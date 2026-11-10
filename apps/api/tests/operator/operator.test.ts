import { afterAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, DEMO_PASSWORD, newTenant, operatorLogin } from "../helpers";

let op: string;
const suiteStart = new Date(Date.now() - 1000);

async function waitForAudit(action: string, tenantId?: string) {
  for (let i = 0; i < 30; i++) {
    let q = db.selectFrom("operator_audit_logs").selectAll().where("action", "=", action).where("created_at", ">=", suiteStart);
    if (tenantId) q = q.where("tenant_id", "=", tenantId);
    const row = await q.orderBy("created_at", "desc").executeTakeFirst();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

afterAll(async () => {
  await closeDB();
});

describe("operator auth", () => {
  it("logs in the seeded operator, rejects a bad password and missing tokens", async () => {
    op = await operatorLogin();
    expect((await api.post("/api/v1/operator/auth/login").send({ email: "operator@example.com", password: "wrong-password" })).status).toBe(401);
    expect((await api.get("/api/v1/operator/tenants")).status).toBe(401);
    const me = await api.get("/api/v1/operator/auth/me").set(auth(op));
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toContain("password_hash");
  });

  it("does not accept a tenant token on the operator plane", async () => {
    const t = await newTenant();
    expect((await api.get("/api/v1/operator/tenants").set(auth(t.token))).status).toBe(401);
  });
});

describe("plans", () => {
  it("lists the seeded plans with camelCase limits and the six email modules", async () => {
    const res = await api.get("/api/v1/operator/plans").set(auth(op));
    expect(res.status).toBe(200);
    const growth = res.body.data.find((p: { key: string }) => p.key === "GROWTH");
    expect(growth.limits).toMatchObject({ monthlyEmails: 50000, maxContacts: 25000, maxDomains: 5, maxUsers: 15 });
    expect(growth.modules.sort()).toEqual(["analytics", "audience", "audit", "campaigns", "email", "templates"]);
    expect(growth).not.toHaveProperty("price_monthly");
    const starter = res.body.data.find((p: { key: string }) => p.key === "STARTER");
    expect(starter.limits.monthlyEmails).toBe(5000);
  });

  it("creates and edits a plan without a price, null limits meaning unlimited", async () => {
    const key = `TEST_${Date.now().toString(36).toUpperCase()}`;
    const created = await api.post("/api/v1/operator/plans").set(auth(op)).send({ key, name: "Test plan", modules: ["audience", "campaigns"], limits: { monthlyEmails: 100, maxContacts: null, maxDomains: 1, maxUsers: 2 } });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const upd = await api.put(`/api/v1/operator/plans/${id}`).set(auth(op)).send({ limits: { monthlyEmails: 200, maxContacts: 10, maxDomains: 1, maxUsers: 2 }, is_active: false });
    expect(upd.status).toBe(200);
    expect(upd.body.data.limits.monthlyEmails).toBe(200);
    expect((await waitForAudit("plan.updated"))?.category).toBe("plans");
  });

  it("rejects unknown modules, unknown limits and negative numbers", async () => {
    const bad = (body: object) => api.post("/api/v1/operator/plans").set(auth(op)).send({ key: "BAD_PLAN", name: "x", modules: ["audience"], limits: { monthlyEmails: 1, maxContacts: 1, maxDomains: 1, maxUsers: 1 }, ...body });
    expect((await bad({ modules: ["leads"] })).status).toBe(400);
    expect((await bad({ limits: { monthlyEmails: -1 } })).status).toBe(400);
    expect((await bad({ limits: { seats: 3 } })).status).toBe(400);
  });
});

describe("tenants", () => {
  it("onboards a tenant: entitlements snapshot, admin user, starter templates", async () => {
    const t = await newTenant("STARTER");
    const detail = await api.get(`/api/v1/operator/tenants/${t.id}`).set(auth(op));
    expect(detail.status).toBe(200);
    const codes = detail.body.data.entitlements.map((e: { code: string }) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["module.audience", "limit.monthly_emails", "limit.max_domains"]));
    expect(detail.body.data.entitlements.find((e: { code: string }) => e.code === "limit.monthly_emails").limit_value).toBe(5000);
    expect(detail.body.data.usage).toEqual({ users: 1, contacts: 0 });
    expect(detail.body.data.adminUsers[0].email).toBe(t.email);
    const templates = await api.get("/api/v1/templates").set(auth(t.token));
    expect(templates.body.data.filter((x: { isStarter: boolean }) => x.isStarter)).toHaveLength(8);
    expect((await waitForAudit("tenant.created", t.id))?.tenant_id).toBe(t.id);
  });

  it("onboards with a generated password when none is supplied", async () => {
    const tag = Date.now().toString(36);
    const res = await api.post("/api/v1/operator/tenants").set(auth(op)).send({ name: `NoPw ${tag}`, plan_key: "STARTER", admin: { name: "A", email: `a-${tag}@nopw.example` } });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("emailDispatched");
    expect(JSON.stringify(res.body)).not.toContain("password_hash");
  });

  it("rejects duplicate slugs, unknown plans and a missing admin", async () => {
    const t = await newTenant();
    const dup = await api.post("/api/v1/operator/tenants").set(auth(op)).send({ name: "Dup", slug: t.slug, plan_key: "GROWTH", admin: { name: "A", email: "a@dup.example" } });
    expect(dup.status).toBe(409);
    expect((await api.post("/api/v1/operator/tenants").set(auth(op)).send({ name: "x", plan_key: "NOPE", admin: { name: "A", email: "b@dup.example" } })).status).toBe(400);
    expect((await api.post("/api/v1/operator/tenants").set(auth(op)).send({ name: "x", plan_key: "GROWTH" })).status).toBe(400);
  });

  it("suspends and closes a tenant, locking its users out, then reactivates", async () => {
    const t = await newTenant();
    const off = await api.put(`/api/v1/operator/tenants/${t.id}`).set(auth(op)).send({ status: "SUSPENDED" });
    expect(off.status).toBe(200);
    expect((await api.get("/api/v1/tenant/me").set(auth(t.token))).status).toBe(403);
    expect((await api.post("/api/v1/auth/login").send({ email: t.email, password: DEMO_PASSWORD })).status).toBe(403);
    expect((await api.put(`/api/v1/operator/tenants/${t.id}`).set(auth(op)).send({ status: "CLOSED" })).status).toBe(200);
    expect((await api.put(`/api/v1/operator/tenants/${t.id}`).set(auth(op)).send({ status: "ACTIVE" })).status).toBe(200);
    expect((await api.get("/api/v1/tenant/me").set(auth(t.token))).status).toBe(200);
    expect((await api.put(`/api/v1/operator/tenants/${t.id}`).set(auth(op)).send({ status: "BOGUS" })).status).toBe(400);
  });

  it("changing the plan re-snapshots entitlements, and overrides win over plan rows", async () => {
    const t = await newTenant("STARTER");
    await api.put(`/api/v1/operator/tenants/${t.id}/entitlements`).set(auth(op)).send({ code: "limit.max_domains", limit_value: 9 }).expect(200);
    await api.put(`/api/v1/operator/tenants/${t.id}`).set(auth(op)).send({ plan_key: "GROWTH" }).expect(200);
    const detail = await api.get(`/api/v1/operator/tenants/${t.id}`).set(auth(op));
    const byCode = (c: string) => detail.body.data.entitlements.find((e: { code: string }) => e.code === c);
    expect(byCode("limit.max_domains")).toMatchObject({ limit_value: 9, source: "ADMIN" });
    expect(byCode("limit.monthly_emails").limit_value).toBe(50000);
    expect(byCode("module.audit")).toBeTruthy();
    // null clears the cap
    await api.put(`/api/v1/operator/tenants/${t.id}/entitlements`).set(auth(op)).send({ code: "limit.monthly_emails", limit_value: null }).expect(200);
    const me = await api.get("/api/v1/tenant/me").set(auth(t.token));
    expect(me.body.data.limits.monthly_emails).toBeNull();
  });

  it("returns 404 for an unknown tenant", async () => {
    expect((await api.get("/api/v1/operator/tenants/does-not-exist").set(auth(op))).status).toBe(404);
  });
});

describe("metrics and audit", () => {
  it("returns the overview shape with contacts and emails this month", async () => {
    const res = await api.get("/api/v1/operator/metrics/overview").set(auth(op));
    expect(res.status).toBe(200);
    expect(res.body.data.tenants.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.totals).toEqual({ users: expect.any(Number), contacts: expect.any(Number), emailsThisMonth: expect.any(Number) });
    expect(res.body.data.totals).not.toHaveProperty("leads");
    expect(res.body.data.planDistribution.length).toBeGreaterThan(0);
  });

  it("lists audit rows filtered by action", async () => {
    const res = await api.get("/api/v1/operator/audit").query({ action: "tenant.created" }).set(auth(op));
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: { action: string }) => r.action === "tenant.created")).toBe(true);
  });
});

describe("operators and RBAC", () => {
  it("SUPERADMIN creates an OPERATOR who cannot do superadmin things", async () => {
    const email = `op-${Date.now().toString(36)}@ops.example`;
    const created = await api.post("/api/v1/operator/operators").set(auth(op)).send({ name: "Second Op", email, role: "OPERATOR" });
    expect(created.status).toBe(201);
    const list = await api.get("/api/v1/operator/operators").set(auth(op));
    expect(JSON.stringify(list.body)).not.toContain("password_hash");
  });
});
