/**
 * Seed: plans, an operator, starter templates and two fictional workspaces full of data.
 *   pnpm demo:seed            seeds only when the database has no tenants
 *   pnpm demo:seed --force    wipes everything and reseeds
 *
 * Logins (every account uses the same password: EMAIL_DEMO_PASSWORD, or DEMO_PASSWORD, or
 * the local fallback below):
 *   operator@example.com            operator console (SUPERADMIN)
 *   maya@northwind.example          Northwind Mail, Growth plan, ADMIN
 *   theo@northwind.example          Northwind Mail, MARKETER
 *   sam@acme-robotics.example       Acme Robotics, Starter plan, ADMIN (sending held, DNS pending)
 *
 * Refuses to run when NODE_ENV=production. Every address is example.com or *.example.
 */
process.env.TZ = "UTC";

import bcrypt from "bcrypt";
import { sql } from "kysely";
import { ulid } from "ulid";
import { MODULES } from "../src/constants/modules.const";
import { closeDB, db } from "../src/db/connection";
import type { PlanRow } from "../src/repositories/operator/plans.repository";
import { planSnapshotSpecs } from "../src/services/operator/plan-snapshot";
import segmentsService from "../src/services/segments.service";
import { ensureStarterTemplates } from "../src/services/starter-templates";
import { computeDnsRecords } from "../src/utils/email-dns";

export const DEMO_PASSWORD_FALLBACK = "demo-password-1";
const password = (): string => process.env.EMAIL_DEMO_PASSWORD || process.env.DEMO_PASSWORD || DEMO_PASSWORD_FALLBACK;
const DAY = 86400000;
const now = new Date();
const daysAgo = (d: number, extraMs = 0) => new Date(now.getTime() - d * DAY + extraMs);

