import config from "../config";
import { db } from "../db/connection";
import type { email_category } from "../db/enums";
import emailMessagesRepository from "../repositories/email-messages.repository";
import emailSuppressionsRepository from "../repositories/email-suppressions.repository";
import logger from "../utils/logger";
import emailEventsService from "./email-events.service";
import type { ResolvedSender } from "./email-resolver.service";
import emailSesClient from "./email-ses.client";
import rateLimitService from "./rate-limit.service";
import usageService from "./usage.service";

export interface SystemMail {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
}

export interface SentSystemMail {
  messageId: string;
  provider: "SES" | "SIMULATED";
}

export interface BuiltMessage {
  subject: string;
  html: string;
  text: string;
  headers?: Array<{ name: string; value: string }>;
}

export interface TenantMailParams {
  tenantId: string;
  sender: ResolvedSender;
  category: email_category;
  to: string;
  contactId?: string | null;
  campaignId?: string | null;
  /** One logical send: a retry with the same key never produces a second message. */
  idempotencyKey?: string | null;
  /** Test sends and previews do not use the plan's monthly quota. */
  countTowardQuota?: boolean;
  /** Builds the content once the message id exists (tokens embed it). */
  build: (ctx: { messageId: string }) => BuiltMessage;
}

export type TenantMailResult =
  | { status: "sent"; messageId: string; simulated: boolean }
  | { status: "suppressed" | "gated" | "quota" | "duplicate" | "rate_limited" | "failed"; messageId?: string; error?: string };

// Per-status, per-category send-rate multiplier applied to the tenant's base TPS. 1 = full
// rate, fractions = throttled, 0 = fully blocked. TRANSACTIONAL (confirmations) is never
// throttled or blocked; only MARKETING is fully blocked, and only at PAUSED.
export const categoryMultiplier = (status: string, category: email_category): number => {
  if (category === "TRANSACTIONAL") return 1;
  switch (status) {
    case "PAUSED":
      return category === "MARKETING" ? 0 : 0.5;
    case "THROTTLED":
      return category === "MARKETING" ? 0.1 : 0.5;
    case "WARNING":
      return category === "MARKETING" ? 0.5 : 1;
    default:
      return 1;
  }
};

// Per-tenant base TPS from tenants.config.emailTps, else the configured default.
export const readEmailTps = (raw: unknown): number => {
  let cfg: Record<string, unknown> | null = null;
  if (raw && typeof raw === "object") cfg = raw as Record<string, unknown>;
  else if (typeof raw === "string") {
    try {
      cfg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      cfg = null;
    }
  }
  const v = Number(cfg?.emailTps);
  return Number.isFinite(v) && v > 0 ? Math.min(v, config.EMAIL_ACCOUNT_TPS) : config.EMAIL_DEFAULT_TENANT_TPS;
};

/** Effective per-second capacity for a tenant in a given reputation state. */
export const tenantCapacity = (status: string, category: email_category, rawConfig: unknown): number =>
  Math.max(1, Math.ceil(readEmailTps(rawConfig) * categoryMultiplier(status, category)));

/**
 * Which outcome the simulator plays for an address. delivery is the default;
 * bounce@, soft@ and complaint@ local parts give a hard bounce, a soft bounce, a complaint.
 */
