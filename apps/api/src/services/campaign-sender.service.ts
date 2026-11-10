import { sql } from "kysely";
import config from "../config";
import { db } from "../db/connection";
import { registerHandler, enqueue } from "../queue/work";
import { clickUrl, linkBase, openPixelUrl, unsubscribeUrl, viewUrl } from "../utils/links";
import logger from "../utils/logger";
import { extractLinks, renderEmail } from "../utils/render";
import { randomLinkToken } from "../utils/tokens";
import emailResolverService from "./email-resolver.service";
import mailerService from "./mailer.service";
import reputationService from "./reputation.service";
import campaignsService from "./campaigns.service";
import { ulid } from "ulid";

const CLAIM_TTL_MIN = 5;
// One queue job works on a campaign for at most this long, then re-enqueues itself.
const JOB_BUDGET_MS = 25_000;

export const SUSPENDED_REASON = "Workspace suspended";

type CampaignRow = Awaited<ReturnType<typeof campaignsService.rowOf>>;

class CampaignSender {
  /** Freezes every SENDING campaign of a tenant; called when reputation reaches PAUSED. */
  async pauseTenant(tenantId: string, reason: string): Promise<void> {
    await db
      .updateTable("campaigns")
      .set({ status: "PAUSED", paused_reason: reason, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "SENDING")
      .execute();
  }

  /** Stops every in-flight or scheduled campaign of a tenant that was suspended or closed. */
  async suspendTenant(tenantId: string): Promise<void> {
    await db
      .updateTable("campaigns")
      .set({ status: "PAUSED", paused_reason: SUSPENDED_REASON, updated_at: new Date() })
      .where("tenant_id", "=", tenantId)
      .where("status", "in", ["SENDING", "SCHEDULED"])
      .execute();
  }

  private async pauseCampaign(id: string, reason: string): Promise<void> {
    await db
      .updateTable("campaigns")
      .set({ status: "PAUSED", paused_reason: reason, updated_at: new Date() })
      .where("id", "=", id)
      .where("status", "=", "SENDING")
      .execute();
  }

  private async isSending(id: string): Promise<boolean> {
    const r = await db.selectFrom("campaigns").select("status").where("id", "=", id).executeTakeFirst();
    return r?.status === "SENDING";
  }

  /** Takes a batch of QUEUED recipients; SKIP LOCKED so parallel workers never share rows. */
  private async claim(campaignId: string, n: number) {
    const res = await sql<{ id: string; contact_id: string | null; email: string }>`
      UPDATE campaign_recipients SET claimed_at = now()
      WHERE id IN (
        SELECT id FROM campaign_recipients
        WHERE campaign_id = ${campaignId} AND status = 'QUEUED'
          AND (claimed_at IS NULL OR claimed_at < now() - make_interval(mins => ${CLAIM_TTL_MIN}))
        ORDER BY id LIMIT ${n} FOR UPDATE SKIP LOCKED)
      RETURNING id, contact_id, email`.execute(db);
    return res.rows;
  }

  private async ensureLinks(tenantId: string, campaignId: string, html: string): Promise<Map<string, string>> {
    const urls = extractLinks(html);
    const map = new Map<string, string>();
    if (!urls.length) return map;
    const now = new Date();
    await db
      .insertInto("campaign_links")
      .values(urls.map((url) => ({ id: ulid(), tenant_id: tenantId, campaign_id: campaignId, url, token: randomLinkToken(), created_at: now })))
      .onConflict((oc) => oc.columns(["campaign_id", "url"]).doNothing())
      .execute();
    const rows = await db.selectFrom("campaign_links").select(["url", "token"]).where("campaign_id", "=", campaignId).where("tenant_id", "=", tenantId).execute();
    for (const r of rows) map.set(r.url, r.token);
    return map;
  }

  /** Works through a campaign until it is done, paused, or the time budget runs out. */
  async run(campaignId: string, budgetMs = JOB_BUDGET_MS): Promise<void> {
    const deadline = Date.now() + budgetMs;
    const campaign = await db.selectFrom("campaigns").selectAll().where("id", "=", campaignId).executeTakeFirst();
    if (!campaign || campaign.status !== "SENDING") return;
    const tenantId = campaign.tenant_id;
    const tenant = await db.selectFrom("tenants").select(["name", "company_address"]).where("id", "=", tenantId).executeTakeFirst();
    const links = await this.ensureLinks(tenantId, campaignId, campaign.html);

    while (Date.now() < deadline) {
      if (!(await this.isSending(campaignId))) return;
      const t = await db.selectFrom("tenants").select(["status", "email_sending_status"]).where("id", "=", tenantId).executeTakeFirst();
      if (!t || t.status !== "ACTIVE") return this.pauseCampaign(campaignId, SUSPENDED_REASON);
      if (t.email_sending_status === "PAUSED") return this.pauseCampaign(campaignId, "Tenant sending paused");
      const sender = campaign.sender_identity_id ? await emailResolverService.resolveIdentity(tenantId, campaign.sender_identity_id) : null;
      if (!sender) return this.pauseCampaign(campaignId, "Sender or domain not verified");

      const batch = await this.claim(campaignId, config.EMAIL_SEND_BATCH);
      if (!batch.length) {
        const left = await db.selectFrom("campaign_recipients").select(sql<string>`count(*)`.as("n")).where("campaign_id", "=", campaignId).where("status", "=", "QUEUED").executeTakeFirst();
        if (Number(left?.n ?? 0) === 0) {
          await db
            .updateTable("campaigns")
            .set({ status: "SENT", completed_at: new Date(), updated_at: new Date() })
            .where("id", "=", campaignId)
            .where("status", "=", "SENDING")
            .execute();
          return;
        }
        // Rows are claimed by another worker (or waiting out a stale claim): look again later.
        return enqueue({ kind: "campaign", id: campaignId }, { delayMs: 5000 });
      }

      const contactIds = batch.map((b) => b.contact_id).filter((x): x is string => !!x);
      const contacts = new Map(
        (await db.selectFrom("contacts").selectAll().where("tenant_id", "=", tenantId).where("id", "in", contactIds.length ? contactIds : ["-"]).execute()).map((c) => [c.id, c])
      );

      for (const r of batch) {
        if (!(await this.isSending(campaignId))) {
          await this.unclaim(r.id);
          continue;
        }
        const contact = r.contact_id ? contacts.get(r.contact_id) : undefined;
        if (!contact || contact.status !== "SUBSCRIBED") {
          await this.skip(r.id, contact ? contact.status : "CONTACT_DELETED");
          continue;
        }
        const out = await mailerService.sendTenant({
          tenantId,
          sender,
          category: "MARKETING",
          to: contact.email,
          contactId: contact.id,
          campaignId,
          idempotencyKey: `campaign:${campaignId}:${contact.id}`,
          build: ({ messageId }) => this.build(campaign, tenant, contact, messageId, sender.trackingDomain, links),
        });
        switch (out.status) {
          case "sent":
            await this.markSent(r.id, out.messageId);
            break;
          case "duplicate":
            await this.markSent(r.id, out.messageId ?? null);
            break;
          case "suppressed":
            await this.skip(r.id, "SUPPRESSED");
            break;
          case "quota":
            await this.skip(r.id, "OVER_QUOTA");
            break;
          case "failed":
            await db.updateTable("campaign_recipients").set({ status: "FAILED", message_id: out.messageId ?? null, claimed_at: null, updated_at: new Date() }).where("id", "=", r.id).execute();
            break;
          case "gated":
            await this.unclaim(r.id);
            return this.pauseCampaign(campaignId, "Tenant sending paused");
          default: // rate_limited
            await this.unclaim(r.id);
        }
      }
    }
    // Out of time with work left: continue in a fresh job.
    if (await this.isSending(campaignId)) await enqueue({ kind: "campaign", id: campaignId });
  }

  private build(
    c: CampaignRow,
    tenant: { name: string; company_address: string | null } | undefined,
    contact: { id: string; email: string; first_name: string | null; last_name: string | null; attributes: unknown },
    messageId: string,
    trackingDomain: string | null,
    links: Map<string, string>
  ) {
    const base = linkBase(trackingDomain);
    const unsub = unsubscribeUrl(base, c.tenant_id, contact.id, messageId);
    const out = renderEmail({
      subject: c.subject,
      preheader: c.preheader,
      html: c.html,
      contact: { email: contact.email, firstName: contact.first_name, lastName: contact.last_name, attributes: (contact.attributes ?? {}) as Record<string, unknown> },
      company: { name: tenant?.name, address: tenant?.company_address },
      unsubscribeUrl: unsub,
      viewUrl: viewUrl(base, messageId),
      trackLink: (url) => {
        const token = links.get(url);
        return token ? clickUrl(base, messageId, token) : null;
      },
      pixelUrl: openPixelUrl(base, messageId),
    });
    return {
      subject: out.subject,
      html: out.html,
      text: out.text,
      headers: [
        { name: "List-Unsubscribe", value: `<${unsub}>` },
        { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
      ],
    };
  }

  private async markSent(recipientId: string, messageId: string | null): Promise<void> {
    // The simulator may already have moved the row to DELIVERED/BOUNCED: never downgrade it.
    await db.updateTable("campaign_recipients").set({ message_id: messageId, claimed_at: null, updated_at: new Date() }).where("id", "=", recipientId).execute();
    await db.updateTable("campaign_recipients").set({ status: "SENT" }).where("id", "=", recipientId).where("status", "=", "QUEUED").execute();
  }

  private async skip(recipientId: string, reason: string): Promise<void> {
    await db.updateTable("campaign_recipients").set({ status: "SKIPPED", skip_reason: reason, claimed_at: null, updated_at: new Date() }).where("id", "=", recipientId).execute();
  }

  private async unclaim(recipientId: string): Promise<void> {
    await db.updateTable("campaign_recipients").set({ claimed_at: null }).where("id", "=", recipientId).where("status", "=", "QUEUED").execute();
  }

  /** The scheduler tick: start due campaigns, and keep SENDING campaigns moving. */
  async tick(): Promise<void> {
    const due = await db
      .selectFrom("campaigns")
      .select(["id", "tenant_id"])
      .where("status", "=", "SCHEDULED")
      .where("scheduled_at", "<=", new Date())
      .orderBy("scheduled_at")
      .limit(20)
      .execute();
    for (const d of due) {
      const owner = await db.selectFrom("tenants").select("status").where("id", "=", d.tenant_id).executeTakeFirst();
      if (!owner || owner.status !== "ACTIVE") {
        // Never start for a suspended or closed workspace; stop it visibly instead.
        await db.updateTable("campaigns").set({ status: "PAUSED", paused_reason: SUSPENDED_REASON, updated_at: new Date() }).where("id", "=", d.id).where("status", "=", "SCHEDULED").execute();
        continue;
      }
      try {
        await campaignsService.start(d.tenant_id, d.id);
      } catch (err) {
        // A scheduled campaign that cannot start (domain lost, tenant paused, quota) stops visibly.
        logger.warn(`scheduled campaign ${d.id} could not start: ${String(err)}`);
        await db
          .updateTable("campaigns")
          .set({ status: "PAUSED", paused_reason: err instanceof Error ? err.message.slice(0, 200) : "Could not start", updated_at: new Date() })
          .where("id", "=", d.id)
          .where("status", "=", "SCHEDULED")
          .execute();
      }
    }
    const sending = await db.selectFrom("campaigns").select("id").where("status", "=", "SENDING").limit(50).execute();
    for (const s of sending) await enqueue({ kind: "campaign", id: s.id });
  }
}

const sender = new CampaignSender();
registerHandler("campaign", (id) => sender.run(id));
reputationService.onPaused((tenantId, reason) => sender.pauseTenant(tenantId, reason));
export default sender;