// Deterministic PRNG so every seed produces the same demo.
let seedState = 20260101;
const rnd = (): number => {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const chunks = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

const PLANS = [
  { key: "STARTER", name: "Starter", description: "For a first newsletter and a small audience", modules: ["audience", "templates", "campaigns", "analytics", "email"], limits: { monthlyEmails: 5000, maxContacts: 2000, maxDomains: 1, maxUsers: 3 }, sort_order: 0 },
  { key: "GROWTH", name: "Growth", description: "Regular campaigns, several senders, a small team", modules: [...MODULES], limits: { monthlyEmails: 50000, maxContacts: 25000, maxDomains: 5, maxUsers: 15 }, sort_order: 1 },
  { key: "SCALE", name: "Scale", description: "High volume with room to grow", modules: [...MODULES], limits: { monthlyEmails: 500000, maxContacts: 500000, maxDomains: 25, maxUsers: 100 }, sort_order: 2 },
];

async function wipe() {
  console.log("[seed] wiping existing data...");
  await db.deleteFrom("tenants").execute(); // cascades to every tenant table
  await db.deleteFrom("operator_audit_logs").execute();
  await db.deleteFrom("operator_users").execute();
  await db.deleteFrom("plans").execute();
}

async function seedPlansAndOperator() {
  const t = new Date();
  for (const p of PLANS) {
    await db.insertInto("plans").values({ id: ulid(), key: p.key, name: p.name, description: p.description, modules: JSON.stringify(p.modules), limits: JSON.stringify(p.limits), is_active: true, sort_order: p.sort_order, created_at: t, updated_at: t }).execute();
  }
  await db.insertInto("operator_users").values({ id: ulid(), email: "operator@example.com", name: "Platform Operator", password_hash: await bcrypt.hash(password(), 12), role: "SUPERADMIN", status: "ACTIVE", created_at: t, updated_at: t }).execute();
}

async function createTenant(o: { slug: string; name: string; plan: string; timezone: string; address: string; color: string; status?: "ACTIVE" | "PAUSED" }) {
  const plan = (await db.selectFrom("plans").selectAll().where("key", "=", o.plan).executeTakeFirstOrThrow()) as PlanRow;
  const t = new Date();
  const id = ulid();
  await db.insertInto("tenants").values({ id, slug: o.slug, name: o.name, plan_key: o.plan, brand_color: o.color, timezone: o.timezone, company_address: o.address, status: "ACTIVE", email_sending_status: o.status ?? "ACTIVE", email_sending_status_changed_at: o.status && o.status !== "ACTIVE" ? daysAgo(2) : null, created_at: daysAgo(70), updated_at: t }).execute();
  await db.insertInto("tenant_entitlements").values(planSnapshotSpecs(plan).map((s) => ({ id: ulid(), tenant_id: id, code: s.code, enabled: s.enabled, limit_value: s.limit_value, source: "PLAN" as const, created_at: t, updated_at: t }))).execute();
  await ensureStarterTemplates(id);
  return id;
}

async function addUser(tenantId: string, name: string, email: string, role: string) {
  const t = new Date();
  await db.insertInto("users").values({ id: ulid(), tenant_id: tenantId, name, email, password_hash: await bcrypt.hash(password(), 12), role, status: "ACTIVE", created_at: daysAgo(60), updated_at: t }).execute();
}

const FIRST = ["Ada", "Bruno", "Chiara", "Dmitri", "Elena", "Farid", "Greta", "Hiro", "Imani", "Jonas", "Kavya", "Leila", "Mateo", "Nadia", "Omar", "Priya", "Quinn", "Rosa", "Sven", "Tara", "Uma", "Viktor", "Wen", "Xavi", "Yara", "Zane"] as const;
const LAST = ["Alvarez", "Berg", "Castro", "Dubois", "Eriksen", "Fischer", "Gupta", "Haddad", "Ivanov", "Jensen", "Kowalski", "Larsen", "Moreau", "Nakamura", "Okoye", "Petrov", "Quast", "Rossi", "Silva", "Tanaka", "Underwood", "Varga", "Weber", "Yilmaz"] as const;
const CITIES = ["Lisbon", "Oslo", "Austin", "Nairobi", "Osaka", "Toronto", "Berlin", "Melbourne"] as const;
const PLAN_ATTR = ["free", "pro", "team"] as const;

async function seedNorthwind() {
  const tenantId = await createTenant({ slug: "northwind-mail", name: "Northwind Mail", plan: "GROWTH", timezone: "Europe/Berlin", address: "12 Example Street, Springfield, EX 00000", color: "#ab1757" });
  await addUser(tenantId, "Maya Okafor", "maya@northwind.example", "ADMIN");
  await addUser(tenantId, "Theo Lindqvist", "theo@northwind.example", "MARKETER");
  await addUser(tenantId, "Priya Raman", "priya@northwind.example", "ANALYST");

  // Verified sending domain with every record found.
  const domainId = ulid();
  const records = computeDnsRecords("mail.northwind.example", ["sim4h2k9a1x0z", "sim7p3m5c8q2w", "sim9d6t1v4n3b"], "us-east-1", "track.mail-engine.example").map((r) => ({ ...r, found: true }));
  await db.insertInto("email_sending_domains").values({ id: domainId, tenant_id: tenantId, subdomain: "mail.northwind.example", mail_from_subdomain: "bounce.mail.northwind.example", ses_configuration_set: `email-tenant-${tenantId}`, status: "VERIFIED", dkim_status: "SUCCESS", mail_from_status: "SUCCESS", dns_records: JSON.stringify(records), tracking_domain: "track.mail.northwind.example", tracking_status: "VERIFIED", verified_at: daysAgo(68), last_checked_at: daysAgo(1), created_at: daysAgo(69), updated_at: daysAgo(1) }).execute();
  const helloId = ulid();
  const newsId = ulid();
  const t = new Date();
  await db.insertInto("email_sender_identities").values([
    { id: helloId, tenant_id: tenantId, sending_domain_id: domainId, email_address: "hello@mail.northwind.example", display_name: "Northwind Mail", reply_to: "support@northwind.example", status: "ACTIVE", is_default_transactional: true, is_default_notification: true, is_default_marketing: true, created_at: daysAgo(68), updated_at: t },
    { id: newsId, tenant_id: tenantId, sending_domain_id: domainId, email_address: "news@mail.northwind.example", display_name: "Northwind News", reply_to: null, status: "ACTIVE", is_default_transactional: false, is_default_notification: false, is_default_marketing: false, created_at: daysAgo(68), updated_at: t },
  ]).execute();

  // Custom fields.
  await db.insertInto("custom_fields").values([
    { id: ulid(), tenant_id: tenantId, key: "plan", label: "Plan", type: "text", created_at: daysAgo(66) },
    { id: ulid(), tenant_id: tenantId, key: "city", label: "City", type: "text", created_at: daysAgo(66) },
    { id: ulid(), tenant_id: tenantId, key: "seats", label: "Seats", type: "number", created_at: daysAgo(66) },
  ]).execute();

  // Lists.
  const lists = [
    { id: ulid(), name: "Newsletter", description: "Monthly newsletter subscribers", double: true },
    { id: ulid(), name: "Customers", description: "Paying customers", double: false },
    { id: ulid(), name: "Trial users", description: "People in their first 30 days", double: false },
    { id: ulid(), name: "Event attendees", description: "Webinar registrations", double: false },
  ];
  await db.insertInto("lists").values(lists.map((l) => ({ id: l.id, tenant_id: tenantId, name: l.name, description: l.description, double_opt_in: l.double, created_at: daysAgo(66), updated_at: t }))).execute();

  // 600 contacts.
  type C = { id: string; email: string; status: string; created: Date };
  const contacts: C[] = [];
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 600; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const roll = rnd();
    const status = roll < 0.92 ? "SUBSCRIBED" : roll < 0.96 ? "UNSUBSCRIBED" : roll < 0.985 ? "BOUNCED" : roll < 0.99 ? "COMPLAINED" : "PENDING_CONFIRMATION";
    const created = daysAgo(Math.floor(rnd() * 66) + 1, Math.floor(rnd() * DAY));
    const id = ulid(created.getTime());
    const planAttr = pick(PLAN_ATTR);
    const tags = [...(rnd() < 0.3 ? ["vip"] : []), ...(rnd() < 0.4 ? ["blog"] : []), ...(planAttr === "pro" ? ["pro"] : [])];
    contacts.push({ id, email: `${first}.${last}${i}@example.com`.toLowerCase(), status, created });
    rows.push({ id, tenant_id: tenantId, email: `${first}.${last}${i}@example.com`.toLowerCase(), first_name: first, last_name: last, status, source: pick(["MANUAL", "IMPORT", "FORM", "FORM"] as const), tags, attributes: JSON.stringify({ plan: planAttr, city: pick(CITIES), seats: Math.floor(rnd() * 40) + 1 }), emails_received: 0, consent_at: created, unsubscribed_at: status === "UNSUBSCRIBED" ? daysAgo(Math.floor(rnd() * 30)) : null, created_at: created, updated_at: created });
  }
  for (const c of chunks(rows, 300)) await db.insertInto("contacts").values(c as never).execute();

  // List memberships: each contact in 1 or 2 lists.
  const members: Array<Record<string, unknown>> = [];
  for (const c of contacts) {
    const picks = new Set<number>([Math.floor(rnd() * 4)]);
    if (rnd() < 0.35) picks.add(Math.floor(rnd() * 4));
    for (const k of picks) {
      const st = c.status === "UNSUBSCRIBED" ? "unsubscribed" : c.status === "PENDING_CONFIRMATION" ? "pending" : "subscribed";
      members.push({ tenant_id: tenantId, list_id: lists[k].id, contact_id: c.id, status: st, created_at: c.created, updated_at: c.created });
    }
  }
  for (const c of chunks(members, 500)) await db.insertInto("list_members").values(c as never).execute();

  // Segments, counted by the real evaluator after contacts exist.
  const segDefs = [
    { name: "Engaged in the last 30 days", description: "Opened any campaign recently", rules: { match: "all", conditions: [{ field: "opened_in_days", op: "in_last_days", value: 30 }] } },
    { name: "Pro plan customers", description: "Custom field plan is pro", rules: { match: "all", conditions: [{ field: "attr:plan", op: "is", value: "pro" }, { field: "status", op: "is", value: "SUBSCRIBED" }] } },
    { name: "New this month", description: "Joined in the last 30 days", rules: { match: "all", conditions: [{ field: "created_at", op: "in_last_days", value: 30 }] } },
  ];
  const segIds: string[] = [];
  for (const s of segDefs) {
    const id = ulid();
    segIds.push(id);
    await db.insertInto("segments").values({ id, tenant_id: tenantId, name: s.name, description: s.description, rules: JSON.stringify(s.rules), contact_count: null, created_at: daysAgo(40), updated_at: t }).execute();
  }

  // Forms.
  await db.insertInto("subscribe_forms").values([
    { id: ulid(), tenant_id: tenantId, name: "Newsletter signup", slug: "northwind-newsletter", list_id: lists[0].id, headline: "Get the Northwind newsletter", description: "One short email a month. Unsubscribe any time.", button_label: "Subscribe", success_message: "Thanks, check your inbox to confirm.", collect_name: true, submissions: 214, active: true, created_at: daysAgo(60), updated_at: t },
    { id: ulid(), tenant_id: tenantId, name: "Webinar waitlist", slug: "northwind-webinar", list_id: lists[3].id, headline: "Join the next live session", description: "We will email you the date.", button_label: "Save my seat", success_message: "You are on the list.", collect_name: false, submissions: 87, active: true, created_at: daysAgo(30), updated_at: t },
  ]).execute();

  await db.insertInto("templates").values({ id: ulid(), tenant_id: tenantId, name: "Monthly newsletter", subject: "The monthly newsletter", preheader: "A short update from the team.", html: BODY(["https://example.com/blog/one", "https://example.com/pricing", "https://example.com/docs"]), text_body: null, is_starter: false, created_at: daysAgo(60), updated_at: daysAgo(60) }).execute();
  await seedCampaigns(tenantId, helloId, newsId, lists, segIds, contacts);

  // Suppressions: hard bounces and complaints from the contact statuses, plus a few others.
  const sup: Array<Record<string, unknown>> = [];
  for (const c of contacts) {
    if (c.status === "BOUNCED") sup.push({ id: ulid(), tenant_id: tenantId, email: c.email, reason: "HARD_BOUNCE", category_scope: null, note: "550 5.1.1 mailbox does not exist", created_at: daysAgo(10), updated_at: daysAgo(10) });
    else if (c.status === "COMPLAINED") sup.push({ id: ulid(), tenant_id: tenantId, email: c.email, reason: "COMPLAINT", category_scope: null, note: null, created_at: daysAgo(8), updated_at: daysAgo(8) });
    else if (c.status === "UNSUBSCRIBED") sup.push({ id: ulid(), tenant_id: tenantId, email: c.email, reason: "UNSUBSCRIBE", category_scope: "MARKETING", note: null, created_at: daysAgo(12), updated_at: daysAgo(12) });
  }
  sup.push({ id: ulid(), tenant_id: tenantId, email: "legal-hold@example.com", reason: "ADMIN_BLOCK", category_scope: null, note: "Asked not to be contacted", created_at: daysAgo(20), updated_at: daysAgo(20) });
  sup.push({ id: ulid(), tenant_id: tenantId, email: "old-list-entry@example.com", reason: "IMPORTED", category_scope: null, note: "From the previous provider's suppression list", created_at: daysAgo(55), updated_at: daysAgo(55) });
  for (const c of chunks(sup, 300)) await db.insertInto("email_suppressions").values(c as never).execute();

  // Reputation history: one WARNING episode that recovered.
  await db.insertInto("email_reputation_events").values([
    { id: ulid(), tenant_id: tenantId, from_status: "ACTIVE", to_status: "WARNING", trigger: "bounce", reason: "sends=480 bounceRate=3.40% complaintRate=0.000%", rates_snapshot: JSON.stringify({ sends: 480, bounceRate: 0.034 }), created_at: daysAgo(34) },
    { id: ulid(), tenant_id: tenantId, from_status: "WARNING", to_status: "ACTIVE", trigger: "recovery", reason: "sends=900 bounceRate=1.20% complaintRate=0.000%", rates_snapshot: JSON.stringify({ sends: 900, bounceRate: 0.012 }), created_at: daysAgo(31) },
  ]).execute();

  // Segment counts and per-contact counters from the generated events.
  for (const id of segIds) {
    const { rows: seg } = await sql<{ rules: unknown }>`SELECT rules FROM segments WHERE id = ${id}`.execute(db);
    const count = await segmentsService.countMatching(tenantId, seg[0].rules as never);
    await db.updateTable("segments").set({ contact_count: count }).where("id", "=", id).execute();
  }
  await sql`
    UPDATE contacts c SET
      emails_received = COALESCE((SELECT count(*) FROM email_events e WHERE e.contact_id = c.id AND e.type = 'DELIVERY'), 0),
      last_opened_at = (SELECT max(occurred_at) FROM email_events e WHERE e.contact_id = c.id AND e.type = 'OPEN' AND NOT e.machine),
      last_clicked_at = (SELECT max(occurred_at) FROM email_events e WHERE e.contact_id = c.id AND e.type = 'CLICK' AND NOT e.machine)
    WHERE c.tenant_id = ${tenantId}`.execute(db);
  await sql`
    INSERT INTO tenant_usage_monthly (tenant_id, month, emails_sent, updated_at)
    SELECT ${tenantId}, date_trunc('month', timezone('utc', now()))::date, count(*), now() FROM email_messages
    WHERE tenant_id = ${tenantId} AND sent_at >= date_trunc('month', timezone('utc', now()))
    ON CONFLICT (tenant_id, month) DO UPDATE SET emails_sent = EXCLUDED.emails_sent`.execute(db);
  console.log("[seed] Northwind Mail ready");
}