export const simulatedOutcome = (to: string): "DELIVERY" | "HARD_BOUNCE" | "SOFT_BOUNCE" | "COMPLAINT" => {
  const local = to.toLowerCase().split("@")[0];
  if (local === "bounce") return "HARD_BOUNCE";
  if (local === "soft") return "SOFT_BOUNCE";
  if (local === "complaint") return "COMPLAINT";
  return "DELIVERY";
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MailerService {
  isLive(): boolean {
    return emailSesClient.isLive();
  }

  /**
   * Platform mail (invites, password resets, operator welcome) from AWS_SES_FROM_EMAIL.
   * Not tracked in email_messages and never counted against a tenant quota. Simulated
   * mode logs and returns a fake id.
   */
  async sendSystem(mail: SystemMail): Promise<SentSystemMail> {
    const to = mail.to.trim().toLowerCase();
    if (!emailSesClient.isLive() || !config.AWS_SES_FROM_EMAIL) {
      logger.info(`[mail:simulated] system mail to ${to}: ${mail.subject}`);
      return { messageId: `sim_system_${Date.now()}`, provider: "SIMULATED" };
    }
    const from = config.AWS_SES_FROM_NAME
      ? `${config.AWS_SES_FROM_NAME} <${config.AWS_SES_FROM_EMAIL}>`
      : config.AWS_SES_FROM_EMAIL;
    const r = await emailSesClient.sendEmail({ from, to, subject: mail.subject, text: mail.text, html: mail.html });
    return { messageId: r.messageId, provider: r.provider };
  }

  /**
   * Tenant mail from a verified sender. Order: reputation gate, suppression, rate limit,
   * quota reservation, message row (idempotent), render, provider send, SEND event, and in
   * simulated mode the simulated outcome through the real event handler.
   */
  async sendTenant(p: TenantMailParams): Promise<TenantMailResult> {
    const to = p.to.trim().toLowerCase();
    const tenant = await db
      .selectFrom("tenants")
      .select(["status", "email_sending_status", "config"])
      .where("id", "=", p.tenantId)
      .executeTakeFirst();
    const status = tenant?.email_sending_status ?? "ACTIVE";

    if (!tenant || tenant.status !== "ACTIVE") return { status: "gated" };
    if (categoryMultiplier(status, p.category) <= 0) return { status: "gated" };
    if (await emailSuppressionsRepository.isSuppressed(p.tenantId, to, p.category)) return { status: "suppressed" };

    const capacity = tenantCapacity(status, p.category, tenant?.config);
    if (!(await this.waitForSlot(p.tenantId, capacity))) return { status: "rate_limited" };

    const counted = p.countTowardQuota !== false;
    if (counted && !(await usageService.reserve(p.tenantId, 1))) return { status: "quota" };

    const created = await emailMessagesRepository.createOnce({
      tenant_id: p.tenantId,
      category: p.category,
      sending_domain_id: p.sender.sendingDomainId,
      sender_identity_id: p.sender.senderIdentityId,
      campaign_id: p.campaignId ?? null,
      contact_id: p.contactId ?? null,
      from_address: p.sender.fromAddress,
      to_address: to,
      subject: null,
      idempotency_key: p.idempotencyKey ?? null,
      status: "QUEUED",
    });
    if (!created) {
      if (counted) await usageService.release(p.tenantId, 1);
      const existing = p.idempotencyKey ? await emailMessagesRepository.findByKey(p.tenantId, p.idempotencyKey) : undefined;
      return { status: "duplicate", messageId: existing?.id };
    }

    try {
      const built = p.build({ messageId: created.id });
      await db.updateTable("email_messages").set({ subject: built.subject.slice(0, 300) }).where("id", "=", created.id).execute();
      const from = p.sender.displayName
        ? `"${p.sender.displayName.replace(/["\r\n]/g, "")}" <${p.sender.fromAddress}>`
        : p.sender.fromAddress;
      const r = await emailSesClient.sendEmail({
        from,
        to,
        subject: built.subject,
        text: built.text,
        html: built.html,
        replyTo: p.sender.replyTo,
        configurationSetName: p.sender.configurationSetName,
        tags: [
          { name: "tenantId", value: p.tenantId },
          { name: "messageId", value: created.id },
          { name: "category", value: p.category },
          ...(p.campaignId ? [{ name: "campaignId", value: p.campaignId }] : []),
        ],
        headers: built.headers,
      });
      const simulated = r.provider === "SIMULATED";
      await emailMessagesRepository.markSent(created.id, r.messageId, simulated);
      const message = { ...created, id: created.id };
      await emailEventsService.insertEvent({ tenantId: p.tenantId, message, type: "SEND" });
      if (simulated) await this.playSimulation(p.tenantId, created.id, to);
      return { status: "sent", messageId: created.id, simulated };
    } catch (err) {
      await emailMessagesRepository.markFailed(created.id, String(err));
      if (counted) await usageService.release(p.tenantId, 1);
      logger.warn(`tenant mail to ${to} failed: ${String(err)}`);
      return { status: "failed", messageId: created.id, error: String(err) };
    }
  }

  // The simulator reports outcomes through the same handler SES events use.
  private async playSimulation(tenantId: string, messageId: string, to: string): Promise<void> {
    const outcome = simulatedOutcome(to);
    if (outcome === "HARD_BOUNCE") {
      await emailEventsService.apply({ tenantId, messageId, type: "BOUNCE", bounceType: "Permanent", detail: "550 5.1.1 simulated: mailbox does not exist" });
    } else if (outcome === "SOFT_BOUNCE") {
      await emailEventsService.apply({ tenantId, messageId, type: "BOUNCE", bounceType: "Transient", detail: "452 4.2.2 simulated: mailbox full" });
    } else if (outcome === "COMPLAINT") {
      await emailEventsService.apply({ tenantId, messageId, type: "DELIVERY" });
      await emailEventsService.apply({ tenantId, messageId, type: "COMPLAINT", detail: "abuse" });
    } else {
      await emailEventsService.apply({ tenantId, messageId, type: "DELIVERY" });
    }
  }

  // Waits (bounded) for a free per-second slot. Without Redis the limiter always allows.
  private async waitForSlot(tenantId: string, capacity: number): Promise<boolean> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      if (await rateLimitService.allowEmailSend(tenantId, capacity)) return true;
      if (Date.now() >= deadline) return false;
      await sleep(100);
    }
  }
}

export default new MailerService();
