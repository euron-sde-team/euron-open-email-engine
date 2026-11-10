import { type Expression, type SqlBool, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import { BadRequestError, ConflictError, NotFoundError, UnprocessableError } from "../errors";
import { type AudienceDto, type CampaignRow, type CampaignStatsDto, EMPTY_STATS, toCampaignDto } from "../presenters/campaigns";
import { clampLimit, EMAIL_RE, iso, isoReq, normEmail, num } from "../presenters/common";
import { enqueue } from "../queue/work";
import { linkBase, unsubscribeUrl } from "../utils/links";
import { extractLinks, renderEmail, tagsIn } from "../utils/render";
import { rulesToExpression, validateRules } from "../utils/segment-sql";
import auditService from "./audit.service";
import emailResolverService from "./email-resolver.service";
import mailerService from "./mailer.service";
import usageService from "./usage.service";

const MAX_HTML = 500_000;
const MAX_AUDIENCE_LISTS = 50;

export interface PreflightIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

// ─── Audience ────────────────────────────────────────────────────────────────

export const validateAudience = async (tenantId: string, raw: unknown): Promise<AudienceDto> => {
  if (raw === undefined || raw === null) return { type: "ALL" };
  const a = raw as Partial<AudienceDto> & { listIds?: unknown; segmentId?: unknown };
  if (a.type === "ALL") return { type: "ALL" };
  if (a.type === "LISTS") {
    const ids = Array.isArray(a.listIds) ? [...new Set(a.listIds.map(String))] : [];
    if (!ids.length || ids.length > MAX_AUDIENCE_LISTS) throw new BadRequestError("Pick between 1 and 50 lists");
    const found = await db.selectFrom("lists").select("id").where("tenant_id", "=", tenantId).where("id", "in", ids).execute();
    if (found.length !== ids.length) throw new NotFoundError("List not found");
    return { type: "LISTS", listIds: ids };
  }
  if (a.type === "SEGMENT") {
    const id = String(a.segmentId ?? "");
    const seg = await db.selectFrom("segments").select("id").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    if (!seg) throw new NotFoundError("Segment not found");
    return { type: "SEGMENT", segmentId: id };
  }
  throw new BadRequestError("audience.type must be ALL, LISTS or SEGMENT");
};

/** Contacts matched by an audience, as a condition on `contacts`. */
const audiencePredicate = async (tenantId: string, a: AudienceDto): Promise<((eb: never) => Expression<SqlBool>) | null> => {
  if (a.type === "ALL") return null;
  if (a.type === "LISTS") {
    return () =>
      sql<boolean>`EXISTS (SELECT 1 FROM list_members lm WHERE lm.contact_id = contacts.id AND lm.tenant_id = ${tenantId} AND lm.status = 'subscribed' AND lm.list_id IN (${sql.join(a.listIds)}))`;
  }
  const seg = await db.selectFrom("segments").select("rules").where("id", "=", a.segmentId).where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!seg) throw new NotFoundError("Segment not found");
  const rules = validateRules(seg.rules);
  return (eb) => rulesToExpression(eb as never, rules);
};

// Why a matched contact is not sent to, evaluated in SQL so the snapshot is one statement.
const SKIP_CASE = sql<string | null>`CASE
  WHEN contacts.status = 'UNSUBSCRIBED' THEN 'UNSUBSCRIBED'
  WHEN contacts.status = 'BOUNCED' THEN 'BOUNCED'
  WHEN contacts.status = 'COMPLAINED' THEN 'COMPLAINED'
  WHEN contacts.status = 'PENDING_CONFIRMATION' THEN 'PENDING_CONFIRMATION'
  WHEN EXISTS (SELECT 1 FROM email_suppressions s WHERE s.tenant_id = contacts.tenant_id AND s.email = contacts.email AND (s.category_scope IS NULL OR s.category_scope = 'MARKETING')) THEN 'SUPPRESSED'
  ELSE NULL END`;

class CampaignsService {
  // ─── Reads ─────────────────────────────────────────────────────────────

