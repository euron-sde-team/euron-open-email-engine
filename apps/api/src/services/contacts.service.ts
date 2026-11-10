import { type Expression, type SqlBool, sql } from "kysely";
import { ulid } from "ulid";
import { LIMIT_CODES } from "../constants/modules.const";
import { db } from "../db/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { clampLimit, EMAIL_RE, iso, isoReq, normEmail, num } from "../presenters/common";
import { ContactRow, toContactDto } from "../presenters/audience";
import { rulesToExpression, validateRules } from "../utils/segment-sql";
import { csvCell } from "../utils/csv";
import auditService from "./audit.service";
import entitlementsService from "./entitlements.service";

const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.:/-]{0,39}$/u;
const ATTR_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_TAGS = 50;
const MAX_BULK = 500;
const MAX_EXPORT_ROWS = 100_000;

export const normTags = (v: unknown): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new BadRequestError("tags must be an array of strings");
  const out = new Set<string>();
  for (const t of v) {
    const tag = String(t).trim();
    if (!tag) continue;
    if (!TAG_RE.test(tag)) throw new BadRequestError(`Invalid tag: ${tag.slice(0, 40)}`);
    out.add(tag);
  }
  if (out.size > MAX_TAGS) throw new BadRequestError(`At most ${MAX_TAGS} tags per contact`);
  return [...out];
};

export const normAttributes = (v: unknown): Record<string, string | number | boolean | null> => {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new BadRequestError("attributes must be an object");
  const out: Record<string, string | number | boolean | null> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 100) throw new BadRequestError("Too many attributes");
  for (const [k, val] of entries) {
    if (!ATTR_KEY_RE.test(k)) throw new BadRequestError(`Invalid attribute key: ${k.slice(0, 40)}`);
    if (val === null || ["string", "number", "boolean"].includes(typeof val)) {
      out[k] = typeof val === "string" ? val.slice(0, 500) : (val as number | boolean | null);
    } else throw new BadRequestError(`attributes.${k} must be a string, number, boolean or null`);
  }
  return out;
};

const optName = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 100) : null;
};

class ContactsService {
  /** Maps contact ids to the lists they are in (subscribed or pending), in one query. */
  async listIdsFor(tenantId: string, contactIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (!contactIds.length) return map;
    const rows = await db
      .selectFrom("list_members")
      .select(["contact_id", "list_id"])
      .where("tenant_id", "=", tenantId)
      .where("contact_id", "in", contactIds)
      .where("status", "<>", "unsubscribed")
      .execute();
    for (const r of rows) map.set(r.contact_id, [...(map.get(r.contact_id) ?? []), r.list_id]);
    return map;
  }

  async present(tenantId: string, rows: ContactRow[]) {
    const lists = await this.listIdsFor(tenantId, rows.map((r) => r.id));
    return rows.map((r) => toContactDto(r, lists.get(r.id) ?? []));
  }

