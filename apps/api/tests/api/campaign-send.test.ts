import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import campaignSender from "../../src/services/campaign-sender.service";
import { addContacts, api, auth, CAMPAIGN_HTML, newCampaign, newTenant, verifiedSender } from "../helpers";

afterAll(async () => {
  await closeDB();
});

const campaign = async (token: string, id: string) => (await api.get(`/api/v1/campaigns/${id}`).set(auth(token))).body.data;

describe("campaign send, end to end in simulated mode", () => {
  it("snapshots the audience, skips suppressed and unsubscribed contacts, sends, and records stats", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    const good = await addContacts(t, ["ada@example.com", "bob@example.com", "cleo@example.com", "dan@example.com"]);
    const [unsub] = await addContacts(t, ["gone@example.com"]);
    await api.patch(`/api/v1/contacts/${unsub}`).set(auth(t.token)).send({ status: "UNSUBSCRIBED" }).expect(200);
    await addContacts(t, ["blocked@example.com"]);
    await api.post("/api/v1/email/suppressions").set(auth(t.token)).send({ email: "Blocked@Example.com" }).expect(201);
    // A contact blocked behind the app's back (only the suppression row exists) is still skipped.
    await addContacts(t, ["ghost@example.com"]);
    await db.insertInto("email_suppressions").values({ id: "sup-ghost-" + t.id, tenant_id: t.id, email: "ghost@example.com", reason: "IMPORTED", category_scope: null, created_at: new Date(), updated_at: new Date() }).execute();

    const c = await newCampaign(t, senderId);
    const pre = await api.get(`/api/v1/campaigns/${c.id}/preflight`).set(auth(t.token));
    expect(pre.body.data).toMatchObject({ ok: true, recipients: 4, suppressed: 3, quotaRemaining: 50000 });
    expect(pre.body.data.issues.map((i: { code: string }) => i.code)).toContain("NO_COMPANY_ADDRESS");

    const sent = await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({});
    expect(sent.status).toBe(200);
    const done = await campaign(t.token, c.id);
    expect(done.status).toBe("SENT");
    expect(done.startedAt).toBeTruthy();
    expect(done.completedAt).toBeTruthy();
    expect(done.stats).toMatchObject({ recipients: 7, sent: 4, delivered: 4, skipped: 3, bounced: 0, complained: 0 });

    const rec = await api.get(`/api/v1/campaigns/${c.id}/recipients`).set(auth(t.token));
    expect(rec.body.data.items).toHaveLength(7);
    const skipped = rec.body.data.items.filter((r: { status: string }) => r.status === "SKIPPED");
    expect(skipped.map((r: { skipReason: string }) => r.skipReason).sort()).toEqual(["SUPPRESSED", "UNSUBSCRIBED", "UNSUBSCRIBED"]); // the admin block also unsubscribed its contact
    expect((await api.get(`/api/v1/campaigns/${c.id}/recipients`).query({ status: "DELIVERED" }).set(auth(t.token))).body.data.items).toHaveLength(4);

    const msgs = await db.selectFrom("email_messages").selectAll().where("campaign_id", "=", c.id).execute();
    expect(msgs).toHaveLength(4);
    expect(msgs.every((m) => m.simulated && m.category === "MARKETING" && m.status === "DELIVERED" && m.ses_message_id?.startsWith("sim_"))).toBe(true);
    const events = await db.selectFrom("email_events").select(["type"]).where("campaign_id", "=", c.id).execute();
    expect(events.filter((e) => e.type === "SEND")).toHaveLength(4);
    expect(events.filter((e) => e.type === "DELIVERY")).toHaveLength(4);
    const contact = await api.get(`/api/v1/contacts/${good[0]}`).set(auth(t.token));
    expect(contact.body.data.emailsReceived).toBe(1);

    // Usage reflects the four sends and the monthly counter.
    const dash = await api.get("/api/v1/dashboard").set(auth(t.token));
    expect(dash.body.data.usage.emails.used).toBe(4);
    expect(dash.body.data.checklist.find((x: { key: string }) => x.key === "campaign").done).toBe(true);
    // A finished campaign cannot be started again.
    expect((await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({})).status).toBe(409);
  });

  it("renders per recipient: merge tags, tracked links, pixel, unsubscribe link, one-click headers, footer", async () => {
    const t = await newTenant();
    await api.put("/api/v1/tenant/me").set(auth(t.token)).send({ company_address: "1 Example Street" }).expect(200);
    const { senderId } = await verifiedSender(t);
    await api.post("/api/v1/contacts").set(auth(t.token)).send({ email: "grace@example.com", firstName: "Grace" }).expect(201);
    const c = await newCampaign(t, senderId);
    const prev = await api.get(`/api/v1/campaigns/${c.id}/preview`).set(auth(t.token));
    expect(prev.body.data.html).toContain("Hello Alex");
    await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({}).expect(200);
    const msg = await db.selectFrom("email_messages").selectAll().where("campaign_id", "=", c.id).executeTakeFirstOrThrow();
    expect(msg.subject).toBe("Hello Grace");
    const links = await db.selectFrom("campaign_links").select(["url", "token"]).where("campaign_id", "=", c.id).execute();
    expect(links.map((l) => l.url).sort()).toEqual(["https://example.com/one", "https://example.com/two?x=1&y=2"]);
    // The with-contact preview carries a real unsubscribe link.
    const contactId = msg.contact_id!;
    const real = await api.get(`/api/v1/campaigns/${c.id}/preview`).query({ contactId }).set(auth(t.token));
    expect(real.body.data.html).toMatch(/http:\/\/localhost:5126\/u\/[\w-]+~[\w-]+/);
    expect(real.body.data.html).toContain("1 Example Street");
    expect(CAMPAIGN_HTML).toContain("example.com/one");
  });

  it("refuses a send that would exceed the monthly quota, in preflight and at schedule time", async () => {
    const t = await newTenant("GROWTH", { limits: { monthlyEmails: 3 } });
    const { senderId } = await verifiedSender(t);
    await addContacts(t, ["q1@example.com", "q2@example.com", "q3@example.com", "q4@example.com", "q5@example.com"]);
    const c = await newCampaign(t, senderId);
    const pre = await api.get(`/api/v1/campaigns/${c.id}/preflight`).set(auth(t.token));
    expect(pre.body.data.ok).toBe(false);
    expect(pre.body.data.quotaRemaining).toBe(3);
    expect(pre.body.data.issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", code: "QUOTA_EXCEEDED" })]));
    const res = await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({});
    expect(res.status).toBe(422);
    expect((await campaign(t.token, c.id)).status).toBe("DRAFT");
    // An audience that fits is accepted and uses exactly its share.
    const [a] = await Promise.all([api.post("/api/v1/lists").set(auth(t.token)).send({ name: "Small" })]);
    const ids = (await api.get("/api/v1/contacts").set(auth(t.token)).query({ limit: 2 })).body.data.items.map((x: { id: string }) => x.id);
    await api.post(`/api/v1/lists/${a.body.data.id}/members`).set(auth(t.token)).send({ contactIds: ids }).expect(200);
    const small = await newCampaign(t, senderId, { audience: { type: "LISTS", listIds: [a.body.data.id] } });
    await api.post(`/api/v1/campaigns/${small.id}/schedule`).set(auth(t.token)).send({}).expect(200);
    expect((await api.get("/api/v1/dashboard").set(auth(t.token))).body.data.usage.emails).toMatchObject({ used: 2, limit: 3 });
  });

  it("bounces and complaints update contacts, suppressions, counters and reputation", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    await addContacts(t, ["ok1@example.com", "ok2@example.com", "ok3@example.com", "bounce@hard.example.com", "soft@slow.example.com", "complaint@angry.example.com"]);
    const c = await newCampaign(t, senderId);
    await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({}).expect(200);
    const done = await campaign(t.token, c.id);
    expect(done.stats).toMatchObject({ sent: 6, delivered: 4, bounced: 2, complained: 1 });
    const contacts = (await api.get("/api/v1/contacts").set(auth(t.token)).query({ limit: 50 })).body.data.items as Array<{ email: string; status: string }>;
    const status = (e: string) => contacts.find((x) => x.email === e)?.status;
    expect(status("bounce@hard.example.com")).toBe("BOUNCED");
    expect(status("complaint@angry.example.com")).toBe("COMPLAINED");
    expect(status("soft@slow.example.com")).toBe("SUBSCRIBED"); // a soft bounce changes nothing
    const sup = (await api.get("/api/v1/email/suppressions").set(auth(t.token))).body.data.items as Array<{ email: string; reason: string }>;
    expect(sup.map((s) => `${s.email}:${s.reason}`).sort()).toEqual(["bounce@hard.example.com:HARD_BOUNCE", "complaint@angry.example.com:COMPLAINT"]);
    const rec = (await api.get(`/api/v1/campaigns/${c.id}/recipients`).set(auth(t.token))).body.data.items as Array<{ email: string; status: string }>;
    expect(rec.find((r) => r.email === "bounce@hard.example.com")?.status).toBe("BOUNCED");
    expect(rec.find((r) => r.email === "complaint@angry.example.com")?.status).toBe("COMPLAINED");
    const rep = (await api.get("/api/v1/email/reputation").set(auth(t.token))).body.data;
    expect(rep.window.sent).toBe(6);
    expect(rep.window.permanentBounceRate).toBeCloseTo(1 / 6, 5);
    expect(rep.window.complaintRate).toBeCloseTo(1 / 6, 5);
    // Below the minimum volume the tenant stays ACTIVE even with terrible rates.
    expect(rep.status).toBe("ACTIVE");
    const report = (await api.get(`/api/v1/campaigns/${c.id}/report`).set(auth(t.token))).body.data;
    expect(report.bounces.map((b: { reason: string }) => b.reason).join(" ")).toMatch(/mailbox/);
    expect(report.topDomains.length).toBeGreaterThan(0);
    // A second send never reaches suppressed addresses.
    const again = await newCampaign(t, senderId);
    const pre = await api.get(`/api/v1/campaigns/${again.id}/preflight`).set(auth(t.token));
    expect(pre.body.data.recipients).toBe(4); // 3 ok + the soft bouncer
  });

  it("freezes a SENDING campaign when reputation reaches PAUSED, then resumes after an unpause", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    // 40 recipients, 30 of them hard bounces: the tenant crosses PAUSED once 20 sends are counted.
    const emails = [...Array.from({ length: 10 }, (_, i) => `fine${i}@example.com`), ...Array.from({ length: 30 }, (_, i) => `bounce@d${i}.example.com`)];
    await addContacts(t, emails);
    const c = await newCampaign(t, senderId);
    await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({}).expect(200);
    const frozen = await campaign(t.token, c.id);
    expect(frozen.status).toBe("PAUSED");
    expect(frozen.pausedReason).toBe("Tenant sending paused");
    const queued = await db.selectFrom("campaign_recipients").select(db.fn.countAll<string>().as("n")).where("campaign_id", "=", c.id).where("status", "=", "QUEUED").executeTakeFirstOrThrow();
    expect(Number(queued.n)).toBeGreaterThan(0);
    const rep = (await api.get("/api/v1/email/reputation").set(auth(t.token))).body.data;
    expect(rep.status).toBe("PAUSED");
    expect(rep.history[0]).toMatchObject({ to: "PAUSED", trigger: expect.stringMatching(/bounce|complaint/) });
    expect(rep.note).toMatch(/paused/i);
    // New marketing is blocked and resume is refused while paused.
    expect((await api.post(`/api/v1/campaigns/${c.id}/resume`).set(auth(t.token))).status).toBe(422);
    const other = await newCampaign(t, senderId);
    expect((await api.post(`/api/v1/campaigns/${other.id}/schedule`).set(auth(t.token)).send({})).status).toBe(422);
    // The bounce-prone addresses were typos; fix the rest of the list, then lift the hold.
    await db.updateTable("contacts").set({ email: sql`lower('fixed' || id || '@example.com')` }).where("tenant_id", "=", t.id).where("email", "like", "bounce@%").where("status", "=", "SUBSCRIBED").execute();
    // An operator lifts the hold; the campaign resumes and completes the rest of the list.
    await api.post(`/api/v1/operator/tenants/${t.id}/email/unpause`).set(auth(t.op)).send({ reason: "Cleaned the list" }).expect(200);
    const resumed = await api.post(`/api/v1/campaigns/${c.id}/resume`).set(auth(t.token));
    expect(resumed.status).toBe(200);
    expect((await campaign(t.token, c.id)).status).toBe("SENT");
  });

  it("pauses and resumes by hand, cancels, and keeps idempotency per contact", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    await addContacts(t, ["m1@example.com", "m2@example.com", "m3@example.com"]);
    const c = await newCampaign(t, senderId);
    await db.updateTable("campaigns").set({ status: "SENDING" }).where("id", "=", c.id).execute();
    const paused = await api.post(`/api/v1/campaigns/${c.id}/pause`).set(auth(t.token));
    expect(paused.body.data).toMatchObject({ status: "PAUSED", pausedReason: "Paused by a user" });
    expect((await api.post(`/api/v1/campaigns/${c.id}/pause`).set(auth(t.token))).status).toBe(409);
    const cancelled = await api.post(`/api/v1/campaigns/${c.id}/cancel`).set(auth(t.token));
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect((await api.delete(`/api/v1/campaigns/${c.id}`).set(auth(t.token))).status).toBe(200);

    // Sending the same campaign twice (a retry) never double-sends a contact.
    const d = await newCampaign(t, senderId);
    await api.post(`/api/v1/campaigns/${d.id}/schedule`).set(auth(t.token)).send({}).expect(200);
    await db.updateTable("campaigns").set({ status: "SENDING", completed_at: null }).where("id", "=", d.id).execute();
    await db.updateTable("campaign_recipients").set({ status: "QUEUED", claimed_at: null, message_id: null }).where("campaign_id", "=", d.id).execute();
    await campaignSender.run(d.id);
    const msgs = await db.selectFrom("email_messages").select("id").where("campaign_id", "=", d.id).execute();
    expect(msgs).toHaveLength(3);
    expect((await campaign(t.token, d.id)).status).toBe("SENT");
  });
});

