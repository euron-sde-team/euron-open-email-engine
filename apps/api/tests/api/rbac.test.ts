import { afterAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, DEMO_PASSWORD, login, NW_ADMIN, newTenant } from "../helpers";

afterAll(async () => {
  await closeDB();
});

describe("roles and modules", () => {
  it("exposes built-in roles, the six email modules and three capabilities for the team page", async () => {
    const t = await newTenant();
    const res = await api.get("/api/v1/users/roles").set(auth(t.token));
    expect(res.status).toBe(200);
    expect(res.body.data.builtin).toEqual(["ADMIN", "MANAGER", "MARKETER", "ANALYST"]);
    expect(res.body.data.modules).toEqual(["audience", "templates", "campaigns", "analytics", "email", "audit"]);
    expect(res.body.data.capabilities).toEqual(["channels", "team", "settings"]);
    expect(res.body.data.roleModules.MARKETER).toEqual(["audience", "templates", "campaigns", "analytics", "email"]);
  });

  it("signs in with the visible modules, and filters them by role and plan", async () => {
    const t = await newTenant("STARTER");
    const me = await api.get("/api/v1/auth/me").set(auth(t.token));
    expect(me.body.data.user.role).toBe("ADMIN");
    expect(me.body.data.user.modules.sort()).toEqual(["analytics", "audience", "campaigns", "channels", "email", "settings", "team", "templates"]); // Starter has no audit module
    expect(me.body.data.user.tenant).toMatchObject({ plan_key: "STARTER", timezone: "UTC" });
    expect(me.body.data.user).not.toHaveProperty("phone");
  });

  it("MARKETER builds audiences and campaigns but cannot set up domains, manage the team or change settings", async () => {
    const t = await newTenant();
    const created = await api.post("/api/v1/users").set(auth(t.token)).send({ name: "Mark", email: `mark-${Date.now()}@mk.example`, role: "MARKETER", password: DEMO_PASSWORD });
    expect(created.status).toBe(201);
    const m = await login(created.body.data.email);
    expect((await api.get("/api/v1/contacts").set(auth(m))).status).toBe(200);
    expect((await api.get("/api/v1/campaigns").set(auth(m))).status).toBe(200);
    expect((await api.get("/api/v1/templates").set(auth(m))).status).toBe(200);
    expect((await api.get("/api/v1/dashboard").set(auth(m))).status).toBe(200);
    expect((await api.get("/api/v1/email/senders").set(auth(m))).status).toBe(200); // the composer's sender picker
    expect((await api.get("/api/v1/email/domains").set(auth(m))).status).toBe(200);
    expect((await api.post("/api/v1/email/domains").set(auth(m)).send({ domain: "mail.nope.example" })).status).toBe(403);
    expect((await api.post("/api/v1/users").set(auth(m)).send({ name: "x", email: "x@mk.example", role: "ANALYST" })).status).toBe(403);
    expect((await api.put("/api/v1/tenant/me").set(auth(m)).send({ name: "Mine now" })).status).toBe(403);
    expect((await api.get("/api/v1/audit").set(auth(m))).status).toBe(403);
  });

  it("ANALYST reads results but cannot touch the audience or campaigns", async () => {
    const t = await newTenant();
    const created = await api.post("/api/v1/users").set(auth(t.token)).send({ name: "Ana", email: `ana-${Date.now()}@an.example`, role: "ANALYST", password: DEMO_PASSWORD });
    const a = await login(created.body.data.email);
    expect((await api.get("/api/v1/dashboard").set(auth(a))).status).toBe(200);
    expect((await api.get("/api/v1/email/messages").set(auth(a))).status).toBe(200);
    expect((await api.get("/api/v1/email/reputation").set(auth(a))).status).toBe(200);
    for (const p of ["/contacts", "/campaigns", "/templates", "/lists", "/segments", "/forms", "/imports"]) expect((await api.get(`/api/v1${p}`).set(auth(a))).status, p).toBe(403);
  });

  it("a module the plan does not include is a 403 even for an ADMIN", async () => {
    const t = await newTenant("STARTER");
    expect((await api.get("/api/v1/audit").set(auth(t.token))).status).toBe(403);
    expect((await api.get("/api/v1/contacts").set(auth(t.token))).status).toBe(200);
  });

  it("enforces the user limit of the plan and the admin-only rules", async () => {
    const t = await newTenant("GROWTH", { limits: { maxUsers: 2 } });
    const mk = (n: string, role: string) => api.post("/api/v1/users").set(auth(t.token)).send({ name: n, email: `${n}-${Date.now()}@lim.example`, role, password: DEMO_PASSWORD });
    expect((await mk("one", "MARKETER")).status).toBe(201);
    expect((await mk("two", "MARKETER")).status).toBe(403);
    expect((await mk("bad", "NOPE")).status).toBe(400);
    const users = (await api.get("/api/v1/users").set(auth(t.token))).body.data;
    const admin = users.find((u: { role: string }) => u.role === "ADMIN");
    expect((await api.delete(`/api/v1/users/${admin.id}`).set(auth(t.token))).status).toBe(400); // not yourself, not the last admin
    expect(JSON.stringify(users)).not.toContain("password_hash");
  });

  it("custom roles grant exactly the modules they list", async () => {
    const t = await newTenant();
    const role = await api.post("/api/v1/users/roles").set(auth(t.token)).send({ name: "Templates only", permissions: ["templates"] });
    expect(role.status).toBe(201);
    expect((await api.post("/api/v1/users/roles").set(auth(t.token)).send({ name: "Bad", permissions: ["leads"] })).status).toBe(400);
    const u = await api.post("/api/v1/users").set(auth(t.token)).send({ name: "T", email: `t-${Date.now()}@tp.example`, role: role.body.data.key, password: DEMO_PASSWORD });
    const tok = await login(u.body.data.email);
    expect((await api.get("/api/v1/templates").set(auth(tok))).status).toBe(200);
    expect((await api.get("/api/v1/campaigns").set(auth(tok))).status).toBe(403);
  });
});

