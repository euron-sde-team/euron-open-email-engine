import { sql } from "kysely";
import { db } from "../db/connection";
import type { email_suppression_reason } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import { clampLimit, EMAIL_RE, iso, isoReq, normEmail } from "../presenters/common";
import emailReputationRepository from "../repositories/email-reputation.repository";
import emailSuppressionsRepository from "../repositories/email-suppressions.repository";
import { BOUNCE, COMPLAINT } from "./reputation.service";
import auditService from "./audit.service";
import dashboardService from "./dashboard.service";

const MESSAGE_STATUSES = ["QUEUED", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "REJECTED", "FAILED", "SUPPRESSED"];
const CATEGORIES = ["TRANSACTIONAL", "NOTIFICATION", "MARKETING"];
const REASONS = ["HARD_BOUNCE", "COMPLAINT", "UNSUBSCRIBE", "ADMIN_BLOCK", "IMPORTED"];

const messageSelect = () =>
  db
    .selectFrom("email_messages as m")
    .leftJoin("campaigns as c", "c.id", "m.campaign_id")
    .select([
      "m.id", "m.category", "m.campaign_id", "c.name as campaign_name", "m.to_address", "m.from_address", "m.subject", "m.status", "m.simulated",
      "m.ses_message_id", "m.bounce_type", "m.open_count", "m.click_count", "m.created_at", "m.delivered_at",
    ]);

type MsgRow = Awaited<ReturnType<ReturnType<typeof messageSelect>["execute"]>>[number];

const toMessage = (r: MsgRow) => ({
  id: r.id,
  category: r.category,
  campaignId: r.campaign_id,
  campaignName: r.campaign_name,
  to: r.to_address,
  from: r.from_address,
  subject: r.subject ?? "",
  status: r.status,
  simulated: r.simulated,
  sesMessageId: r.ses_message_id,
  bounceType: r.bounce_type,
  opens: r.open_count,
  clicks: r.click_count,
  createdAt: isoReq(r.created_at),
  deliveredAt: iso(r.delivered_at),
});