  private async segmentExpr(tenantId: string, segmentId: string) {
    const seg = await db.selectFrom("segments").select("rules").where("id", "=", segmentId).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!seg) throw new NotFoundError("Segment not found");
    return validateRules(seg.rules);
  }

  async list(
    tenantId: string,
    q: { q?: string; status?: string; tag?: string; listId?: string; segmentId?: string; cursor?: string; limit?: unknown }
  ) {
    const limit = clampLimit(q.limit, 50, 200);
    const rules = q.segmentId ? await this.segmentExpr(tenantId, q.segmentId) : null;
    let qb = db.selectFrom("contacts").selectAll("contacts").where("contacts.tenant_id", "=", tenantId);
    if (q.q) {
      const like = `%${q.q.trim().toLowerCase().replace(/[\\%_]/g, "\\$&").slice(0, 100)}%`;
      qb = qb.where((eb) =>
        eb.or([eb("contacts.email", "like", like), eb("contacts.first_name", "ilike", like), eb("contacts.last_name", "ilike", like)])
      );
    }
    if (q.status) {
      const st = q.status.toUpperCase();
      if (!["SUBSCRIBED", "UNSUBSCRIBED", "BOUNCED", "COMPLAINED", "PENDING_CONFIRMATION"].includes(st)) throw new BadRequestError("Invalid status");
      qb = qb.where("contacts.status", "=", st as never);
    }
    if (q.tag) qb = qb.where(sql<boolean>`${q.tag} = ANY(contacts.tags)`);
    if (q.listId) {
      qb = qb.where(
        sql<boolean>`EXISTS (SELECT 1 FROM list_members lm WHERE lm.contact_id = contacts.id AND lm.tenant_id = ${tenantId} AND lm.list_id = ${q.listId} AND lm.status <> 'unsubscribed')`
      );
    }
    if (rules) qb = qb.where((eb) => rulesToExpression(eb as never, rules) as Expression<SqlBool>);
    if (q.cursor) qb = qb.where("contacts.id", "<", q.cursor);
    const rows = await qb.orderBy("contacts.id", "desc").limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    const items = await this.present(tenantId, page);
    return { items, nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  async get(tenantId: string, id: string) {
    const row = await db.selectFrom("contacts").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!row) throw new NotFoundError("Contact not found");
    return (await this.present(tenantId, [row]))[0];
  }

  private async assertLists(tenantId: string, listIds: string[]): Promise<void> {
    if (!listIds.length) return;
    const found = await db.selectFrom("lists").select("id").where("tenant_id", "=", tenantId).where("id", "in", listIds).execute();
    if (found.length !== new Set(listIds).size) throw new NotFoundError("List not found");
  }

  async create(
    tenantId: string,
    actorId: string,
    body: { email?: string; firstName?: string; lastName?: string; tags?: string[]; attributes?: unknown; listIds?: string[] }
  ) {
    const email = normEmail(body.email);
    if (!EMAIL_RE.test(email) || email.length > 254) throw new BadRequestError("A valid email address is required");
    const tags = normTags(body.tags);
    const attributes = normAttributes(body.attributes);
    const listIds = Array.isArray(body.listIds) ? [...new Set(body.listIds.map(String))] : [];
    await this.assertLists(tenantId, listIds);

    const count = await this.count(tenantId);
    await entitlementsService.ensureCapacity(tenantId, LIMIT_CODES.CONTACTS, count, 1, "contact");

    const now = new Date();
    const id = ulid();
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto("contacts")
          .values({
            id,
            tenant_id: tenantId,
            email,
            first_name: optName(body.firstName),
            last_name: optName(body.lastName),
            status: "SUBSCRIBED",
            source: "MANUAL",
            tags,
            attributes: JSON.stringify(attributes),
            consent_at: now,
            created_at: now,
            updated_at: now,
          })
          .execute();
        if (listIds.length) {
          await trx
            .insertInto("list_members")
            .values(listIds.map((list_id) => ({ tenant_id: tenantId, list_id, contact_id: id, status: "subscribed" as const, created_at: now, updated_at: now })))
            .execute();
        }
      });
    } catch (err) {
      if (/contacts_tenant_id_email_key|duplicate key/.test(String(err))) throw new ConflictError("A contact with that email already exists");
      throw err;
    }
    auditService.record(tenantId, actorId, "contact.created", "contact", id, {});
    return this.get(tenantId, id);
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    body: { firstName?: string | null; lastName?: string | null; tags?: string[]; attributes?: unknown; listIds?: string[]; status?: string }
  ) {
    const cur = await db.selectFrom("contacts").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!cur) throw new NotFoundError("Contact not found");
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.firstName !== undefined) patch.first_name = optName(body.firstName);
    if (body.lastName !== undefined) patch.last_name = optName(body.lastName);
    if (body.tags !== undefined) patch.tags = normTags(body.tags);
    if (body.attributes !== undefined) {
      patch.attributes = JSON.stringify({ ...(cur.attributes as object), ...normAttributes(body.attributes) });
    }
    if (body.status !== undefined) {
      const st = String(body.status).toUpperCase();
      if (st !== "SUBSCRIBED" && st !== "UNSUBSCRIBED") throw new BadRequestError("status can only be set to SUBSCRIBED or UNSUBSCRIBED");
      if (st === "SUBSCRIBED" && ["BOUNCED", "COMPLAINED"].includes(cur.status)) {
        throw new ConflictError("A bounced or complaining address cannot be re-subscribed");
      }
      patch.status = st;
      patch.unsubscribed_at = st === "UNSUBSCRIBED" ? new Date() : null;
    }
    const listIds = body.listIds !== undefined ? [...new Set((body.listIds ?? []).map(String))] : null;
    if (listIds) await this.assertLists(tenantId, listIds);

    await db.transaction().execute(async (trx) => {
      await trx.updateTable("contacts").set(patch).where("id", "=", id).where("tenant_id", "=", tenantId).execute();
      if (listIds) {
        await trx.deleteFrom("list_members").where("tenant_id", "=", tenantId).where("contact_id", "=", id).where("status", "<>", "unsubscribed").execute();
        if (listIds.length) {
          const now = new Date();
          await trx
            .insertInto("list_members")
            .values(listIds.map((list_id) => ({ tenant_id: tenantId, list_id, contact_id: id, status: "subscribed" as const, created_at: now, updated_at: now })))
            .onConflict((oc) => oc.columns(["list_id", "contact_id"]).doNothing())
            .execute();
        }
      }
    });
    auditService.record(tenantId, actorId, "contact.updated", "contact", id, { fields: Object.keys(body) });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const res = await db.deleteFrom("contacts").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) throw new NotFoundError("Contact not found");
    auditService.record(tenantId, actorId, "contact.deleted", "contact", id, {});
    return { id };
  }

  async count(tenantId: string): Promise<number> {
    const r = await db.selectFrom("contacts").select(db.fn.countAll<string>().as("n")).where("tenant_id", "=", tenantId).executeTakeFirst();
    return num(r?.n);
  }

  async timeline(tenantId: string, id: string) {
    const contact = await db.selectFrom("contacts").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!contact) throw new NotFoundError("Contact not found");
    const events = await db
      .selectFrom("email_events as e")
      .leftJoin("campaigns as c", "c.id", "e.campaign_id")
      .select(["e.id", "e.type", "e.occurred_at", "e.campaign_id", "c.name as campaign_name", "e.detail", "e.url", "e.machine"])
      .where("e.tenant_id", "=", tenantId)
      .where("e.contact_id", "=", id)
      .orderBy("e.occurred_at", "desc")
      .limit(200)
      .execute();
    const entries = events.map((e) => ({
      id: e.id,
      type: e.type as string,
      at: isoReq(e.occurred_at),
      campaignId: e.campaign_id,
      campaignName: e.campaign_name,
      detail: e.detail,
      url: e.url,
      machine: e.machine,
    }));
    const origin = {
      id: `${contact.id}:origin`,
      type: contact.source === "IMPORT" ? "IMPORTED" : "SUBSCRIBED",
      at: iso(contact.consent_at ?? contact.created_at) as string,
      campaignId: null,
      campaignName: null,
      detail: `Source: ${contact.source}`,
      url: null,
      machine: false,
    };
    return [...entries, origin].sort((a, b) => b.at.localeCompare(a.at));
  }

  async bulk(tenantId: string, actorId: string, body: { ids?: string[]; action?: string; value?: string }) {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : [];
    if (!ids.length) throw new BadRequestError("ids are required");
    if (ids.length > MAX_BULK) throw new BadRequestError(`At most ${MAX_BULK} contacts per bulk action`);
    const now = new Date();
    let affected = 0;
    switch (body.action) {
      case "tag":
      case "untag": {
        const tag = normTags([body.value])[0];
        if (!tag) throw new BadRequestError("value (the tag) is required");
        const res =
          body.action === "tag"
            ? await sql`UPDATE contacts SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(array_append(tags, ${tag}::text)) t), updated_at = ${now} WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::text[]) AND NOT (${tag} = ANY(tags))`.execute(db)
            : await sql`UPDATE contacts SET tags = array_remove(tags, ${tag}::text), updated_at = ${now} WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::text[]) AND ${tag} = ANY(tags)`.execute(db);
        affected = Number(res.numAffectedRows ?? 0);
        break;
      }
      case "addToList": {
        if (!body.value) throw new BadRequestError("value (the list id) is required");
        await this.assertLists(tenantId, [body.value]);
        const res = await sql`INSERT INTO list_members (tenant_id, list_id, contact_id, status, created_at, updated_at)
          SELECT ${tenantId}, ${body.value}, c.id, 'subscribed', ${now}, ${now} FROM contacts c WHERE c.tenant_id = ${tenantId} AND c.id = ANY(${ids}::text[])
          ON CONFLICT (list_id, contact_id) DO UPDATE SET status = CASE WHEN list_members.status = 'unsubscribed' THEN list_members.status ELSE 'subscribed' END, updated_at = ${now}`.execute(db);
        affected = Number(res.numAffectedRows ?? 0);
        break;
      }
      case "removeFromList": {
        if (!body.value) throw new BadRequestError("value (the list id) is required");
        const res = await db.deleteFrom("list_members").where("tenant_id", "=", tenantId).where("list_id", "=", body.value).where("contact_id", "in", ids).executeTakeFirst();
        affected = Number(res.numDeletedRows);
        break;
      }
      case "delete": {
        const res = await db.deleteFrom("contacts").where("tenant_id", "=", tenantId).where("id", "in", ids).executeTakeFirst();
        affected = Number(res.numDeletedRows);
        break;
      }
      default:
        throw new BadRequestError("action must be tag, untag, addToList, removeFromList or delete");
    }
    auditService.record(tenantId, actorId, `contact.bulk_${body.action}`, "contact", null, { count: ids.length, affected });
    return { affected };
  }

  /** Streams the audience as CSV, formula-injection safe, bounded at 100k rows. */
  async exportCsv(tenantId: string, write: (chunk: string) => void): Promise<void> {
    const fields = await db.selectFrom("custom_fields").select("key").where("tenant_id", "=", tenantId).orderBy("key").execute();
    const keys = fields.map((f) => f.key);
    const header = ["email", "first_name", "last_name", "status", "source", "tags", "created_at", ...keys.map((k) => `attr:${k}`)];
    write(header.map(csvCell).join(",") + "\r\n");
    let cursor: string | undefined;
    let written = 0;
    while (written < MAX_EXPORT_ROWS) {
      let qb = db.selectFrom("contacts").selectAll().where("tenant_id", "=", tenantId);
      if (cursor) qb = qb.where("id", ">", cursor);
      const rows = await qb.orderBy("id").limit(1000).execute();
      if (!rows.length) break;
      for (const r of rows) {
        const attrs = (r.attributes ?? {}) as Record<string, unknown>;
        write(
          [r.email, r.first_name, r.last_name, r.status, r.source, (r.tags ?? []).join(";"), isoReq(r.created_at), ...keys.map((k) => attrs[k])]
            .map(csvCell)
            .join(",") + "\r\n"
        );
      }
      written += rows.length;
      cursor = rows[rows.length - 1].id;
    }
  }
}

export default new ContactsService();