const BODY = (links: string[]) =>
  `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#18181b;"><h1 style="font-size:22px;">{{first_name | default: "Hello"}}, here is this edition</h1><p>Three short stories from the Northwind team.</p>${links.map((l, i) => `<p><a href="${l}">Story ${i + 1}</a></p>`).join("")}</body></html>`;

async function seedCampaigns(tenantId: string, helloId: string, newsId: string, lists: Array<{ id: string }>, segIds: string[], contacts: Array<{ id: string; email: string; status: string }>) {
  const t = new Date();
  const mailable = contacts.filter((c) => c.status === "SUBSCRIBED");
  const defs = [
    { name: "Spring product update", subject: "What shipped this spring", daysAgo: 58, size: 380 },
    { name: "March newsletter", subject: "The March newsletter", daysAgo: 46, size: 420 },
    { name: "Customer survey", subject: "Two minutes of your time?", daysAgo: 35, size: 300 },
    { name: "Webinar replay", subject: "The replay is ready", daysAgo: 24, size: 350 },
    { name: "May newsletter", subject: "The May newsletter", daysAgo: 12, size: 440 },
    { name: "Summer sale", subject: "Summer pricing starts today", daysAgo: 5, size: 460 },
  ];
  const messages: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const recipients: Array<Record<string, unknown>> = [];
  const linksRows: Array<Record<string, unknown>> = [];

  for (const [ci, d] of defs.entries()) {
    const id = ulid(daysAgo(d.daysAgo).getTime());
    const urls = ["https://example.com/blog/one", "https://example.com/pricing", "https://example.com/docs"];
    const started = daysAgo(d.daysAgo);
    await db.insertInto("campaigns").values({ id, tenant_id: tenantId, name: d.name, status: "SENT", subject: d.subject, preheader: "A short update from the team.", html: BODY(urls), sender_identity_id: ci % 2 ? newsId : helloId, audience: JSON.stringify(ci === 2 ? { type: "SEGMENT", segmentId: segIds[1] } : { type: "LISTS", listIds: [lists[0].id, lists[1].id] }), started_at: started, completed_at: new Date(started.getTime() + 20 * 60000), created_by: null, created_at: new Date(started.getTime() - DAY), updated_at: started }).execute();
    const tokens = urls.map((u, i) => ({ id: ulid(), tenant_id: tenantId, campaign_id: id, url: u, token: `seedtoken${ci}${i}`, created_at: started }));
    linksRows.push(...tokens);
    const subset = mailable.slice(0, d.size);
    for (const [ri, c] of subset.entries()) {
      const sentAt = new Date(started.getTime() + (ri % 1200) * 1000);
      const mid = ulid(sentAt.getTime());
      const r = rnd();
      const hard = r < 0.012, soft = !hard && r < 0.02, complaint = ci === 1 && ri === 7;
      const delivered = !hard;
      const opened = delivered && rnd() < 0.42;
      const machine = opened && rnd() < 0.22;
      const clicked = opened && !machine && rnd() < 0.16;
      const status = hard ? "BOUNCED" : complaint ? "COMPLAINED" : "DELIVERED";
      const opens = opened ? 1 + (rnd() < 0.3 ? 1 : 0) : 0;
      messages.push({ id: mid, tenant_id: tenantId, category: "MARKETING", sending_domain_id: null, sender_identity_id: ci % 2 ? newsId : helloId, campaign_id: id, contact_id: c.id, from_address: ci % 2 ? "news@mail.northwind.example" : "hello@mail.northwind.example", to_address: c.email, subject: d.subject, ses_message_id: `sim_${mid}`, status, simulated: true, idempotency_key: `campaign:${id}:${c.id}`, open_count: opens, click_count: clicked ? 1 : 0, bounce_type: hard ? "Permanent" : soft ? "Transient" : null, bounce_reason: hard ? "550 5.1.1 mailbox does not exist" : soft ? "452 4.2.2 mailbox full" : null, sent_at: sentAt, delivered_at: delivered ? new Date(sentAt.getTime() + 2000) : null, bounced_at: hard || soft ? new Date(sentAt.getTime() + 3000) : null, complained_at: complaint ? new Date(sentAt.getTime() + 3 * 3600000) : null, opened_at: opened ? new Date(sentAt.getTime() + (machine ? 1500 : 900000 + rnd() * 20 * 3600000)) : null, clicked_at: clicked ? new Date(sentAt.getTime() + 1200000 + rnd() * 10 * 3600000) : null, created_at: sentAt, updated_at: sentAt });
      const ev = (type: string, at: Date, extra: Record<string, unknown> = {}) => events.push({ id: ulid(at.getTime()), tenant_id: tenantId, message_id: mid, campaign_id: id, contact_id: c.id, type, occurred_at: at, machine: false, ...extra });
      ev("SEND", sentAt);
      if (delivered) ev("DELIVERY", new Date(sentAt.getTime() + 2000));
      if (hard) ev("BOUNCE", new Date(sentAt.getTime() + 3000), { detail: "Permanent: 550 5.1.1 mailbox does not exist" });
      if (soft) ev("BOUNCE", new Date(sentAt.getTime() + 3000), { detail: "Transient: 452 4.2.2 mailbox full" });
      if (complaint) ev("COMPLAINT", new Date(sentAt.getTime() + 3 * 3600000), { detail: "abuse" });
      for (let k = 0; k < opens; k++) ev("OPEN", new Date(sentAt.getTime() + (machine ? 1500 : 900000 + rnd() * 20 * 3600000)), { machine, ua_class: machine ? "apple-mpp" : "browser" });
      if (clicked) ev("CLICK", new Date(sentAt.getTime() + 1200000 + rnd() * 10 * 3600000), { url: pick(urls), ua_class: "browser" });
      if (rnd() < 0.004 && delivered) ev("UNSUBSCRIBE", new Date(sentAt.getTime() + 5 * 3600000), { detail: "page" });
      recipients.push({ id: ulid(sentAt.getTime()), tenant_id: tenantId, campaign_id: id, contact_id: c.id, email: c.email, status, message_id: mid, created_at: started, updated_at: sentAt });
    }
  }

  // One scheduled, one draft, one paused.
  const sched = ulid();
  await db.insertInto("campaigns").values({ id: sched, tenant_id: tenantId, name: "Autumn announcement", status: "SCHEDULED", subject: "Something new is coming", preheader: "Save the date.", html: BODY(["https://example.com/autumn"]), sender_identity_id: helloId, audience: JSON.stringify({ type: "LISTS", listIds: [lists[0].id] }), scheduled_at: new Date(Date.now() + 3 * DAY), created_at: daysAgo(1), updated_at: t }).execute();
  await db.insertInto("campaigns").values({ id: ulid(), tenant_id: tenantId, name: "Holiday draft", status: "DRAFT", subject: "", preheader: "", html: "", sender_identity_id: null, audience: JSON.stringify({ type: "ALL" }), created_at: daysAgo(2), updated_at: t }).execute();
  const paused = ulid();
  const pStart = daysAgo(1);
  await db.insertInto("campaigns").values({ id: paused, tenant_id: tenantId, name: "Customer stories", status: "PAUSED", subject: "Customers tell us how it went", preheader: "Real stories.", html: BODY(["https://example.com/stories"]), sender_identity_id: helloId, audience: JSON.stringify({ type: "LISTS", listIds: [lists[1].id] }), started_at: pStart, paused_reason: "Paused by a user", created_at: daysAgo(2), updated_at: pStart }).execute();
  for (const [ri, c] of mailable.slice(0, 120).entries()) {
    recipients.push({ id: ulid(pStart.getTime() + ri), tenant_id: tenantId, campaign_id: paused, contact_id: c.id, email: c.email, status: ri < 45 ? "DELIVERED" : "QUEUED", message_id: null, created_at: pStart, updated_at: pStart });
  }

  await db.insertInto("campaign_links").values(linksRows as never).execute();
  for (const c of chunks(messages, 300)) await db.insertInto("email_messages").values(c as never).execute();
  for (const c of chunks(events, 400)) await db.insertInto("email_events").values(c as never).onConflict((oc) => oc.doNothing()).execute();
  for (const c of chunks(recipients, 400)) await db.insertInto("campaign_recipients").values(c as never).execute();
}

