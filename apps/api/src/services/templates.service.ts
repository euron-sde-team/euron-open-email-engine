import { ulid } from "ulid";
import { db } from "../db/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { isoReq } from "../presenters/common";
import { renderEmail } from "../utils/render";
import auditService from "./audit.service";

const MAX_HTML = 500_000;

interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  preheader: string;
  html: string;
  text_body: string | null;
  is_starter: boolean;
  created_at: Date;
  updated_at: Date;
}

// EmailTemplate in @open-email/types.
export const toTemplateDto = (r: TemplateRow) => ({
  id: r.id,
  name: r.name,
  subject: r.subject,
  preheader: r.preheader,
  html: r.html,
  text: r.text_body,
  isStarter: r.is_starter,
  createdAt: isoReq(r.created_at),
  updatedAt: isoReq(r.updated_at),
});

const clean = (body: Record<string, unknown>, partial: boolean) => {
  const out: Record<string, unknown> = {};
  const need = (k: string, label: string, max: number) => {
    if (body[k] === undefined) {
      if (!partial) throw new BadRequestError(`${label} is required`);
      return;
    }
    const v = String(body[k]);
    if (!v.trim()) throw new BadRequestError(`${label} cannot be empty`);
    if (v.length > max) throw new BadRequestError(`${label} is too long`);
    out[k] = v;
  };
  need("name", "name", 100);
  need("subject", "subject", 300);
  need("html", "html", MAX_HTML);
  if (body.preheader !== undefined) out.preheader = String(body.preheader).slice(0, 300);
  if (body.text !== undefined) out.text_body = body.text === null ? null : String(body.text).slice(0, MAX_HTML);
  return out;
};

class TemplatesService {
  async list(tenantId: string) {
    const rows = await db.selectFrom("templates").selectAll().where("tenant_id", "=", tenantId).orderBy("is_starter", "desc").orderBy("name").limit(500).execute();
    return rows.map(toTemplateDto);
  }

  async get(tenantId: string, id: string) {
    const r = await db.selectFrom("templates").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!r) throw new NotFoundError("Template not found");
    return toTemplateDto(r);
  }

  async create(tenantId: string, actorId: string, body: Record<string, unknown>) {
    const v = clean(body, false);
    const now = new Date();
    const id = ulid();
    await db
      .insertInto("templates")
      .values({ id, tenant_id: tenantId, name: v.name as string, subject: v.subject as string, html: v.html as string, preheader: (v.preheader as string) ?? "", text_body: (v.text_body as string | null) ?? null, is_starter: false, created_at: now, updated_at: now })
      .execute();
    auditService.record(tenantId, actorId, "template.created", "template", id, {});
    return this.get(tenantId, id);
  }

  async update(tenantId: string, actorId: string, id: string, body: Record<string, unknown>) {
    await this.get(tenantId, id);
    const v = clean(body, true);
    await db.updateTable("templates").set({ ...v, updated_at: new Date() }).where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "template.updated", "template", id, {});
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const t = await this.get(tenantId, id);
    if (t.isStarter) throw new ConflictError("Starter templates cannot be deleted. Duplicate one to make your own.");
    await db.deleteFrom("templates").where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "template.deleted", "template", id, {});
    return { id };
  }

  async duplicate(tenantId: string, actorId: string, id: string) {
    const t = await this.get(tenantId, id);
    return this.create(tenantId, actorId, { name: `${t.name} (copy)`.slice(0, 100), subject: t.subject, preheader: t.preheader, html: t.html, text: t.text });
  }

  /** Preview render for the editor: a real contact when given, else a fixed sample. */
  async render(tenantId: string, body: { subject?: string; preheader?: string; html?: string; text?: string | null; contactId?: string }) {
    if (typeof body.html !== "string" || body.html.length > MAX_HTML) throw new BadRequestError("html is required");
    const tenant = await db.selectFrom("tenants").select(["name", "company_address"]).where("id", "=", tenantId).executeTakeFirst();
    let contact = { email: "alex.rivera@example.com", firstName: "Alex", lastName: "Rivera", attributes: {} as Record<string, unknown> };
    if (body.contactId) {
      const c = await db.selectFrom("contacts").selectAll().where("id", "=", body.contactId).where("tenant_id", "=", tenantId).executeTakeFirst();
      if (!c) throw new NotFoundError("Contact not found");
      contact = { email: c.email, firstName: c.first_name ?? "", lastName: c.last_name ?? "", attributes: (c.attributes ?? {}) as Record<string, unknown> };
    }
    return renderEmail({
      subject: String(body.subject ?? ""),
      preheader: body.preheader,
      html: body.html,
      text: body.text,
      contact,
      company: { name: tenant?.name, address: tenant?.company_address },
      unsubscribeUrl: "https://example.com/unsubscribe-preview",
      viewUrl: "https://example.com/view-preview",
    });
  }
}

export default new TemplatesService();
