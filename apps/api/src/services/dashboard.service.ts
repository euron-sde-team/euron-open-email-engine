import { sql } from "kysely";
import { db } from "../db/connection";
import { isoReq, iso, num } from "../presenters/common";
import campaignsService from "./campaigns.service";
import reputationService from "./reputation.service";
import usageService, { nextMonthStart } from "./usage.service";
import { LIMIT_CODES } from "../constants/modules.const";
import entitlementsService from "./entitlements.service";

const limitOf = async (tenantId: string, code: string): Promise<number | null> => {
  const l = await entitlementsService.getLimit(tenantId, code);
  return l === null || l === Infinity ? null : l;
};

class DashboardService {
  async tenantStatus(tenantId: string) {
    const t = await db.selectFrom("tenants").select("email_sending_status").where("id", "=", tenantId).executeTakeFirst();
    return t?.email_sending_status ?? "ACTIVE";
  }

  async windowFor(tenantId: string) {
    const r = await reputationService.getRates(tenantId);
    return { sent: r.sends, delivered: r.delivered, bounceRate: r.bounceRate, permanentBounceRate: r.permanentBounceRate, complaintRate: r.complaintRate };
  }

  async get(tenantId: string) {
    const nowUtc = sql`timezone('utc', now())`;
    const [status, window, emailsUsed, emailsLimit, counts, daily, top, audience, checklist, contactsLimit, domainsLimit, usersLimit] = await Promise.all([
      this.tenantStatus(tenantId),
      this.windowFor(tenantId),
      usageService.emailsSentThisMonth(tenantId),
      usageService.monthlyLimit(tenantId),
      sql<{ contacts: string; domains: string; users: string }>`
        SELECT (SELECT count(*) FROM contacts WHERE tenant_id = ${tenantId}) AS contacts,
               (SELECT count(*) FROM email_sending_domains WHERE tenant_id = ${tenantId}) AS domains,
               (SELECT count(*) FROM users WHERE tenant_id = ${tenantId}) AS users`.execute(db),
      sql<{ date: string; sent: string; delivered: string; opened: string; clicked: string; bounced: string }>`
        WITH days AS (SELECT generate_series(date_trunc('day', ${nowUtc}) - interval '29 days', date_trunc('day', ${nowUtc}), interval '1 day') AS d)
        SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
          count(e.id) FILTER (WHERE e.type = 'SEND') AS sent,
          count(e.id) FILTER (WHERE e.type = 'DELIVERY') AS delivered,
          count(e.id) FILTER (WHERE e.type = 'OPEN') AS opened,
          count(e.id) FILTER (WHERE e.type = 'CLICK' AND NOT e.machine) AS clicked,
          count(e.id) FILTER (WHERE e.type = 'BOUNCE') AS bounced
        FROM days LEFT JOIN email_events e
          ON e.tenant_id = ${tenantId} AND e.occurred_at >= days.d AND e.occurred_at < days.d + interval '1 day'
          AND e.type IN ('SEND','DELIVERY','OPEN','CLICK','BOUNCE')
        GROUP BY days.d ORDER BY days.d`.execute(db),
      db.selectFrom("campaigns").select(["id", "name", "completed_at"]).where("tenant_id", "=", tenantId).where("status", "=", "SENT").orderBy("completed_at", "desc").limit(5).execute(),
      sql<{ subscribed: string; unsubscribed: string; bounced: string; new_week: string }>`
        SELECT count(*) FILTER (WHERE status = 'SUBSCRIBED') AS subscribed,
               count(*) FILTER (WHERE status = 'UNSUBSCRIBED') AS unsubscribed,
               count(*) FILTER (WHERE status IN ('BOUNCED','COMPLAINED')) AS bounced,
               count(*) FILTER (WHERE created_at >= ${nowUtc} - interval '7 days') AS new_week
        FROM contacts WHERE tenant_id = ${tenantId}`.execute(db),
      sql<{ domain: boolean; sender: boolean; contacts: boolean; template: boolean; campaign: boolean }>`
        SELECT EXISTS (SELECT 1 FROM email_sending_domains WHERE tenant_id = ${tenantId} AND status = 'VERIFIED') AS domain,
               EXISTS (SELECT 1 FROM email_sender_identities WHERE tenant_id = ${tenantId} AND status = 'ACTIVE') AS sender,
               EXISTS (SELECT 1 FROM contacts WHERE tenant_id = ${tenantId}) AS contacts,
               EXISTS (SELECT 1 FROM templates WHERE tenant_id = ${tenantId} AND NOT is_starter) AS template,
               EXISTS (SELECT 1 FROM campaigns WHERE tenant_id = ${tenantId} AND status IN ('SENDING','SENT','SCHEDULED','PAUSED')) AS campaign`.execute(db),
      limitOf(tenantId, LIMIT_CODES.CONTACTS),
      limitOf(tenantId, LIMIT_CODES.DOMAINS),
      limitOf(tenantId, LIMIT_CODES.USERS),
    ]);
    const stats = await campaignsService.statsFor(tenantId, top.map((t) => t.id));
    const c = counts.rows[0];
    const a = audience.rows[0];
    const k = checklist.rows[0];
    const ratio = (x: number, y: number) => (y > 0 ? Math.round((x / y) * 10000) / 10000 : 0);

    return {
      usage: {
        emails: { used: emailsUsed, limit: emailsLimit },
        contacts: { used: num(c.contacts), limit: contactsLimit },
        domains: { used: num(c.domains), limit: domainsLimit },
        users: { used: num(c.users), limit: usersLimit },
        resetsAt: isoReq(nextMonthStart()),
      },
      reputation: { status, window },
      daily: daily.rows.map((r) => ({ date: r.date, sent: num(r.sent), delivered: num(r.delivered), opened: num(r.opened), clicked: num(r.clicked), bounced: num(r.bounced) })),
      topCampaigns: top
        .map((t) => {
          const s = stats.get(t.id)!;
          return { id: t.id, name: t.name, sentAt: iso(t.completed_at), delivered: s.delivered, openRate: ratio(s.opened, s.delivered), clickRate: ratio(s.clicked, s.delivered) };
        })
        .sort((x, y) => y.openRate - x.openRate),
      audience: { subscribed: num(a.subscribed), unsubscribed: num(a.unsubscribed), bounced: num(a.bounced), newThisWeek: num(a.new_week) },
      checklist: [
        { key: "domain" as const, done: k.domain },
        { key: "sender" as const, done: k.sender },
        { key: "contacts" as const, done: k.contacts },
        { key: "template" as const, done: k.template },
        { key: "campaign" as const, done: k.campaign },
      ],
    };
  }
}

export default new DashboardService();
