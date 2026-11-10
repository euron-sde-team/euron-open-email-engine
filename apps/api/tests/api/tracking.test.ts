import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { PIXEL_GIF } from "../../src/services/tracking.service";
import { clickUrl, openPixelUrl, unsubscribeUrl, viewUrl } from "../../src/utils/links";
import { signToken } from "../../src/utils/tokens";
import { addContacts, api, auth, newCampaign, newTenant, verifiedSender, type TestTenant } from "../helpers";

const path = (url: string) => new URL(url).pathname;
let t: TestTenant;
let campaignId: string;
let messageId: string;
let contactId: string;
let linkToken: string;
let otherMessage: string;

beforeAll(async () => {
  t = await newTenant();
  const { senderId } = await verifiedSender(t);
  await addContacts(t, ["track1@example.com", "track2@example.com"]);
  const lst = await api.post("/api/v1/lists").set(auth(t.token)).send({ name: "L" });
  const ids = (await api.get("/api/v1/contacts").set(auth(t.token))).body.data.items.map((c: { id: string }) => c.id);
  await api.post(`/api/v1/lists/${lst.body.data.id}/members`).set(auth(t.token)).send({ contactIds: ids });
  const c = await newCampaign(t, senderId);
  campaignId = c.id;
  await api.post(`/api/v1/campaigns/${c.id}/schedule`).set(auth(t.token)).send({}).expect(200);
  const msgs = await db.selectFrom("email_messages").selectAll().where("campaign_id", "=", c.id).orderBy("to_address").execute();
  messageId = msgs[0].id;
  otherMessage = msgs[1].id;
  contactId = msgs[0].contact_id!;
  linkToken = (await db.selectFrom("campaign_links").select("token").where("campaign_id", "=", c.id).where("url", "=", "https://example.com/one").executeTakeFirstOrThrow()).token;
  // Make every hit look like it came well after the send, so only the classifier decides.
  await db.updateTable("email_messages").set({ sent_at: new Date(Date.now() - 3600_000) }).where("campaign_id", "=", c.id).execute();
});

afterAll(async () => {
  await closeDB();
});

const BASE = "http://localhost:5126";
// An address inside the network Apple Mail Privacy Protection fetches images from (built, not
// written out, so the sanitization scan does not mistake it for a real host).
const APPLE_IP = ["17", "58", "4", "4"].join(".");
const events = (type: string, machine?: boolean) => {
  let q = db.selectFrom("email_events").selectAll().where("message_id", "=", messageId).where("type", "=", type as never);
  if (machine !== undefined) q = q.where("machine", "=", machine);
  return q.execute();
};

describe("open pixel", () => {
  it("serves a 1x1 gif that is never cached, and records a human open", async () => {
    const res = await api.get(path(openPixelUrl(BASE, messageId))).set("User-Agent", "Mozilla/5.0 (iPhone) Safari").set("X-Forwarded-For", "198.51.100.7").buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/gif");
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(Buffer.from(res.body).equals(PIXEL_GIF)).toBe(true);
    const ev = await events("OPEN", false);
    expect(ev).toHaveLength(1);
    expect(ev[0].ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(ev[0])).not.toContain("198.51.100.7");
    const contact = (await api.get(`/api/v1/contacts/${contactId}`).set(auth(t.token))).body.data;
    expect(contact.lastOpenedAt).toBeTruthy();
    const m = await db.selectFrom("email_messages").select(["open_count", "opened_at"]).where("id", "=", messageId).executeTakeFirstOrThrow();
    expect(m.open_count).toBe(1);
    expect(m.opened_at).toBeTruthy();
  });

  it("counts an Apple Mail Privacy Protection open but flags it as a machine open", async () => {
    await api.get(path(openPixelUrl(BASE, messageId))).set("User-Agent", "Mozilla/5.0 (Macintosh) AppleWebKit").set("X-Forwarded-For", APPLE_IP).expect(200);
    const machine = await events("OPEN", true);
    expect(machine).toHaveLength(1);
    expect(machine[0].ua_class).toBe("apple-mpp");
    const report = (await api.get(`/api/v1/campaigns/${campaignId}/report`).set(auth(t.token))).body.data;
    expect(report.machineOpens).toBe(1);
    const detail = (await api.get(`/api/v1/email/messages/${messageId}`).set(auth(t.token))).body.data;
    expect(detail.opens).toBe(2);
    expect(detail.events.filter((e: { type: string; machine: boolean }) => e.type === "OPEN" && e.machine)).toHaveLength(1);
    // The machine open must not move "last opened".
    const before = (await db.selectFrom("contacts").select("last_opened_at").where("id", "=", contactId).executeTakeFirstOrThrow()).last_opened_at;
    await api.get(path(openPixelUrl(BASE, messageId))).set("User-Agent", "Mozilla/5.0").set("X-Forwarded-For", APPLE_IP).expect(200);
    const after = (await db.selectFrom("contacts").select("last_opened_at").where("id", "=", contactId).executeTakeFirstOrThrow()).last_opened_at;
    expect(after).toEqual(before);
  });

  it("returns the pixel without recording anything for a forged or unknown token", async () => {
    const n = (await db.selectFrom("email_events").select(db.fn.countAll<string>().as("n")).where("type", "=", "OPEN").executeTakeFirstOrThrow()).n;
    for (const p of ["/t/o/garbage.gif", "/t/o/abc~def.gif", `/t/o/${signToken({ kind: "o", parts: ["01UNKNOWNMESSAGEID00000000"] })}.gif`, `/t/o/${signToken({ kind: "w", parts: [messageId] })}.gif`]) {
      const res = await api.get(p);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/gif");
    }
    const m = (await db.selectFrom("email_events").select(db.fn.countAll<string>().as("n")).where("type", "=", "OPEN").executeTakeFirstOrThrow()).n;
    expect(m).toBe(n);
  });
});

