import { useQuery } from "@tanstack/react-query";
import type { ReputationSummary } from "@open-email/types";

import { Section } from "@/components/common/Section";
import { SendingStatusText } from "@/components/common/status";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getReputation } from "@/lib/api/monitoring";
import { formatDateTime, formatNumber } from "@/lib/format";
import { formatRate } from "@/lib/report";

/** A rate on a track with tick marks for the warn, throttle and pause thresholds. */
function Meter({ label, value, warn, throttle, pause }: { label: string; value: number; warn: number; throttle: number; pause: number }) {
  const max = pause * 1.25;
  const x = (v: number) => Math.min(100, (v / max) * 100);
  const tone = value >= pause ? "fill-danger" : value >= throttle || value >= warn ? "fill-warning" : "fill-success";
  const state = value >= pause ? "paused level" : value >= throttle ? "throttle level" : value >= warn ? "warning level" : "healthy";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          {formatRate(value)} <span className="text-muted-foreground">({state})</span>
        </span>
      </div>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label={`${label} ${formatRate(value)}. Warning at ${formatRate(warn)}, throttle at ${formatRate(throttle)}, pause at ${formatRate(pause)}.`} className="h-3 w-full">
        <rect width="100" height="10" className="fill-muted" />
        <rect width={x(value)} height="10" className={tone} />
        {[warn, throttle, pause].map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1="0" y2="10" strokeWidth="0.6" className="stroke-foreground" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <p className="text-xs text-muted-foreground">
        Warning {formatRate(warn)}, throttled {formatRate(throttle)}, paused {formatRate(pause)}
      </p>
    </div>
  );
}

function History({ rows }: { rows: ReputationSummary["history"] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No status changes. Your sending has been healthy.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Change</TableHead>
          <TableHead>Cause</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((h, i) => (
          <TableRow key={`${h.at}-${i}`}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(h.at)}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-2">
                <SendingStatusText status={h.from} /> <span aria-label="to">to</span> <SendingStatusText status={h.to} />
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{h.reason || h.trigger}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ReputationPage() {
  const rep = useQuery({ queryKey: ["reputation"], queryFn: getReputation, refetchInterval: 60_000 });
  if (rep.isLoading) return <Skeleton className="h-64 w-full" />;
  if (rep.isError || !rep.data) {
    return (
      <p role="alert" className="text-sm text-danger">
        {(rep.error as Error | null)?.message ?? "Reputation is not available."}
      </p>
    );
  }
  const r = rep.data;
  return (
    <div className="space-y-8">
      <PageHeader title="Reputation" description="Inbox providers judge senders by bounces and spam complaints. If either climbs, we slow down or pause marketing sends to protect your domain." />

      <section aria-label="Current status" className="space-y-1 border-t pt-4">
        <p className="font-display text-2xl font-semibold tracking-tight">
          <SendingStatusText status={r.status} />
        </p>
        {r.note ? <p className="max-w-2xl text-sm text-muted-foreground">{r.note}</p> : <p className="text-sm text-muted-foreground">Everything is flowing normally.</p>}
        <p className="text-sm text-muted-foreground">
          Last 14 days: {formatNumber(r.window.sent)} sent, {formatNumber(r.window.delivered)} delivered.
        </p>
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Bounce rate">
          <div className="space-y-6">
            <Meter label="All bounces" value={r.window.bounceRate} warn={r.thresholds.warnBounce} throttle={r.thresholds.throttleBounce} pause={r.thresholds.pauseBounce} />
            <p className="text-sm text-muted-foreground">
              Permanent bounces (addresses that do not exist): <strong className="text-foreground">{formatRate(r.window.permanentBounceRate)}</strong>. Clean your list if this is high.
            </p>
          </div>
        </Section>
        <Section title="Complaint rate">
          <Meter label="Spam complaints" value={r.window.complaintRate} warn={r.thresholds.warnComplaint} throttle={r.thresholds.throttleComplaint} pause={r.thresholds.pauseComplaint} />
        </Section>
      </div>

      <Section title="Status history">
        <History rows={r.history} />
      </Section>

      <Section title="How to keep a good reputation" headingLevel={2}>
        <ul className="max-w-2xl list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Only email people who asked to hear from you, and use double opt-in on public forms.</li>
          <li>Make unsubscribing easy. A visible link is better than a spam complaint.</li>
          <li>Remove addresses that bounce. The engine does this for you automatically.</li>
          <li>Send regularly rather than rarely in huge bursts.</li>
        </ul>
      </Section>
    </div>
  );
}