async function seedAcme() {
  const tenantId = await createTenant({ slug: "acme-robotics", name: "Acme Robotics", plan: "STARTER", timezone: "America/Chicago", address: "500 Sample Avenue, Metropolis, EX 00001", color: "#16a34a", status: "PAUSED" });
  await addUser(tenantId, "Sam Whitfield", "sam@acme-robotics.example", "ADMIN");
  const t = new Date();
  const records = computeDnsRecords("mail.acme-robotics.example", ["simk2d8f1a9s", "simq7w3e5r1t", "simz4x6c9v2b"], "us-east-1", "track.mail-engine.example");
  await db.insertInto("email_sending_domains").values({ id: ulid(), tenant_id: tenantId, subdomain: "mail.acme-robotics.example", mail_from_subdomain: "bounce.mail.acme-robotics.example", ses_configuration_set: `email-tenant-${tenantId}`, status: "PENDING", dkim_status: "PENDING", mail_from_status: "PENDING", dns_records: JSON.stringify(records), tracking_domain: "track.mail.acme-robotics.example", tracking_status: "PENDING", created_at: daysAgo(1), updated_at: t }).execute();
  const rows = Array.from({ length: 12 }, (_, i) => {
    const first = FIRST[i];
    return { id: ulid(), tenant_id: tenantId, email: `${first}.${LAST[i]}@example.com`.toLowerCase(), first_name: first, last_name: LAST[i], status: "SUBSCRIBED", source: "IMPORT", tags: ["beta"], attributes: "{}", emails_received: 0, consent_at: daysAgo(3), created_at: daysAgo(3), updated_at: daysAgo(3) };
  });
  await db.insertInto("contacts").values(rows as never).execute();
  await db.insertInto("email_reputation_events").values({ id: ulid(), tenant_id: tenantId, from_status: "ACTIVE", to_status: "PAUSED", trigger: "operator_hold", reason: "Held for review while the sending domain is set up", rates_snapshot: null, created_at: daysAgo(2) }).execute();
  console.log("[seed] Acme Robotics ready (sending held, DNS pending)");
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("The demo seed refuses to run in production. Use bootstrap-operator instead.");
  const force = process.argv.includes("--force");
  const existing = await db.selectFrom("tenants").select("id").limit(1).executeTakeFirst();
  const op = await db.selectFrom("operator_users").select("id").limit(1).executeTakeFirst();
  if ((existing || op) && !force) {
    console.log("[seed] data already present; pass --force to wipe and reseed");
    return;
  }
  if (force) await wipe();
  await seedPlansAndOperator();
  await seedNorthwind();
  await seedAcme();
  console.log("[seed] done. Operator: operator@example.com, workspaces: maya@northwind.example, sam@acme-robotics.example");
}

main()
  .catch((err) => {
    console.error("[seed] FAILED:", err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => closeDB());
