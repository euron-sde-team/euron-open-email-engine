import type { Kysely, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB } from "../db/types";

// Eight starter templates, copied into every workspace when it is created. Plain, inline
// styled, one column, 600px: they render the same in every mail client. Merge tags use
// defaults so a missing first name never leaves a hole. All addresses are example.com.

const shell = (inner: string): string => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;padding:32px;border-radius:4px;">
${inner}
</div>
</body></html>`;

const button = (label: string, href: string): string =>
  `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:bold;">${label}</a></p>`;

const h1 = (t: string): string => `<h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;">${t}</h1>`;
const p = (t: string): string => `<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">${t}</p>`;

export interface StarterTemplate {
  name: string;
  subject: string;
  preheader: string;
  html: string;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: "Newsletter",
    subject: "{{first_name | default: \"Hello\"}}, your monthly update",
    preheader: "Three things worth your time this month.",
    html: shell(
      h1("This month at {{company_name | default: \"our team\"}}") +
        p("Hi {{first_name | default: \"there\"}}, here is what we have been working on.") +
        `<h2 style="font-size:18px;margin:24px 0 8px;">1. A headline story</h2>` +
        p("Write two or three sentences about your most important news. Keep it specific and useful.") +
        `<h2 style="font-size:18px;margin:24px 0 8px;">2. Something we learned</h2>` +
        p("Share a lesson, a number or a short customer story that readers can act on.") +
        `<h2 style="font-size:18px;margin:24px 0 8px;">3. What is next</h2>` +
        p("Tell readers what to expect next month and how to reach you.") +
        button("Read more", "https://example.com/news")
    ),
  },
  {
    name: "Announcement",
    subject: "Big news from {{company_name | default: \"us\"}}",
    preheader: "We have something to share.",
    html: shell(
      h1("We have an announcement") +
        p("Hi {{first_name | default: \"there\"}},") +
        p("Today we are announcing a change that matters to you. Explain what is changing, why, and what it means for the reader in plain words.") +
        p("If you have questions, just reply to this email.") +
        button("See the details", "https://example.com/announcement")
    ),
  },
  {
    name: "Product launch",
    subject: "Introducing our newest product",
    preheader: "It is here, and you are among the first to know.",
    html: shell(
      h1("Meet the new arrival") +
        p("Hi {{first_name | default: \"there\"}}, after months of work it is ready.") +
        `<ul style="font-size:16px;line-height:1.7;padding-left:20px;margin:0 0 16px;"><li>The first thing it does better</li><li>The second thing it does better</li><li>The third thing it does better</li></ul>` +
        button("Take a look", "https://example.com/launch") +
        p("Early subscribers get a thank-you offer at launch. Watch your inbox.")
    ),
  },
  {
    name: "Promotion",
    subject: "{{first_name | default: \"A little something\"}}, save 20% this week",
    preheader: "Use the code below before it ends.",
    html: shell(
      h1("20% off, this week only") +
        p("Hi {{first_name | default: \"there\"}}, as a thank-you we are taking 20% off your next order.") +
        `<p style="font-size:22px;letter-spacing:2px;text-align:center;border:1px dashed #a1a1aa;padding:14px;margin:20px 0;"><strong>THANKS20</strong></p>` +
        button("Shop now", "https://example.com/shop") +
        p("The offer ends Sunday at midnight. Terms apply.")
    ),
  },
  {
    name: "Event invitation",
    subject: "You are invited: our live session",
    preheader: "Save your seat.",
    html: shell(
      h1("Join us live") +
        p("Hi {{first_name | default: \"there\"}}, we would love to see you at our upcoming session.") +
        `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;"><strong>When:</strong> add the date and time<br><strong>Where:</strong> online, link sent after you register<br><strong>Length:</strong> 45 minutes</p>` +
        button("Reserve my seat", "https://example.com/events") +
        p("Cannot make it? Register anyway and we will send the recording.")
    ),
  },
  {
    name: "Welcome",
    subject: "Welcome, {{first_name | default: \"friend\"}}",
    preheader: "Here is how to get started.",
    html: shell(
      h1("Welcome aboard") +
        p("Hi {{first_name | default: \"there\"}}, thanks for joining {{company_name | default: \"us\"}}.") +
        p("Here is what to expect: a short note every few weeks with things we think are worth your time. No filler.") +
        button("Start here", "https://example.com/start") +
        p("Reply to this email any time. A real person reads it.")
    ),
  },
  {
    name: "Re-engagement",
    subject: "{{first_name | default: \"Hello\"}}, still interested?",
    preheader: "We miss you. Stay, or leave with one click.",
    html: shell(
      h1("It has been a while") +
        p("Hi {{first_name | default: \"there\"}}, we noticed you have not opened our emails lately.") +
        p("If you still want to hear from us, there is nothing to do. If not, no hard feelings: you can unsubscribe at the bottom of this message.") +
        button("Yes, keep me subscribed", "https://example.com/stay")
    ),
  },
  {
    name: "Plain letter",
    subject: "A quick note",
    preheader: "",
    html: `<!DOCTYPE html><html lang="en"><body style="margin:0;padding:24px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:#18181b;"><div style="max-width:560px;">
<p>Hi {{first_name | default: "there"}},</p>
<p>I wanted to write to you directly. Say what you came to say in a few short paragraphs, the way you would write to one person.</p>
<p>If it is useful, reply and tell me. I read every answer.</p>
<p>Thanks,<br>{{company_name | default: "The team"}}</p>
</div></body></html>`,
  },
];

/** Adds the starter templates a workspace does not have yet. Idempotent. */
export async function ensureStarterTemplates(
  tenantId: string,
  conn: Kysely<DB> | Transaction<DB> = db
): Promise<number> {
  const have = new Set(
    (await conn.selectFrom("templates").select("name").where("tenant_id", "=", tenantId).where("is_starter", "=", true).execute()).map((r) => r.name)
  );
  const now = new Date();
  const missing = STARTER_TEMPLATES.filter((t) => !have.has(t.name));
  if (!missing.length) return 0;
  await conn
    .insertInto("templates")
    .values(
      missing.map((t) => ({
        id: ulid(),
        tenant_id: tenantId,
        name: t.name,
        subject: t.subject,
        preheader: t.preheader,
        html: t.html,
        text_body: null,
        is_starter: true,
        created_at: now,
        updated_at: now,
      }))
    )
    .execute();
  return missing.length;
}
