import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB } from "../../src/db/connection";
import { api, auth, login, NW_ADMIN } from "../helpers";

let token: string;
beforeAll(async () => {
  token = await login(NW_ADMIN.email);
});
afterAll(async () => {
  await closeDB();
});
const get = (p: string, q: object = {}) => api.get(`/api/v1${p}`).set(auth(token)).query(q);

describe("dashboard and reports on the demo data", () => {
  it("returns the dashboard DTO", async () => {
    const d = (await get("/dashboard")).body.data;
    expect(d.usage.emails.limit).toBe(50000);
    expect(d.usage.emails.used).toBeGreaterThan(0);
    expect(new Date(d.usage.resetsAt).getUTCDate()).toBe(1);
    expect(d.reputation.status).toBe("ACTIVE");
    expect(d.daily.map((x: { date: string }) => x.date)).toEqual([...d.daily.map((x: { date: string }) => x.date)].sort());
    expect(d.daily.reduce((s: number, x: { sent: number }) => s + x.sent, 0)).toBeGreaterThan(0);
    expect(d.audience.subscribed).toBeGreaterThan(400);
    expect(d.audience.unsubscribed).toBeGreaterThan(0);
    for (const c of d.topCampaigns) expect(c.openRate).toBeGreaterThan(0);
    expect(d.topCampaigns.map((c: { openRate: number }) => c.openRate)).toEqual([...d.topCampaigns.map((c: { openRate: number }) => c.openRate)].sort((x, y) => y - x));
  });

  it("returns a campaign report whose parts agree with each other", async () => {
    const list = (await get("/campaigns", { status: "SENT", limit: 50 })).body.data.items;
    expect(list).toHaveLength(6);
    const c = list[list.length - 1];
    const r = (await get(`/campaigns/${c.id}/report`)).body.data;
    const s = r.campaign.stats;
    expect(s.sent).toBeGreaterThan(300);
    expect(s.delivered).toBeLessThanOrEqual(s.sent);
    expect(r.rates.delivery).toBeCloseTo(s.delivered / s.sent, 3);
    expect(r.rates.open).toBeCloseTo(s.opened / s.delivered, 3);
    expect(r.rates.clickToOpen).toBeCloseTo(s.clicked / s.opened, 3);
    expect(r.timeline.length).toBeGreaterThan(1);
    expect(r.timeline.map((x: { at: string }) => x.at)).toEqual([...r.timeline.map((x: { at: string }) => x.at)].sort());
    expect(r.timeline.reduce((n: number, x: { opens: number }) => n + x.opens, 0)).toBeGreaterThanOrEqual(s.opened);
    expect(r.links).toHaveLength(3);
    expect(r.links.reduce((n: number, l: { clicks: number }) => n + l.clicks, 0)).toBe(s.clicked);
    expect(r.machineOpens).toBeGreaterThan(0);
    expect(r.topDomains[0]).toMatchObject({ domain: "example.com" });
    expect(r.bounces.reduce((n: number, b: { count: number }) => n + b.count, 0)).toBe(s.bounced);
  });

  it("covers the other campaign states and the recipient list", async () => {
    const all = (await get("/campaigns", { limit: 50 })).body.data.items as Array<{ id: string; status: string; name: string }>;
    expect(all.filter((c) => c.status === "SENT")).toHaveLength(6);
    expect(["DRAFT", "SCHEDULED", "PAUSED"].every((s) => all.some((c) => c.status === s))).toBe(true);
    const paused = all.find((c) => c.status === "PAUSED")!;
    const rec = (await get(`/campaigns/${paused.id}/recipients`, { status: "QUEUED" })).body.data;
    expect(rec.items.length).toBeGreaterThan(0);
    expect(rec.items[0]).toMatchObject({ status: "QUEUED", opens: 0, clicks: 0 });
    const sched = all.find((c) => c.status === "SCHEDULED")!;
    const pre = (await get(`/campaigns/${sched.id}/preflight`)).body.data;
    expect(pre.recipients).toBeGreaterThan(0);
    expect(pre.quotaRemaining).toBeGreaterThan(0);
  });

  it("pages and filters the message log and shows a message timeline", async () => {
    const first = (await get("/email/messages", { limit: 25 })).body.data;
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).toBeTruthy();
    expect(first.items[0]).toMatchObject({ category: "MARKETING", simulated: true });
    expect(first.items[0].campaignName).toBeTruthy();
    const next = (await get("/email/messages", { limit: 25, cursor: first.nextCursor })).body.data;
    expect(next.items[0].id < first.items[24].id).toBe(true);
    expect((await get("/email/messages", { status: "BOUNCED", limit: 100 })).body.data.items.every((m: { status: string }) => m.status === "BOUNCED")).toBe(true);
    expect((await get("/email/messages", { category: "TRANSACTIONAL" })).body.data.items).toHaveLength(0);
    expect((await get("/email/messages", { q: "example.com", limit: 5 })).body.data.items).toHaveLength(5);
    expect((await get("/email/messages", { status: "NOPE" })).status).toBe(400);
    const detail = (await get(`/email/messages/${first.items[0].id}`)).body.data;
    expect(detail.events.map((e: { type: string }) => e.type)[0]).toBe("SEND");
    expect(detail.events.length).toBeGreaterThanOrEqual(2);
  });

  it("returns the reputation summary with its WARNING episode", async () => {
    const r = (await get("/email/reputation")).body.data;
    expect(r.thresholds).toMatchObject({ warnBounce: 0.03, pauseBounce: 0.05, warnComplaint: 0.0005, pauseComplaint: 0.001 });
    expect(r.history.map((h: { to: string }) => h.to)).toEqual(["ACTIVE", "WARNING"]);
    expect(r.window.sent).toBeGreaterThan(0);
  });

  it("lists suppressions by reason and searches them", async () => {
    const all = (await get("/email/suppressions", { limit: 200 })).body.data.items;
    expect(new Set(all.map((s: { reason: string }) => s.reason))).toEqual(new Set(["HARD_BOUNCE", "COMPLAINT", "UNSUBSCRIBE", "ADMIN_BLOCK", "IMPORTED"]));
    expect((await get("/email/suppressions", { reason: "ADMIN_BLOCK" })).body.data.items).toHaveLength(1);
    expect((await get("/email/suppressions", { q: "legal-hold" })).body.data.items[0].note).toBe("Asked not to be contacted");
    expect((await get("/email/suppressions", { reason: "WHAT" })).status).toBe(400);
  });

  it("serves demo segments with counts and forms with public URLs", async () => {
    const segs = (await get("/segments", { count: "true" })).body.data;
    expect(segs).toHaveLength(3);
    expect(segs.every((s: { contactCount: number }) => s.contactCount > 0)).toBe(true);
    const lists = (await get("/lists")).body.data;
    expect(lists).toHaveLength(4);
    expect(lists.find((l: { name: string }) => l.name === "Newsletter").doubleOptIn).toBe(true);
    const forms = (await get("/forms")).body.data;
    expect(forms).toHaveLength(2);
    expect((await api.get(new URL(forms[0].url).pathname)).status).toBe(200);
  });
});
