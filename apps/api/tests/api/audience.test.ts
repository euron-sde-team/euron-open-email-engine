import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, newTenant, type TestTenant } from "../helpers";

let t: TestTenant;
afterAll(async () => {
  await closeDB();
});
beforeAll(async () => {
  t = await newTenant();
});

const post = (path: string, body: object) => api.post(`/api/v1${path}`).set(auth(t.token)).send(body);

describe("contacts", () => {
  it("creates, normalises, rejects duplicates and invalid input", async () => {
    const res = await post("/contacts", { email: " Ada@Example.COM ", firstName: "Ada", lastName: "Lovelace", tags: ["vip", "vip", " beta "], attributes: { plan: "pro", seats: 5, active: true } });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: "ada@example.com", status: "SUBSCRIBED", source: "MANUAL", tags: ["vip", "beta"], attributes: { plan: "pro", seats: 5, active: true }, listIds: [], emailsReceived: 0, lastOpenedAt: null });
    expect((await post("/contacts", { email: "ADA@example.com" })).status).toBe(409);
    expect((await post("/contacts", { email: "nope" })).status).toBe(400);
    expect((await post("/contacts", { email: "x@example.com", tags: "vip" })).status).toBe(400);
    expect((await post("/contacts", { email: "x@example.com", tags: ["bad<tag>"] })).status).toBe(400);
    expect((await post("/contacts", { email: "x@example.com", attributes: { "Bad Key": 1 } })).status).toBe(400);
    expect((await post("/contacts", { email: "x@example.com", attributes: { a: { nested: 1 } } })).status).toBe(400);
    expect((await post("/contacts", { email: "x@example.com", listIds: ["missing"] })).status).toBe(404);
  });

  it("updates, merges attributes, changes status with guards, and deletes", async () => {
    const c = (await post("/contacts", { email: "upd@example.com", attributes: { a: "1" } })).body.data;
    const up = await api.patch(`/api/v1/contacts/${c.id}`).set(auth(t.token)).send({ firstName: "Up", tags: ["x"], attributes: { b: "2" } });
    expect(up.body.data).toMatchObject({ firstName: "Up", tags: ["x"], attributes: { a: "1", b: "2" } });
    const un = await api.patch(`/api/v1/contacts/${c.id}`).set(auth(t.token)).send({ status: "UNSUBSCRIBED" });
    expect(un.body.data.status).toBe("UNSUBSCRIBED");
    expect((await api.patch(`/api/v1/contacts/${c.id}`).set(auth(t.token)).send({ status: "BOUNCED" })).status).toBe(400);
    await db.updateTable("contacts").set({ status: "BOUNCED" }).where("id", "=", c.id).execute();
    expect((await api.patch(`/api/v1/contacts/${c.id}`).set(auth(t.token)).send({ status: "SUBSCRIBED" })).status).toBe(409);
    expect((await api.delete(`/api/v1/contacts/${c.id}`).set(auth(t.token))).status).toBe(200);
    expect((await api.get(`/api/v1/contacts/${c.id}`).set(auth(t.token))).status).toBe(404);
  });

  it("filters by q, status, tag, list and segment, and pages by cursor", async () => {
    const t2 = await newTenant();
    const mk = (b: object) => api.post("/api/v1/contacts").set(auth(t2.token)).send(b).then((r) => r.body.data);
    const list = (await api.post("/api/v1/lists").set(auth(t2.token)).send({ name: "L1" })).body.data;
    const a = await mk({ email: "alpha@example.com", firstName: "Alpha", tags: ["red"], listIds: [list.id] });
    await mk({ email: "beta@example.com", firstName: "Beta", tags: ["red", "blue"] });
    const g = await mk({ email: "gamma@example.com", firstName: "Gamma" });
    await api.patch(`/api/v1/contacts/${g.id}`).set(auth(t2.token)).send({ status: "UNSUBSCRIBED" });
    const get = (q: object) => api.get("/api/v1/contacts").set(auth(t2.token)).query(q).then((r) => r.body.data);
    expect((await get({ q: "alph" })).items.map((x: { email: string }) => x.email)).toEqual(["alpha@example.com"]);
    expect((await get({ q: "%" })).items).toHaveLength(0); // wildcards are escaped
    expect((await get({ status: "UNSUBSCRIBED" })).items).toHaveLength(1);
    expect((await get({ tag: "red" })).items).toHaveLength(2);
    expect((await get({ tag: "blue" })).items).toHaveLength(1);
    expect((await get({ listId: list.id })).items.map((x: { id: string }) => x.id)).toEqual([a.id]);
    const seg = (await api.post("/api/v1/segments").set(auth(t2.token)).send({ name: "Blue", rules: { match: "all", conditions: [{ field: "tag", op: "is", value: "blue" }] } })).body.data;
    expect((await get({ segmentId: seg.id })).items.map((x: { email: string }) => x.email)).toEqual(["beta@example.com"]);
    const p1 = await get({ limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await get({ limit: 2, cursor: p1.nextCursor });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect((await api.get("/api/v1/contacts").set(auth(t2.token)).query({ status: "WRONG" })).status).toBe(400);
  });

  it("applies bulk actions: tag, untag, add to and remove from a list, delete, with limits", async () => {
    const t2 = await newTenant();
    const ids = await Promise.all(["b1", "b2", "b3"].map((n) => api.post("/api/v1/contacts").set(auth(t2.token)).send({ email: `${n}@example.com` }).then((r) => r.body.data.id)));
    const list = (await api.post("/api/v1/lists").set(auth(t2.token)).send({ name: "Bulk" })).body.data.id;
    const bulk = (b: object) => api.post("/api/v1/contacts/bulk").set(auth(t2.token)).send(b);
    expect((await bulk({ ids, action: "tag", value: "promo" })).body.data).toEqual({ affected: 3 });
    expect((await bulk({ ids, action: "tag", value: "promo" })).body.data).toEqual({ affected: 0 });
    expect((await api.get(`/api/v1/contacts/${ids[0]}`).set(auth(t2.token))).body.data.tags).toEqual(["promo"]);
    expect((await bulk({ ids: ids.slice(0, 2), action: "untag", value: "promo" })).body.data.affected).toBe(2);
    expect((await bulk({ ids, action: "addToList", value: list })).body.data.affected).toBe(3);
    expect((await api.get("/api/v1/lists").set(auth(t2.token))).body.data[0].memberCount).toBe(3);
    expect((await bulk({ ids: [ids[0]], action: "removeFromList", value: list })).body.data.affected).toBe(1);
    expect((await bulk({ ids: [ids[1]], action: "delete" })).body.data.affected).toBe(1);
    expect((await bulk({ ids, action: "explode" })).status).toBe(400);
    expect((await bulk({ ids: [], action: "delete" })).status).toBe(400);
    expect((await bulk({ ids: Array.from({ length: 501 }, (_, i) => `x${i}`), action: "delete" })).status).toBe(400);
    expect((await bulk({ ids, action: "addToList", value: "missing" })).status).toBe(404);
  });

  it("exports CSV with formula injection neutralised, bounded to the tenant", async () => {
    const t2 = await newTenant();
    await api.post("/api/v1/custom-fields").set(auth(t2.token)).send({ key: "note", label: "Note" });
    await api.post("/api/v1/contacts").set(auth(t2.token)).send({ email: "csv@example.com", firstName: "=HYPERLINK(\"http://evil.example\")", lastName: "+cmd|' /C calc'!A0", attributes: { note: "@SUM(1+1)" } }).expect(201);
    const other = await newTenant();
    await api.post("/api/v1/contacts").set(auth(other.token)).send({ email: "other-tenant@example.com" }).expect(201);
    const res = await api.get("/api/v1/contacts/export.csv").set(auth(t2.token));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe("email,first_name,last_name,status,source,tags,created_at,attr:note");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain("'+cmd");
    expect(lines[1]).toContain("'@SUM");
    expect(res.text).not.toContain("other-tenant");
    expect(lines[1].split(",")[1].startsWith("\"'=") || lines[1].split(",")[1].startsWith("'=")).toBe(true);
  });
});