class EmailLogService {
  async messages(tenantId: string, q: { status?: string; category?: string; campaignId?: string; q?: string; cursor?: string; limit?: unknown }) {
    const limit = clampLimit(q.limit, 50, 200);
    let qb = messageSelect().where("m.tenant_id", "=", tenantId);
    if (q.status) {
      if (!MESSAGE_STATUSES.includes(q.status.toUpperCase())) throw new BadRequestError("Invalid status");
      qb = qb.where("m.status", "=", q.status.toUpperCase() as never);
    }
    if (q.category) {
      if (!CATEGORIES.includes(q.category.toUpperCase())) throw new BadRequestError("Invalid category");
      qb = qb.where("m.category", "=", q.category.toUpperCase() as never);
    }
    if (q.campaignId) qb = qb.where("m.campaign_id", "=", q.campaignId);
    if (q.q) qb = qb.where("m.to_address", "like", `%${q.q.toLowerCase().replace(/[\\%_]/g, "\\$&").slice(0, 100)}%`);
    if (q.cursor) qb = qb.where("m.id", "<", q.cursor);
    const rows = await qb.orderBy("m.id", "desc").limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    return { items: page.map(toMessage), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  async message(tenantId: string, id: string) {
    const r = await messageSelect().where("m.tenant_id", "=", tenantId).where("m.id", "=", id).executeTakeFirst();
    if (!r) throw new NotFoundError("Message not found");
    const events = await db
      .selectFrom("email_events")
      .select(["id", "type", "occurred_at", "detail", "url", "machine"])
      .where("tenant_id", "=", tenantId)
      .where("message_id", "=", id)
      .orderBy("occurred_at")
      .limit(500)
      .execute();
    return { ...toMessage(r), events: events.map((e) => ({ id: e.id, type: e.type, at: isoReq(e.occurred_at), detail: e.detail, url: e.url, machine: e.machine })) };
  }

  async reputation(tenantId: string) {
    const [status, window, history, state] = await Promise.all([
      dashboardService.tenantStatus(tenantId),
      dashboardService.windowFor(tenantId),
      emailReputationRepository.listByTenant(tenantId, 50),
      emailReputationRepository.getTenantState(tenantId),
    ]);
    void state;
    const note =
      status === "PAUSED"
        ? "Marketing sends are paused because bounce or complaint rates are too high. Transactional mail still flows. Contact your operator after cleaning your list."
        : status === "THROTTLED"
          ? "Marketing sends are slowed to protect your sending reputation."
          : status === "WARNING"
            ? "Bounce or complaint rates are elevated. Marketing sends run at half speed."
            : null;
    return {
      status,
      window,
      thresholds: {
        warnBounce: BOUNCE.WARNING, throttleBounce: BOUNCE.THROTTLED, pauseBounce: BOUNCE.PAUSED,
        warnComplaint: COMPLAINT.WARNING, throttleComplaint: COMPLAINT.THROTTLED, pauseComplaint: COMPLAINT.PAUSED,
      },
      note,
      history: history.map((h) => ({ at: isoReq(h.created_at), from: h.from_status, to: h.to_status, trigger: h.trigger, reason: h.reason ?? "" })),
    };
  }

  // ─── Suppressions ──────────────────────────────────────────────────────

  async suppressions(tenantId: string, q: { q?: string; reason?: string; cursor?: string; limit?: unknown }) {
    const limit = clampLimit(q.limit, 50, 200);
    if (q.reason && !REASONS.includes(q.reason.toUpperCase())) throw new BadRequestError("Invalid reason");
    const rows = await emailSuppressionsRepository.list(tenantId, { q: q.q, reason: q.reason?.toUpperCase() as email_suppression_reason | undefined, cursor: q.cursor, limit });
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({ id: r.id, email: r.email, reason: r.reason, category: r.category_scope, note: r.note, createdAt: isoReq(r.created_at) })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async addSuppression(tenantId: string, actorId: string, body: { email?: string; category?: string | null; note?: string }) {
    const email = normEmail(body.email);
    if (!EMAIL_RE.test(email)) throw new BadRequestError("A valid email is required");
    const scope = body.category ? String(body.category).toUpperCase() : null;
    if (scope && !CATEGORIES.includes(scope)) throw new BadRequestError("Invalid category");
    await emailSuppressionsRepository.add(tenantId, email, "ADMIN_BLOCK", scope as never, body.note ? String(body.note).slice(0, 300) : null);
    // Keep the contact in step: a blocked address must not be mailed through the list either.
    if (!scope || scope === "MARKETING") {
      await db.updateTable("contacts").set({ status: "UNSUBSCRIBED", unsubscribed_at: new Date(), updated_at: new Date() }).where("tenant_id", "=", tenantId).where("email", "=", email).where("status", "=", "SUBSCRIBED").execute();
    }
    auditService.record(tenantId, actorId, "email_suppression.added", "email_suppression", email, { category: scope });
    const row = await db.selectFrom("email_suppressions").selectAll().where("tenant_id", "=", tenantId).where("email", "=", email).where(scope ? sql<boolean>`category_scope = ${scope}::email_category` : sql<boolean>`category_scope IS NULL`).executeTakeFirstOrThrow();
    return { id: row.id, email: row.email, reason: row.reason, category: row.category_scope, note: row.note, createdAt: isoReq(row.created_at) };
  }

  async removeSuppression(tenantId: string, actorId: string, id: string) {
    const row = await emailSuppressionsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Suppression not found");
    await emailSuppressionsRepository.remove(id, tenantId);
    auditService.record(tenantId, actorId, "email_suppression.removed", "email_suppression", id, {});
    return { id };
  }
}

export default new EmailLogService();