describe("scheduling", () => {
  it("starts a due scheduled campaign from the scheduler tick, and supports unschedule and reschedule", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    await addContacts(t, ["s1@example.com", "s2@example.com"]);
    const c = await newCampaign(t, senderId);

    const past = await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({ at: new Date(Date.now() - 60_000).toISOString() });
    expect(past.status).toBe(400);
    expect((await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({ at: "not a date" })).status).toBe(400);

    const at = new Date(Date.now() + 3600_000).toISOString();
    const sched = await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({ at });
    expect(sched.body.data).toMatchObject({ status: "SCHEDULED", scheduledAt: at });
    // Not due yet: a tick leaves it alone.
    await campaignSender.tick();
    expect((await campaign(t.token, c.id)).status).toBe("SCHEDULED");
    // Edits need an unschedule first.
    expect((await api.patch(`/api/v1/campaigns/${c.id}`).set(auth(t.token)).send({ name: "x" })).status).toBe(409);
    expect((await api.post(`/api/v1/campaigns/${c.id}/unschedule`).set(auth(t.token))).body.data.status).toBe("DRAFT");
    const later = new Date(Date.now() + 7200_000).toISOString();
    expect((await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({ at: later })).body.data.scheduledAt).toBe(later);
    const re = new Date(Date.now() + 9000_000).toISOString();
    expect((await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({ at: re })).body.data.scheduledAt).toBe(re);

    // Make it due and tick.
    await db.updateTable("campaigns").set({ scheduled_at: new Date(Date.now() - 1000) }).where("id", "=", c.id).execute();
    await campaignSender.tick();
    const done = await campaign(t.token, c.id);
    expect(done.status).toBe("SENT");
    expect(done.stats.sent).toBe(2);
  });

  it("stops a scheduled campaign visibly when its domain is gone by the time it is due", async () => {
    const t = await newTenant();
    const { senderId, domainId } = await verifiedSender(t);
    await addContacts(t, ["d1@example.com"]);
    const c = await newCampaign(t, senderId);
    await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({ at: new Date(Date.now() + 3600_000).toISOString() }).expect(200);
    await db.updateTable("email_sending_domains").set({ status: "FAILED" }).where("id", "=", domainId).execute();
    await db.updateTable("campaigns").set({ scheduled_at: new Date(Date.now() - 1000) }).where("id", "=", c.id).execute();
    await campaignSender.tick();
    const after = await campaign(t.token, c.id);
    expect(after.status).toBe("PAUSED");
    expect(after.pausedReason).toMatch(/not verified/i);
  });

  it("will not send without a verified sender, a subject or content", async () => {
    const t = await newTenant();
    await addContacts(t, ["n1@example.com"]);
    const c = await api.post("/api/v1/campaigns").set(auth(t.token)).send({ name: "Bare", subject: "S" }).expect(201);
    const pre = await api.get(`/api/v1/campaigns/${c.body.data.id}/preflight`).set(auth(t.token));
    expect(pre.body.data.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(["NO_SENDER", "NO_CONTENT"]));
    expect((await api.post(`/api/v1/campaigns/${c.body.data.id}/schedule`).set(auth(t.token)).send({})).status).toBe(422);
    expect((await api.post("/api/v1/campaigns").set(auth(t.token)).send({ name: "x" })).status).toBe(400);
  });
});

