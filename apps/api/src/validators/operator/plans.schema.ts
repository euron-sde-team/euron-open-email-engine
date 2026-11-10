import { z } from "zod";
import { optStr, reqStr } from "../common";

// `modules` and `limits` stay `unknown` on purpose: plans.service owns the real
// rules (module-key allowlist, the four limit fields, non-negative
// integers or null) and returns precise messages. Typing them here would duplicate that
// and risk diverging from the module registry.
const modules = z.unknown().optional();
const limits = z.unknown().optional();

// The UPPER_SNAKE_CASE key pattern stays in the service.
export const createPlanSchema = z.object({
  key: reqStr("key"),
  name: reqStr("name"),
  description: optStr,
  modules,
  limits,
});

// Fully partial. `description` is explicitly nullable (the service treats null
// as "clear it"). The "nothing to update" rule stays in the service.
export const updatePlanSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  modules,
  limits,
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});