describe("lists and custom fields", () => {
  it("manages lists and members, keeps counts in sync", async () => {
    const list = (await post("/lists", { name: "VIPs", description: "Top accounts", doubleOptIn: true })).body.data;
    expect(list).toMatchObject({ name: "VIPs", doubleOptIn: true, memberCount: 0 });
    const ids = await Promise.all(["l1", "l2"].map((n) => post("/contacts", { email: `${n}@example.com` }).then((r) => r.body.data.id)));
    expect((await post(`/lists/${list.id}/members`, { contactIds: ids })).body.data.added).toBe(2);
    expect((await post(`/lists/${list.id}/members`, { contactIds: ids })).body.data.added).toBe(2); // idempotent
    expect((await api.get(`/api/v1/lists/${list.id}`).set(auth(t.token))).body.data.memberCount).toBe(2);
    const upd = await api.patch(`/api/v1/lists/${list.id}`).set(auth(t.token)).send({ name: "Top VIPs", doubleOptIn: false });
    expect(upd.body.data).toMatchObject({ name: "Top VIPs", doubleOptIn: false });
    const rm = await api.delete(`/api/v1/lists/${list.id}/members`).set(auth(t.token)).send({ contactIds: [ids[0]] });
    expect(rm.body.data.removed).toBe(1);
    expect((await api.get(`/api/v1/lists/${list.id}`).set(auth(t.token))).body.data.memberCount).toBe(1);
    expect((await post(`/lists/${list.id}/members`, { contactIds: [] })).status).toBe(400);
    expect((await post("/lists", {})).status).toBe(400);
    expect((await api.delete(`/api/v1/lists/${list.id}`).set(auth(t.token))).status).toBe(200);
  });

  it("creates and deletes custom fields with validation", async () => {
    expect((await post("/custom-fields", { key: "plan", label: "Plan", type: "text" })).status).toBe(201);
    expect((await post("/custom-fields", { key: "plan" })).status).toBe(409);
    expect((await post("/custom-fields", { key: "Bad Key" })).status).toBe(400);
    expect((await post("/custom-fields", { key: "x", type: "money" })).status).toBe(400);
    expect((await api.get("/api/v1/custom-fields").set(auth(t.token))).body.data).toEqual([{ key: "plan", label: "Plan", type: "text" }]);
    expect((await api.delete("/api/v1/custom-fields/plan").set(auth(t.token))).status).toBe(200);
    expect((await api.delete("/api/v1/custom-fields/plan").set(auth(t.token))).status).toBe(404);
  });
});

