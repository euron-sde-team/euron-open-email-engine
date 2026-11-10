import { Selectable, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { email_category, email_message_status } from "../db/enums";
import type { email_messages } from "../db/types";

export type EmailMessageRow = Selectable<email_messages>;

export interface CreateEmailMessageData {
  tenant_id: string;
  category: email_category;
  sending_domain_id: string | null;
  sender_identity_id: string | null;
  campaign_id?: string | null;
  contact_id?: string | null;
  from_address: string;
  to_address: string;
  subject: string | null;
  idempotency_key: string | null;
  status: email_message_status;
  simulated?: boolean;
}

class EmailMessagesRepository {
  /** Inserts a message; null when the idempotency key already exists (a retried send). */
  async createOnce(data: CreateEmailMessageData): Promise<EmailMessageRow | null> {
    const now = new Date();
    const row = await db
      .insertInto("email_messages")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        category: data.category,
        sending_domain_id: data.sending_domain_id,
        sender_identity_id: data.sender_identity_id,
        campaign_id: data.campaign_id ?? null,
        contact_id: data.contact_id ?? null,
        from_address: data.from_address,
        to_address: data.to_address,
        subject: data.subject,
        idempotency_key: data.idempotency_key,
        status: data.status,
        simulated: data.simulated ?? false,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.columns(["tenant_id", "idempotency_key"]).where("idempotency_key", "is not", null).doNothing()
      )
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async findById(id: string, tenantId: string): Promise<EmailMessageRow | undefined> {
    return db.selectFrom("email_messages").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
  }

  async findByKey(tenantId: string, key: string): Promise<EmailMessageRow | undefined> {
    return db
      .selectFrom("email_messages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("idempotency_key", "=", key)
      .executeTakeFirst();
  }

  async markSent(id: string, sesMessageId: string, simulated: boolean): Promise<void> {
    const now = new Date();
    await db
      .updateTable("email_messages")
      .set({ status: "SENT", ses_message_id: sesMessageId, simulated, sent_at: now, updated_at: now })
      .where("id", "=", id)
      .execute();
  }

  async markFailed(id: string, error: string): Promise<void> {
    await db
      .updateTable("email_messages")
      .set({ status: "FAILED", error: error.slice(0, 500), updated_at: new Date() })
      .where("id", "=", id)
      .execute();
  }

  async markDelivered(id: string): Promise<boolean> {
    const now = new Date();
    const res = await db
      .updateTable("email_messages")
      .set({ status: sql`CASE WHEN status IN ('BOUNCED','COMPLAINED') THEN status ELSE 'DELIVERED'::email_message_status END`, delivered_at: now, updated_at: now })
      .where("id", "=", id)
      .where("delivered_at", "is", null)
      .executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  /** Records a bounce. Only a permanent one changes the status. */
  async markBounced(id: string, type: string, reason: string | null): Promise<boolean> {
    const now = new Date();
    const hard = type === "Permanent";
    const res = await db
      .updateTable("email_messages")
      .set({
        ...(hard ? { status: "BOUNCED" as const } : {}),
        bounce_type: type,
        bounce_reason: reason ? reason.slice(0, 300) : null,
        bounced_at: now,
        updated_at: now,
      })
      .where("id", "=", id)
      .where("bounced_at", "is", null)
      .executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  async markComplained(id: string): Promise<boolean> {
    const now = new Date();
    const res = await db
      .updateTable("email_messages")
      .set({ status: "COMPLAINED", complained_at: now, updated_at: now })
      .where("id", "=", id)
      .where("complained_at", "is", null)
      .executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  async markRejected(id: string): Promise<void> {
    await db
      .updateTable("email_messages")
      .set({ status: "REJECTED", updated_at: new Date() })
      .where("id", "=", id)
      .where("status", "in", ["QUEUED", "SENT"])
      .execute();
  }

  async bumpOpen(id: string): Promise<void> {
    const now = new Date();
    await db
      .updateTable("email_messages")
      .set({ open_count: sql`open_count + 1`, opened_at: sql`COALESCE(opened_at, ${now})`, updated_at: now })
      .where("id", "=", id)
      .execute();
  }

  async bumpClick(id: string): Promise<void> {
    const now = new Date();
    await db
      .updateTable("email_messages")
      .set({ click_count: sql`click_count + 1`, clicked_at: sql`COALESCE(clicked_at, ${now})`, updated_at: now })
      .where("id", "=", id)
      .execute();
  }
}

export default new EmailMessagesRepository();
