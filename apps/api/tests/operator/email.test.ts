import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, newTenant, operatorLogin, verifiedSender, addContacts, newCampaign } from "../helpers";

let op: string;
beforeAll(async () => {
  op = await operatorLogin();
});
afterAll(async () => {
  await closeDB();
});

describe("operator email endpoints", () => {
  it("fleet totals equal the counts of its rows", async () => {
    const res = await api.get("/api/v1/operator/email/fleet").set(auth(op));
    expect(res.status).toBe(200);
    const { totals, tenants } = res.body.data;
    expect(totals.tenants).toBe(tenants.length);
    for (const [key, status] of [["active", "ACTIVE"], ["warning", "WARNING"], ["throttled", "THROTTLED"], ["paused", "PAUSED"]] as const) {
      expect(totals[key]).toBe(tenants.filter((t: { status: string }) => t.status === status).length);
    }
    expect(totals.sentThisMonth).toBeGreaterThan(0);
    const nw = tenants.find((t: { name: string }) => t.name === "Northwind Mail");
    expect(nw).toMatchObject({ plan: "Growth", domains: 1, verifiedDomains: 1, contacts: 600 });
    expect(nw.sent14d).toBeGreaterThan(0);
    expect(tenants.find((t: { name: string }) => t.name === "Acme Robotics").status).toBe("PAUSED");
  });

  it("returns a tenant's fleet row, usage, domains and reputation", async () => {
    const nw = (await api.get("/api/v1/operator/tenants").set(auth(op))).body.data.find((t: { name: string }) => t.name === "Northwind Mail");
    const res = await api.get(`/api/v1/operator/tenants/${nw.id}/email`).set(auth(op));
    expect(res.status).toBe(200);
    expect(res.body.data.fleet.tenantId).toBe(nw.id);
    expect(res.body.data.usage.emails.limit).toBe(50000);
    expect(res.body.data.usage.contacts.used).toBe(600);
    expect(res.body.data.domains[0]).toMatchObject({ domain: "mail.northwind.example", status: "VERIFIED", trackingStatus: "VERIFIED" });
    expect(res.body.data.reputation.history.map((h: { to: string }) => h.to)).toEqual(expect.arrayContaining(["WARNING", "ACTIVE"]));
    expect((await api.get("/api/v1/operator/tenants/nope/email").set(auth(op))).status).toBe(404);
  });

  it("reports simulated account health and an unconfigured DLQ", async () => {
    const health = await api.get("/api/v1/operator/email/account-health").set(auth(op));
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({ mode: "simulated", sendingEnabled: true, sandbox: false });
    expect(health.body.data.quota.maxPerSecond).toBeGreaterThan(0);
    const dlq = await api.get("/api/v1/operator/email/dlq").set(auth(op));
    expect(dlq.body.data).toEqual({ configured: false, depth: 0, oldestAgeSeconds: null, sample: [] });
  });

  it("unpauses a tenant with a required reason and writes an operator audit row", async () => {
    const t = await newTenant();
    await db.updateTable("tenants").set({ email_sending_status: "PAUSED", email_sending_status_changed_at: new Date() }).where("id", "=", t.id).execute();
    const url = `/api/v1/operator/tenants/${t.id}/email/unpause`;

    expect((await api.post(url).set(auth(op)).send({})).status).toBe(400);
    expect((await api.post(url).set(auth(op)).send({ reason: "   " })).status).toBe(400);
    expect((await api.post(url).send({ reason: "x" })).status).toBe(401);
    expect((await api.post(url).set(auth(t.token)).send({ reason: "x" })).status).toBe(401);

    const res = await api.post(url).set(auth(op)).send({ reason: "List cleaned, complaints investigated" });
    expect(res.status).toBe(200);
    expect(res.body.data.fleet.status).toBe("ACTIVE");
    expect(res.body.data.reputation.history[0]).toMatchObject({ from: "PAUSED", to: "ACTIVE", trigger: "operator_unpause" });
    expect(res.body.data.reputation.history[0].reason).toContain("List cleaned");

    let audit;
    for (let i = 0; i < 30 && !audit; i++) {
      audit = await db.selectFrom("operator_audit_logs").selectAll().where("action", "=", "tenant.email_unpaused").where("tenant_id", "=", t.id).executeTakeFirst();
      if (!audit) await new Promise((r) => setTimeout(r, 100));
    }
    expect(audit?.summary).toContain("PAUSED to ACTIVE");
    expect(JSON.stringify(audit?.metadata)).toContain("List cleaned");
    expect((await api.get("/api/v1/dashboard").set(auth(t.token))).body.data.reputation.status).toBe("ACTIVE");
  });

  it("a tenant's PAUSED state blocks marketing sends until unpaused, and a paused campaign can then resume", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    await addContacts(t, ["r1@example.com", "r2@example.com"]);
    const c = await newCampaign(t, senderId);
    await db.updateTable("tenants").set({ email_sending_status: "PAUSED" }).where("id", "=", t.id).execute();
    const pre = await api.get(`/api/v1/campaigns/${c.id}/preflight`).set(auth(t.token));
    expect(pre.body.data.issues.map((i: { code: string }) => i.code)).toContain("SENDING_PAUSED");
    expect((await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({})).status).toBe(422);
    await api.post(`/api/v1/operator/tenants/${t.id}/email/unpause`).set(auth(op)).send({ reason: "ok to send" }).expect(200);
    const sent = await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({});
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe("SENT");
  });
});
