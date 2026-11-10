import supertest from "supertest";
import app from "../src/app";

// Supertest drives the Express app in-process; no listening server needed. Tests run
// against a freshly migrated and seeded database (pnpm demo:seed) and create their own
// tenants through the operator API, so suites never depend on each other's data.
// vitest.config.ts disables file parallelism so cross-file writes never race.
export const api = supertest(app);

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export const DEMO_PASSWORD = process.env.EMAIL_DEMO_PASSWORD || "demo-password-1";

export async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await api.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.token as string;
}

export async function operatorLogin(): Promise<string> {
  const res = await api.post("/api/v1/operator/auth/login").send({ email: "operator@example.com", password: DEMO_PASSWORD });
  if (res.status !== 200) throw new Error(`operator login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.token as string;
}

export const NW_ADMIN = { email: "maya@northwind.example" };
export const ACME_ADMIN = { email: "sam@acme-robotics.example" };

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface TestTenant {
  id: string;
  slug: string;
  token: string;
  email: string;
  op: string;
  name: string;
}

/** Onboards a fresh tenant through the operator API and signs its admin in. */
export async function newTenant(plan = "GROWTH", opts: { limits?: Record<string, number | null> } = {}): Promise<TestTenant> {
  const op = await operatorLogin();
  const tag = uniq();
  const email = `admin-${tag}@test-${tag}.example`;
  const res = await api
    .post("/api/v1/operator/tenants")
    .set(auth(op))
    .send({ name: `Test ${tag}`, plan_key: plan, admin: { name: "Test Admin", email, password: DEMO_PASSWORD } });
  if (res.status !== 201) throw new Error(`tenant create failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id = res.body.data.tenant.id as string;
  for (const [field, code] of Object.entries({ monthlyEmails: "limit.monthly_emails", maxContacts: "limit.max_contacts", maxDomains: "limit.max_domains", maxUsers: "limit.max_users" })) {
    if (opts.limits && field in opts.limits) {
      await api.put(`/api/v1/operator/tenants/${id}/entitlements`).set(auth(op)).send({ code, limit_value: opts.limits[field] }).expect(200);
    }
  }
  const token = await login(email);
  return { id, slug: res.body.data.tenant.slug, token, email, op, name: `Test ${tag}` };
}

/** A verified domain and a default sender in simulated mode. Returns their ids. */
export async function verifiedSender(t: TestTenant, domain?: string) {
  const d = domain ?? `mail.${uniq()}.example`;
  const dom = await api.post("/api/v1/email/domains").set(auth(t.token)).send({ domain: d }).expect(201);
  const checked = await api.post(`/api/v1/email/domains/${dom.body.data.id}/check`).set(auth(t.token)).expect(200);
  if (checked.body.data.status !== "VERIFIED") throw new Error("domain did not verify");
  const s = await api
    .post("/api/v1/email/senders")
    .set(auth(t.token))
    .send({ domainId: dom.body.data.id, localPart: "hello", displayName: "Test Sender", defaults: ["MARKETING", "TRANSACTIONAL"] })
    .expect(201);
  return { domainId: dom.body.data.id as string, domain: d, senderId: s.body.data.id as string };
}

export async function addContacts(t: TestTenant, emails: string[], extra: Record<string, unknown> = {}): Promise<string[]> {
  const ids: string[] = [];
  for (const email of emails) {
    const r = await api.post("/api/v1/contacts").set(auth(t.token)).send({ email, firstName: "Test", ...extra }).expect(201);
    ids.push(r.body.data.id);
  }
  return ids;
}

export const CAMPAIGN_HTML =
  '<html><body><p>Hello {{first_name | default: "there"}}</p><a href="https://example.com/one">one</a> <a href="https://example.com/two?x=1&amp;y=2">two</a></body></html>';

export async function newCampaign(t: TestTenant, senderId: string, body: Record<string, unknown> = {}) {
  const r = await api
    .post("/api/v1/campaigns")
    .set(auth(t.token))
    .send({ name: "Test campaign", subject: "Hello {{first_name}}", html: CAMPAIGN_HTML, senderIdentityId: senderId, audience: { type: "ALL" }, ...body })
    .expect(201);
  return r.body.data as { id: string; status: string };
}
