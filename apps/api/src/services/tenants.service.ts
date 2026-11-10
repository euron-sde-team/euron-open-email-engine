import { BadRequestError, NotFoundError } from "../errors";
import tenantsRepository from "../repositories/tenants.repository";
import auditService from "./audit.service";
import entitlementsService from "./entitlements.service";
import usageService from "./usage.service";

const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

class TenantsService {
  async me(tenantId: string) {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Workspace not found");
    const [usage, entitlements, emailsThisMonth] = await Promise.all([
      tenantsRepository.usage(tenantId),
      entitlementsService.getAll(tenantId),
      usageService.emailsSentThisMonth(tenantId),
    ]);
    const modules = entitlements
      .filter((e) => e.enabled && e.code.startsWith("module."))
      .map((e) => e.code.slice("module.".length));
    const limits = Object.fromEntries(
      entitlements
        .filter((e) => e.enabled && e.code.startsWith("limit."))
        .map((e) => [e.code.slice("limit.".length), e.limit_value])
    );
    return { tenant, usage: { ...usage, emailsThisMonth }, modules, limits };
  }

  async update(
    tenantId: string,
    actorId: string,
    body: Partial<{
      name: string;
      brand_color: string;
      timezone: string;
      company_address: string | null;
      config: Record<string, unknown> | null;
    }>
  ) {
    if (body.name !== undefined && !String(body.name).trim()) {
      throw new BadRequestError("Name cannot be empty");
    }
    if (body.timezone !== undefined && !isValidTimezone(String(body.timezone))) {
      throw new BadRequestError("timezone must be an IANA zone such as Europe/Berlin");
    }
    if (body.company_address !== undefined && body.company_address !== null) {
      if (String(body.company_address).length > 500) {
        throw new BadRequestError("company_address is too long");
      }
    }
    // `config` is a shared JSON blob (sending rate overrides, UI preferences).
    // Shallow-merge so writing one key never wipes another; the repository replaces
    // the column wholesale, so merge here.
    // Send rates are the operator's to set: a tenant cannot raise its own.
    if (body.config) {
      const { emailTps: _ignored, ...rest } = body.config as Record<string, unknown>;
      body = { ...body, config: rest };
    }
    let patch = body;
    if (body.config) {
      const existing = await tenantsRepository.findById(tenantId);
      const current =
        existing?.config && typeof existing.config === "object"
          ? (existing.config as Record<string, unknown>)
          : {};
      patch = { ...body, config: { ...current, ...body.config } };
    }

    const updated = await tenantsRepository.update(tenantId, patch);
    if (!updated) throw new NotFoundError("Workspace not found");
    entitlementsService.invalidate(tenantId);
    auditService.record(tenantId, actorId, "tenant.updated", "tenant", tenantId, {
      fields: Object.keys(body),
    });
    return updated;
  }

  async plans() {
    return tenantsRepository.listActivePlans();
  }
}

export default new TenantsService();
