import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { addContacts, api, auth, newCampaign, newTenant, verifiedSender, type TestTenant } from "../helpers";

// Every tenant-scoped route, called by tenant B with ids that belong to tenant A. The answer
// must be 404 (never 200, never 403, never A's data), and A's data must be untouched.

let a: TestTenant;
let b: TestTenant;
const ids: Record<string, string> = {};

beforeAll(async () => {
  a = await newTenant();
  b = await newTenant();
  const s = await verifiedSender(a);
  ids.domain = s.domainId;
  ids.sender = s.senderId;
  [ids.contact] = await addContacts(a, ["victim@example.com", "second@example.com"]);
  ids.list = (await api.post("/api/v1/lists").set(auth(a.token)).send({ name: "A list" })).body.data.id;
  await api.post("/api/v1/custom-fields").set(auth(a.token)).send({ key: "plan", label: "Plan" });
  ids.segment = (await api.post("/api/v1/segments").set(auth(a.token)).send({ name: "A seg", rules: { match: "all", conditions: [{ field: "tag", op: "is", value: "x" }] } })).body.data.id;
  ids.form = (await api.post("/api/v1/forms").set(auth(a.token)).send({ name: "A form", listId: ids.list, headline: "h" })).body.data.id;
  ids.template = (await api.post("/api/v1/templates").set(auth(a.token)).send({ name: "A tpl", subject: "s", html: "<p>x</p>" })).body.data.id;
  ids.campaign = (await newCampaign(a, ids.sender)).id;
  const sent = await newCampaign(a, ids.sender);
  await api.post(`/api/v1/campaigns/${sent.id}/schedule`).set(auth(a.token)).send({}).expect(200);
  ids.sentCampaign = sent.id;
  ids.message = (await db.selectFrom("email_messages").select("id").where("tenant_id", "=", a.id).executeTakeFirstOrThrow()).id;
  await api.post("/api/v1/email/suppressions").set(auth(a.token)).send({ email: "sup@example.com" }).expect(201);
  ids.suppression = (await db.selectFrom("email_suppressions").select("id").where("tenant_id", "=", a.id).where("email", "=", "sup@example.com").executeTakeFirstOrThrow()).id;
  const up = await api.post("/api/v1/imports").set(auth(a.token)).attach("file", Buffer.from("Email\nimp@example.com"), { filename: "x.csv", contentType: "text/csv" });
  ids.import = up.body.data.id;
  ids.user = (await db.selectFrom("users").select("id").where("tenant_id", "=", a.id).executeTakeFirstOrThrow()).id;
});
afterAll(async () => {
  await closeDB();
});

type Call = [method: "get" | "post" | "patch" | "put" | "delete", path: string, body?: object];
const CALLS: Call[] = [
  ["get", "/contacts/{contact}"],
  ["patch", "/contacts/{contact}", { firstName: "Hacked" }],
  ["delete", "/contacts/{contact}"],
  ["get", "/contacts/{contact}/timeline"],
  ["get", "/lists/{list}"],
  ["patch", "/lists/{list}", { name: "Hacked" }],
  ["delete", "/lists/{list}"],
  ["post", "/lists/{list}/members", { contactIds: ["{contact}"] }],
  ["delete", "/lists/{list}/members", { contactIds: ["{contact}"] }],
  ["delete", "/custom-fields/plan"],
  ["get", "/segments/{segment}"],
  ["patch", "/segments/{segment}", { name: "Hacked" }],
  ["delete", "/segments/{segment}"],
  ["get", "/forms/{form}"],
  ["patch", "/forms/{form}", { name: "Hacked" }],
  ["delete", "/forms/{form}"],
  ["get", "/imports/{import}"],
  ["post", "/imports/{import}/start", { mapping: { Email: "email" }, consentConfirmed: true }],
  ["get", "/templates/{template}"],
  ["patch", "/templates/{template}", { name: "Hacked" }],
  ["delete", "/templates/{template}"],
  ["post", "/templates/{template}/duplicate"],
  ["get", "/campaigns/{campaign}"],
  ["patch", "/campaigns/{campaign}", { name: "Hacked" }],
  ["delete", "/campaigns/{campaign}"],
  ["post", "/campaigns/{campaign}/duplicate"],
  ["get", "/campaigns/{campaign}/preview"],
  ["get", "/campaigns/{campaign}/preflight"],
  ["post", "/campaigns/{campaign}/test", { to: ["x@example.com"] }],
  ["post", "/campaigns/{campaign}/schedule", {}],
  ["post", "/campaigns/{campaign}/unschedule"],
  ["post", "/campaigns/{campaign}/pause"],
  ["post", "/campaigns/{campaign}/resume"],
  ["post", "/campaigns/{campaign}/cancel"],
  ["get", "/campaigns/{sentCampaign}/report"],
  ["get", "/campaigns/{sentCampaign}/recipients"],
  ["get", "/email/domains/{domain}"],
  ["post", "/email/domains/{domain}/check"],
  ["delete", "/email/domains/{domain}"],
  ["patch", "/email/senders/{sender}", { displayName: "Hacked" }],
  ["post", "/email/senders/{sender}/test"],
  ["delete", "/email/senders/{sender}"],
  ["delete", "/email/suppressions/{suppression}"],
  ["get", "/email/messages/{message}"],
];

