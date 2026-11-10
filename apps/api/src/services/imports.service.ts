import { sql } from "kysely";
import { ulid } from "ulid";
import { LIMIT_CODES } from "../constants/modules.const";
import { db } from "../db/connection";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { clampLimit, EMAIL_RE, iso, isoReq, normEmail, num } from "../presenters/common";
import { enqueue, registerHandler } from "../queue/work";
import { parseCsv } from "../utils/csv";
import logger from "../utils/logger";
import auditService from "./audit.service";
import entitlementsService from "./entitlements.service";
import { normTags } from "./contacts.service";
import storageService from "./storage.service";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 100_000;
const MAX_HEADERS = 200;
const CHUNK = 500;
const MAX_ERRORS = 100;
const FIXED_TARGETS = new Set(["email", "first_name", "last_name", "full_name", "tags", "skip"]);

interface ImportError {
  row: number;
  email: string | null;
  reason: string;
}

export interface ParsedMapping {
  mapping: Record<string, string>;
  tags: string[];
}

/** Validates a header -> target mapping. Exactly one column must map to email. */
export const validateMapping = (headers: string[], mapping: unknown, customKeys: Set<string>): Record<string, string> => {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new BadRequestError("mapping is required");
  const m = mapping as Record<string, unknown>;
  const out: Record<string, string> = {};
  let emailCols = 0;
  const seen = new Set<string>();
  for (const h of headers) {
    const target = String(m[h] ?? "skip");
    if (!FIXED_TARGETS.has(target) && !(target.startsWith("attr:") && customKeys.has(target.slice(5)))) {
      throw new BadRequestError(`Column "${h}" maps to an unknown target: ${target.slice(0, 40)}`);
    }
    if (target === "email") emailCols++;
    if (target !== "skip" && target !== "tags" && seen.has(target)) throw new BadRequestError(`More than one column maps to ${target}`);
    seen.add(target);
    out[h] = target;
  }
  for (const k of Object.keys(m)) if (!headers.includes(k)) throw new BadRequestError(`Unknown column in mapping: ${k.slice(0, 40)}`);
  if (emailCols !== 1) throw new BadRequestError("Map exactly one column to email");
  return out;
};

const splitName = (full: string): { first: string | null; last: string | null } => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  return { first: parts[0].slice(0, 100), last: parts.slice(1).join(" ").slice(0, 100) || null };
};

interface PreparedRow {
  email: string;
  first: string | null;
  last: string | null;
  tags: string[];
  attrs: Record<string, string>;
}

/** Turns one CSV record into a contact row, or an error reason. Pure. */
export const prepareRow = (
  record: string[],
  headers: string[],
  mapping: Record<string, string>
): { row?: PreparedRow; error?: { email: string | null; reason: string } } => {
  const row: PreparedRow = { email: "", first: null, last: null, tags: [], attrs: {} };
  headers.forEach((h, i) => {
    const target = mapping[h];
    const v = (record[i] ?? "").trim();
    if (!target || target === "skip" || !v) return;
    if (target === "email") row.email = normEmail(v);
    else if (target === "first_name") row.first = v.slice(0, 100);
    else if (target === "last_name") row.last = v.slice(0, 100);
    else if (target === "full_name") {
      const { first, last } = splitName(v);
      row.first ??= first;
      row.last ??= last;
    } else if (target === "tags") row.tags.push(...v.split(/[;|,]/).map((t) => t.trim()).filter(Boolean));
    else if (target.startsWith("attr:")) row.attrs[target.slice(5)] = v.slice(0, 500);
  });
  if (!row.email) return { error: { email: null, reason: "Missing email" } };
  if (!EMAIL_RE.test(row.email) || row.email.length > 254) return { error: { email: row.email.slice(0, 100), reason: "Invalid email address" } };
  try {
    row.tags = normTags(row.tags);
  } catch {
    return { error: { email: row.email, reason: "Invalid tag" } };
  }
  return { row };
};

const toDto = (r: Awaited<ReturnType<ImportsService["row"]>>) => ({
  id: r.id,
  fileName: r.file_name,
  status: r.status,
  listId: r.list_id,
  total: r.total,
  created: r.created,
  updated: r.updated,
  skipped: r.skipped,
  errors: (Array.isArray(r.errors) ? r.errors : []) as ImportError[],
  createdAt: isoReq(r.created_at),
  finishedAt: iso(r.finished_at),
});

