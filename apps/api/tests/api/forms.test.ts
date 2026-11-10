import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { confirmUrl } from "../../src/utils/links";
import { signToken } from "../../src/utils/tokens";
import { api, auth, newTenant, verifiedSender, type TestTenant } from "../helpers";

let t: TestTenant;
let doubleList: string;
let singleList: string;
let doubleSlug: string;
let singleSlug: string;

beforeAll(async () => {
  t = await newTenant();
  await verifiedSender(t); // a TRANSACTIONAL default sender for the confirmation mail
  doubleList = (await api.post("/api/v1/lists").set(auth(t.token)).send({ name: "Double", doubleOptIn: true })).body.data.id;
  singleList = (await api.post("/api/v1/lists").set(auth(t.token)).send({ name: "Single" })).body.data.id;
  const f1 = await api.post("/api/v1/forms").set(auth(t.token)).send({ name: "Newsletter", listId: doubleList, headline: "Join us", collectName: true });
  const f2 = await api.post("/api/v1/forms").set(auth(t.token)).send({ name: "Plain", listId: singleList, headline: "Hi", slug: "plain-form-" + t.slug.slice(-6) });
  expect(f1.status).toBe(201);
  doubleSlug = f1.body.data.slug;
  singleSlug = f2.body.data.slug;
});
afterAll(async () => {
  await closeDB();
});

const contact = (email: string) => db.selectFrom("contacts").selectAll().where("tenant_id", "=", t.id).where("email", "=", email).executeTakeFirst();
const membership = async (email: string, listId: string) =>
  (await db.selectFrom("list_members").select("status").where("list_id", "=", listId).where("contact_id", "=", (await contact(email))!.id).executeTakeFirst())?.status;

describe("form management", () => {
  it("returns the public URL, validates the list and slug, and counts nothing yet", async () => {
    const form = (await api.get("/api/v1/forms").set(auth(t.token))).body.data.find((f: { slug: string }) => f.slug === doubleSlug);
    expect(form).toMatchObject({ name: "Newsletter", listId: doubleList, collectName: true, active: true, submissions: 0, url: `http://localhost:5126/f/${doubleSlug}` });
    expect((await api.post("/api/v1/forms").set(auth(t.token)).send({ name: "x", listId: "missing", headline: "h" })).status).toBe(404);
    expect((await api.post("/api/v1/forms").set(auth(t.token)).send({ name: "x", listId: singleList, headline: "h", slug: "A b" })).status).toBe(400);
    expect((await api.post("/api/v1/forms").set(auth(t.token)).send({ name: "x", listId: singleList, headline: "h", slug: singleSlug })).status).toBe(409);
    expect((await api.delete(`/api/v1/lists/${singleList}`).set(auth(t.token))).status).toBe(409); // a form still posts to it
  });
});