describe("tests, duplicates and lifecycle", () => {
  it("sends test messages without using the quota and validates addresses", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    const c = await newCampaign(t, senderId);
    const res = await api.post(`/api/v1/campaigns/${c.id}/test`).set(auth(t.token)).send({ to: ["qa1@example.com", "qa2@example.com"] });
    expect(res.status).toBe(200);
    expect(res.body.data.results.map((r: { status: string }) => r.status)).toEqual(["sent", "sent"]);
    expect((await api.get("/api/v1/dashboard").set(auth(t.token))).body.data.usage.emails.used).toBe(0);
    const msg = await db.selectFrom("email_messages").select("subject").where("tenant_id", "=", t.id).where("to_address", "=", "qa1@example.com").executeTakeFirstOrThrow();
    expect(msg.subject).toMatch(/^\[Test\]/);
    expect((await api.post(`/api/v1/campaigns/${c.id}/test`).set(auth(t.token)).send({ to: Array.from({ length: 6 }, (_, i) => `x${i}@example.com`) })).status).toBe(400);
    expect((await api.post(`/api/v1/campaigns/${c.id}/test`).set(auth(t.token)).send({ to: ["nope"] })).status).toBe(400);
  });

  it("duplicates, filters by status, edits drafts, and only deletes drafts or cancelled campaigns", async () => {
    const t = await newTenant();
    const { senderId } = await verifiedSender(t);
    const c = await newCampaign(t, senderId, { name: "Original" });
    const dup = await api.post(`/api/v1/campaigns/${c.id}/duplicate`).set(auth(t.token));
    expect(dup.status).toBe(201);
    expect(dup.body.data).toMatchObject({ name: "Original (copy)", status: "DRAFT", senderIdentityId: senderId });
    const edited = await api.patch(`/api/v1/campaigns/${c.id}`).set(auth(t.token)).send({ name: "Renamed", audience: { type: "ALL" } });
    expect(edited.body.data.name).toBe("Renamed");
    expect((await api.get("/api/v1/campaigns").query({ status: "DRAFT" }).set(auth(t.token))).body.data.items).toHaveLength(2);
    expect((await api.get("/api/v1/campaigns").query({ status: "SENT" }).set(auth(t.token))).body.data.items).toHaveLength(0);
    expect((await api.get("/api/v1/campaigns").query({ status: "BOGUS" }).set(auth(t.token))).status).toBe(400);
    await addContacts(t, ["life@example.com"]);
    await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({}).expect(200);
    expect((await api.delete(`/api/v1/campaigns/${c.id}`).set(auth(t.token))).status).toBe(409);
    expect((await api.patch(`/api/v1/campaigns/${c.id}`).set(auth(t.token)).send({ name: "x" })).status).toBe(409);
    const pagedList = await api.get("/api/v1/campaigns").query({ limit: 1 }).set(auth(t.token));
    expect(pagedList.body.data.items).toHaveLength(1);
    expect(pagedList.body.data.nextCursor).toBeTruthy();
    const next = await api.get("/api/v1/campaigns").query({ limit: 1, cursor: pagedList.body.data.nextCursor }).set(auth(t.token));
    expect(next.body.data.items[0].id).not.toBe(pagedList.body.data.items[0].id);
  });

  it("builds a campaign from a template and keeps the audience valid", async () => {
    const t = await newTenant();
    const tpls = (await api.get("/api/v1/templates").set(auth(t.token))).body.data;
    const welcome = tpls.find((x: { name: string }) => x.name === "Welcome");
    const c = await api.post("/api/v1/campaigns").set(auth(t.token)).send({ name: "From template", templateId: welcome.id });
    expect(c.status).toBe(201);
    expect(c.body.data.subject).toBe(welcome.subject);
    expect(c.body.data.html).toBe(welcome.html);
    expect((await api.post("/api/v1/campaigns").set(auth(t.token)).send({ name: "x", subject: "s", audience: { type: "LISTS", listIds: ["missing"] } })).status).toBe(404);
    expect((await api.post("/api/v1/campaigns").set(auth(t.token)).send({ name: "x", subject: "s", audience: { type: "WHAT" } })).status).toBe(400);
    expect((await api.post("/api/v1/campaigns").set(auth(t.token)).send({ name: "x", subject: "s", senderIdentityId: "missing" })).status).toBe(404);
  });
});
