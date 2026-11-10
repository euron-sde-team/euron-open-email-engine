import { type Expression, type SqlBool, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import { BadRequestError, NotFoundError } from "../errors";
import { toSegmentDto } from "../presenters/audience";
import { num } from "../presenters/common";
import { rulesToExpression, type SegmentRules, validateRules } from "../utils/segment-sql";
import auditService from "./audit.service";
import contactsService from "./contacts.service";

const COUNT_TIMEOUT_MS = 3000;

class SegmentsService {
  /** Counts matching contacts under a statement timeout so a heavy rule cannot hold a connection. */
  async countMatching(tenantId: string, rules: SegmentRules): Promise<number> {
    return db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('statement_timeout', ${String(COUNT_TIMEOUT_MS)}, true)`.execute(trx);
      try {
        const r = await trx
          .selectFrom("contacts")
          .select(trx.fn.countAll<string>().as("n"))
          .where("tenant_id", "=", tenantId)
          .where((eb) => rulesToExpression(eb as never, rules) as Expression<SqlBool>)
          .executeTakeFirst();
        return num(r?.n);
      } catch (err) {
        if (/statement timeout|canceling statement/i.test(String(err))) {
          throw new BadRequestError("These rules take too long to evaluate. Narrow them and try again.");
        }
        throw err;
      }
    });
  }

  async list(tenantId: string, withCount: boolean) {
    const rows = await db.selectFrom("segments").selectAll().where("tenant_id", "=", tenantId).orderBy("created_at", "desc").limit(500).execute();
    if (!withCount) return rows.map(toSegmentDto);
    const out = [];
    for (const r of rows) {
      const count = await this.countMatching(tenantId, validateRules(r.rules)).catch(() => null);
      out.push({ ...toSegmentDto(r), contactCount: count });
    }
    return out;
  }

  async get(tenantId: string, id: string, withCount = false) {
    const row = await db.selectFrom("segments").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!row) throw new NotFoundError("Segment not found");
    if (!withCount) return toSegmentDto(row);
    const count = await this.countMatching(tenantId, validateRules(row.rules)).catch(() => null);
    return { ...toSegmentDto(row), contactCount: count };
  }

  async create(tenantId: string, actorId: string, body: { name?: string; description?: string; rules?: unknown }) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new BadRequestError("name is required");
    const rules = validateRules(body.rules);
    const count = await this.countMatching(tenantId, rules);
    const now = new Date();
    const id = ulid();
    await db
      .insertInto("segments")
      .values({ id, tenant_id: tenantId, name: name.slice(0, 100), description: String(body.description ?? "").slice(0, 500), rules: JSON.stringify(rules), contact_count: count, created_at: now, updated_at: now })
      .execute();
    auditService.record(tenantId, actorId, "segment.created", "segment", id, {});
    return this.get(tenantId, id);
  }

  async update(tenantId: string, actorId: string, id: string, body: { name?: string; description?: string; rules?: unknown }) {
    await this.get(tenantId, id);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) {
      if (!String(body.name).trim()) throw new BadRequestError("name cannot be empty");
      patch.name = String(body.name).trim().slice(0, 100);
    }
    if (body.description !== undefined) patch.description = String(body.description).slice(0, 500);
    if (body.rules !== undefined) {
      const rules = validateRules(body.rules);
      patch.rules = JSON.stringify(rules);
      patch.contact_count = await this.countMatching(tenantId, rules);
    }
    await db.updateTable("segments").set(patch).where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "segment.updated", "segment", id, {});
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    await this.get(tenantId, id);
    await db.deleteFrom("segments").where("id", "=", id).where("tenant_id", "=", tenantId).execute();
    auditService.record(tenantId, actorId, "segment.deleted", "segment", id, {});
    return { id };
  }

  /** POST /segments/preview: the count and ten sample contacts. */
  async preview(tenantId: string, rawRules: unknown) {
    const rules = validateRules(rawRules);
    const [count, sampleRows] = await Promise.all([
      this.countMatching(tenantId, rules),
      db
        .selectFrom("contacts")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where((eb) => rulesToExpression(eb as never, rules) as Expression<SqlBool>)
        .orderBy("id", "desc")
        .limit(10)
        .execute(),
    ]);
    return { count, sample: await contactsService.present(tenantId, sampleRows) };
  }
}

export default new SegmentsService();
