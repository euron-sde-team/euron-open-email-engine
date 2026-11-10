import { sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_event_type } from "../db/enums";
import emailMessagesRepository, { EmailMessageRow } from "../repositories/email-messages.repository";
import emailSuppressionsRepository from "../repositories/email-suppressions.repository";
import logger from "../utils/logger";
import reputationService from "./reputation.service";

// The one place delivery outcomes are applied. SES events (SNS -> SQS), the simulator and
// the tracking endpoints all end up here, so a simulated bounce updates contacts, campaign
// counters and reputation exactly like a real one. Every write is idempotent: SQS delivers
// at least once, and the unique index on (message, type) drops a replayed event before its
// side effects run.

export type OutcomeType = "DELIVERY" | "BOUNCE" | "COMPLAINT" | "REJECT";

export interface Outcome {
  tenantId: string;
  messageId: string;
  type: OutcomeType;
  /** BOUNCE only: Permanent, Transient or Undetermined. */
  bounceType?: string;
  detail?: string | null;
  at?: Date;
}

interface SesMailTags {
  [key: string]: string[] | undefined;
}
interface SesEvent {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; destination?: string[]; tags?: SesMailTags };
  bounce?: {
    bounceType?: string;
    bouncedRecipients?: Array<{ diagnosticCode?: string; emailAddress?: string }>;
  };
  complaint?: { complaintFeedbackType?: string };
}

const firstTag = (tags: SesMailTags | undefined, key: string): string | undefined => {
  const v = tags?.[key];
  return Array.isArray(v) ? v[0] : undefined;
};

class EmailEventsService {
  /** Accepts the raw SQS body, unwrapping an SNS envelope when raw delivery is off. */
  async processRaw(body: string): Promise<void> {
    let payload: SesEvent & { Type?: string; Message?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      logger.warn("SES event: unparseable body");
      return;
    }
    if (payload.Type === "Notification" && typeof payload.Message === "string") {
      try {
        payload = JSON.parse(payload.Message);
      } catch {
        logger.warn("SES event: unparseable SNS message");
        return;
      }
    }
    await this.processSes(payload);
  }

  async processSes(event: SesEvent): Promise<void> {
    const type = (event.eventType ?? event.notificationType ?? "").toLowerCase();
    const messageId = firstTag(event.mail?.tags, "messageId");
    const tenantId = firstTag(event.mail?.tags, "tenantId");
    if (!messageId || !tenantId) {
      logger.warn(`SES event ${type || "?"} without messageId/tenantId tags, skipping`);
      return;
    }
    switch (type) {
      case "delivery":
        return this.apply({ tenantId, messageId, type: "DELIVERY" });
      case "bounce":
        return this.apply({
          tenantId,
          messageId,
          type: "BOUNCE",
          bounceType: event.bounce?.bounceType ?? "Undetermined",
          detail: event.bounce?.bouncedRecipients?.[0]?.diagnosticCode ?? null,
        });
      case "complaint":
        return this.apply({ tenantId, messageId, type: "COMPLAINT", detail: event.complaint?.complaintFeedbackType ?? null });
      case "reject":
        return this.apply({ tenantId, messageId, type: "REJECT" });
      case "send":
      case "deliverydelay":
      case "open":
      case "click":
        return; // our own pixel and redirect are the source of engagement events
      default:
        logger.warn(`Unhandled SES event type: ${type}`);
    }
  }

