import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, users } from "../db/types";
import type { user_status } from "../db/enums";

export type UserRow = Selectable<users>;

class UsersRepository {
  async findById(id: string, tenantId?: string): Promise<UserRow | undefined> {
    let query = db.selectFrom("users").selectAll().where("id", "=", id);
    if (tenantId) query = query.where("tenant_id", "=", tenantId);
    return query.executeTakeFirst();
  }

  // Login lookup: same email can exist in multiple tenants; return all with
  // their tenant so the auth service can pick the active match.
  async findByEmailWithTenants(email: string) {
    return db
      .selectFrom("users")
      .innerJoin("tenants", "tenants.id", "users.tenant_id")
      .select([
        "users.id as id",
        "users.tenant_id as tenant_id",
        "users.name as name",
        "users.email as email",
        "users.password_hash as password_hash",
        "users.role as role",
        "users.status as status",
        "users.permissions as permissions",
        "tenants.slug as tenant_slug",
        "tenants.name as tenant_name",
        "tenants.status as tenant_status",
        "tenants.brand_color as tenant_brand_color",
        "tenants.plan_key as tenant_plan_key",
        "tenants.timezone as tenant_timezone",
      ])
      .where(({ eb, fn }) => eb(fn("lower", ["users.email"]), "=", email.toLowerCase()))
      .execute();
  }

  async findByTenant(tenantId: string): Promise<UserRow[]> {
    return db
      .selectFrom("users")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();
  }

  async emailExistsInTenant(tenantId: string, email: string): Promise<boolean> {
    const row = await db
      .selectFrom("users")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where(({ eb, fn }) => eb(fn("lower", ["email"]), "=", email.toLowerCase()))
      .executeTakeFirst();
    return !!row;
  }

  async countByTenant(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("users")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // How many users currently hold a given role key (used to block deleting a
  // role that is still in use).
  async countByRole(tenantId: string, role: string): Promise<number> {
    const row = await db
      .selectFrom("users")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .where("role", "=", role)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // Member counts keyed by role, for the roles catalogue.
  async countsByRole(tenantId: string): Promise<Record<string, number>> {
    const rows = await db
      .selectFrom("users")
      .select(["role", db.fn.count<number>("id").as("n")])
      .where("tenant_id", "=", tenantId)
      .groupBy("role")
      .execute();
    const out: Record<string, number> = {};
    for (const r of rows) out[r.role] = Number(r.n);
    return out;
  }

  async create(
    data: {
      tenant_id: string;
      name: string;
      email: string;
      password_hash: string;
      role: string;
      status?: user_status;
      permissions?: string[] | null;
      avatar_color?: string | null;
    },
    trx?: Transaction<DB>
  ): Promise<UserRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("users")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        email: data.email,
        password_hash: data.password_hash,
        role: data.role,
        status: data.status ?? "ACTIVE",
        permissions: data.permissions ? JSON.stringify(data.permissions) : null,
        avatar_color: data.avatar_color ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<{
      name: string;
      role: string;
      status: user_status;
      permissions: string[] | null;
      avatar_color: string | null;
      password_hash: string;
    }>,
    trx?: Transaction<DB>
  ): Promise<UserRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.role !== undefined) patch.role = data.role;
    if (data.status !== undefined) patch.status = data.status;
    if (data.permissions !== undefined) {
      patch.permissions = data.permissions ? JSON.stringify(data.permissions) : null;
    }
    if (data.avatar_color !== undefined) patch.avatar_color = data.avatar_color;
    if (data.password_hash !== undefined) patch.password_hash = data.password_hash;

    return (trx || db)
      .updateTable("users")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, tenantId: string): Promise<number> {
    const res = await db
      .deleteFrom("users")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  // Remove the user's own personal records that are meaningless once they are gone.
  async purgePersonal(tenantId: string, userId: string): Promise<{ notifications: number }> {
    const res = await db
      .deleteFrom("notifications")
      .where("tenant_id", "=", tenantId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return { notifications: Number(res?.numDeletedRows ?? 0) };
  }

  touchLastLogin(id: string): void {
    void db
      .updateTable("users")
      .set({ last_login_at: new Date() })
      .where("id", "=", id)
      .execute()
      .catch(() => undefined);
  }
}

export default new UsersRepository();
