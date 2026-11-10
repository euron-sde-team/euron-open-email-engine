import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { tenant_status } from "../../db/enums";
import type { DB, tenants } from "../../db/types";

export type TenantRow = Selectable<tenants>;
export type TenantWithUsage = TenantRow & { usage: { users: number; contacts: number } };

class TenantsRepository {
  async listWithUsage(filters: {
    q?: string;
    status?: tenant_status;
  }): Promise<TenantWithUsage[]> {
    let query = db
      .selectFrom("tenants")
      .selectAll("tenants")
      .select((eb) => [
        eb
          .selectFrom("users")
          .select((ib) => ib.fn.count<number>("users.id").as("n"))
          .whereRef("users.tenant_id", "=", "tenants.id")
          .as("users_count"),
        eb
          .selectFrom("contacts")
          .select((ib) => ib.fn.count<number>("contacts.id").as("n"))
          .whereRef("contacts.tenant_id", "=", "tenants.id")
          .as("contacts_count"),
      ]);
    if (filters.q) {
      const like = `%${filters.q}%`;
      query = query.where((eb) =>
        eb.or([eb("tenants.name", "ilike", like), eb("tenants.slug", "ilike", like)])
      );
    }
    if (filters.status) query = query.where("tenants.status", "=", filters.status);

    const rows = await query.orderBy("tenants.created_at", "asc").execute();
    return rows.map(({ users_count, contacts_count, ...tenant }) => ({
      ...tenant,
      usage: { users: Number(users_count ?? 0), contacts: Number(contacts_count ?? 0) },
    }));
  }

  async findById(id: string): Promise<TenantRow | undefined> {
    return db.selectFrom("tenants").selectAll().where("id", "=", id).executeTakeFirst();
  }

  async findBySlug(slug: string): Promise<TenantRow | undefined> {
    return db.selectFrom("tenants").selectAll().where("slug", "=", slug).executeTakeFirst();
  }

  async create(
    data: {
      slug: string;
      name: string;
      plan_key: string;
      brand_color?: string;
      timezone?: string;
    },
    trx?: Transaction<DB>
  ): Promise<TenantRow> {
    const t = new Date();
    return (trx || db)
      .insertInto("tenants")
      .values({
        id: ulid(),
        slug: data.slug,
        name: data.name,
        plan_key: data.plan_key,
        ...(data.brand_color !== undefined ? { brand_color: data.brand_color } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        status: "ACTIVE",
        created_at: t,
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      brand_color: string;
      status: tenant_status;
      plan_key: string;
    }>,
    trx?: Transaction<DB>
  ): Promise<TenantRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.brand_color !== undefined) patch.brand_color = data.brand_color;
    if (data.status !== undefined) patch.status = data.status;
    if (data.plan_key !== undefined) patch.plan_key = data.plan_key;
    return (trx || db)
      .updateTable("tenants")
      .set(patch)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async usage(tenantId: string): Promise<{ users: number; contacts: number }> {
    const [users, contacts] = await Promise.all([
      this.count("users", tenantId),
      this.count("contacts", tenantId),
    ]);
    return { users, contacts };
  }

  private async count(table: "users" | "contacts", tenantId: string): Promise<number> {
    const row = await db
      .selectFrom(table)
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }
}

export default new TenantsRepository();