class ImportsService {
  async row(tenantId: string, id: string) {
    const r = await db.selectFrom("import_jobs").selectAll().where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!r) throw new NotFoundError("Import not found");
    return r;
  }

  async list(tenantId: string, q: { cursor?: string; limit?: unknown }) {
    const limit = clampLimit(q.limit, 20, 100);
    let qb = db.selectFrom("import_jobs").selectAll().where("tenant_id", "=", tenantId);
    if (q.cursor) qb = qb.where("id", "<", q.cursor);
    const rows = await qb.orderBy("id", "desc").limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    return { items: page.map(toDto), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  async get(tenantId: string, id: string) {
    return toDto(await this.row(tenantId, id));
  }

  /** POST /imports: stores the file and returns its header row and a few sample rows. */
  async upload(tenantId: string, userId: string, file: { buffer: Buffer; originalname: string; size: number } | undefined) {
    if (!file) throw new BadRequestError("Attach a CSV file in the `file` field");
    if (file.size > IMPORT_MAX_BYTES) throw new BadRequestError("The file is larger than 10 MB");
    if (file.buffer.includes(0)) throw new BadRequestError("That does not look like a CSV text file");
    const parsed = parseCsv(file.buffer.toString("utf8"), IMPORT_MAX_ROWS);
    if (parsed.truncated) throw new BadRequestError(`At most ${IMPORT_MAX_ROWS.toLocaleString("en-US")} rows per import. Split the file.`);
    if (!parsed.headers.length || parsed.headers.every((h) => !h)) throw new BadRequestError("The first row must be column headers");
    if (parsed.headers.length > MAX_HEADERS) throw new BadRequestError("Too many columns");
    if (parsed.headers.some((h) => !h)) throw new BadRequestError("Every column needs a header name");
    if (new Set(parsed.headers).size !== parsed.headers.length) throw new BadRequestError("Column headers must be unique");
    if (!parsed.rows.length) throw new BadRequestError("The file has no data rows");

    const id = ulid();
    const key = `imports/${tenantId}/${id}.csv`;
    const stored = await storageService.upload({ key, body: file.buffer, contentType: "text/csv" });
    const now = new Date();
    const fileId = ulid();
    const name = file.originalname.replace(/[^\w.\- ]/g, "_").slice(0, 150) || "contacts.csv";
    await db
      .insertInto("files")
      .values({ id: fileId, tenant_id: tenantId, key: stored.key, bucket: stored.bucket, name, content_type: "text/csv", size_bytes: file.size, entity_type: "import", entity_id: id, uploaded_by: userId, storage: stored.storage, created_at: now })
      .execute();
    await db
      .insertInto("import_jobs")
      .values({ id, tenant_id: tenantId, file_name: name, file_id: fileId, status: "UPLOADED", total: parsed.rows.length, created_by: userId, created_at: now })
      .execute();
    return { id, fileName: name, headers: parsed.headers, sampleRows: parsed.rows.slice(0, 5), totalRows: parsed.rows.length };
  }

  async start(
    tenantId: string,
    actorId: string,
    id: string,
    body: { mapping?: unknown; listId?: string | null; tags?: unknown; consentConfirmed?: unknown }
  ) {
    const job = await this.row(tenantId, id);
    if (job.status !== "UPLOADED") throw new ConflictError("This import has already been started");
    if (body.consentConfirmed !== true) throw new BadRequestError("Confirm that you have permission to email these contacts");
    const file = job.file_id ? await db.selectFrom("files").selectAll().where("id", "=", job.file_id).where("tenant_id", "=", tenantId).executeTakeFirst() : undefined;
    if (!file) throw new NotFoundError("Import file not found");
    const parsed = parseCsv((await storageService.read(file.key)).toString("utf8"), IMPORT_MAX_ROWS);
    const fields = await db.selectFrom("custom_fields").select("key").where("tenant_id", "=", tenantId).execute();
    const mapping = validateMapping(parsed.headers, body.mapping, new Set(fields.map((f) => f.key)));
    const tags = normTags(body.tags);
    if (body.listId) {
      const l = await db.selectFrom("lists").select("id").where("id", "=", body.listId).where("tenant_id", "=", tenantId).executeTakeFirst();
      if (!l) throw new NotFoundError("List not found");
    }
    const claimed = await db
      .updateTable("import_jobs")
      .set({ status: "QUEUED", mapping: JSON.stringify({ mapping, tags }), list_id: body.listId ?? null })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "UPLOADED")
      .executeTakeFirst();
    if (Number(claimed.numUpdatedRows) === 0) throw new ConflictError("This import has already been started");
    auditService.record(tenantId, actorId, "import.started", "import", id, { rows: job.total });
    await enqueue({ kind: "import", id });
    return this.get(tenantId, id);
  }

  /** The queue handler: processes an import in chunks. Safe to re-run. */
  async process(id: string): Promise<void> {
    const claimed = await db
      .updateTable("import_jobs")
      .set({ status: "PROCESSING" })
      .where("id", "=", id)
      .where("status", "=", "QUEUED")
      .returning(["tenant_id", "file_id", "mapping", "list_id", "created_by"])
      .executeTakeFirst();
    if (!claimed) return;
    const tenantId = claimed.tenant_id;
    try {
      const file = await db.selectFrom("files").selectAll().where("id", "=", claimed.file_id as string).where("tenant_id", "=", tenantId).executeTakeFirstOrThrow();
      const { headers, rows } = parseCsv((await storageService.read(file.key)).toString("utf8"), IMPORT_MAX_ROWS);
      const cfg = claimed.mapping as unknown as ParsedMapping;
      const limit = await entitlementsService.getLimit(tenantId, LIMIT_CODES.CONTACTS);
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: ImportError[] = [];
      const addError = (row: number, email: string | null, reason: string) => {
        skipped++;
        if (errors.length < MAX_ERRORS) errors.push({ row, email, reason });
      };

      for (let start = 0; start < rows.length; start += CHUNK) {
        const prepared = new Map<string, PreparedRow & { line: number }>();
        for (let i = start; i < Math.min(start + CHUNK, rows.length); i++) {
          const line = i + 2; // 1-based, after the header
          const r = prepareRow(rows[i], headers, cfg.mapping);
          if (r.error) {
            addError(line, r.error.email, r.error.reason);
            continue;
          }
          const row = r.row as PreparedRow;
          const prev = prepared.get(row.email);
          if (prev) addError(line, row.email, `Duplicate of row ${prev.line} in this file; kept the first`);
          else prepared.set(row.email, { ...row, tags: [...new Set([...row.tags, ...cfg.tags])], line });
        }
        const emails = [...prepared.keys()];
        if (!emails.length) continue;

        const existing = new Set((await db.selectFrom("contacts").select("email").where("tenant_id", "=", tenantId).where("email", "in", emails).execute()).map((r) => r.email));
        const suppressed = new Map(
          (
            await db
              .selectFrom("email_suppressions")
              .select(["email", "reason"])
              .where("tenant_id", "=", tenantId)
              .where("email", "in", emails)
              .where((eb) => eb.or([eb("category_scope", "is", null), eb("category_scope", "=", "MARKETING")]))
              .execute()
          ).map((r) => [r.email, r.reason])
        );

        let room = Infinity;
        if (limit !== null && limit !== Infinity) {
          const total = num((await db.selectFrom("contacts").select(db.fn.countAll<string>().as("n")).where("tenant_id", "=", tenantId).executeTakeFirst())?.n);
          room = Math.max(0, limit - total);
        }
        const now = new Date();
        const values: Array<Record<string, unknown>> = [];
        for (const row of prepared.values()) {
          if (!existing.has(row.email)) {
            if (room <= 0) {
              addError(row.line, row.email, "Contact limit of your plan reached");
              continue;
            }
            room--;
          }
          const sup = suppressed.get(row.email);
          values.push({
            id: ulid(),
            tenant_id: tenantId,
            email: row.email,
            first_name: row.first,
            last_name: row.last,
            // A new contact that is already suppressed never becomes mailable through an import.
            status: sup === "HARD_BOUNCE" ? "BOUNCED" : sup === "COMPLAINT" ? "COMPLAINED" : sup ? "UNSUBSCRIBED" : "SUBSCRIBED",
            source: "IMPORT",
            tags: row.tags,
            attributes: JSON.stringify(row.attrs),
            consent_at: now,
            created_at: now,
            updated_at: now,
          });
        }
        if (!values.length) continue;

        // One statement per chunk. Existing contacts keep their status; names fill only when
        // empty; tags and attributes merge. xmax = 0 tells inserts from updates.
        const res = await db
          .insertInto("contacts")
          .values(values as never)
          .onConflict((oc) =>
            oc.columns(["tenant_id", "email"]).doUpdateSet({
              first_name: sql`COALESCE(contacts.first_name, excluded.first_name)`,
              last_name: sql`COALESCE(contacts.last_name, excluded.last_name)`,
              tags: sql`(SELECT COALESCE(array_agg(DISTINCT t), ARRAY[]::text[]) FROM unnest(contacts.tags || excluded.tags) t)`,
              attributes: sql`contacts.attributes || excluded.attributes`,
              updated_at: now,
            })
          )
          .returning(["id", "status", sql<boolean>`(xmax = 0)`.as("inserted")])
          .execute();
        for (const r of res) {
          if (r.inserted) created++;
          else updated++;
        }

        if (claimed.list_id) {
          const members = res.filter((r) => r.status === "SUBSCRIBED");
          if (members.length) {
            await db
              .insertInto("list_members")
              .values(members.map((m) => ({ tenant_id: tenantId, list_id: claimed.list_id as string, contact_id: m.id, status: "subscribed" as const, created_at: now, updated_at: now })))
              .onConflict((oc) => oc.columns(["list_id", "contact_id"]).doNothing())
              .execute();
          }
        }
        await db.updateTable("import_jobs").set({ created, updated, skipped, errors: JSON.stringify(errors) }).where("id", "=", id).execute();
      }
      await db
        .updateTable("import_jobs")
        .set({ status: "DONE", created, updated, skipped, errors: JSON.stringify(errors), finished_at: new Date() })
        .where("id", "=", id)
        .execute();
      auditService.record(tenantId, claimed.created_by, "import.finished", "import", id, { created, updated, skipped });
    } catch (err) {
      logger.error(`import ${id} failed: ${String(err)}`);
      await db
        .updateTable("import_jobs")
        .set({ status: "FAILED", errors: JSON.stringify([{ row: 0, email: null, reason: "The import failed unexpectedly" }]), finished_at: new Date() })
        .where("id", "=", id)
        .execute();
    }
  }
}

const service = new ImportsService();
registerHandler("import", (id) => service.process(id));
export default service;