  /** Inserts an event row; false when it was a replay of a once-per-message type. */
  async insertEvent(e: {
    tenantId: string;
    message: Pick<EmailMessageRow, "id" | "campaign_id" | "contact_id">;
    type: email_event_type;
    at?: Date;
    detail?: string | null;
    url?: string | null;
    machine?: boolean;
    ipHash?: string | null;
    uaClass?: string | null;
  }): Promise<boolean> {
    const res = await db
      .insertInto("email_events")
      .values({
        id: ulid(),
        tenant_id: e.tenantId,
        message_id: e.message.id,
        campaign_id: e.message.campaign_id,
        contact_id: e.message.contact_id,
        type: e.type,
        occurred_at: e.at ?? new Date(),
        detail: e.detail ? e.detail.slice(0, 500) : null,
        url: e.url ?? null,
        machine: e.machine ?? false,
        ip_hash: e.ipHash ?? null,
        ua_class: e.uaClass ?? null,
      })
      .onConflict((oc) => oc.columns(["message_id", "type"]).where(sql<boolean>`type IN ('SEND','DELIVERY','BOUNCE','COMPLAINT','REJECT','UNSUBSCRIBE')`).doNothing())
      .executeTakeFirst();
    return Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  async apply(o: Outcome): Promise<void> {
    const message = await emailMessagesRepository.findById(o.messageId, o.tenantId);
    if (!message) {
      logger.warn(`email event ${o.type} for unknown message ${o.messageId}`);
      return;
    }
    const detail = o.type === "BOUNCE" ? `${o.bounceType ?? "Undetermined"}${o.detail ? `: ${o.detail}` : ""}` : (o.detail ?? null);
    const fresh = await this.insertEvent({ tenantId: o.tenantId, message, type: o.type, at: o.at, detail });
    if (!fresh) return;

    switch (o.type) {
      case "DELIVERY":
        await emailMessagesRepository.markDelivered(message.id);
        await this.setRecipient(message, "DELIVERED", ["QUEUED", "SENT"]);
        if (message.contact_id) {
          await db
            .updateTable("contacts")
            .set({ emails_received: sql`emails_received + 1`, updated_at: new Date() })
            .where("id", "=", message.contact_id)
            .where("tenant_id", "=", o.tenantId)
            .execute();
        }
        break;
      case "BOUNCE": {
        const type = o.bounceType ?? "Undetermined";
        await emailMessagesRepository.markBounced(message.id, type, o.detail ?? null);
        if (type === "Permanent") {
          await this.setRecipient(message, "BOUNCED", ["QUEUED", "SENT", "DELIVERED"]);
          await this.markContact(o.tenantId, message, "BOUNCED");
          await emailSuppressionsRepository.add(o.tenantId, message.to_address, "HARD_BOUNCE", null, o.detail ?? null);
        }
        await reputationService.evaluateAndApply(o.tenantId, "bounce");
        break;
      }
      case "COMPLAINT":
        await emailMessagesRepository.markComplained(message.id);
        await this.setRecipient(message, "COMPLAINED", ["QUEUED", "SENT", "DELIVERED", "BOUNCED"]);
        await this.markContact(o.tenantId, message, "COMPLAINED");
        await emailSuppressionsRepository.add(o.tenantId, message.to_address, "COMPLAINT", null, null);
        await reputationService.evaluateAndApply(o.tenantId, "complaint");
        break;
      case "REJECT":
        await emailMessagesRepository.markRejected(message.id);
        await this.setRecipient(message, "FAILED", ["QUEUED", "SENT"]);
        break;
    }
  }

  private async setRecipient(message: EmailMessageRow, status: "DELIVERED" | "BOUNCED" | "COMPLAINED" | "FAILED", from: string[]): Promise<void> {
    if (!message.campaign_id || !message.contact_id) return;
    await db
      .updateTable("campaign_recipients")
      .set({ status, updated_at: new Date() })
      .where("campaign_id", "=", message.campaign_id)
      .where("contact_id", "=", message.contact_id)
      .where("tenant_id", "=", message.tenant_id)
      .where("status", "in", from as never)
      .execute();
  }

  // A hard bounce or complaint ends subscription; a complaint outranks a bounce.
  private async markContact(tenantId: string, message: EmailMessageRow, status: "BOUNCED" | "COMPLAINED"): Promise<void> {
    let qb = db
      .updateTable("contacts")
      .set({ status, updated_at: new Date() })
      .where("tenant_id", "=", tenantId);
    qb = message.contact_id ? qb.where("id", "=", message.contact_id) : qb.where("email", "=", message.to_address.toLowerCase());
    if (status === "BOUNCED") qb = qb.where("status", "not in", ["COMPLAINED"]);
    await qb.execute();
  }
}

export default new EmailEventsService();