describe("workspace settings, profile and audit", () => {
  it("updates name, time zone and footer address with validation, and records an audit trail", async () => {
    const t = await newTenant();
    const res = await api.put("/api/v1/tenant/me").set(auth(t.token)).send({ name: "Renamed", timezone: "Europe/Berlin", company_address: "1 Example Road, Town" });
    expect(res.status).toBe(200);
    const me = (await api.get("/api/v1/tenant/me").set(auth(t.token))).body.data;
    expect(me.tenant).toMatchObject({ name: "Renamed", timezone: "Europe/Berlin", company_address: "1 Example Road, Town" });
    expect(me.usage).toMatchObject({ users: 1, contacts: 0, domains: 0, emailsThisMonth: 0 });
    expect((await api.put("/api/v1/tenant/me").set(auth(t.token)).send({ timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await api.put("/api/v1/tenant/me").set(auth(t.token)).send({ name: "  " })).status).toBe(400);
    let logs: Array<{ action: string; user: string }> = [];
    for (let i = 0; i < 30 && !logs.some((l) => l.action === "tenant.updated"); i++) {
      logs = (await api.get("/api/v1/audit").set(auth(t.token))).body.data;
      if (!logs.some((l) => l.action === "tenant.updated")) await new Promise((r) => setTimeout(r, 100));
    }
    expect(logs.find((l) => l.action === "tenant.updated")?.user).toBe("Test Admin");
    expect((await api.get("/api/v1/audit").set(auth(t.token)).query({ action: "auth.login" })).body.data.every((l: { action: string }) => l.action === "auth.login")).toBe(true);
  });

  it("changes the user's own password and rejects the wrong current one", async () => {
    const t = await newTenant();
    expect((await api.patch("/api/v1/users/me/password").set(auth(t.token)).send({ currentPassword: "wrong-wrong", newPassword: "another-pass-1" })).status).toBe(400);
    expect((await api.patch("/api/v1/users/me/password").set(auth(t.token)).send({ currentPassword: DEMO_PASSWORD, newPassword: "short" })).status).toBe(400);
    expect((await api.patch("/api/v1/users/me/password").set(auth(t.token)).send({ currentPassword: DEMO_PASSWORD, newPassword: "another-pass-1" })).status).toBe(200);
    expect((await api.post("/api/v1/auth/login").send({ email: t.email, password: DEMO_PASSWORD })).status).toBe(401);
    expect((await api.post("/api/v1/auth/login").send({ email: t.email, password: "another-pass-1" })).status).toBe(200);
  });

  it("answers forgot-password the same for unknown and known addresses", async () => {
    const t = await newTenant();
    const known = await api.post("/api/v1/auth/forgot-password").send({ email: t.email });
    const unknown = await api.post("/api/v1/auth/forgot-password").send({ email: "nobody@nowhere.example" });
    expect(known.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
    expect((await api.post("/api/v1/auth/reset-password").send({ token: "bogus", password: "long-enough-1" })).status).toBe(400);
  });

  it("the seeded Northwind admin sees seeded data through the same API", async () => {
    const token = await login(NW_ADMIN.email);
    const dash = (await api.get("/api/v1/dashboard").set(auth(token))).body.data;
    expect(dash.usage.contacts.used).toBe(600);
    expect(dash.checklist.every((c: { done: boolean }) => c.done)).toBe(true);
    expect(dash.topCampaigns.length).toBeGreaterThan(0);
    expect(dash.daily).toHaveLength(30);
    void db;
  });
});
