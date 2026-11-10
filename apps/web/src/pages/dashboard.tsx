import { useQuery } from "@tanstack/react-query";
import type { TenantDashboard } from "@open-email/types";
import { ArrowRight, Check, Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { LineChart } from "@/components/charts/LineChart";
import { Section } from "@/components/common/Section";
import { SendingStatusText } from "@/components/common/status";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDashboard } from "@/lib/api/dashboard";
import { formatDate, formatNumber } from "@/lib/format";
import { formatRate, ratio } from "@/lib/report";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

type StepKey = TenantDashboard["checklist"][number]["key"];

const STEPS: Record<StepKey, { title: string; body: string; to: string; cta: string }> = {
  domain: {
    title: "Add and verify a sending domain",
    body: "Mail goes out from a domain you own. Add a subdomain such as mail.yourcompany.example, publish the DNS records we show you, and check them.",
    to: "/domains?new=1",
    cta: "Add a domain",
  },
  sender: {
    title: "Create a sender",
    body: "A sender is the From address people see, for example hello@mail.yourcompany.example. It must belong to a verified domain.",
    to: "/senders?new=1",
    cta: "Create a sender",
  },
  contacts: {
    title: "Bring in your contacts",
    body: "Import a CSV, add people one by one, or put a subscribe form on your site. Only email people who agreed to hear from you.",
    to: "/import",
    cta: "Import contacts",
  },
  template: {
    title: "Pick or design a template",
    body: "Start from one of the starter templates and change the words, or paste your own HTML. Merge tags personalise each message.",
    to: "/templates",
    cta: "Browse templates",
  },
  campaign: {
    title: "Send your first campaign",
    body: "Choose the sender, the audience and the content, check the preflight, then send now or schedule it.",
    to: "/campaigns/new",
    cta: "New campaign",
  },
};

