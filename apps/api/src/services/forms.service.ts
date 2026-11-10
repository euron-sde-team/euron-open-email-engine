import crypto from "crypto";
import { ulid } from "ulid";
import { LIMIT_CODES } from "../constants/modules.const";
import { db } from "../db/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { toFormDto } from "../presenters/audience";
import { EMAIL_RE, normEmail, num } from "../presenters/common";
import { confirmUrl, linkBase } from "../utils/links";
import { escapeHtml } from "../utils/render";
import { hashIp, verifyToken } from "../utils/tokens";
import logger from "../utils/logger";
import auditService from "./audit.service";
import emailResolverService from "./email-resolver.service";
import entitlementsService from "./entitlements.service";
import mailerService from "./mailer.service";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,47}$/;

const slugBase = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "form";

export interface PublicFormView {
  name: string;
  slug: string;
  headline: string;
  description: string;
  buttonLabel: string;
  successMessage: string;
  collectName: boolean;
}

class FormsService {
  async list(tenantId: string) {
    const rows = await db.selectFrom("subscribe_forms").selectAll().where("tenant_id", "=", tenantId).orderBy("created_at", "desc").limit(200).execute();
    return rows.map(toFormDto);
  }

  async get(tenantId: string, id: string) {
    const row = await db.selectFrom("subscribe_forms").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!row) throw new NotFoundError("Form not found");
    return toFormDto(row);
  }

  private async assertList(tenantId: string, listId: unknown): Promise<string> {
    const id = String(listId ?? "");
    const l = await db.selectFrom("lists").select("id").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!l) throw new NotFoundError("List not found");
    return id;
  }

  private text(v: unknown, max: number, field: string, required = false): string | undefined {
    if (v === undefined || v === null) {
      if (required) throw new BadRequestError(`${field} is required`);
      return undefined;
    }
    const s = String(v).trim().slice(0, max);
    if (required && !s) throw new BadRequestError(`${field} is required`);
    return s;
  }

  async create(tenantId: string, actorId: string, body: Record<string, unknown>) {
    const name = this.text(body.name, 100, "name", true)!;
    const listId = await this.assertList(tenantId, body.listId);
    const slug = typeof body.slug === "string" && body.slug ? body.slug.toLowerCase() : `${slugBase(name)}-${crypto.randomBytes(3).toString("hex")}`;
    if (!SLUG_RE.test(slug)) throw new BadRequestError("slug must be 3 to 48 lowercase letters, digits and hyphens");
    const now = new Date();
    const id = ulid();
    try {
      await db
        .insertInto("subscribe_forms")
        .values({
          id,
          tenant_id: tenantId,
          name,
          slug,
          list_id: listId,
          headline: this.text(body.headline, 200, "headline", true)!,
          description: this.text(body.description, 500, "description") ?? "",
          button_label: this.text(body.buttonLabel, 40, "buttonLabel") || "Subscribe",
          success_message: this.text(body.successMessage, 300, "successMessage") || "Thanks for subscribing.",
          collect_name: body.collectName === true,
          active: body.active !== false,
          created_at: now,
          updated_at: now,
        })
        .execute();
    } catch (err) {
      if (/subscribe_forms_slug_key/.test(String(err))) throw new ConflictError("That slug is taken");
      throw err;
    }
    auditService.record(tenantId, actorId, "form.created", "form", id, {});
    return this.get(tenantId, id);
  }

  async update(tenantId: string, actorId: string, id: string, body: Record<string, unknown>) {
    await this.get(tenantId, id);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) patch.name = this.text(body.name, 100, "name", true);
    if (body.listId !== undefined) patch.list_id = await this.assertList(tenantId, body.listId);
    if (body.headline !== undefined) patch.headline = this.text(body.headline, 200, "headline", true);
    if (body.description !== undefined) patch.description = this.text(body.description, 500, "description");
    if (body.buttonLabel !== undefined) patch.button_label = this.text(body.buttonLabel, 40, "buttonLabel", true);
    if (body.successMessage !== undefined) patch.success_message = this.text(body.successMessage, 300, "successMessage", true);
    if (body.collectName !== undefined) patch.collect_name = body.collectName === true;
    if (body.active !== undefined) patch.active = body.active === true;
    if (body.slug !== undefined) {
      const slug = String(body.slug).toLowerCase();
      if (!SLUG_RE.test(slug)) throw new BadRequestError("slug must be 3 to 48 lowercase letters, digits and hyphens");
      patch.slug = slug;
    }
    try {
      await db.updateTable("subscribe_forms").set(patch).where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    } catch (err) {
      if (/subscribe_forms_slug_key/.test(String(err))) throw new ConflictError("That slug is taken");
      throw err;
    }
    auditService.record(tenantId, actorId, "form.updated", "form", id, {});
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    await this.get(tenantId, id);
    await db.deleteFrom("subscribe_forms").where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "form.deleted", "form", id, {});
    return { id };
  }

  // ─── Public ──────────────────────────────────────────────────────────────

  async publicView(slug: string): Promise<PublicFormView | null> {
    const f = await db
      .selectFrom("subscribe_forms as f")
      .innerJoin("tenants as t", "t.id", "f.tenant_id")
      .select(["f.name", "f.slug", "f.headline", "f.description", "f.button_label", "f.success_message", "f.collect_name"])
      .where("f.slug", "=", slug)
      .where("f.active", "=", true)
      .where("t.status", "=", "ACTIVE")
      .executeTakeFirst();
    return f
      ? { name: f.name, slug: f.slug, headline: f.headline, description: f.description, buttonLabel: f.button_label, successMessage: f.success_message, collectName: f.collect_name }
      : null;
  }

  /**
   * Public submit. Every outcome looks the same to the caller (no account enumeration):
   * `ok` is true unless the form does not exist or the email is malformed.
   */
  async subscribe(
    slug: string,
    body: { email?: unknown; firstName?: unknown; lastName?: unknown; website?: unknown },
    ip: string | undefined
  ): Promise<{ ok: boolean; pending: boolean; message: string; error?: string }> {
    const form = await db
      .selectFrom("subscribe_forms as f")
      .innerJoin("tenants as t", "t.id", "f.tenant_id")
      .innerJoin("lists as l", "l.id", "f.list_id")
      .select(["f.id", "f.tenant_id", "f.list_id", "f.success_message", "f.collect_name", "l.double_opt_in", "t.name as tenant_name"])
      .where("f.slug", "=", slug)
      .where("f.active", "=", true)
      .where("t.status", "=", "ACTIVE")
      .executeTakeFirst();
    if (!form) return { ok: false, pending: false, message: "", error: "This form is not available." };

    // Honeypot: real people never see the field. Bots that fill it get a normal-looking success.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return { ok: true, pending: false, message: form.success_message };
    }
    const email = normEmail(body.email);
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return { ok: false, pending: false, message: "", error: "Enter a valid email address." };
    }
    const first = form.collect_name && body.firstName ? String(body.firstName).trim().slice(0, 100) || null : null;
    const last = form.collect_name && body.lastName ? String(body.lastName).trim().slice(0, 100) || null : null;
    const tenantId = form.tenant_id;
    const now = new Date();
    const ipHash = hashIp(ip);

    await db.updateTable("subscribe_forms").set({ submissions: (eb) => eb("submissions", "+", 1) }).where("id", "=", form.id).execute();

    const existing = await db.selectFrom("contacts").selectAll().where("tenant_id", "=", tenantId).where("email", "=", email).executeTakeFirst();
    if (existing && (existing.status === "BOUNCED" || existing.status === "COMPLAINED")) {
      return { ok: true, pending: form.double_opt_in, message: form.success_message };
    }

    let contactId = existing?.id;
    if (!existing) {
      const n = await db.selectFrom("contacts").select(db.fn.countAll<string>().as("n")).where("tenant_id", "=", tenantId).executeTakeFirst();
      try {
        await entitlementsService.ensureCapacity(tenantId, LIMIT_CODES.CONTACTS, num(n?.n), 1, "contact");
      } catch {
        logger.warn(`form ${slug}: contact limit reached for tenant ${tenantId}`);
        return { ok: true, pending: form.double_opt_in, message: form.success_message };
      }
      contactId = ulid();
      await db
        .insertInto("contacts")
        .values({
          id: contactId,
          tenant_id: tenantId,
          email,
          first_name: first,
          last_name: last,
          status: form.double_opt_in ? "PENDING_CONFIRMATION" : "SUBSCRIBED",
          source: "FORM",
          tags: [],
          attributes: "{}",
          consent_at: form.double_opt_in ? null : now,
          consent_ip_hash: ipHash,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) => oc.columns(["tenant_id", "email"]).doNothing())
        .execute();
    }
    const cid = contactId as string;

    if (form.double_opt_in) {
      await this.upsertMember(tenantId, form.list_id, cid, "pending");
      if (existing && existing.status === "UNSUBSCRIBED") {
        await db.updateTable("contacts").set({ status: "PENDING_CONFIRMATION", updated_at: now }).where("id", "=", cid).where("tenant_id", "=", tenantId).execute();
      }
      await this.sendConfirmation(tenantId, cid, form.list_id, email, form.tenant_name);
    } else {
      await this.upsertMember(tenantId, form.list_id, cid, "subscribed");
      if (existing && existing.status !== "SUBSCRIBED") await this.resubscribe(tenantId, cid, ipHash);
    }
    return { ok: true, pending: form.double_opt_in, message: form.success_message };
  }

  private async upsertMember(tenantId: string, listId: string, contactId: string, status: "pending" | "subscribed"): Promise<void> {
    const now = new Date();
    await db
      .insertInto("list_members")
      .values({ tenant_id: tenantId, list_id: listId, contact_id: contactId, status, created_at: now, updated_at: now })
      .onConflict((oc) => oc.columns(["list_id", "contact_id"]).doUpdateSet({ status, updated_at: now }))
      .execute();
  }

  // A person who asked to join again lifts their own unsubscribe.
  private async resubscribe(tenantId: string, contactId: string, ipHash: string | null): Promise<void> {
    const now = new Date();
    const c = await db
      .updateTable("contacts")
      .set({ status: "SUBSCRIBED", unsubscribed_at: null, consent_at: now, consent_ip_hash: ipHash, updated_at: now })
      .where("id", "=", contactId)
      .where("tenant_id", "=", tenantId)
      .where("status", "in", ["UNSUBSCRIBED", "PENDING_CONFIRMATION"])
      .returning("email")
      .executeTakeFirst();
    if (c) {
      await db.deleteFrom("email_suppressions").where("tenant_id", "=", tenantId).where("email", "=", c.email).where("reason", "=", "UNSUBSCRIBE").execute();
    }
  }

  private async sendConfirmation(tenantId: string, contactId: string, listId: string, email: string, tenantName: string): Promise<void> {
    try {
      const sender = await emailResolverService.resolveDefault(tenantId, "TRANSACTIONAL");
      if (!sender) {
        logger.warn(`double opt-in for tenant ${tenantId}: no verified transactional sender, confirmation not sent`);
        return;
      }
      const url = confirmUrl(linkBase(sender.trackingDomain), tenantId, contactId, listId);
      await mailerService.sendTenant({
        tenantId,
        sender,
        category: "TRANSACTIONAL",
        to: email,
        contactId,
        build: () => ({
          subject: `Confirm your subscription to ${tenantName}`,
          html: `<p>Please confirm that you want to receive email from ${escapeHtml(tenantName)}.</p><p><a href="${escapeHtml(url)}">Confirm subscription</a></p><p>If you did not ask for this, ignore this message and nothing will happen.</p>`,
          text: `Please confirm that you want to receive email from ${tenantName}:\n${url}\n\nIf you did not ask for this, ignore this message and nothing will happen.`,
        }),
      });
    } catch (err) {
      logger.warn(`confirmation email failed: ${String(err)}`);
    }
  }

  /** GET /c/:token. Returns the outcome for the public page. */
  async confirm(token: string): Promise<{ ok: boolean; tenantName?: string }> {
    const t = verifyToken(token, "k");
    if (!t || t.parts.length !== 3) return { ok: false };
    const [tenantId, contactId, listId] = t.parts;
    const member = await db
      .selectFrom("list_members")
      .select("status")
      .where("tenant_id", "=", tenantId)
      .where("list_id", "=", listId)
      .where("contact_id", "=", contactId)
      .executeTakeFirst();
    const tenant = await db.selectFrom("tenants").select("name").where("id", "=", tenantId).executeTakeFirst();
    if (!member || !tenant) return { ok: false };
    const contact = await db.selectFrom("contacts").select("status").where("id", "=", contactId).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!contact || contact.status === "BOUNCED" || contact.status === "COMPLAINED") return { ok: false };
    await this.upsertMember(tenantId, listId, contactId, "subscribed");
    await this.resubscribe(tenantId, contactId, null);
    auditService.record(tenantId, null, "contact.confirmed", "contact", contactId, { listId });
    return { ok: true, tenantName: tenant.name };
  }
}

export default new FormsService();
