import { db } from "../db/connection";
import { clickUrlIsSafe } from "../utils/url-safety";
import { classifyHit } from "../utils/open-classify";
import { linkBase, unsubscribeUrl, viewUrl } from "../utils/links";
import { hashIp, verifyToken } from "../utils/tokens";
import { renderEmail } from "../utils/render";
import emailMessagesRepository from "../repositories/email-messages.repository";
import emailSuppressionsRepository from "../repositories/email-suppressions.repository";
import emailEventsService from "./email-events.service";
import auditService from "./audit.service";

export interface HitContext {
  ip?: string;
  userAgent?: string;
  purpose?: string;
}

// The 1x1 transparent GIF the open pixel serves.
export const PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const msgById = async (id: string) =>
  db.selectFrom("email_messages").selectAll().where("id", "=", id).executeTakeFirst();

class TrackingService {
  /** Records an open. Never throws: a broken or forged token still gets the pixel. */
  async open(token: string, hit: HitContext): Promise<void> {
    const t = verifyToken(token, "o");
    if (!t) return;
    const m = await msgById(t.parts[0]);
    if (!m) return;
    const sinceSent = m.sent_at ? Date.now() - new Date(m.sent_at).getTime() : null;
    const cls = classifyHit({ ip: hit.ip, userAgent: hit.userAgent, purpose: hit.purpose, sinceSentMs: sinceSent, kind: "open" });
    await emailEventsService.insertEvent({ tenantId: m.tenant_id, message: m, type: "OPEN", machine: cls.machine, ipHash: hashIp(hit.ip), uaClass: cls.uaClass });
    await emailMessagesRepository.bumpOpen(m.id);
    if (!cls.machine && m.contact_id) {
      await db.updateTable("contacts").set({ last_opened_at: new Date() }).where("id", "=", m.contact_id).where("tenant_id", "=", m.tenant_id).execute();
    }
  }

  /**
   * Resolves a click token to its destination and records the click. The destination is read
   * from campaign_links, never from the token, and must be http(s): there is no open redirect.
   */
  async click(token: string, hit: HitContext): Promise<string | null> {
    const t = verifyToken(token, "c");
    if (!t || t.parts.length !== 2) return null;
    const m = await msgById(t.parts[0]);
    if (!m || !m.campaign_id) return null;
    const link = await db
      .selectFrom("campaign_links")
      .select(["url"])
      .where("campaign_id", "=", m.campaign_id)
      .where("tenant_id", "=", m.tenant_id)
      .where("token", "=", t.parts[1])
      .executeTakeFirst();
    if (!link || !clickUrlIsSafe(link.url)) return null;
    const sinceSent = m.sent_at ? Date.now() - new Date(m.sent_at).getTime() : null;
    const cls = classifyHit({ ip: hit.ip, userAgent: hit.userAgent, purpose: hit.purpose, sinceSentMs: sinceSent, kind: "click" });
    await emailEventsService.insertEvent({ tenantId: m.tenant_id, message: m, type: "CLICK", url: link.url, machine: cls.machine, ipHash: hashIp(hit.ip), uaClass: cls.uaClass });
    if (!cls.machine) {
      await emailMessagesRepository.bumpClick(m.id);
      if (m.contact_id) await db.updateTable("contacts").set({ last_clicked_at: new Date() }).where("id", "=", m.contact_id).where("tenant_id", "=", m.tenant_id).execute();
    }
    return link.url;
  }

  /** Looks the token up without changing anything (the confirm page). */
  async unsubscribeInfo(token: string): Promise<{ email: string; tenantName: string } | null> {
    const t = verifyToken(token, "u");
    if (!t || t.parts.length !== 3) return null;
    const [tenantId, contactId] = t.parts;
    const row = await db
      .selectFrom("contacts as c")
      .innerJoin("tenants as t", "t.id", "c.tenant_id")
      .select(["c.email", "t.name as tenant_name"])
      .where("c.id", "=", contactId)
      .where("c.tenant_id", "=", tenantId)
      .executeTakeFirst();
    return row ? { email: row.email, tenantName: row.tenant_name } : null;
  }

  /** Unsubscribes the contact from marketing mail. Idempotent. */
  async unsubscribe(token: string, via: "page" | "one-click"): Promise<{ email: string; tenantName: string } | null> {
    const t = verifyToken(token, "u");
    if (!t || t.parts.length !== 3) return null;
    const [tenantId, contactId, messageId] = t.parts;
    const info = await this.unsubscribeInfo(token);
    if (!info) return null;
    const now = new Date();
    await db
      .updateTable("contacts")
      .set({ status: "UNSUBSCRIBED", unsubscribed_at: now, updated_at: now })
      .where("id", "=", contactId)
      .where("tenant_id", "=", tenantId)
      .where("status", "in", ["SUBSCRIBED", "PENDING_CONFIRMATION"])
      .execute();
    await db
      .updateTable("list_members")
      .set({ status: "unsubscribed", updated_at: now })
      .where("tenant_id", "=", tenantId)
      .where("contact_id", "=", contactId)
      .where("status", "<>", "unsubscribed")
      .execute();
    await emailSuppressionsRepository.add(tenantId, info.email, "UNSUBSCRIBE", "MARKETING", via === "one-click" ? "One-click unsubscribe" : null);
    if (messageId !== "-") {
      const m = await db.selectFrom("email_messages").selectAll().where("id", "=", messageId).where("tenant_id", "=", tenantId).executeTakeFirst();
      if (m) await emailEventsService.insertEvent({ tenantId, message: m, type: "UNSUBSCRIBE", detail: via });
    }
    auditService.record(tenantId, null, "contact.unsubscribed", "contact", contactId, { via });
    return info;
  }

  /** The "view in browser" copy: the campaign rendered again for the same contact, untracked. */
  async view(token: string): Promise<string | null> {
    const t = verifyToken(token, "w");
    if (!t) return null;
    const m = await msgById(t.parts[0]);
    if (!m || !m.campaign_id || !m.contact_id) return null;
    const [c, contact, tenant] = await Promise.all([
      db.selectFrom("campaigns").selectAll().where("id", "=", m.campaign_id).where("tenant_id", "=", m.tenant_id).executeTakeFirst(),
      db.selectFrom("contacts").selectAll().where("id", "=", m.contact_id).where("tenant_id", "=", m.tenant_id).executeTakeFirst(),
      db.selectFrom("tenants").select(["name", "company_address"]).where("id", "=", m.tenant_id).executeTakeFirst(),
    ]);
    if (!c || !contact) return null;
    const base = linkBase();
    return renderEmail({
      subject: c.subject,
      preheader: c.preheader,
      html: c.html,
      contact: { email: contact.email, firstName: contact.first_name, lastName: contact.last_name, attributes: (contact.attributes ?? {}) as Record<string, unknown> },
      company: { name: tenant?.name, address: tenant?.company_address },
      unsubscribeUrl: unsubscribeUrl(base, m.tenant_id, contact.id, m.id),
      viewUrl: viewUrl(base, m.id),
    }).html;
  }
}

export default new TrackingService();