describe("segments: rules evaluated by the database", () => {
  it("counts and previews every field kind, and treats injection attempts as data", async () => {
    const t2 = await newTenant();
    const mk = (b: object) => api.post("/api/v1/contacts").set(auth(t2.token)).send(b).then((r) => r.body.data);
    const list = (await api.post("/api/v1/lists").set(auth(t2.token)).send({ name: "S" })).body.data.id;
    const ada = await mk({ email: "ada@example.com", firstName: "Ada", tags: ["vip"], attributes: { plan: "pro", seats: 40 }, listIds: [list] });
    await mk({ email: "bob@example.com", firstName: "Bob", attributes: { plan: "free", seats: 3 } });
    await mk({ email: "obrien@example.com", firstName: "x'; DROP TABLE contacts; --" });
    await db.updateTable("contacts").set({ last_opened_at: new Date(Date.now() - 2 * 86400000) }).where("id", "=", ada.id).execute();
    const prev = (rules: object) => api.post("/api/v1/segments/preview").set(auth(t2.token)).send({ rules });
    const count = async (match: "all" | "any", conditions: object[]) => (await prev({ match, conditions })).body.data.count;
    expect(await count("all", [{ field: "attr:plan", op: "is", value: "pro" }])).toBe(1);
    expect(await count("all", [{ field: "attr:seats", op: "gt", value: 10 }])).toBe(1);
    expect(await count("all", [{ field: "attr:seats", op: "lt", value: 10 }])).toBe(1);
    expect(await count("all", [{ field: "attr:plan", op: "is_set" }])).toBe(2);
    expect(await count("all", [{ field: "attr:plan", op: "is_not_set" }])).toBe(1);
    expect(await count("all", [{ field: "email", op: "contains", value: "example" }])).toBe(3);
    expect(await count("all", [{ field: "first_name", op: "starts_with", value: "ad" }])).toBe(1);
    expect(await count("all", [{ field: "tag", op: "is", value: "vip" }])).toBe(1);
    expect(await count("all", [{ field: "tag", op: "is_not", value: "vip" }])).toBe(2);
    expect(await count("all", [{ field: "list", op: "is", value: list }])).toBe(1);
    expect(await count("all", [{ field: "opened_in_days", op: "in_last_days", value: 7 }])).toBe(1);
    expect(await count("all", [{ field: "opened_in_days", op: "not_in_last_days", value: 7 }])).toBe(2);
    expect(await count("all", [{ field: "never_opened", op: "is", value: true }])).toBe(2);
    expect(await count("all", [{ field: "created_at", op: "in_last_days", value: 1 }])).toBe(3);
    expect(await count("all", [{ field: "created_at", op: "lt", value: "2000-01-01" }])).toBe(0);
    expect(await count("all", [{ field: "status", op: "is", value: "SUBSCRIBED" }, { field: "tag", op: "is", value: "vip" }])).toBe(1);
    expect(await count("any", [{ field: "tag", op: "is", value: "vip" }, { field: "attr:plan", op: "is", value: "free" }])).toBe(2);
    // Hostile values match literally and harm nothing.
    expect(await count("all", [{ field: "first_name", op: "is", value: "x'; DROP TABLE contacts; --" }])).toBe(1);
    expect(await count("all", [{ field: "email", op: "contains", value: "%" }])).toBe(0);
    expect((await prev({ match: "all", conditions: [{ field: "attr:plan'; --", op: "is", value: "a" }] })).status).toBe(400);
    expect((await prev({ match: "all", conditions: [{ field: "password_hash", op: "is", value: "a" }] })).status).toBe(400);
    expect((await prev({ match: "all", conditions: [] })).status).toBe(400);
    const sample = (await prev({ match: "all", conditions: [{ field: "email", op: "contains", value: "example" }] })).body.data.sample;
    expect(sample).toHaveLength(3);
    expect(sample[0]).toHaveProperty("listIds");
    expect(await db.selectFrom("contacts").select(db.fn.countAll<string>().as("n")).executeTakeFirstOrThrow()).toBeTruthy();
  });

  it("saves segments with a count, lists them with ?count=true, and edits and deletes them", async () => {
    const t2 = await newTenant();
    await api.post("/api/v1/contacts").set(auth(t2.token)).send({ email: "seg@example.com", tags: ["a"] }).expect(201);
    const seg = (await api.post("/api/v1/segments").set(auth(t2.token)).send({ name: "A", description: "d", rules: { match: "all", conditions: [{ field: "tag", op: "is", value: "a" }] } })).body.data;
    expect(seg).toMatchObject({ name: "A", contactCount: 1, rules: { match: "all" } });
    await api.post("/api/v1/contacts").set(auth(t2.token)).send({ email: "seg2@example.com", tags: ["a"] }).expect(201);
    expect((await api.get("/api/v1/segments").set(auth(t2.token))).body.data[0].contactCount).toBe(1); // stored, not recomputed
    expect((await api.get("/api/v1/segments").set(auth(t2.token)).query({ count: "true" })).body.data[0].contactCount).toBe(2);
    const upd = await api.patch(`/api/v1/segments/${seg.id}`).set(auth(t2.token)).send({ name: "B", rules: { match: "all", conditions: [{ field: "tag", op: "is", value: "zzz" }] } });
    expect(upd.body.data).toMatchObject({ name: "B", contactCount: 0 });
    expect((await api.delete(`/api/v1/segments/${seg.id}`).set(auth(t2.token))).status).toBe(200);
    expect((await api.get(`/api/v1/segments/${seg.id}`).set(auth(t2.token))).status).toBe(404);
  });
});

