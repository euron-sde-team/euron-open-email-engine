import { z } from "zod";
import { optBool, optStr, reqStr } from "../common";

// Mirrors src/db/enums.ts tenant_status.
const TENANT_STATUS = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;

// `slug` may be "", the service derives one from the name.
export const onboardTenantSchema = z.object({
  name: reqStr("name"),
  plan_key: reqStr("plan_key"),
  slug: optStr,
  brand_color: optStr,
  timezone: optStr,
  admin: z.object({
    name: reqStr("admin.name"),
    email: reqStr("admin.email"),
    // Blank means "generate a secure one and email it".
    password: optStr,
  }),
});

// Fully partial. The plan_key-must-be-active check and the "nothing to update"
// rule stay in the service.
export const updateTenantSchema = z.object({
  name: z.string().optional(),
  brand_color: z.string().optional(),
  status: z.enum(TENANT_STATUS).optional(),
  plan_key: z.string().optional(),
});

// `limit_value` is nullable: null clears the cap (unlimited).
export const overrideEntitlementSchema = z.object({
  code: reqStr("code"),
  enabled: optBool,
  limit_value: z.number().int().nullable().optional(),
});
