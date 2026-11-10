import { afterAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { setDnsResolver } from "../../src/services/email-domains.service";
import emailDomainsRepository from "../../src/repositories/email-domains.repository";
import emailDomainsService from "../../src/services/email-domains.service";
import { api, auth, newTenant, verifiedSender } from "../helpers";

const RUN = Date.now().toString(36);

afterAll(async () => {
  setDnsResolver(null);
  await closeDB();
});

describe("domain wizard (simulated provider)", () => {
  it("creates a PENDING domain with DKIM, MAIL FROM, SPF, DMARC and the tracking CNAME", async () => {
    const t = await newTenant();
    const res = await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: `Mail.Wizard-One-${RUN}.example` });
    expect(res.status).toBe(201);
    const d = res.body.data;
    expect(d).toMatchObject({ domain: `mail.wizard-one-${RUN}.example`, mailFromDomain: `bounce.mail.wizard-one-${RUN}.example`, status: "PENDING", trackingDomain: `track.mail.wizard-one-${RUN}.example`, trackingStatus: "PENDING", verifiedAt: null });
    const purposes = d.records.map((r: { purpose: string }) => r.purpose);
    expect(purposes.filter((p: string) => p === "DKIM")).toHaveLength(3);
    expect(purposes).toEqual(expect.arrayContaining(["MAIL FROM", "SPF", "DMARC", "TRACKING"]));
    const tracking = d.records.find((r: { purpose: string }) => r.purpose === "TRACKING");
    expect(tracking).toMatchObject({ type: "CNAME", name: `track.mail.wizard-one-${RUN}.example`, required: false, found: null });
    expect(d.records.filter((r: { required: boolean }) => r.required).length).toBeGreaterThanOrEqual(5);
  });

  it("verifies on Check now, marking every record found and the tracking domain verified", async () => {
    const t = await newTenant();
    const created = await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: `mail.wizard-two-${RUN}.example` });
    const id = created.body.data.id;
    const res = await api.post(`/api/v1/email/domains/${id}/check`).set(auth(t.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "VERIFIED", dkimStatus: "SUCCESS", mailFromStatus: "SUCCESS", trackingStatus: "VERIFIED" });
    expect(res.body.data.verifiedAt).toBeTruthy();
    expect(res.body.data.lastCheckedAt).toBeTruthy();
    expect(res.body.data.records.every((r: { found: boolean }) => r.found === true)).toBe(true);
    const got = await api.get(`/api/v1/email/domains/${id}`).set(auth(t.token));
    expect(got.body.data.status).toBe("VERIFIED");
  });

  it("verifies on its own after the simulated delay, with no DNS", async () => {
    const t = await newTenant();
    const created = await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: `mail.wizard-three-${RUN}.example` });
    const id = created.body.data.id;
    const row = await emailDomainsRepository.findById(id, t.id);
    await emailDomainsService.refresh(row!, { explicit: false });
    expect((await emailDomainsRepository.findById(id, t.id))?.status).toBe("PENDING");
    await db.updateTable("email_sending_domains").set({ created_at: new Date(Date.now() - 10 * 60_000) }).where("id", "=", id).execute();
    await emailDomainsService.refresh((await emailDomainsRepository.findById(id, t.id))!, { explicit: false });
    expect((await emailDomainsRepository.findById(id, t.id))?.status).toBe("VERIFIED");
  });

  it("refreshes found flags from the injected DNS resolver without verifying", async () => {
    const t = await newTenant();
    const created = await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: `mail.wizard-four-${RUN}.example` });
    const id = created.body.data.id;
    const records = created.body.data.records as Array<{ purpose: string; name: string; value: string }>;
    const track = records.find((r) => r.purpose === "TRACKING")!;
    setDnsResolver({ cname: async (n) => (n === track.name ? [track.value] : []), txt: async () => [], mx: async () => [] });
    try {
      const row = (await emailDomainsRepository.findById(id, t.id))!;
      const out = await emailDomainsService.refresh(row, { explicit: false });
      const found = (out.dns_records as Array<{ purpose: string; found: boolean }>).filter((r) => r.found).map((r) => r.purpose);
      expect(found).toEqual(["TRACKING"]);
      expect(out.status).toBe("PENDING");
    } finally {
      setDnsResolver(null);
    }
  });

  it("rejects malformed domains, a domain another tenant owns, and domains beyond the plan limit", async () => {
    const t = await newTenant("STARTER");
    expect((await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: "not a domain" })).status).toBe(400);
    expect((await api.post("/api/v1/email/domains").set(auth(t.token)).send({})).status).toBe(400);
    await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: `mail.wizard-five-${RUN}.example` }).expect(201);
    const other = await newTenant("STARTER");
    expect((await api.post("/api/v1/email/domains").set(auth(other.token)).send({ domain: `mail.wizard-five-${RUN}.example` })).status).toBe(409);
    // Starter allows one domain.
    expect((await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: `mail.wizard-six-${RUN}.example` })).status).toBe(403);
  });

  it("only lets a sender be created on a verified domain, on that domain", async () => {
    const t = await newTenant();
    const created = await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: `mail.wizard-seven-${RUN}.example` });
    const id = created.body.data.id;
    expect((await api.post("/api/v1/email/senders").set(auth(t.token)).send({ domainId: id, localPart: "hi" })).status).toBe(400);
    await api.post(`/api/v1/email/domains/${id}/check`).set(auth(t.token)).expect(200);
    const s = await api.post("/api/v1/email/senders").set(auth(t.token)).send({ domainId: id, localPart: "hi", displayName: "Hi", replyTo: "Reply@Wizard.Example", defaults: ["MARKETING"] });
    expect(s.status).toBe(201);
    expect(s.body.data).toMatchObject({ domainId: id, email: `hi@mail.wizard-seven-${RUN}.example`, displayName: "Hi", replyTo: "reply@wizard.example", status: "ACTIVE", defaults: ["MARKETING"] });
    expect((await api.post("/api/v1/email/senders").set(auth(t.token)).send({ domainId: id, localPart: "hi" })).status).toBe(409);
    expect((await api.post("/api/v1/email/senders").set(auth(t.token)).send({ domainId: id, localPart: "bad local@x" })).status).toBe(400);
  });

  it("keeps one default sender per category and sends a test to the signed-in user", async () => {
    const t = await newTenant();
    const { domainId, senderId } = await verifiedSender(t);
    const second = await api.post("/api/v1/email/senders").set(auth(t.token)).send({ domainId, localPart: "news", defaults: ["MARKETING"] });
    const list = await api.get("/api/v1/email/senders").set(auth(t.token));
    const first = list.body.data.find((s: { id: string }) => s.id === senderId);
    expect(first.defaults).toEqual(["TRANSACTIONAL"]);
    expect(second.body.data.defaults).toEqual(["MARKETING"]);
    const test = await api.post(`/api/v1/email/senders/${senderId}/test`).set(auth(t.token));
    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ sentTo: t.email, status: "sent" });
    const msg = await db.selectFrom("email_messages").selectAll().where("tenant_id", "=", t.id).where("to_address", "=", t.email).executeTakeFirst();
    expect(msg).toMatchObject({ simulated: true, category: "TRANSACTIONAL", status: "DELIVERED" });
    const patched = await api.patch(`/api/v1/email/senders/${senderId}`).set(auth(t.token)).send({ status: "ARCHIVED" });
    expect(patched.body.data.status).toBe("ARCHIVED");
    expect((await api.post(`/api/v1/email/senders/${senderId}/test`).set(auth(t.token))).status).toBe(400);
  });

  it("removes a domain and its senders", async () => {
    const t = await newTenant();
    const { domainId, senderId } = await verifiedSender(t);
    expect((await api.delete(`/api/v1/email/domains/${domainId}`).set(auth(t.token))).status).toBe(200);
    expect((await api.get(`/api/v1/email/domains/${domainId}`).set(auth(t.token))).status).toBe(404);
    expect((await api.patch(`/api/v1/email/senders/${senderId}`).set(auth(t.token)).send({ displayName: "x" })).status).toBe(404);
  });
});
