import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import * as React from "react";

import { Meter } from "@/components/fleet/Meter";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAccountHealth } from "@/lib/api/email";
import { formatDateTime, timeAgo } from "@/lib/format";
import { RATE_TEXT, formatCount, formatRate, rateTone } from "@/lib/fleet";
import { cn } from "@/lib/utils";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3.5 sm:grid-cols-[14rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function Dot({ tone, children }: { tone: "success" | "warning" | "destructive"; children: React.ReactNode }) {
  const color = { success: "text-success", warning: "text-warning", destructive: "text-destructive" }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5", color)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export default function AccountHealthPage() {
  const query = useQuery({ queryKey: ["account-health"], queryFn: getAccountHealth });
  const health = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account health"
        description="What Amazon SES reports for the whole deployment. Tenants share this account's quota and reputation."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={cn("size-3.5", query.isFetching && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        }
      />

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : query.isError ? (
        <p role="alert" className="py-8 text-sm text-destructive">
          Could not load account health. {query.error instanceof Error ? query.error.message : ""}
        </p>
      ) : health ? (
        <div className="reveal space-y-6">
          {health.mode === "simulated" ? (
            <p className="border-l-2 border-warning pl-3 text-sm text-muted-foreground">
              The provider is simulated: nothing here comes from AWS and no real mail is sent. Set the
              provider mode to aws to read the live account.
            </p>
          ) : null}

          <dl className="divide-y border-y">
            <Row label="Provider mode">{health.mode === "aws" ? "Amazon SES" : "Simulated"}</Row>
            <Row label="Sending">
              {health.sendingEnabled ? (
                <Dot tone="success">Enabled</Dot>
              ) : (
                <Dot tone="destructive">Disabled by SES</Dot>
              )}
            </Row>
            <Row label="Sandbox">
              {health.sandbox ? (
                <Dot tone="warning">In the sandbox: only verified recipients can receive mail</Dot>
              ) : (
                <Dot tone="success">Production access</Dot>
              )}
            </Row>
            <Row label="Send rate">{formatCount(health.quota.maxPerSecond)} messages per second at most</Row>
            <Row label="Bounce rate, 14 days">
              <span className={RATE_TEXT[rateTone("bounce", health.bounceRate)]}>{formatRate(health.bounceRate)}</span>
            </Row>
            <Row label="Complaint rate, 14 days">
              <span className={RATE_TEXT[rateTone("complaint", health.complaintRate)]}>
                {formatRate(health.complaintRate)}
              </span>
            </Row>
            <Row label="Checked">
              <span title={formatDateTime(health.checkedAt)}>{timeAgo(health.checkedAt)}</span>
            </Row>
          </dl>

          <section aria-labelledby="quota-title" className="max-w-xl">
            <h2 id="quota-title" className="mb-3 font-display text-[15px] font-semibold tracking-tight">
              Daily sending quota
            </h2>
            <Meter
              label="Sent in the last 24 hours"
              used={health.quota.sentLast24Hours}
              limit={health.quota.max24Hour}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