  async statsFor(tenantId: string, ids: string[]): Promise<Map<string, CampaignStatsDto>> {
    const out = new Map<string, CampaignStatsDto>();
    if (!ids.length) return out;
    for (const id of ids) out.set(id, { ...EMPTY_STATS });
    const [rec, msg, uns] = await Promise.all([
      db
        .selectFrom("campaign_recipients")
        .select(["campaign_id", sql<string>`count(*)`.as("recipients"), sql<string>`count(*) filter (where status = 'SKIPPED')`.as("skipped")])
        .where("tenant_id", "=", tenantId)
        .where("campaign_id", "in", ids)
        .groupBy("campaign_id")
        .execute(),
      db
        .selectFrom("email_messages")
        .select([
          "campaign_id",
          sql<string>`count(*) filter (where sent_at is not null)`.as("sent"),
          sql<string>`count(*) filter (where delivered_at is not null)`.as("delivered"),
          sql<string>`count(*) filter (where opened_at is not null)`.as("opened"),
          sql<string>`count(*) filter (where clicked_at is not null)`.as("clicked"),
          sql<string>`count(*) filter (where bounced_at is not null)`.as("bounced"),
          sql<string>`count(*) filter (where complained_at is not null)`.as("complained"),
        ])
        .where("tenant_id", "=", tenantId)
        .where("campaign_id", "in", ids)
        .groupBy("campaign_id")
        .execute(),
      db
        .selectFrom("email_events")
        .select(["campaign_id", sql<string>`count(*)`.as("n")])
        .where("tenant_id", "=", tenantId)
        .where("type", "=", "UNSUBSCRIBE")
        .where("campaign_id", "in", ids)
        .groupBy("campaign_id")
        .execute(),
    ]);
    for (const r of rec) Object.assign(out.get(r.campaign_id as string)!, { recipients: num(r.recipients), skipped: num(r.skipped) });
    for (const r of msg) {
      Object.assign(out.get(r.campaign_id as string)!, {
        sent: num(r.sent), delivered: num(r.delivered), opened: num(r.opened), clicked: num(r.clicked), bounced: num(r.bounced), complained: num(r.complained),
      });
    }
    for (const r of uns) out.get(r.campaign_id as string)!.unsubscribed = num(r.n);
    return out;
  }