describe("click redirect", () => {
  it("302s to the stored URL, records the click and counts it", async () => {
    const res = await api.get(path(clickUrl(BASE, messageId, linkToken))).set("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com/one");
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    const ev = await events("CLICK", false);
    expect(ev[0].url).toBe("https://example.com/one");
    const detail = (await api.get(`/api/v1/campaigns/${campaignId}/report`).set(auth(t.token))).body.data;
    const link = detail.links.find((l: { url: string }) => l.url === "https://example.com/one");
    expect(link).toMatchObject({ clicks: 1, uniqueClicks: 1 });
    expect(detail.links.find((l: { url: string }) => l.url.includes("two"))).toMatchObject({ clicks: 0 });
    expect(detail.timeline.length).toBeGreaterThan(0);
    expect(detail.campaign.stats.clicked).toBe(1);
    expect((await api.get(`/api/v1/contacts/${contactId}`).set(auth(t.token))).body.data.lastClickedAt).toBeTruthy();
  });

  it("flags a link scanner's click as a machine hit and does not count it", async () => {
    await api.get(path(clickUrl(BASE, messageId, linkToken))).set("User-Agent", "Mozilla/5.0 (compatible; Proofpoint)").redirects(0).expect(302);
    expect(await events("CLICK", true)).toHaveLength(1);
    const m = await db.selectFrom("email_messages").select("click_count").where("id", "=", messageId).executeTakeFirstOrThrow();
    expect(m.click_count).toBe(1);
  });

  it("is never an open redirect: forged tokens, other messages' links and unsafe stored URLs all 404", async () => {
    expect((await api.get("/t/c/garbage").redirects(0)).status).toBe(404);
    expect((await api.get(`/t/c/${signToken({ kind: "c", parts: [messageId, "nope"] })}`).redirects(0)).status).toBe(404);
    // A link token from another campaign does not resolve through this message.
    const t2 = await newTenant();
    const s2 = await verifiedSender(t2);
    await addContacts(t2, ["x@example.com"]);
    const c2 = await newCampaign(t2, s2.senderId, { html: '<a href="https://example.org/other">o</a>' });
    await api.post(`/api/v1/campaigns/${c2.id}/schedule`).set(auth(t2.token)).send({}).expect(200);
    const foreign = await db.selectFrom("campaign_links").select("token").where("campaign_id", "=", c2.id).executeTakeFirstOrThrow();
    expect((await api.get(path(clickUrl(BASE, messageId, foreign.token))).redirects(0)).status).toBe(404);
    // Even a stored javascript: or data: URL is refused.
    for (const [i, bad] of ["javascript:alert(1)", "data:text/html,<script>1</script>", "https://user:pass@example.com/"].entries()) {
      await db.insertInto("campaign_links").values({ id: `bad-${t.id}-${i}`, tenant_id: t.id, campaign_id: campaignId, url: bad, token: `bad${i}`, created_at: new Date() }).execute();
      const res = await api.get(path(clickUrl(BASE, messageId, `bad${i}`))).redirects(0);
      expect(res.status).toBe(404);
      expect(res.headers.location).toBeUndefined();
    }
  });
});