function Checklist({ items }: { items: TenantDashboard["checklist"] }) {
  const done = items.filter((i) => i.done).length;
  const nextIdx = items.findIndex((i) => !i.done);
  return (
    <section aria-labelledby="setup-h" className="border-t pt-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup-h" className="font-display text-base font-semibold tracking-tight">
          Get set up to send
        </h2>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {done} of {items.length} done
        </p>
      </div>
      <ol className="divide-y border-y">
        {items.map((item, i) => {
          const s = STEPS[item.key];
          const isNext = i === nextIdx;
          return (
            <li key={item.key} className="flex gap-4 py-4">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                  item.done ? "border-success bg-success text-white dark:text-background" : isNext ? "border-brand text-brand" : "border-input text-muted-foreground",
                )}
              >
                {item.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className={cn("text-sm font-semibold", item.done && "text-muted-foreground")}>
                  {s.title}
                  {item.done ? <span className="sr-only"> (done)</span> : null}
                </h3>
                {!item.done ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{s.body}</p> : null}
              </div>
              {!item.done ? (
                <div className="shrink-0 self-center">
                  <Button asChild size="sm" variant={isNext ? "default" : "outline"}>
                    <Link to={s.to}>
                      {s.cta} <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["dashboard"], queryFn: getDashboard });

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <p role="alert" className="text-sm text-danger">
          {(error as Error).message}
        </p>
      </div>
    );
  }

  const totals = (data?.daily ?? []).reduce(
    (a, d) => ({ sent: a.sent + d.sent, delivered: a.delivered + d.delivered, opened: a.opened + d.opened, clicked: a.clicked + d.clicked, bounced: a.bounced + d.bounced }),
    { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 },
  );
  const allDone = data ? data.checklist.every((c) => c.done) : false;
  const labels = (data?.daily ?? []).map((d) => formatDate(d.date, { day: "numeric", month: "short" }));

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Hello, ${user?.name.split(" ")[0] ?? "there"}`}
        description="Sending, audience and deliverability for the last 30 days."
        actions={
          <Button asChild>
            <Link to="/campaigns/new">
              <Plus aria-hidden /> New campaign
            </Link>
          </Button>
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {!allDone ? <Checklist items={data.checklist} /> : null}

          {data.reputation.status !== "ACTIVE" ? (
            <p className="flex flex-wrap items-center gap-2 border-y py-3 text-sm" role="status">
              <SendingStatusText status={data.reputation.status} />
              <span className="text-muted-foreground">
                {data.reputation.status === "PAUSED" ? "Marketing sends are blocked until your bounce and complaint rates recover." : "Your bounce or complaint rate is higher than it should be."}
              </span>
              <Link to="/reputation" className="font-medium text-brand hover:underline">
                See reputation
              </Link>
            </p>
          ) : null}

          <section aria-label="Last 30 days" className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
            <StatCard label="Sent" value={formatNumber(totals.sent)} hint="last 30 days" />
            <StatCard label="Delivered" value={formatRate(ratio(totals.delivered, totals.sent))} hint={`${formatNumber(totals.delivered)} messages`} />
            <StatCard label="Opened" value={formatRate(ratio(totals.opened, totals.delivered))} hint="includes machine opens" />
            <StatCard label="Clicked" value={formatRate(ratio(totals.clicked, totals.delivered))} hint={`${formatNumber(totals.clicked)} clicks`} />
          </section>

          <Section title="Activity" description="Messages sent, delivered, opened and clicked, day by day.">
            {totals.sent === 0 && !allDone ? (
              <p className="text-sm text-muted-foreground">Nothing has been sent yet. Your first campaign will show up here.</p>
            ) : (
              <LineChart
                title="Daily sent, delivered, opened and clicked messages for the last 30 days"
                labels={labels}
                series={[
                  { name: "Sent", values: data.daily.map((d) => d.sent), stroke: "stroke-muted-foreground", dash: "4 3" },
                  { name: "Delivered", values: data.daily.map((d) => d.delivered), stroke: "stroke-info" },
                  { name: "Opened", values: data.daily.map((d) => d.opened), stroke: "stroke-brand" },
                  { name: "Clicked", values: data.daily.map((d) => d.clicked), stroke: "stroke-success" },
                ]}
              />
            )}
          </Section>

          <div className="grid gap-10 lg:grid-cols-2">
            <Section title="Usage this month" description={`Resets ${formatDate(data.usage.resetsAt)}`}>
              <dl className="divide-y border-y text-sm">
                {(
                  [
                    ["Emails", data.usage.emails],
                    ["Contacts", data.usage.contacts],
                    ["Sending domains", data.usage.domains],
                  ] as const
                ).map(([label, u]) => (
                  <div key={label} className="flex items-baseline justify-between py-2.5">
                    <dt>{label}</dt>
                    <dd className="tabular-nums text-muted-foreground">
                      {formatNumber(u.used)} of {u.limit === null ? "unlimited" : formatNumber(u.limit)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
            <Section title="Audience" actions={<Link to="/contacts" className="text-sm font-medium text-brand hover:underline">View contacts</Link>}>
              <dl className="divide-y border-y text-sm">
                {(
                  [
                    ["Subscribed", data.audience.subscribed],
                    ["Unsubscribed", data.audience.unsubscribed],
                    ["Bounced", data.audience.bounced],
                    ["New this week", data.audience.newThisWeek],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label} className="flex items-baseline justify-between py-2.5">
                    <dt>{label}</dt>
                    <dd className="tabular-nums text-muted-foreground">{formatNumber(n)}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          </div>

          {data.topCampaigns.length > 0 ? (
            <Section title="Top campaigns" description="By open rate. Opens include machine opens, so read them as a trend.">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Opens</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topCampaigns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link to={`/campaigns/${c.id}`} className="font-medium hover:text-brand hover:underline">
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(c.sentAt)}</TableCell>
                      <TableCell className="text-right">{formatNumber(c.delivered)}</TableCell>
                      <TableCell className="text-right">{formatRate(c.openRate)}</TableCell>
                      <TableCell className="text-right">{formatRate(c.clickRate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}
