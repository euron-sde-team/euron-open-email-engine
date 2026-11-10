import {
  LIMIT_CODE_BY_FIELD,
  moduleEntitlementCode,
  PLAN_LIMIT_FIELDS,
  type PlanLimitField,
} from "../../constants/modules.const";
import type { EntitlementSpec } from "../../repositories/operator/entitlements.repository";
import type { PlanRow } from "../../repositories/operator/plans.repository";

/** The wire shape of `PlanLimits` in @open-email/types: null means unlimited. */
export type PlanLimitsDto = Record<PlanLimitField, number | null>;

export const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Reads `plans.limits` into the wire shape; a missing or null limit is unlimited. */
export const parseLimits = (value: unknown): PlanLimitsDto => {
  const src =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const out = {} as PlanLimitsDto;
  for (const field of PLAN_LIMIT_FIELDS) {
    const v = src[field];
    out[field] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return out;
};

// Snapshot of a plan into entitlement rows: one boolean gate per module plus one row per
// limit (a null limit_value is unlimited). The snapshot is taken at onboarding and at
// plan-change time; later edits to the plan itself never touch these rows.
export const planSnapshotSpecs = (plan: PlanRow): EntitlementSpec[] => {
  const modules = parseStringArray(plan.modules);
  const limits = parseLimits(plan.limits);
  return [
    ...modules.map((moduleKey) => ({
      code: moduleEntitlementCode(moduleKey),
      enabled: true,
      limit_value: null,
    })),
    ...PLAN_LIMIT_FIELDS.map((field) => ({
      code: LIMIT_CODE_BY_FIELD[field],
      enabled: true,
      limit_value: limits[field],
    })),
  ];
};
