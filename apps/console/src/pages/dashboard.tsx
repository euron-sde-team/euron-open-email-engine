import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { listAudit } from "@/lib/api/audit";
import { getFleet } from "@/lib/api/email";
import { getMetricsOverview } from "@/lib/api/metrics";
import { timeAgo } from "@/lib/format";
import { formatCount, formatRate, needsAttention } from "@/lib/fleet";

function SectionHeading({ title, to, linkLabel }: { title: string; to: string; linkLabel: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
      <Link
        to={to}
        className="inline-flex items-center gap-1 text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {linkLabel}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const metricsQuery = useQuery({ queryKey: ["metrics-overview"], queryFn: getMetricsOverview });
  const fleetQuery = useQuery({ queryKey: ["fleet"], queryFn: getFleet });
  const auditQuery = useQuery({ queryKey: ["audit", "", ""], queryFn: () => listAudit() });

  const metrics = metricsQuery.data;
  const fleet = fleetQuery.data;
  const planDistribution = metrics?.planDistribution ?? [];
  const planTotal = planDistribution.reduce((sum, row) => sum + row.count, 0);
  const attention = needsAttention(fleet?.tenants ?? []);
  const recentAudit = (auditQuery.data ?? []).slice(0, 8);

  const cards = [
    { label: "Tenants", value: formatCount(metrics?.tenants.total), hint: "On this deployment", loading: metricsQuery.isLoading },
    {
      label: "Emails sent this month",
      value: formatCount(metrics?.totals.emailsThisMonth ?? fleet?.totals.sentThisMonth),
      hint: "All tenants, UTC month",
      loading: metricsQuery.isLoading && fleetQuery.isLoading,
    },
    { label: "Contacts", value: formatCount(metrics?.totals.contacts), hint: "Across all tenants", loading: metricsQuery.isLoading },
    { label: "Users", value: formatCount(metrics?.totals.users), hint: "Across all tenants", loading: metricsQuery.isLoading },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Platform overview" description="Totals for the whole deployment and the tenants that need you." />

      <section aria-label="Platform totals" className="grid grid-cols-2 gap-x-6 gap-y-4 xl:grid-cols-4">
        {cards.map((card, index) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            hint={card.hint}
            loading={card.loading}
            className="reveal"
            style={{ animationDelay: `${60 + index * 45}ms` }}
          />
        ))}
      </section>

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-5">
        <section aria-labelledby="attention-title" className="reveal lg:col-span-3" style={{ animationDelay: "240ms" }}>
          <SectionHeading title="Needs attention" to="/fleet" linkLabel="Fleet" />
          <span id="attention-title" className="sr-only">
            Tenants that are not sending normally
          </span>
          {fleetQuery.isLoading ? (
            <Skeleton className="h-24" />
          ) : attention.length === 0 ? (
            <p className="border-t py-6 text-sm text-muted-foreground">Every tenant is sending normally.</p>
          ) : (
            <ul className="divide-y border-y">
              {attention.slice(0, 8).map((row) => (
                <li key={row.tenantId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                  <Link
                    to={`/tenants/${row.tenantId}`}
                    className="text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.name}
                  </Link>
                  <span className="flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
                    <span>bounce {formatRate(row.bounceRate)}</span>
                    <span>complaint {formatRate(row.complaintRate)}</span>
                    <StatusBadge status={row.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="plans-title" className="reveal lg:col-span-2" style={{ animationDelay: "300ms" }}>
          <SectionHeading title="Plan distribution" to="/plans" linkLabel="Plans" />
          <span id="plans-title" className="sr-only">
            Tenants per plan
          </span>
          {metricsQuery.isLoading ? (
            <Skeleton className="h-24" />
          ) : planDistribution.length === 0 ? (
            <p className="border-t py-6 text-sm text-muted-foreground">No tenant is on a plan yet.</p>
          ) : (
            <ul className="divide-y border-y">
              {planDistribution.map((row) => {
                const pct = planTotal > 0 ? (row.count / planTotal) * 100 : 0;
                return (
                  <li key={row.plan_key} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{row.plan_key}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatCount(row.count)} {row.count === 1 ? "tenant" : "tenants"}, {Math.round(pct)}%
                      </span>
                    </div>
                    <div aria-hidden className="mt-2 h-0.5 bg-border">
                      <div className="h-full bg-brand" style={{ width: `${Math.max(pct, 4)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="activity-title" className="reveal" style={{ animationDelay: "360ms" }}>
        <SectionHeading title="Recent operator activity" to="/audit" linkLabel="Full audit" />
        <span id="activity-title" className="sr-only">
          Recent operator activity
        </span>
        {auditQuery.isLoading ? (
          <Skeleton className="h-24" />
        ) : recentAudit.length === 0 ? (
          <p className="border-t py-6 text-sm text-muted-foreground">No operator activity recorded yet.</p>
        ) : (
          <ul className="divide-y border-y">
            {recentAudit.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5">
                <span className="text-sm">{row.summary}</span>
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">{row.action}</span>, {timeAgo(row.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
