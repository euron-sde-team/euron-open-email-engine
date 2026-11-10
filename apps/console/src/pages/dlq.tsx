import { useQuery } from "@tanstack/react-query";
import { Inbox, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getDlq } from "@/lib/api/email";
import { formatDateTime, timeAgo } from "@/lib/format";
import { formatAge, formatCount } from "@/lib/fleet";
import { cn } from "@/lib/utils";

export default function DlqPage() {
  const query = useQuery({ queryKey: ["dlq"], queryFn: getDlq });
  const dlq = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dead-letter queue"
        description="SES events the consumer gave up on after its retries. Read only: fix the cause, the queue's own retention then drops them."
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

      {query.isError ? (
        <p role="alert" className="py-8 text-sm text-destructive">
          Could not load the queue. {query.error instanceof Error ? query.error.message : ""}
        </p>
      ) : dlq && !dlq.configured ? (
        <EmptyState
          icon={Inbox}
          title="No dead-letter queue is configured"
          description="Set the queue URL in the API environment to monitor it here. Simulated mode has none."
        />
      ) : (
        <>
          <section aria-label="Queue state" className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
            <StatCard
              label="Messages waiting"
              value={formatCount(dlq?.depth)}
              loading={query.isLoading}
              hint={
                dlq ? (
                  <span className={cn("inline-flex items-center gap-1.5", dlq.depth > 0 ? "text-warning" : "text-success")}>
                    <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    {dlq.depth > 0 ? "Needs a look" : "Empty"}
                  </span>
                ) : null
              }
              className="reveal"
            />
            <StatCard
              label="Oldest message"
              value={formatAge(dlq?.oldestAgeSeconds)}
              loading={query.isLoading}
              className="reveal"
              style={{ animationDelay: "45ms" }}
            />
          </section>

          <section aria-labelledby="dlq-sample-title" className="reveal" style={{ animationDelay: "90ms" }}>
            <h2 id="dlq-sample-title" className="mb-3 font-display text-[15px] font-semibold tracking-tight">
              Sample
              {dlq ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  up to 10 messages, bodies cut to 500 characters
                </span>
              ) : null}
            </h2>
            {query.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : !dlq || dlq.sample.length === 0 ? (
              <p className="border-t py-6 text-sm text-muted-foreground">Nothing in the queue.</p>
            ) : (
              <ul className="divide-y border-y">
                {dlq.sample.map((m) => (
                  <li key={m.id} className="py-3">
                    <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                      <span className="font-mono">{m.id}</span>
                      <span title={formatDateTime(m.receivedAt)}>received {timeAgo(m.receivedAt)}</span>
                    </p>
                    {/* Focusable so keyboard users can scroll a long body. */}
                    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                    <pre tabIndex={0}
                      role="region"
                      aria-label={`Body of message ${m.id}`}
                      className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all border-l pl-3 font-mono text-xs leading-relaxed text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {m.body}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
