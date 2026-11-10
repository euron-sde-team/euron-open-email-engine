import { afterAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, newTenant } from "../helpers";

afterAll(async () => {
  await closeDB();
});

const csv = (lines: string[]) => Buffer.from(lines.join("\n"));
const upload = (token: string, body: Buffer, name = "contacts.csv") => api.post("/api/v1/imports").set(auth(token)).attach("file", body, { filename: name, contentType: "text/csv" });
const MAPPING = { Email: "email", Name: "full_name", Tags: "tags", Plan: "attr:plan", Ignore: "skip" };

describe("CSV import: mapping, chunks, idempotency, errors", () => {
  it("uploads, returns headers and sample rows, then imports with the mapping", async () => {
    const t = await newTenant();
    await api.post("/api/v1/custom-fields").set(auth(t.token)).send({ key: "plan", label: "Plan" }).expect(201);
    const list = (await api.post("/api/v1/lists").set(auth(t.token)).send({ name: "Imported" })).body.data.id;
    const file = csv([
      "Email,Name,Tags,Plan,Ignore",
      "ada@example.com,Ada Lovelace,vip;early,pro,x",
      "BOB@example.com,Bob,,free,x",
      "not-an-email,Carl,,free,x",
      ",Nobody,,,x",
      "ada@example.com,Ada Again,dup,free,x",
      '"dee@example.com","Dee, the Third",newsletter,team,x',
    ]);
    const up = await upload(t.token, file);
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ fileName: "contacts.csv", headers: ["Email", "Name", "Tags", "Plan", "Ignore"], totalRows: 6 });
    expect(up.body.data.sampleRows).toHaveLength(5);
    expect(up.body.data.sampleRows[0][0]).toBe("ada@example.com");
    const id = up.body.data.id;

    // The consent confirmation is required, and so is a valid mapping.
    expect((await api.post(`/api/v1/imports/${id}/start`).set(auth(t.token)).send({ mapping: MAPPING, consentConfirmed: false })).status).toBe(400);
    expect((await api.post(`/api/v1/imports/${id}/start`).set(auth(t.token)).send({ mapping: { Name: "full_name" }, consentConfirmed: true })).status).toBe(400);
    expect((await api.post(`/api/v1/imports/${id}/start`).set(auth(t.token)).send({ mapping: { ...MAPPING, Plan: "attr:ghost" }, consentConfirmed: true })).status).toBe(400);

    const started = await api.post(`/api/v1/imports/${id}/start`).set(auth(t.token)).send({ mapping: MAPPING, listId: list, tags: ["spring"], consentConfirmed: true });
    expect(started.status).toBe(200);
    const job = (await api.get(`/api/v1/imports/${id}`).set(auth(t.token))).body.data;
    expect(job).toMatchObject({ status: "DONE", total: 6, created: 3, updated: 0, skipped: 3, listId: list });
    expect(job.finishedAt).toBeTruthy();
    expect(job.errors.map((e: { row: number; reason: string }) => `${e.row}:${e.reason}`)).toEqual(
      expect.arrayContaining(["4:Invalid email address", "5:Missing email"])
    );
    expect(job.errors.some((e: { reason: string }) => /Duplicate of row 2/.test(e.reason))).toBe(true);

    const ada = (await api.get("/api/v1/contacts").set(auth(t.token)).query({ q: "ada@" })).body.data.items[0];
    expect(ada).toMatchObject({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", source: "IMPORT", status: "SUBSCRIBED", attributes: { plan: "pro" }, listIds: [list] });
    expect(ada.tags.sort()).toEqual(["early", "spring", "vip"]);
    const dee = (await api.get("/api/v1/contacts").set(auth(t.token)).query({ q: "dee@" })).body.data.items[0];
    expect(dee.lastName).toBe("the Third"); // quoted comma stayed inside the field
    expect((await api.get("/api/v1/imports").set(auth(t.token))).body.data.items[0].id).toBe(id);
    expect((await api.post(`/api/v1/imports/${id}/start`).set(auth(t.token)).send({ mapping: MAPPING, consentConfirmed: true })).status).toBe(409);
  });

  it("is idempotent on email, merges instead of overwriting, and never revives unsubscribed, bounced or complained contacts", async () => {
    const t = await newTenant();
    await api.post("/api/v1/contacts").set(auth(t.token)).send({ email: "keep@example.com", firstName: "Keeper", tags: ["old"] }).expect(201);
    const [a, b, c] = await Promise.all(["unsub@example.com", "bounced@example.com", "complained@example.com"].map((e) => api.post("/api/v1/contacts").set(auth(t.token)).send({ email: e }).then((r) => r.body.data.id)));
    for (const [id, status] of [[a, "UNSUBSCRIBED"], [b, "BOUNCED"], [c, "COMPLAINED"]]) await db.updateTable("contacts").set({ status: status as never }).where("id", "=", id).execute();
    const file = csv(["Email,Name,Tags", "keep@example.com,Different Name,new", "unsub@example.com,U,", "bounced@example.com,B,", "complained@example.com,C,", "fresh@example.com,Fresh,"]);
    const up = await upload(t.token, file);
    const run = () => api.post(`/api/v1/imports/${up.body.data.id}/start`).set(auth(t.token)).send({ mapping: { Email: "email", Name: "full_name", Tags: "tags" }, consentConfirmed: true });
    await run().expect(200);
    const job = (await api.get(`/api/v1/imports/${up.body.data.id}`).set(auth(t.token))).body.data;
    expect(job).toMatchObject({ status: "DONE", created: 1, updated: 4 });
    const all = (await api.get("/api/v1/contacts").set(auth(t.token)).query({ limit: 20 })).body.data.items as Array<{ email: string; status: string; firstName: string; tags: string[] }>;
    const by = (e: string) => all.find((x) => x.email === e)!;
    expect(by("keep@example.com")).toMatchObject({ firstName: "Keeper", status: "SUBSCRIBED" });
    expect(by("keep@example.com").tags.sort()).toEqual(["new", "old"]);
    expect(by("unsub@example.com").status).toBe("UNSUBSCRIBED");
    expect(by("bounced@example.com").status).toBe("BOUNCED");
    expect(by("complained@example.com").status).toBe("COMPLAINED");
    expect(all).toHaveLength(5);

    // A second upload of the same data creates nothing new.
    const again = await upload(t.token, file);
    await api.post(`/api/v1/imports/${again.body.data.id}/start`).set(auth(t.token)).send({ mapping: { Email: "email", Name: "full_name", Tags: "tags" }, consentConfirmed: true }).expect(200);
    expect((await api.get(`/api/v1/imports/${again.body.data.id}`).set(auth(t.token))).body.data).toMatchObject({ created: 0, updated: 5 });
  });

  it("makes a new contact that is already suppressed unmailable, and respects the plan's contact limit", async () => {
    const t = await newTenant("GROWTH", { limits: { maxContacts: 3 } });
    await api.post("/api/v1/email/suppressions").set(auth(t.token)).send({ email: "blocked@example.com" }).expect(201);
    const up = await upload(t.token, csv(["Email", "blocked@example.com", "a@example.com", "b@example.com", "c@example.com"]));
    await api.post(`/api/v1/imports/${up.body.data.id}/start`).set(auth(t.token)).send({ mapping: { Email: "email" }, consentConfirmed: true }).expect(200);
    const job = (await api.get(`/api/v1/imports/${up.body.data.id}`).set(auth(t.token))).body.data;
    expect(job.created).toBe(3);
    expect(job.skipped).toBe(1);
    expect(job.errors[0].reason).toMatch(/limit/i);
    expect((await api.get("/api/v1/contacts").set(auth(t.token)).query({ q: "blocked@" })).body.data.items[0].status).toBe("UNSUBSCRIBED");
  });

  it("rejects bad uploads: no file, oversize, binary, duplicate headers, too many rows, header only", async () => {
    const t = await newTenant();
    expect((await api.post("/api/v1/imports").set(auth(t.token))).status).toBe(400);
    expect((await upload(t.token, Buffer.alloc(10 * 1024 * 1024 + 10, "a"))).status).toBe(400);
    expect((await upload(t.token, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 1]))).status).toBe(400);
    expect((await upload(t.token, csv(["Email,Email", "a@example.com,b@example.com"]))).status).toBe(400);
    expect((await upload(t.token, csv(["Email"]))).status).toBe(400);
    const big = "Email\n" + Array.from({ length: 100_001 }, (_, i) => `u${i}@example.com`).join("\n");
    const res = await upload(t.token, Buffer.from(big));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/100,000/);
  });

  it("handles a few thousand rows in chunks", async () => {
    const t = await newTenant();
    const rows = Array.from({ length: 1700 }, (_, i) => `bulk${i}@example.com,Bulk${i}`);
    const up = await upload(t.token, csv(["Email,Name", ...rows]));
    await api.post(`/api/v1/imports/${up.body.data.id}/start`).set(auth(t.token)).send({ mapping: { Email: "email", Name: "full_name" }, consentConfirmed: true }).expect(200);
    const job = (await api.get(`/api/v1/imports/${up.body.data.id}`).set(auth(t.token))).body.data;
    expect(job).toMatchObject({ status: "DONE", total: 1700, created: 1700, skipped: 0 });
    expect((await api.get("/api/v1/dashboard").set(auth(t.token))).body.data.usage.contacts.used).toBe(1700);
  });
});