describe("templates", () => {
  it("ships eight starters, protects them from deletion, duplicates and edits", async () => {
    const t2 = await newTenant();
    const list = (await api.get("/api/v1/templates").set(auth(t2.token))).body.data;
    const starters = list.filter((x: { isStarter: boolean }) => x.isStarter);
    expect(starters.map((s: { name: string }) => s.name).sort()).toEqual(["Announcement", "Event invitation", "Newsletter", "Plain letter", "Product launch", "Promotion", "Re-engagement", "Welcome"]);
    for (const s of starters) {
      expect(s.html).not.toMatch(new RegExp(["eu", "ron"].join(""), "i"));
      expect((s.html.match(/https?:\/\/[^"'\s<)]+/g) ?? []).every((u: string) => /example\.com/.test(u))).toBe(true);
    }
    expect((await api.delete(`/api/v1/templates/${starters[0].id}`).set(auth(t2.token))).status).toBe(409);
    const dup = await api.post(`/api/v1/templates/${starters[0].id}/duplicate`).set(auth(t2.token));
    expect(dup.status).toBe(201);
    expect(dup.body.data).toMatchObject({ isStarter: false, html: starters[0].html });
    const edit = await api.patch(`/api/v1/templates/${dup.body.data.id}`).set(auth(t2.token)).send({ name: "Mine", html: "<p>Hi {{first_name}}</p>", text: "Hi" });
    expect(edit.body.data).toMatchObject({ name: "Mine", text: "Hi" });
    expect((await api.delete(`/api/v1/templates/${dup.body.data.id}`).set(auth(t2.token))).status).toBe(200);
    expect((await api.post("/api/v1/templates").set(auth(t2.token)).send({ name: "x" })).status).toBe(400);
    expect((await api.post("/api/v1/templates").set(auth(t2.token)).send({ name: "n", subject: "s", html: "x".repeat(600_000) })).status).toBe(400);
  });

  it("renders a preview with a sample or a real contact, reporting missing tags", async () => {
    const t2 = await newTenant();
    const body = { subject: "Hi {{first_name | default: \"you\"}}", preheader: "p", html: "<p>{{first_name}} {{attr.plan}} {{nope}}</p>" };
    const sample = await api.post("/api/v1/templates/render").set(auth(t2.token)).send(body);
    expect(sample.status).toBe(200);
    expect(sample.body.data).toMatchObject({ subject: "Hi Alex" });
    expect(sample.body.data.missingTags.sort()).toEqual(["attr.plan", "nope"]);
    const c = (await api.post("/api/v1/contacts").set(auth(t2.token)).send({ email: "real@example.com", firstName: "Real", attributes: { plan: "pro" } })).body.data;
    const real = await api.post("/api/v1/templates/render").set(auth(t2.token)).send({ ...body, contactId: c.id });
    expect(real.body.data.html).toContain("Real pro");
    expect(real.body.data.text).toContain("Real pro");
    const evil = await api.post("/api/v1/templates/render").set(auth(t2.token)).send({ html: "<script>alert(1)</script><p onclick=\"x()\">hi</p>" });
    expect(evil.body.data.html).not.toMatch(/<script|onclick/);
    expect((await api.post("/api/v1/templates/render").set(auth(t2.token)).send({})).status).toBe(400);
    expect((await api.post("/api/v1/templates/render").set(auth(t2.token)).send({ ...body, contactId: "missing" })).status).toBe(404);
  });
});
