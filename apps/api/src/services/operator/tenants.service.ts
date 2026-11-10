import bcrypt from "bcrypt";
import { db } from "../../db/connection";
import { tenant_status } from "../../db/enums";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors";
import entitlementsRepository, {
  EntitlementRow,
} from "../../repositories/operator/entitlements.repository";
import plansRepository, { PlanRow } from "../../repositories/operator/plans.repository";
import tenantsRepository, {
  TenantRow,
  TenantWithUsage,
} from "../../repositories/operator/tenants.repository";
import usersRepository, { TenantUserSummary } from "../../repositories/operator/users.repository";
import logger from "../../utils/logger";
import { generateTempPassword } from "../../utils/password";
import auditService, { AuditActor } from "./audit.service";
import emailService from "./email.service";
import { renderOnboardingEmail } from "./email/onboarding.template";
import campaignSender from "../campaign-sender.service";
import entitlementsService from "../entitlements.service";
import { ensureStarterTemplates } from "../starter-templates";
import { parseLimits, parseStringArray, planSnapshotSpecs } from "./plan-snapshot";

const BCRYPT_ROUNDS = 12;

const isTenantStatus = (value: string): value is tenant_status =>
  Object.values(tenant_status).includes(value as tenant_status);

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

class TenantsService {
  async list(filters: { q?: string; status?: string }): Promise<TenantWithUsage[]> {
    let status: tenant_status | undefined;
    if (filters.status) {
      if (!isTenantStatus(filters.status)) {
        throw new BadRequestError(
          `Invalid status: must be one of ${Object.values(tenant_status).join(", ")}`
        );
      }
      status = filters.status;
    }
    return tenantsRepository.listWithUsage({ q: filters.q, status });
  }

  async detail(id: string): Promise<{
    tenant: TenantRow;
    entitlements: EntitlementRow[];
    usage: { users: number; contacts: number };
    adminUsers: TenantUserSummary[];
  }> {
    const tenant = await tenantsRepository.findById(id);
    if (!tenant) throw new NotFoundError("Tenant not found");
    const [entitlements, usage, adminUsers] = await Promise.all([
      entitlementsRepository.listByTenant(id),
      tenantsRepository.usage(id),
      usersRepository.listAdminsByTenant(id),
    ]);
    return { tenant, entitlements, usage, adminUsers };
  }

  async onboard(
    actor: AuditActor,
    body: {
      name?: string;
      slug?: string;
      brand_color?: string;
      timezone?: string;
      plan_key?: string;
      admin?: { name?: string; email?: string; password?: string };
    }
  ): Promise<{
    tenant: TenantRow;
    adminUser: TenantUserSummary;
    entitlements: EntitlementRow[];
    emailDispatched: boolean;
  }> {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new BadRequestError("Name is required");

    const planKey = typeof body.plan_key === "string" ? body.plan_key.trim() : "";
    if (!planKey) throw new BadRequestError("plan_key is required");
    const plan = await plansRepository.findByKey(planKey);
    if (!plan || !plan.is_active) {
      throw new BadRequestError(`plan_key must reference an active plan: ${planKey}`);
    }

    const adminName = typeof body.admin?.name === "string" ? body.admin.name.trim() : "";
    const adminEmail =
      typeof body.admin?.email === "string" ? body.admin.email.trim().toLowerCase() : "";
    if (!adminName || !adminEmail) {
      throw new BadRequestError("admin.name and admin.email are required");
    }

    const slug = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : name);
    if (!slug) throw new BadRequestError("Could not derive a slug from the tenant name");
    const existing = await tenantsRepository.findBySlug(slug);
    if (existing) throw new ConflictError(`Tenant with slug ${slug} already exists`);