describe("public form page", () => {
  it("renders the form with a honeypot and no cookies, and 404s for unknown or inactive forms", async () => {
    const res = await api.get(`/f/${doubleSlug}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Join us");
    expect(res.text).toContain('name="email"');
    expect(res.text).toContain('name="firstName"');
    expect(res.text).toContain('name="website"');
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await api.get("/f/nope-nope")).status).toBe(404);
    const form = (await api.get("/api/v1/forms").set(auth(t.token))).body.data.find((f: { slug: string }) => f.slug === singleSlug);
    await api.patch(`/api/v1/forms/${form.id}`).set(auth(t.token)).send({ active: false }).expect(200);
    expect((await api.get(`/f/${singleSlug}`)).status).toBe(404);
    expect((await api.post(`/f/${singleSlug}`).send({ email: "a@example.com" })).status).toBe(404);
    await api.patch(`/api/v1/forms/${form.id}`).set(auth(t.token)).send({ active: true }).expect(200);
  });
});

describe("double opt-in", () => {
  it("creates a pending contact, mails a confirmation through the transactional sender, and subscribes on confirm", async () => {
    const res = await api.post(`/f/${doubleSlug}`).send({ email: "New.Person@Example.com", firstName: "Nia" });
    expect(res.status).toBe(200);
    expect(res.body.data.pending).toBe(true);
    const c = await contact("new.person@example.com");
    expect(c).toMatchObject({ status: "PENDING_CONFIRMATION", source: "FORM", first_name: "Nia", consent_at: null });
    expect(c?.consent_ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(await membership("new.person@example.com", doubleList)).toBe("pending");
    const mail = await db.selectFrom("email_messages").selectAll().where("tenant_id", "=", t.id).where("to_address", "=", "new.person@example.com").executeTakeFirstOrThrow();
    expect(mail).toMatchObject({ category: "TRANSACTIONAL", simulated: true });
    expect(mail.subject).toMatch(/Confirm/);
    expect((await db.selectFrom("subscribe_forms").select("submissions").where("slug", "=", doubleSlug).executeTakeFirstOrThrow()).submissions).toBe(1);

    // Pending contacts are not mailed by campaigns.
    const pre = await api.post("/api/v1/segments/preview").set(auth(t.token)).send({ rules: { match: "all", conditions: [{ field: "status", op: "is", value: "SUBSCRIBED" }] } });
    expect(pre.body.data.count).toBe(0);

    const link = confirmUrl("http://localhost:5126", t.id, c!.id, doubleList);
    const ok = await api.get(new URL(link).pathname);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("Subscription confirmed");
    expect(await contact("new.person@example.com")).toMatchObject({ status: "SUBSCRIBED" });
    expect((await contact("new.person@example.com"))?.consent_at).toBeTruthy();
    expect(await membership("new.person@example.com", doubleList)).toBe("subscribed");
    // Confirming twice is harmless.
    expect((await api.get(new URL(link).pathname)).status).toBe(200);
  });

  it("rejects forged, wrong-kind and expired confirmation tokens", async () => {
    const c = await contact("new.person@example.com");
    expect((await api.get("/c/forged")).status).toBe(400);
    expect((await api.get(`/c/${signToken({ kind: "u", parts: [t.id, c!.id, doubleList] })}`)).status).toBe(400);
    expect((await api.get(`/c/${signToken({ kind: "k", parts: [t.id, c!.id, doubleList], exp: 1000 })}`)).status).toBe(400);
    // A token for a membership that does not exist confirms nothing.
    expect((await api.get(`/c/${signToken({ kind: "k", parts: [t.id, c!.id, "nolist"] })}`)).status).toBe(400);
  });

  it("looks identical for an address that already exists, so nobody can probe who is subscribed", async () => {
    const again = await api.post(`/f/${doubleSlug}`).send({ email: "new.person@example.com" });
    const fresh = await api.post(`/f/${doubleSlug}`).send({ email: "another.person@example.com" });
    expect(again.status).toBe(fresh.status);
    expect(again.body.data).toEqual(fresh.body.data);
  });
});

describe("single opt-in and abuse protection", () => {
  it("subscribes immediately on a single opt-in list", async () => {
    const res = await api.post(`/f/${singleSlug}`).type("form").send({ email: "quick@example.com" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Thanks for subscribing.");
    expect(await contact("quick@example.com")).toMatchObject({ status: "SUBSCRIBED" });
    expect(await membership("quick@example.com", singleList)).toBe("subscribed");
  });

  it("silently ignores the honeypot and rejects invalid emails", async () => {
    const bot = await api.post(`/f/${singleSlug}`).send({ email: "bot@example.com", website: "https://spam.example" });
    expect(bot.status).toBe(200);
    expect(await contact("bot@example.com")).toBeUndefined();
    for (const bad of ["", "no-at-sign", "a@b", "a b@example.com", "<script>@example.com"]) {
      expect((await api.post(`/f/${singleSlug}`).send({ email: bad })).status).toBe(400);
    }
    const html = await api.post(`/f/${singleSlug}`).type("form").send({ email: "nope" });
    expect(html.status).toBe(400);
    expect(html.text).toContain("Enter a valid email address.");
  });

  it("never re-subscribes a bounced or complaining address through the form", async () => {
    const [id] = (await db.insertInto("contacts").values({ id: "bounced-" + t.id, tenant_id: t.id, email: "bounced@example.com", status: "BOUNCED", source: "MANUAL", tags: [], attributes: "{}", created_at: new Date(), updated_at: new Date() }).returning("id").execute()).map((r) => r.id);
    await api.post(`/f/${singleSlug}`).send({ email: "bounced@example.com" }).expect(200);
    expect((await contact("bounced@example.com"))?.status).toBe("BOUNCED");
    expect(await db.selectFrom("list_members").select("status").where("contact_id", "=", id).where("list_id", "=", singleList).executeTakeFirst()).toBeUndefined();
  });

  it("lets a person who unsubscribed earlier join again on their own request", async () => {
    await api.post(`/f/${singleSlug}`).send({ email: "returning@example.com" }).expect(200);
    const c = await contact("returning@example.com");
    await api.patch(`/api/v1/contacts/${c!.id}`).set(auth(t.token)).send({ status: "UNSUBSCRIBED" }).expect(200);
    await db.insertInto("email_suppressions").values({ id: "sup-ret-" + t.id, tenant_id: t.id, email: "returning@example.com", reason: "UNSUBSCRIBE", category_scope: "MARKETING", created_at: new Date(), updated_at: new Date() }).execute();
    await api.post(`/f/${singleSlug}`).send({ email: "returning@example.com" }).expect(200);
    expect((await contact("returning@example.com"))?.status).toBe("SUBSCRIBED");
    expect(await db.selectFrom("email_suppressions").select("id").where("tenant_id", "=", t.id).where("email", "=", "returning@example.com").executeTakeFirst()).toBeUndefined();
  });

  it("respects the plan's contact limit without telling the visitor", async () => {
    const small = await newTenant("GROWTH", { limits: { maxContacts: 1 } });
    const l = (await api.post("/api/v1/lists").set(auth(small.token)).send({ name: "L" })).body.data.id;
    const f = (await api.post("/api/v1/forms").set(auth(small.token)).send({ name: "F", listId: l, headline: "h" })).body.data;
    await api.post(`/f/${f.slug}`).send({ email: "one@example.com" }).expect(200);
    const second = await api.post(`/f/${f.slug}`).send({ email: "two@example.com" });
    expect(second.status).toBe(200);
    expect((await api.get("/api/v1/contacts").set(auth(small.token))).body.data.items).toHaveLength(1);
  });
});
