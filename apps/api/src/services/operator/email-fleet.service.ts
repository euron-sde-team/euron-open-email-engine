import { sql } from "kysely";
import { GetQueueAttributesCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import config from "../../config";
import { LIMIT_CODES } from "../../constants/modules.const";
import { db } from "../../db/connection";
import { BadRequestError, NotFoundError } from "../../errors";
import { isoReq, num } from "../../presenters/common";
import { toDomainDto } from "../../presenters/domains";
import emailDomainsRepository from "../../repositories/email-domains.repository";
import emailSesClient from "../email-ses.client";
import entitlementsService from "../entitlements.service";
import emailLogService from "../email-log.service";
import reputationService from "../reputation.service";
import usageService, { nextMonthStart } from "../usage.service";
import { sesClientOptions } from "../../utils/aws";
import auditService, { AuditActor } from "./audit.service";

const fleetRows = async (tenantId?: string) => {
  const rows = await sql<{
    id: string; name: string; status: string; plan: string | null; sent14d: string; bounced14d: string; complained14d: string;
    domains: string; verified_domains: string; contacts: string;
  }>`
    SELECT t.id, t.name, t.email_sending_status AS status, p.name AS plan,
      COALESCE(m.sent, 0) AS sent14d, COALESCE(m.bounced, 0) AS bounced14d, COALESCE(m.complained, 0) AS complained14d,
      (SELECT count(*) FROM email_sending_domains d WHERE d.tenant_id = t.id) AS domains,
      (SELECT count(*) FROM email_sending_domains d WHERE d.tenant_id = t.id AND d.status = 'VERIFIED') AS verified_domains,
      (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id) AS contacts
    FROM tenants t
    LEFT JOIN plans p ON p.key = t.plan_key
    LEFT JOIN LATERAL (
      SELECT count(*) AS sent, count(*) FILTER (WHERE bounced_at IS NOT NULL) AS bounced, count(*) FILTER (WHERE complained_at IS NOT NULL) AS complained
      FROM email_messages e WHERE e.tenant_id = t.id AND e.sent_at >= timezone('utc', now()) - interval '14 days'
    ) m ON true
    WHERE ${tenantId ? sql`t.id = ${tenantId}` : sql`true`}
    ORDER BY t.created_at`.execute(db);
  return rows.rows.map((r) => {
    const sent = num(r.sent14d);
    return {
      tenantId: r.id,
      name: r.name,
      status: r.status as "ACTIVE" | "WARNING" | "THROTTLED" | "PAUSED",
      plan: r.plan,
      sent14d: sent,
      bounceRate: sent ? num(r.bounced14d) / sent : 0,
      complaintRate: sent ? num(r.complained14d) / sent : 0,
      domains: num(r.domains),
      verifiedDomains: num(r.verified_domains),
      contacts: num(r.contacts),
    };
  });
};

const meter = async (tenantId: string, used: number, code: string) => {
  const l = await entitlementsService.getLimit(tenantId, code);
  return { used, limit: l === null || l === Infinity ? null : l };
};

class OperatorEmailService {
  async fleet() {
    const tenants = await fleetRows();
    const sentRow = await sql<{ n: string }>`SELECT COALESCE(sum(emails_sent), 0) AS n FROM tenant_usage_monthly WHERE month = ${usageMonth()}::date`.execute(db);
    const count = (s: string) => tenants.filter((t) => t.status === s).length;
    return {
      totals: {
        tenants: tenants.length,
        active: count("ACTIVE"),
        warning: count("WARNING"),
        throttled: count("THROTTLED"),
        paused: count("PAUSED"),
        sentThisMonth: num(sentRow.rows[0]?.n),
      },
      tenants,
    };
  }

  async tenantEmail(tenantId: string) {
    const [fleet] = await fleetRows(tenantId);
    if (!fleet) throw new NotFoundError("Tenant not found");
    const [domains, counts, emails, reputation] = await Promise.all([
      emailDomainsRepository.listByTenant(tenantId),
      sql<{ contacts: string; users: string }>`SELECT (SELECT count(*) FROM contacts WHERE tenant_id = ${tenantId}) AS contacts, (SELECT count(*) FROM users WHERE tenant_id = ${tenantId}) AS users`.execute(db),
      usageService.emailsSentThisMonth(tenantId),
      emailLogService.reputation(tenantId),
    ]);
    const limit = await usageService.monthlyLimit(tenantId);
    return {
      fleet,
      usage: {
        emails: { used: emails, limit },
        contacts: await meter(tenantId, num(counts.rows[0].contacts), LIMIT_CODES.CONTACTS),
        domains: await meter(tenantId, domains.length, LIMIT_CODES.DOMAINS),
        users: await meter(tenantId, num(counts.rows[0].users), LIMIT_CODES.USERS),
        resetsAt: isoReq(nextMonthStart()),
      },
      domains: domains.map((d) => {
        const dto = toDomainDto(d);
        return { id: dto.id, domain: dto.domain, status: dto.status, trackingStatus: dto.trackingStatus, failureReason: dto.failureReason, verifiedAt: dto.verifiedAt, lastCheckedAt: dto.lastCheckedAt };
      }),
      reputation,
    };
  }

  /** Lifts a tenant's sending pause. The reason is required and written to the operator audit log. */
  async unpause(actor: AuditActor, tenantId: string, reason: unknown) {
    const why = typeof reason === "string" ? reason.trim() : "";
    if (!why) throw new BadRequestError("A reason is required");
    if (why.length > 500) throw new BadRequestError("The reason is too long");
    const t = await db.selectFrom("tenants").select(["id", "name"]).where("id", "=", tenantId).executeTakeFirst();
    if (!t) throw new NotFoundError("Tenant not found");
    const previous = await reputationService.manualUnpause(tenantId, actor.email, why);
    auditService.log(actor, "tenant.email_unpaused", "tenants", {
      tenantId,
      resourceId: tenantId,
      summary: `${actor.email} set sending for ${t.name} from ${previous} to ACTIVE`,
      metadata: { previous, reason: why },
    });
    return this.tenantEmail(tenantId);
  }

  async accountHealth() {
    const acct = await emailSesClient.getAccount();
    const r = await sql<{ sent: string; bounced: string; complained: string; sent24: string }>`
      SELECT count(*) FILTER (WHERE sent_at >= timezone('utc', now()) - interval '14 days') AS sent,
             count(*) FILTER (WHERE bounced_at IS NOT NULL AND sent_at >= timezone('utc', now()) - interval '14 days') AS bounced,
             count(*) FILTER (WHERE complained_at IS NOT NULL AND sent_at >= timezone('utc', now()) - interval '14 days') AS complained,
             count(*) FILTER (WHERE sent_at >= timezone('utc', now()) - interval '24 hours') AS sent24
      FROM email_messages WHERE sent_at IS NOT NULL`.execute(db);
    const row = r.rows[0];
    const sent = num(row.sent);
    return {
      mode: acct.mode,
      sendingEnabled: acct.sendingEnabled,
      sandbox: acct.sandbox,
      quota: { max24Hour: acct.max24Hour, maxPerSecond: acct.maxPerSecond, sentLast24Hours: acct.mode === "aws" ? acct.sentLast24Hours : num(row.sent24) },
      bounceRate: sent ? num(row.bounced) / sent : 0,
      complaintRate: sent ? num(row.complained) / sent : 0,
      checkedAt: isoReq(new Date()),
    };
  }

  /** Peeks at the events dead-letter queue. Messages are never deleted or redriven here. */
  async dlq() {
    const url = config.SES_EVENTS_DLQ_URL;
    if (!url) return { configured: false, depth: 0, oldestAgeSeconds: null as number | null, sample: [] as Array<{ id: string; receivedAt: string; body: string }> };
    const sqs = new SQSClient(sesClientOptions(config.AWS_SES_REGION));
    try {
      const attrs = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["ApproximateNumberOfMessages"] }));
      const depth = num(attrs.Attributes?.ApproximateNumberOfMessages);
      const got = await sqs.send(new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 10, VisibilityTimeout: 0, WaitTimeSeconds: 0, MessageSystemAttributeNames: ["SentTimestamp"] }));
      const sample = (got.Messages ?? []).map((m) => ({
        id: m.MessageId ?? "",
        receivedAt: new Date(Number(m.Attributes?.SentTimestamp ?? Date.now())).toISOString(),
        body: (m.Body ?? "").slice(0, 500),
      }));
      const oldest = sample.length ? Math.max(...sample.map((s) => Math.floor((Date.now() - new Date(s.receivedAt).getTime()) / 1000))) : null;
      return { configured: true, depth, oldestAgeSeconds: depth === 0 ? null : oldest, sample };
    } finally {
      sqs.destroy();
    }
  }
}

function usageMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export default new OperatorEmailService();