    // When the operator doesn't set a password we generate a secure random one and
    // email it to the workspace admin. If mail is not configured the admin gets no
    // credentials and must use "forgot password", surfaced to the operator via
    // `emailDispatched` in the response.
    const providedPassword =
      typeof body.admin?.password === "string" ? body.admin.password.trim() : "";
    const plainPassword = providedPassword || generateTempPassword();
    const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);

    const result = await db.transaction().execute(async (trx) => {
      const tenant = await tenantsRepository.create(
        {
          slug,
          name,
          plan_key: plan.key,
          ...(typeof body.brand_color === "string" && body.brand_color
            ? { brand_color: body.brand_color }
            : {}),
          ...(typeof body.timezone === "string" && body.timezone ? { timezone: body.timezone } : {}),
        },
        trx
      );

      await entitlementsRepository.insertPlanSnapshot(tenant.id, planSnapshotSpecs(plan), trx);

      const adminUser = await usersRepository.createAdmin(
        { tenantId: tenant.id, name: adminName, email: adminEmail, passwordHash },
        trx
      );

      await ensureStarterTemplates(tenant.id, trx);

      const entitlements = await entitlementsRepository.listByTenant(tenant.id, trx);
      return { tenant, adminUser, entitlements };
    });

    auditService.log(actor, "tenant.created", "tenants", {
      tenantId: result.tenant.id,
      resourceId: result.tenant.id,
      summary: `${actor.email} onboarded tenant ${name} (${slug}) on plan ${plan.key}`,
      metadata: { name, slug, plan_key: plan.key, admin_email: adminEmail },
    });

    // Welcome email. Fire-and-forget: a mail hiccup must never fail onboarding.
    void this.dispatchOnboardingEmail(actor, {
      tenant: result.tenant,
      plan,
      adminName,
      adminEmail,
      plainPassword,
    });

    return { ...result, emailDispatched: emailService.isConfigured() };
  }

  private async dispatchOnboardingEmail(
    actor: AuditActor,
    params: {
      tenant: TenantRow;
      plan: PlanRow;
      adminName: string;
      adminEmail: string;
      plainPassword: string;
    }
  ): Promise<void> {
    try {
      const limits = parseLimits(params.plan.limits);
      const email = renderOnboardingEmail({
        adminName: params.adminName,
        adminEmail: params.adminEmail,
        tempPassword: params.plainPassword,
        workspaceName: params.tenant.name,
        workspaceSlug: params.tenant.slug,
        planName: params.plan.name,
        planKey: params.plan.key,
        modules: parseStringArray(params.plan.modules),
        limits,
      });

      const sendResult = await emailService.send({
        to: params.adminEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      const action = sendResult.sent
        ? "tenant.welcome_email_sent"
        : sendResult.skipped
          ? "tenant.welcome_email_skipped"
          : "tenant.welcome_email_failed";
      const summary = sendResult.sent
        ? `Welcome email sent to ${params.adminEmail} for tenant ${params.tenant.name}`
        : sendResult.skipped
          ? `Welcome email skipped (SES not configured) for tenant ${params.tenant.name}`
          : `Welcome email failed for tenant ${params.tenant.name}: ${sendResult.error ?? "unknown error"}`;

      auditService.log(actor, action, "tenants", {
        tenantId: params.tenant.id,
        resourceId: params.tenant.id,
        summary,
        metadata: {
          to: params.adminEmail,
          messageId: sendResult.messageId ?? null,
          error: sendResult.error ?? null,
        },
      });
    } catch (err) {
      logger.error(
        `[onboarding-email] unexpected error for tenant ${params.tenant.id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async update(
    actor: AuditActor,
    id: string,
    body: { name?: string; brand_color?: string; status?: string; plan_key?: string }
  ): Promise<TenantRow> {
    const existing = await tenantsRepository.findById(id);
    if (!existing) throw new NotFoundError("Tenant not found");

    const patch: { name?: string; brand_color?: string; status?: tenant_status } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new BadRequestError("Name cannot be empty");
      patch.name = name;
    }
    if (body.brand_color !== undefined) {
      if (typeof body.brand_color !== "string" || !body.brand_color.trim()) {
        throw new BadRequestError("brand_color must be a non-empty string");
      }
      patch.brand_color = body.brand_color.trim();
    }
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !isTenantStatus(body.status)) {
        throw new BadRequestError(
          `Invalid status: must be one of ${Object.values(tenant_status).join(", ")}`
        );
      }
      patch.status = body.status;
    }

    let newPlan: PlanRow | undefined;
    if (body.plan_key !== undefined) {
      const planKey = typeof body.plan_key === "string" ? body.plan_key.trim() : "";
      newPlan = planKey ? await plansRepository.findByKey(planKey) : undefined;
      if (!newPlan || !newPlan.is_active) {
        throw new BadRequestError(`plan_key must reference an active plan: ${planKey}`);
      }
    }

    if (!Object.keys(patch).length && !newPlan) throw new BadRequestError("Nothing to update");

    const updated = await db.transaction().execute(async (trx) => {
      if (newPlan) {
        // Plan change: drop the previous PLAN snapshot and re-snapshot from
        // the new plan. ADMIN-sourced override rows are preserved as-is.
        await entitlementsRepository.deletePlanSourced(id, trx);
        await entitlementsRepository.insertPlanSnapshot(id, planSnapshotSpecs(newPlan), trx);
      }
      return tenantsRepository.update(id, { ...patch, plan_key: newPlan?.key }, trx);
    });
    if (!updated) throw new NotFoundError("Tenant not found");

    entitlementsService.invalidate(id);
    // A suspended or closed workspace stops sending at once. Reactivating does not resume.
    if (patch.status && patch.status !== "ACTIVE") await campaignSender.suspendTenant(id);

    auditService.log(actor, "tenant.updated", "tenants", {
      tenantId: updated.id,
      resourceId: updated.id,
      summary: `${actor.email} updated tenant ${updated.name}`,
      metadata: { ...patch, ...(newPlan ? { plan_key: newPlan.key } : {}) },
    });
    return updated;
  }

  async overrideEntitlement(
    actor: AuditActor,
    tenantId: string,
    body: { code?: string; enabled?: boolean; limit_value?: number | null }
  ): Promise<EntitlementRow> {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Tenant not found");

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) throw new BadRequestError("code is required");
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      throw new BadRequestError("enabled must be a boolean");
    }
    if (
      body.limit_value !== undefined &&
      body.limit_value !== null &&
      !Number.isInteger(body.limit_value)
    ) {
      throw new BadRequestError("limit_value must be an integer or null");
    }

    const row = await entitlementsRepository.upsertAdminOverride(tenantId, code, {
      enabled: body.enabled,
      limit_value: body.limit_value,
    });
    entitlementsService.invalidate(tenantId);

    auditService.log(actor, "tenant.entitlement_overridden", "tenants", {
      tenantId,
      resourceId: row.id,
      summary: `${actor.email} overrode entitlement ${code} for tenant ${tenant.name}`,
      metadata: { code, enabled: row.enabled, limit_value: row.limit_value },
    });
    return row;
  }
}

export default new TenantsService();