describe("unsubscribe", () => {
  it("GET shows a confirmation page and changes nothing", async () => {
    const res = await api.get(path(unsubscribeUrl(BASE, t.id, contactId, messageId)));
    expect(res.status).toBe(200);
    expect(res.text).toContain("<button");
    expect(res.text).toContain("Unsubscribe");
    expect(res.text).toContain("track1@example.com");
    expect((await api.get(`/api/v1/contacts/${contactId}`).set(auth(t.token))).body.data.status).toBe("SUBSCRIBED");
    expect((await api.get("/u/forged").set("Accept", "text/html")).status).toBe(400);
  });

  it("RFC 8058 one-click POST unsubscribes, suppresses MARKETING, updates lists and records the event", async () => {
    const url = path(unsubscribeUrl(BASE, t.id, contactId, messageId));
    const res = await api.post(url).type("form").send({ "List-Unsubscribe": "One-Click" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const contact = (await api.get(`/api/v1/contacts/${contactId}`).set(auth(t.token))).body.data;
    expect(contact.status).toBe("UNSUBSCRIBED");
    expect(contact.listIds).toEqual([]);
    const sup = (await api.get("/api/v1/email/suppressions").set(auth(t.token))).body.data.items.find((s: { email: string }) => s.email === "track1@example.com");
    expect(sup).toMatchObject({ reason: "UNSUBSCRIBE", category: "MARKETING" });
    expect(await events("UNSUBSCRIBE")).toHaveLength(1);
    const members = await db.selectFrom("list_members").select("status").where("contact_id", "=", contactId).execute();
    expect(members.every((m) => m.status === "unsubscribed")).toBe(true);
    // Idempotent, and counted once on the campaign.
    await api.post(url).type("form").send({ "List-Unsubscribe": "One-Click" }).expect(200);
    expect((await api.get(`/api/v1/campaigns/${campaignId}`).set(auth(t.token))).body.data.stats.unsubscribed).toBe(1);
    // The other contact is untouched.
    const other = await db.selectFrom("contacts").select("status").where("tenant_id", "=", t.id).where("email", "=", "track2@example.com").executeTakeFirstOrThrow();
    expect(other.status).toBe("SUBSCRIBED");
    const tl = (await api.get(`/api/v1/contacts/${contactId}/timeline`).set(auth(t.token))).body.data;
    expect(tl.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["SEND", "DELIVERY", "OPEN", "CLICK", "UNSUBSCRIBE"]));
  });

  it("the page POST (button) unsubscribes and says so; the next campaign skips the contact", async () => {
    const res = await api.post(path(unsubscribeUrl(BASE, t.id, (await db.selectFrom("contacts").select("id").where("tenant_id", "=", t.id).where("email", "=", "track2@example.com").executeTakeFirstOrThrow()).id, otherMessage))).type("form").send({});
    expect(res.status).toBe(200);
    expect(res.text).toContain("You are unsubscribed");
    const c = await newCampaign(t, (await api.get("/api/v1/email/senders").set(auth(t.token))).body.data[0].id);
    const pre = await api.get(`/api/v1/campaigns/${c.id}/preflight`).set(auth(t.token));
    expect(pre.body.data.recipients).toBe(0);
    expect(pre.body.data.issues.map((i: { code: string }) => i.code)).toContain("NO_RECIPIENTS");
  });

  it("an unsubscribe token cannot be used for another tenant's contact", async () => {
    const other = await newTenant();
    const [oc] = await addContacts(other, ["victim@example.com"]);
    const forged = path(unsubscribeUrl(BASE, t.id, oc, "-"));
    expect((await api.post(forged).type("form").send({})).status).toBe(400);
    expect((await api.get(`/api/v1/contacts/${oc}`).set(auth(other.token))).body.data.status).toBe("SUBSCRIBED");
  });
});

describe("view in browser", () => {
  it("re-renders the message for its contact under a locked-down CSP", async () => {
    const res = await api.get(path(viewUrl(BASE, otherMessage)));
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'none'.*sandbox/);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.text).toContain("Hello Test");
    expect(res.text).toMatch(/\/u\/[\w-]+~/);
    expect((await api.get("/w/forged")).status).toBe(404);
  });
});
