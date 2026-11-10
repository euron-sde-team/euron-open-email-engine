import { isModuleKey, PLAN_LIMIT_FIELDS } from "../../constants/modules.const";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors";
import plansRepository, { PlanRow } from "../../repositories/operator/plans.repository";
import auditService, { AuditActor } from "./audit.service";

// Plans are sales artifacts. Creating or editing a plan NEVER mutates any
// existing tenant's entitlements: a tenant's entitlements are a snapshot
// taken at onboarding or plan-change time and live independently thereafter.

const PLAN_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const validateModules = (modules: unknown): string[] => {
  if (!Array.isArray(modules) || !modules.length) {
    throw new BadRequestError("modules must be a non-empty array of module keys");
  }
  for (const moduleKey of modules) {
    if (typeof moduleKey !== "string" || !isModuleKey(moduleKey)) {
      throw new BadRequestError(`Invalid module key: ${String(moduleKey)}`);
    }
  }
  return [...new Set(modules as string[])];
};

// Limits use the wire names (monthlyEmails, maxContacts, maxDomains, maxUsers). A missing or
// null value means unlimited; anything else must be a non-negative integer.
const validateLimits = (limits: unknown): Record<string, number | null> => {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw new BadRequestError(`limits must be an object with ${PLAN_LIMIT_FIELDS.join(", ")}`);
  }
  const src = limits as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (!(PLAN_LIMIT_FIELDS as readonly string[]).includes(key)) {
      throw new BadRequestError(`Unknown limit: ${key}`);
    }
  }
  const out: Record<string, number | null> = {};
  for (const field of PLAN_LIMIT_FIELDS) {
    const value = src[field];
    if (value === undefined || value === null) {
      out[field] = null;
      continue;
    }
    if (!Number.isInteger(value) || (value as number) < 0) {
      throw new BadRequestError(`limits.${field} must be a non-negative integer or null`);
    }
    out[field] = value as number;
  }
  return out;
};

class PlansService {
  async list(): Promise<PlanRow[]> {
    return plansRepository.list();
  }

  async create(
    actor: AuditActor,
    body: {
      key?: string;
      name?: string;
      description?: string;
      modules?: unknown;
      limits?: unknown;
    }
  ): Promise<PlanRow> {
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key || !PLAN_KEY_PATTERN.test(key)) {
      throw new BadRequestError("key must be UPPER_SNAKE_CASE (letters, digits, underscores)");
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new BadRequestError("Name is required");
    const modules = validateModules(body.modules);
    const limits = validateLimits(body.limits);

    const existing = await plansRepository.findByKey(key);
    if (existing) throw new ConflictError(`Plan with key ${key} already exists`);

    const created = await plansRepository.create({
      key,
      name,
      description: typeof body.description === "string" ? body.description : null,
      modules,
      limits,
    });

    auditService.log(actor, "plan.created", "plans", {
      resourceId: created.id,
      summary: `${actor.email} created plan ${key} (${name})`,
      metadata: { key, name, modules, limits },
    });
    return created;
  }

  async update(
    actor: AuditActor,
    id: string,
    body: {
      name?: string;
      description?: string | null;
      modules?: unknown;
      limits?: unknown;
      is_active?: boolean;
      sort_order?: number;
    }
  ): Promise<PlanRow> {
    const patch: Parameters<typeof plansRepository.update>[1] = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new BadRequestError("Name cannot be empty");
      patch.name = name;
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") {
        throw new BadRequestError("description must be a string or null");
      }
      patch.description = body.description;
    }
    if (body.modules !== undefined) patch.modules = validateModules(body.modules);
    if (body.limits !== undefined) patch.limits = validateLimits(body.limits);
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        throw new BadRequestError("is_active must be a boolean");
      }
      patch.is_active = body.is_active;
    }
    if (body.sort_order !== undefined) {
      if (!Number.isInteger(body.sort_order)) {
        throw new BadRequestError("sort_order must be an integer");
      }
      patch.sort_order = body.sort_order;
    }
    if (!Object.keys(patch).length) throw new BadRequestError("Nothing to update");

    const updated = await plansRepository.update(id, patch);
    if (!updated) throw new NotFoundError("Plan not found");

    auditService.log(actor, "plan.updated", "plans", {
      resourceId: updated.id,
      summary: `${actor.email} updated plan ${updated.key}`,
      metadata: { ...patch },
    });
    return updated;
  }
}

export default new PlansService();
