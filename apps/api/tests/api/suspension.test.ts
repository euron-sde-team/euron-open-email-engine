import bcrypt from "bcrypt";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import campaignSender from "../../src/services/campaign-sender.service";
import { addContacts, api, auth, newCampaign, newTenant, verifiedSender } from "../helpers";

afterAll(async () => {
  await closeDB();
});

const status = async (t: { token: string; op: string }, id: string) => (await api.get(`/api/v1/campaigns/${id}`).set(auth(t.token))).body.data;
const setTenant = (op: string, id: string, s: string) => api.put(`/api/v1/operator/tenants/${id}`).set(auth(op)).send({ status: s }).expect(200);

describe("suspended and closed workspaces stop sending", () => {
  it("pausing a SCHEDULED campaign on suspend, never auto-resuming, and starting it fresh on resume", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    await addContacts(t, ["a@example.com", "b@example.com"]);
    const c = await newCampaign(t, senderId);
    await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({ at: new Date(Date.now() + 3600_000).toISOString() }).expect(200);
    await setTenant(t.op, t.id, "SUSPENDED");
    const row = await db.selectFrom("campaigns").select(["status", "paused_reason"]).where("id", "=", c.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "PAUSED", paused_reason: "Workspace suspended" });
    await setTenant(t.op, t.id, "ACTIVE");
    expect((await status(t, c.id)).status).toBe("PAUSED"); // reactivation does not resume
    await campaignSender.tick();
    expect((await status(t, c.id)).status).toBe("PAUSED");
    const resumed = await api.post(`/api/v1/campaigns/${c.id}/resume`).set(auth(t.token));
    expect(resumed.status).toBe(200);
    expect((await status(t, c.id)).status).toBe("SENT");
  });

  it("stops a SENDING campaign when the workspace is suspended or closed", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    await addContacts(t, ["s1@example.com", "s2@example.com", "s3@example.com"]);
    const c = await newCampaign(t, senderId);
    await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({}).expect(200);
    // Put it back mid-flight with nothing sent yet.
    await db.deleteFrom("email_messages").where("campaign_id", "=", c.id).execute();
    await db.updateTable("campaign_recipients").set({ status: "QUEUED", message_id: null, claimed_at: null }).where("campaign_id", "=", c.id).execute();
    await db.updateTable("campaigns").set({ status: "SENDING", completed_at: null }).where("id", "=", c.id).execute();
    await setTenant(t.op, t.id, "CLOSED");
    expect(await db.selectFrom("campaigns").select(["status", "paused_reason"]).where("id", "=", c.id).executeTakeFirstOrThrow()).toMatchObject({ status: "PAUSED", paused_reason: "Workspace suspended" });
    // Even a worker already holding the campaign sends nothing for a non-active tenant.
    await db.updateTable("campaigns").set({ status: "SENDING", paused_reason: null }).where("id", "=", c.id).execute();
    await campaignSender.run(c.id);
    const sent = await db.selectFrom("email_messages").select("id").where("campaign_id", "=", c.id).execute();
    expect(sent).toHaveLength(0);
    expect((await db.selectFrom("campaigns").select(["status", "paused_reason"]).where("id", "=", c.id).executeTakeFirstOrThrow())).toMatchObject({ status: "PAUSED", paused_reason: "Workspace suspended" });
  });

  it("the scheduler never starts a due campaign for a suspended workspace", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    await addContacts(t, ["d1@example.com"]);
    const c = await newCampaign(t, senderId);
    await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({ at: new Date(Date.now() + 3600_000).toISOString() }).expect(200);
    await db.updateTable("tenants").set({ status: "SUSPENDED" }).where("id", "=", t.id).execute(); // bypass the operator action
    await db.updateTable("campaigns").set({ scheduled_at: new Date(Date.now() - 1000) }).where("id", "=", c.id).execute();
    await campaignSender.tick();
    const row = await db.selectFrom("campaigns").select(["status", "paused_reason", "started_at"]).where("id", "=", c.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "PAUSED", paused_reason: "Workspace suspended", started_at: null });
    expect((await db.selectFrom("campaign_recipients").select("id").where("campaign_id", "=", c.id).execute())).toHaveLength(0);
  });
});

describe("tenants cannot raise their own send rate", () => {
  it("ignores emailTps in PUT /tenant/me and keeps other config keys", async () => {
    const t = await newTenant();
    const res = await api.put("/api/v1/tenant/me").set(auth(t.token)).send({ config: { emailTps: 100000, theme: "dark" } });
    expect(res.status).toBe(200);
    const row = await db.selectFrom("tenants").select("config").where("id", "=", t.id).executeTakeFirstOrThrow();
    expect(row.config).toEqual({ theme: "dark" });
    await api.put("/api/v1/tenant/me").set(auth(t.token)).send({ config: { emailTps: 50 } }).expect(200);
    expect((await db.selectFrom("tenants").select("config").where("id", "=", t.id).executeTakeFirstOrThrow()).config).toEqual({ theme: "dark" });
  });
});

describe("operator sign-in timing", () => {
  it("still compares a hash for an unknown email", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    try {
      const res = await api.post("/api/v1/operator/auth/login").send({ email: "nobody@nowhere.example", password: "whatever-password" });
      expect(res.status).toBe(401);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