  async rowOf(tenantId: string, id: string): Promise<CampaignRow> {
    const r = await db.selectFrom("campaigns").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!r) throw new NotFoundError("Campaign not found");
    return r;
  }

  async get(tenantId: string, id: string) {
    const r = await this.rowOf(tenantId, id);
    return toCampaignDto(r, (await this.statsFor(tenantId, [id])).get(id));
  }

  async list(tenantId: string, q: { status?: string; cursor?: string; limit?: unknown }) {
    const limit = clampLimit(q.limit, 50, 200);
    let qb = db.selectFrom("campaigns").selectAll().where("tenant_id", "=", tenantId);
    if (q.status) {
      const st = q.status.toUpperCase();
      if (!["DRAFT", "SCHEDULED", "SENDING", "PAUSED", "SENT", "CANCELLED", "FAILED"].includes(st)) throw new BadRequestError("Invalid status");
      qb = qb.where("status", "=", st as never);
    }
    if (q.cursor) qb = qb.where("id", "<", q.cursor);
    const rows = await qb.orderBy("id", "desc").limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    const stats = await this.statsFor(tenantId, page.map((r) => r.id));
    return { items: page.map((r) => toCampaignDto(r, stats.get(r.id))), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  // ─── Writes ────────────────────────────────────────────────────────────

  private async assertSender(tenantId: string, id: unknown): Promise<string | null> {
    if (id === null || id === undefined || id === "") return null;
    const s = await db.selectFrom("email_sender_identities").select("id").where("id", "=", String(id)).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!s) throw new NotFoundError("Sender not found");
    return s.id;
  }

  async create(tenantId: string, actorId: string, body: Record<string, unknown>) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new BadRequestError("name is required");
    let subject = body.subject === undefined ? "" : String(body.subject);
    let preheader = body.preheader === undefined ? "" : String(body.preheader);
    let html = body.html === undefined ? "" : String(body.html);
    let templateId: string | null = null;
    if (body.templateId) {
      const t = await db.selectFrom("templates").selectAll().where("id", "=", String(body.templateId)).where("tenant_id", "=", tenantId).executeTakeFirst();
      if (!t) throw new NotFoundError("Template not found");
      templateId = t.id;
      if (body.html === undefined) html = t.html;
      if (!subject) subject = t.subject;
      if (body.preheader === undefined) preheader = t.preheader;
    }
    if (!subject.trim()) throw new BadRequestError("subject is required");
    if (html.length > MAX_HTML) throw new BadRequestError("html is too large");
    const senderId = await this.assertSender(tenantId, body.senderIdentityId);
    const audience = await validateAudience(tenantId, body.audience);
    const now = new Date();
    const id = ulid();
    await db
      .insertInto("campaigns")
      .values({
        id, tenant_id: tenantId, name: name.slice(0, 150), status: "DRAFT", subject: subject.slice(0, 300), preheader: preheader.slice(0, 300), html,
        template_id: templateId, sender_identity_id: senderId, audience: JSON.stringify(audience), created_by: actorId, created_at: now, updated_at: now,
      })
      .execute();
    auditService.record(tenantId, actorId, "campaign.created", "campaign", id, {});
    return this.get(tenantId, id);
  }

  async update(tenantId: string, actorId: string, id: string, body: Record<string, unknown>) {
    const cur = await this.rowOf(tenantId, id);
    if (cur.status !== "DRAFT") throw new ConflictError("Only a draft can be edited. Unschedule or duplicate it first.");
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) {
      if (!String(body.name).trim()) throw new BadRequestError("name cannot be empty");
      patch.name = String(body.name).trim().slice(0, 150);
    }
    if (body.subject !== undefined) {
      if (!String(body.subject).trim()) throw new BadRequestError("subject cannot be empty");
      patch.subject = String(body.subject).slice(0, 300);
    }
    if (body.preheader !== undefined) patch.preheader = String(body.preheader).slice(0, 300);
    if (body.html !== undefined) {
      if (String(body.html).length > MAX_HTML) throw new BadRequestError("html is too large");
      patch.html = String(body.html);
    }
    if (body.templateId !== undefined) {
      if (body.templateId === null) patch.template_id = null;
      else {
        const t = await db.selectFrom("templates").select("id").where("id", "=", String(body.templateId)).where("tenant_id", "=", tenantId).executeTakeFirst();
        if (!t) throw new NotFoundError("Template not found");
        patch.template_id = t.id;
      }
    }
    if (body.senderIdentityId !== undefined) patch.sender_identity_id = await this.assertSender(tenantId, body.senderIdentityId);
    if (body.audience !== undefined) patch.audience = JSON.stringify(await validateAudience(tenantId, body.audience));
    await db.updateTable("campaigns").set(patch).where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "campaign.updated", "campaign", id, { fields: Object.keys(body) });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const cur = await this.rowOf(tenantId, id);
    if (cur.status !== "DRAFT" && cur.status !== "CANCELLED") throw new ConflictError("Only a draft or cancelled campaign can be deleted");
    await db.deleteFrom("campaigns").where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "campaign.deleted", "campaign", id, {});
    return { id };
  }

  async duplicate(tenantId: string, actorId: string, id: string) {
    const c = await this.rowOf(tenantId, id);
    return this.create(tenantId, actorId, {
      name: `${c.name} (copy)`, subject: c.subject, preheader: c.preheader, html: c.html, senderIdentityId: c.sender_identity_id, audience: c.audience,
    });
  }

  // ─── Preview, preflight, test ──────────────────────────────────────────

  async preview(tenantId: string, id: string, contactId?: string) {
    const c = await this.rowOf(tenantId, id);
    const tenant = await db.selectFrom("tenants").select(["name", "company_address"]).where("id", "=", tenantId).executeTakeFirst();
    let contact = { email: "alex.rivera@example.com", firstName: "Alex", lastName: "Rivera", attributes: {} as Record<string, unknown> };
    if (contactId) {
      const r = await db.selectFrom("contacts").selectAll().where("id", "=", contactId).where("tenant_id", "=", tenantId).executeTakeFirst();
      if (!r) throw new NotFoundError("Contact not found");
      contact = { email: r.email, firstName: r.first_name ?? "", lastName: r.last_name ?? "", attributes: (r.attributes ?? {}) as Record<string, unknown> };
    }
    // With a real contact the unsubscribe link is real too (it works if opened).
    return renderEmail({
      subject: c.subject, preheader: c.preheader, html: c.html, contact,
      company: { name: tenant?.name, address: tenant?.company_address },
      unsubscribeUrl: contactId ? unsubscribeUrl(linkBase(), tenantId, contactId, null) : "https://example.com/unsubscribe-preview",
      viewUrl: "https://example.com/view-preview",
    });
  }

  /** Counts of who would be sent to and who would be skipped, without writing anything. */
  async audienceCounts(tenantId: string, audience: AudienceDto): Promise<{ sendable: number; skipped: number }> {
    const pred = await audiencePredicate(tenantId, audience);
    let qb = db
      .selectFrom("contacts")
      .select([sql<string>`count(*) filter (where ${SKIP_CASE} is null)`.as("sendable"), sql<string>`count(*) filter (where ${SKIP_CASE} is not null)`.as("skipped")])
      .where("tenant_id", "=", tenantId);
    if (pred) qb = qb.where((eb) => pred(eb as never));
    const r = await qb.executeTakeFirst();
    return { sendable: num(r?.sendable), skipped: num(r?.skipped) };
  }

  async preflight(tenantId: string, id: string) {
    const c = await this.rowOf(tenantId, id);
    const issues: PreflightIssue[] = [];
    const err = (code: string, message: string) => issues.push({ severity: "error", code, message });
    const warn = (code: string, message: string) => issues.push({ severity: "warning", code, message });

    if (!c.subject.trim()) err("NO_SUBJECT", "Add a subject line.");
    if (!c.html.trim()) err("NO_CONTENT", "The campaign has no content.");

    const sender = c.sender_identity_id ? await emailResolverService.resolveIdentity(tenantId, c.sender_identity_id) : null;
    if (!c.sender_identity_id) err("NO_SENDER", "Choose a sender.");
    else if (!sender) err("DOMAIN_NOT_VERIFIED", "The sender's domain is not verified, or the sender is archived.");

    const tenant = await db.selectFrom("tenants").select(["email_sending_status", "company_address"]).where("id", "=", tenantId).executeTakeFirst();
    if (tenant?.email_sending_status === "PAUSED") err("SENDING_PAUSED", "Sending is paused for this workspace because of bounce or complaint rates.");
    else if (tenant?.email_sending_status === "THROTTLED") warn("SENDING_THROTTLED", "Sending is slowed because of recent bounce or complaint rates.");
    else if (tenant?.email_sending_status === "WARNING") warn("SENDING_WARNING", "Recent bounce or complaint rates are elevated. Check your list quality.");

    let sendable = 0;
    let skipped = 0;
    try {
      ({ sendable, skipped } = await this.audienceCounts(tenantId, c.audience as AudienceDto));
    } catch {
      err("AUDIENCE_INVALID", "The audience no longer exists. Choose another.");
    }
    if (sendable === 0 && !issues.some((i) => i.code === "AUDIENCE_INVALID")) err("NO_RECIPIENTS", "No one in this audience can receive the campaign.");

    const limit = await usageService.monthlyLimit(tenantId);
    const used = await usageService.emailsSentThisMonth(tenantId);
    const remaining = limit === null ? null : Math.max(0, limit - used);
    if (remaining !== null && sendable > remaining) {
      err("QUOTA_EXCEEDED", `This campaign needs ${sendable.toLocaleString("en-US")} emails but ${remaining.toLocaleString("en-US")} remain this month.`);
    }

    if (c.html && !tagsIn(c.html).includes("unsubscribe_url")) warn("NO_UNSUBSCRIBE_TAG", "The content has no unsubscribe link. A footer with one is added automatically.");
    if (!tenant?.company_address?.trim()) warn("NO_COMPANY_ADDRESS", "Add your postal address in Settings. Many countries require it in marketing email.");
    if (c.html && extractLinks(c.html).length === 0) warn("NO_LINKS", "The content has no links, so clicks cannot be tracked.");

    return {
      ok: !issues.some((i) => i.severity === "error"),
      recipients: sendable,
      suppressed: skipped,
      quotaRemaining: remaining,
      issues,
    };
  }

  async sendTest(tenantId: string, id: string, to: unknown) {
    const c = await this.rowOf(tenantId, id);
    const list = Array.isArray(to) ? [...new Set(to.map(normEmail))] : [];
    if (!list.length) throw new BadRequestError("Give at least one address in `to`");
    if (list.length > 5) throw new BadRequestError("At most 5 test addresses");
    if (list.some((e) => !EMAIL_RE.test(e))) throw new BadRequestError("Every test address must be a valid email");
    if (!c.sender_identity_id) throw new UnprocessableError("Choose a sender first");
    const sender = await emailResolverService.resolveIdentity(tenantId, c.sender_identity_id);
    if (!sender) throw new UnprocessableError("The sender's domain is not verified");
    const tenant = await db.selectFrom("tenants").select(["name", "company_address"]).where("id", "=", tenantId).executeTakeFirst();

    const results: Array<{ to: string; status: string }> = [];
    for (const email of list) {
      const r = await mailerService.sendTenant({
        tenantId, sender, category: "TRANSACTIONAL", to: email, countTowardQuota: false,
        build: () => {
          const out = renderEmail({
            subject: `[Test] ${c.subject}`, preheader: c.preheader, html: c.html,
            contact: { email, firstName: "Alex", lastName: "Rivera" },
            company: { name: tenant?.name, address: tenant?.company_address },
            unsubscribeUrl: "https://example.com/unsubscribe-preview", viewUrl: "https://example.com/view-preview",
          });
          return { subject: out.subject, html: out.html, text: out.text };
        },
      });
      results.push({ to: email, status: r.status });
    }
    return { results };
  }

  // ─── State machine ─────────────────────────────────────────────────────

  async schedule(tenantId: string, actorId: string, id: string, body: { at?: string }) {
    const c = await this.rowOf(tenantId, id);
    if (c.status !== "DRAFT" && c.status !== "SCHEDULED") throw new ConflictError(`A ${c.status.toLowerCase()} campaign cannot be scheduled`);
    const pre = await this.preflight(tenantId, id);
    if (!pre.ok) {
      throw new UnprocessableError(pre.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" "));
    }
    if (body.at === undefined || body.at === null) {
      await this.start(tenantId, id);
      auditService.record(tenantId, actorId, "campaign.sent", "campaign", id, {});
      return this.get(tenantId, id);
    }
    const at = new Date(body.at);
    if (Number.isNaN(at.getTime())) throw new BadRequestError("`at` must be an ISO-8601 time");
    if (at.getTime() <= Date.now()) throw new BadRequestError("`at` must be in the future");
    if (at.getTime() > Date.now() + 366 * 86400000) throw new BadRequestError("`at` is more than a year away");
    await db.updateTable("campaigns").set({ status: "SCHEDULED", scheduled_at: at, paused_reason: null, updated_at: new Date() }).where("id", "=", id).where("tenant_id", "=", tenantId).where("status", "in", ["DRAFT", "SCHEDULED"]).execute();
    auditService.record(tenantId, actorId, "campaign.scheduled", "campaign", id, { at: at.toISOString() });
    return this.get(tenantId, id);
  }

  async unschedule(tenantId: string, actorId: string, id: string) {
    const r = await db.updateTable("campaigns").set({ status: "DRAFT", scheduled_at: null, updated_at: new Date() }).where("id", "=", id).where("tenant_id", "=", tenantId).where("status", "=", "SCHEDULED").executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) {
      await this.rowOf(tenantId, id);
      throw new ConflictError("Only a scheduled campaign can be unscheduled");
    }
    auditService.record(tenantId, actorId, "campaign.unscheduled", "campaign", id, {});
    return this.get(tenantId, id);
  }

  async pause(tenantId: string, actorId: string, id: string) {
    const r = await db.updateTable("campaigns").set({ status: "PAUSED", paused_reason: "Paused by a user", updated_at: new Date() }).where("id", "=", id).where("tenant_id", "=", tenantId).where("status", "=", "SENDING").executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) {
      await this.rowOf(tenantId, id);
      throw new ConflictError("Only a sending campaign can be paused");
    }
    auditService.record(tenantId, actorId, "campaign.paused", "campaign", id, {});
    return this.get(tenantId, id);
  }

  async resume(tenantId: string, actorId: string, id: string) {
    const c = await this.rowOf(tenantId, id);
    if (c.status !== "PAUSED") throw new ConflictError("Only a paused campaign can be resumed");
    const blockers = await this.sendBlockers(tenantId, c);
    if (blockers) throw new UnprocessableError(blockers);
    // A campaign paused before its audience was snapshotted (it was SCHEDULED) starts fresh.
    const snap = await db.selectFrom("campaign_recipients").select("id").where("campaign_id", "=", id).limit(1).executeTakeFirst();
    if (!snap) {
      await db.updateTable("campaigns").set({ status: "DRAFT", paused_reason: null, updated_at: new Date() }).where("id", "=", id).where("tenant_id", "=", tenantId).where("status", "=", "PAUSED").execute();
      await this.start(tenantId, id);
      auditService.record(tenantId, actorId, "campaign.resumed", "campaign", id, {});
      return this.get(tenantId, id);
    }
    await db.updateTable("campaigns").set({ status: "SENDING", paused_reason: null, updated_at: new Date() }).where("id", "=", id).where("tenant_id", "=", tenantId).where("status", "=", "PAUSED").execute();
    auditService.record(tenantId, actorId, "campaign.resumed", "campaign", id, {});
    await enqueue({ kind: "campaign", id });
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const r = await db.updateTable("campaigns").set({ status: "CANCELLED", completed_at: new Date(), paused_reason: null, updated_at: new Date() }).where("id", "=", id).where("tenant_id", "=", tenantId).where("status", "in", ["SCHEDULED", "SENDING", "PAUSED"]).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) {
      await this.rowOf(tenantId, id);
      throw new ConflictError("This campaign can no longer be cancelled");
    }
    await db.updateTable("campaign_recipients").set({ status: "SKIPPED", skip_reason: "CAMPAIGN_CANCELLED", updated_at: new Date() }).where("campaign_id", "=", id).where("tenant_id", "=", tenantId).where("status", "=", "QUEUED").execute();
    auditService.record(tenantId, actorId, "campaign.cancelled", "campaign", id, {});
    return this.get(tenantId, id);
  }

  /** A reason the campaign cannot send right now, or null. */
  private async sendBlockers(tenantId: string, c: CampaignRow): Promise<string | null> {
    if (!c.sender_identity_id || !(await emailResolverService.resolveIdentity(tenantId, c.sender_identity_id))) {
      return "The sender's domain is not verified.";
    }
    const t = await db.selectFrom("tenants").select(["status", "email_sending_status"]).where("id", "=", tenantId).executeTakeFirst();
    if (!t || t.status !== "ACTIVE") return "Workspace suspended";
    if (t.email_sending_status === "PAUSED") return "Sending is paused for this workspace.";
    return null;
  }

  /**
   * Snapshots the audience and starts sending. One transaction: the campaign row is locked,
   * its recipients are written in a single INSERT ... SELECT (deduplicated by contact, with
   * suppressed or unsubscribed contacts recorded as skipped), and it becomes SENDING.
   */
  async start(tenantId: string, id: string): Promise<void> {
    const c = await this.rowOf(tenantId, id);
    if (c.status !== "DRAFT" && c.status !== "SCHEDULED") throw new ConflictError("This campaign has already started");
    const blockers = await this.sendBlockers(tenantId, c);
    if (blockers) throw new UnprocessableError(blockers);
    const pred = await audiencePredicate(tenantId, c.audience as AudienceDto);

    await db.transaction().execute(async (trx) => {
      const locked = await sql<{ status: string }>`SELECT status FROM campaigns WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`.execute(trx);
      if (!["DRAFT", "SCHEDULED"].includes(locked.rows[0]?.status)) throw new ConflictError("This campaign has already started");
      const now = new Date();
      let sel = trx
        .selectFrom("contacts")
        .select([
          sql<string>`gen_random_uuid()::text`.as("id"),
          sql<string>`${tenantId}`.as("tenant_id"),
          sql<string>`${id}`.as("campaign_id"),
          "contacts.id as contact_id",
          "contacts.email as email",
          sql<string>`CASE WHEN ${SKIP_CASE} IS NULL THEN 'QUEUED' ELSE 'SKIPPED' END::recipient_status`.as("status"),
          SKIP_CASE.as("skip_reason"),
          sql<Date>`${now}`.as("created_at"),
          sql<Date>`${now}`.as("updated_at"),
        ])
        .where("contacts.tenant_id", "=", tenantId);
      if (pred) sel = sel.where((eb) => pred(eb as never));
      await trx
        .insertInto("campaign_recipients")
        .columns(["id", "tenant_id", "campaign_id", "contact_id", "email", "status", "skip_reason", "created_at", "updated_at"])
        .expression(sel)
        .onConflict((oc) => oc.columns(["campaign_id", "contact_id"]).doNothing())
        .execute();

      // The quota gate: the snapshot must fit what is left of this month.
      const queued = await trx.selectFrom("campaign_recipients").select(sql<string>`count(*)`.as("n")).where("campaign_id", "=", id).where("status", "=", "QUEUED").executeTakeFirst();
      const limit = await usageService.monthlyLimit(tenantId);
      if (limit !== null) {
        const remaining = Math.max(0, limit - (await usageService.emailsSentThisMonth(tenantId)));
        if (num(queued?.n) > remaining) {
          throw new UnprocessableError(`This campaign needs ${num(queued?.n).toLocaleString("en-US")} emails but ${remaining.toLocaleString("en-US")} remain this month.`);
        }
      }
      await trx.updateTable("campaigns").set({ status: "SENDING", started_at: now, paused_reason: null, updated_at: now }).where("id", "=", id).execute();
    });
    await enqueue({ kind: "campaign", id });
  }

  // ─── Reports ───────────────────────────────────────────────────────────

  async recipients(tenantId: string, id: string, q: { status?: string; cursor?: string; limit?: unknown }) {
    await this.rowOf(tenantId, id);
    const limit = clampLimit(q.limit, 50, 200);
    let qb = db
      .selectFrom("campaign_recipients as r")
      .leftJoin("email_messages as m", "m.id", "r.message_id")
      .select(["r.id", "r.contact_id", "r.email", "r.status", "r.skip_reason", "m.open_count", "m.click_count", sql<Date | null>`GREATEST(m.opened_at, m.clicked_at, m.delivered_at, m.bounced_at, m.complained_at)`.as("last_event_at")])
      .where("r.tenant_id", "=", tenantId)
      .where("r.campaign_id", "=", id);
    if (q.status) {
      const st = q.status.toUpperCase();
      if (!["QUEUED", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "SKIPPED", "FAILED"].includes(st)) throw new BadRequestError("Invalid status");
      qb = qb.where("r.status", "=", st as never);
    }
    if (q.cursor) qb = qb.where("r.id", ">", q.cursor);
    const rows = await qb.orderBy("r.id").limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        contactId: r.contact_id, email: r.email, status: r.status, opens: r.open_count ?? 0, clicks: r.click_count ?? 0,
        lastEventAt: iso(r.last_event_at), skipReason: r.skip_reason,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async report(tenantId: string, id: string) {
    const row = await this.rowOf(tenantId, id);
    const stats = (await this.statsFor(tenantId, [id])).get(id) as CampaignStatsDto;
    const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 10000 : 0);
    const anchor = row.started_at ?? row.created_at;

    const [timeline, links, bounces, domains, machine] = await Promise.all([
      sql<{ bucket: Date; opens: string; clicks: string }>`
        SELECT CASE WHEN occurred_at < ${anchor}::timestamp + interval '48 hours' THEN date_trunc('hour', occurred_at) ELSE date_trunc('day', occurred_at) END AS bucket,
               count(*) FILTER (WHERE type = 'OPEN') AS opens,
               count(*) FILTER (WHERE type = 'CLICK' AND NOT machine) AS clicks
        FROM email_events WHERE tenant_id = ${tenantId} AND campaign_id = ${id} AND type IN ('OPEN','CLICK')
        GROUP BY 1 ORDER BY 1`.execute(db),
      sql<{ url: string; clicks: string; unique_clicks: string }>`
        SELECT l.url, count(e.id) AS clicks, count(DISTINCT e.message_id) AS unique_clicks
        FROM campaign_links l
        LEFT JOIN email_events e ON e.campaign_id = l.campaign_id AND e.tenant_id = l.tenant_id AND e.type = 'CLICK' AND NOT e.machine AND e.url = l.url
        WHERE l.tenant_id = ${tenantId} AND l.campaign_id = ${id}
        GROUP BY l.url ORDER BY clicks DESC, l.url LIMIT 100`.execute(db),
      sql<{ reason: string; n: string }>`
        SELECT COALESCE(NULLIF(bounce_reason, ''), bounce_type, 'Unknown') AS reason, count(*) AS n
        FROM email_messages WHERE tenant_id = ${tenantId} AND campaign_id = ${id} AND bounced_at IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 20`.execute(db),
      sql<{ domain: string; delivered: string; opened: string; bounced: string }>`
        SELECT split_part(to_address, '@', 2) AS domain,
               count(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
               count(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
               count(*) FILTER (WHERE bounced_at IS NOT NULL) AS bounced
        FROM email_messages WHERE tenant_id = ${tenantId} AND campaign_id = ${id}
        GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 10`.execute(db),
      sql<{ n: string }>`SELECT count(*) AS n FROM email_events WHERE tenant_id = ${tenantId} AND campaign_id = ${id} AND type = 'OPEN' AND machine`.execute(db),
    ]);

    return {
      campaign: toCampaignDto(row, stats),
      rates: {
        delivery: ratio(stats.delivered, stats.sent),
        open: ratio(stats.opened, stats.delivered),
        click: ratio(stats.clicked, stats.delivered),
        clickToOpen: ratio(stats.clicked, stats.opened),
        bounce: ratio(stats.bounced, stats.sent),
        complaint: ratio(stats.complained, stats.sent),
        unsubscribe: ratio(stats.unsubscribed, stats.delivered),
      },
      timeline: timeline.rows.map((r) => ({ at: isoReq(r.bucket), opens: num(r.opens), clicks: num(r.clicks) })),
      links: links.rows.map((r) => ({ url: r.url, clicks: num(r.clicks), uniqueClicks: num(r.unique_clicks) })),
      bounces: bounces.rows.map((r) => ({ reason: r.reason, count: num(r.n) })),
      topDomains: domains.rows.map((r) => ({ domain: r.domain, delivered: num(r.delivered), opened: num(r.opened), bounced: num(r.bounced) })),
      machineOpens: num(machine.rows[0]?.n),
    };
  }
}

export default new CampaignsService();
