import { Selectable } from "kysely";
import { db } from "../db/connection";
import type { tenants } from "../db/types";

export type TenantRow = Selectable<tenants>;

class TenantsRepository {
  async findById(id: string): Promise<TenantRow | undefined> {
    return db.selectFrom("tenants").selectAll().where("id", "=", id).executeTakeFirst();
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      brand_color: string;
      timezone: string;
      company_address: string | null;
      config: Record<string, unknown> | null;
    }>
  ): Promise<TenantRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.brand_color !== undefined) patch.brand_color = data.brand_color;
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.company_address !== undefined) patch.company_address = data.company_address;
    if (data.config !== undefined) {
      patch.config = data.config ? JSON.stringify(data.config) : null;
    }
    return db
      .updateTable("tenants")
      .set(patch)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  async usage(tenantId: string) {
    const [users, contacts, domains] = await Promise.all([
      this.count("users", tenantId),
      this.count("contacts", tenantId),
      this.count("email_sending_domains", tenantId),
    ]);
    return { users, contacts, domains };
  }

  private async count(
    table: "users" | "contacts" | "email_sending_domains",
    tenantId: string
  ): Promise<number> {
    const row = await db
      .selectFrom(table)
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async listActivePlans() {
    return db
      .selectFrom("plans")
      .select(["key", "name", "description", "modules", "limits"])
      .where("is_active", "=", true)
      .orderBy("sort_order", "asc")
      .execute();
  }
}

export default new TenantsRepository();