describe("cross-tenant sweep: tenant B cannot reach tenant A's resources", () => {
  for (const [method, template, rawBody] of CALLS) {
    it(`${method.toUpperCase()} ${template.replace(/\{\w+\}/g, ":id")} is a 404 for another tenant`, async () => {
      const fill = (v: string) => v.replace(/\{(\w+)\}/g, (_m, k: string) => ids[k]);
      const path = fill(template);
      const body = rawBody ? JSON.parse(fill(JSON.stringify(rawBody))) : {};
      expect(path).not.toContain("undefined");
      const res = await api[method](`/api/v1${path}`).set(auth(b.token)).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("victim@example.com");
    });
  }

  it("campaign and contact references in request bodies must belong to the caller", async () => {
    const own = await verifiedSender(b);
    const bad = (body: object) => api.post("/api/v1/campaigns").set(auth(b.token)).send({ name: "x", subject: "s", ...body });
    expect((await bad({ senderIdentityId: ids.sender })).status).toBe(404);
    expect((await bad({ templateId: ids.template })).status).toBe(404);
    expect((await bad({ audience: { type: "LISTS", listIds: [ids.list] } })).status).toBe(404);
    expect((await bad({ audience: { type: "SEGMENT", segmentId: ids.segment } })).status).toBe(404);
    expect((await api.post("/api/v1/forms").set(auth(b.token)).send({ name: "x", listId: ids.list, headline: "h" })).status).toBe(404);
    expect((await api.post("/api/v1/email/senders").set(auth(b.token)).send({ domainId: ids.domain, localPart: "x" })).status).toBe(404);
    expect((await api.post("/api/v1/templates/render").set(auth(b.token)).send({ html: "<p/>", contactId: ids.contact })).status).toBe(404);
    expect((await api.get(`/api/v1/campaigns/${ids.campaign}/preview`).query({ contactId: ids.contact }).set(auth(b.token))).status).toBe(404);
    expect((await api.get("/api/v1/contacts").set(auth(b.token)).query({ segmentId: ids.segment })).status).toBe(404);
    const own2 = await api.post("/api/v1/campaigns").set(auth(b.token)).send({ name: "ok", subject: "s", senderIdentityId: own.senderId });
    expect(own2.status).toBe(201);
    // Another tenant's contact id in a bulk action touches nothing.
    const bulk = await api.post("/api/v1/contacts/bulk").set(auth(b.token)).send({ ids: [ids.contact], action: "delete" });
    expect(bulk.body.data.affected).toBe(0);
    const addList = await api.post("/api/v1/lists").set(auth(b.token)).send({ name: "mine" });
    const add = await api.post(`/api/v1/lists/${addList.body.data.id}/members`).set(auth(b.token)).send({ contactIds: [ids.contact] });
    expect(add.body.data.added).toBe(0);
  });

  it("list endpoints never include tenant A's rows", async () => {
    for (const p of ["/contacts", "/lists", "/segments", "/forms", "/templates?x=1", "/campaigns", "/imports", "/email/domains", "/email/senders", "/email/suppressions", "/email/messages", "/custom-fields"]) {
      const res = await api.get(`/api/v1${p}`).set(auth(b.token));
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body.data);
      for (const v of Object.values(ids)) if (p !== "/templates?x=1") expect(text).not.toContain(v);
      expect(text).not.toContain("victim@example.com");
    }
    const csv = await api.get("/api/v1/contacts/export.csv").set(auth(b.token));
    expect(csv.text).not.toContain("victim@example.com");
    const dash = (await api.get("/api/v1/dashboard").set(auth(b.token))).body.data;
    expect(dash.usage.contacts.used).toBe(0);
    expect(dash.audience.subscribed).toBe(0);
    expect((await api.get("/api/v1/email/reputation").set(auth(b.token))).body.data.window.sent).toBe(0);
  });

  it("left tenant A's data untouched", async () => {
    expect((await api.get(`/api/v1/contacts/${ids.contact}`).set(auth(a.token))).body.data.firstName).toBe("Test");
    expect((await api.get(`/api/v1/lists/${ids.list}`).set(auth(a.token))).body.data.name).toBe("A list");
    expect((await api.get(`/api/v1/campaigns/${ids.campaign}`).set(auth(a.token))).body.data.status).toBe("DRAFT");
    expect((await api.get(`/api/v1/email/domains/${ids.domain}`).set(auth(a.token))).body.data.status).toBe("VERIFIED");
    expect((await api.get("/api/v1/contacts").set(auth(a.token))).body.data.items).toHaveLength(2);
  });
});

describe("authentication on every tenant route", () => {
  it("rejects missing and malformed tokens", async () => {
    for (const p of ["/dashboard", "/contacts", "/lists", "/segments", "/forms", "/imports", "/templates", "/campaigns", "/email/domains", "/email/senders", "/email/messages", "/email/suppressions", "/email/reputation", "/users", "/tenant/me", "/audit"]) {
      expect((await api.get(`/api/v1${p}`)).status, p).toBe(401);
      expect((await api.get(`/api/v1${p}`).set("Authorization", "Bearer nope")).status, p).toBe(401);
    }
  });
});
