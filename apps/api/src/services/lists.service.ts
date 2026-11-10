import { sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { toCustomFieldDto, toListDto } from "../presenters/audience";
import { num } from "../presenters/common";
import auditService from "./audit.service";

const FIELD_TYPES = ["text", "number", "date", "boolean"] as const;

class ListsService {
  private async counts(tenantId: string, ids: string[]): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    if (!ids.length) return m;
    const rows = await db
      .selectFrom("list_members")
      .select(["list_id", db.fn.countAll<string>().as("n")])
      .where("tenant_id", "=", tenantId)
      .where("list_id", "in", ids)
      .where("status", "=", "subscribed")
      .groupBy("list_id")
      .execute();
    for (const r of rows) m.set(r.list_id, num(r.n));
    return m;
  }

  async list(tenantId: string) {
    const rows = await db.selectFrom("lists").selectAll().where("tenant_id", "=", tenantId).orderBy("created_at", "desc").limit(500).execute();
    const counts = await this.counts(tenantId, rows.map((r) => r.id));
    return rows.map((r) => toListDto(r, counts.get(r.id) ?? 0));
  }

  async get(tenantId: string, id: string) {
    const row = await db.selectFrom("lists").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!row) throw new NotFoundError("List not found");
    return toListDto(row, (await this.counts(tenantId, [id])).get(id) ?? 0);
  }

  private name(v: unknown): string {
    const n = String(v ?? "").trim();
    if (!n) throw new BadRequestError("name is required");
    return n.slice(0, 100);
  }

  async create(tenantId: string, actorId: string, body: { name?: string; description?: string; doubleOptIn?: boolean }) {
    const now = new Date();
    const id = ulid();
    await db
      .insertInto("lists")
      .values({
        id,
        tenant_id: tenantId,
        name: this.name(body.name),
        description: String(body.description ?? "").slice(0, 500),
        double_opt_in: body.doubleOptIn === true,
        created_at: now,
        updated_at: now,
      })
      .execute();
    auditService.record(tenantId, actorId, "list.created", "list", id, {});
    return this.get(tenantId, id);
  }

  async update(tenantId: string, actorId: string, id: string, body: { name?: string; description?: string; doubleOptIn?: boolean }) {
    await this.get(tenantId, id);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) patch.name = this.name(body.name);
    if (body.description !== undefined) patch.description = String(body.description).slice(0, 500);
    if (body.doubleOptIn !== undefined) patch.double_opt_in = body.doubleOptIn === true;
    await db.updateTable("lists").set(patch).where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "list.updated", "list", id, {});
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    await this.get(tenantId, id);
    const used = await db.selectFrom("subscribe_forms").select("id").where("tenant_id", "=", tenantId).where("list_id", "=", id).executeTakeFirst();
    if (used) throw new ConflictError("A subscribe form still posts to this list. Delete the form first.");
    await db.deleteFrom("lists").where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "list.deleted", "list", id, {});
    return { id };
  }

  async addMembers(tenantId: string, id: string, contactIds: unknown) {
    await this.get(tenantId, id);
    const ids = this.ids(contactIds);
    const now = new Date();
    const valid = await db.selectFrom("contacts").select("id").where("tenant_id", "=", tenantId).where("id", "in", ids).execute();
    if (!valid.length) return { added: 0 };
    await db
      .insertInto("list_members")
      .values(valid.map((c) => ({ tenant_id: tenantId, list_id: id, contact_id: c.id, status: "subscribed" as const, created_at: now, updated_at: now })))
      .onConflict((oc) => oc.columns(["list_id", "contact_id"]).doUpdateSet({ status: sql`CASE WHEN list_members.status = 'unsubscribed' THEN list_members.status ELSE 'subscribed'::list_member_status END`, updated_at: now }))
      .execute();
    return { added: valid.length };
  }

  async removeMembers(tenantId: string, id: string, contactIds: unknown) {
    await this.get(tenantId, id);
    const ids = this.ids(contactIds);
    const res = await db.deleteFrom("list_members").where("tenant_id", "=", tenantId).where("list_id", "=", id).where("contact_id", "in", ids).executeTakeFirst();
    return { removed: Number(res.numDeletedRows) };
  }

  private ids(v: unknown): string[] {
    if (!Array.isArray(v) || !v.length) throw new BadRequestError("contactIds are required");
    if (v.length > 500) throw new BadRequestError("At most 500 contacts per request");
    return [...new Set(v.map(String))];
  }

  // ─── Custom fields ─────────────────────────────────────────────────────────

  async fields(tenantId: string) {
    const rows = await db.selectFrom("custom_fields").selectAll().where("tenant_id", "=", tenantId).orderBy("key").limit(200).execute();
    return rows.map(toCustomFieldDto);
  }

  async createField(tenantId: string, actorId: string, body: { key?: string; label?: string; type?: string }) {
    const key = String(body.key ?? "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) throw new BadRequestError("key must be lowercase letters, digits and underscores, starting with a letter");
    const label = String(body.label ?? "").trim().slice(0, 100) || key;
    const type = (body.type ?? "text") as (typeof FIELD_TYPES)[number];
    if (!FIELD_TYPES.includes(type)) throw new BadRequestError("type must be text, number, date or boolean");
    const count = await db.selectFrom("custom_fields").select(db.fn.countAll<string>().as("n")).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (num(count?.n) >= 100) throw new BadRequestError("At most 100 custom fields");
    try {
      const row = await db
        .insertInto("custom_fields")
        .values({ id: ulid(), tenant_id: tenantId, key, label, type, created_at: new Date() })
        .returningAll()
        .executeTakeFirstOrThrow();
      auditService.record(tenantId, actorId, "custom_field.created", "custom_field", row.id, { key });
      return toCustomFieldDto(row);
    } catch (err) {
      if (/duplicate key/.test(String(err))) throw new ConflictError("A field with that key already exists");
      throw err;
    }
  }

  async removeField(tenantId: string, actorId: string, key: string) {
    const res = await db.deleteFrom("custom_fields").where("tenant_id", "=", tenantId).where("key", "=", key).executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) throw new NotFoundError("Custom field not found");
    auditService.record(tenantId, actorId, "custom_field.deleted", "custom_field", key, {});
    return { key };
  }
}

export default new ListsService();
