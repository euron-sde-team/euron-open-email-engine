import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign, RecipientRow } from "@open-email/types";
import { ArrowLeft, Copy, Pause, Pencil, Play, XCircle, CalendarX } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { FunnelChart } from "@/components/charts/FunnelChart";
import { InlineBar } from "@/components/charts/InlineBar";
import { LineChart } from "@/components/charts/LineChart";
import { LoadMore } from "@/components/common/LoadMore";
import { Section } from "@/components/common/Section";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { CampaignStatusText } from "@/components/common/status";
import { useCursorList } from "@/components/common/useAccumulated";
import { useConfirm } from "@/components/confirm-provider";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelCampaign, duplicateCampaign, getCampaignReport, listRecipients, pauseCampaign, resumeCampaign, unscheduleCampaign } from "@/lib/api/campaigns";
import { formatNumber, timeAgo } from "@/lib/format";
import { formatRate, funnelSteps, machineShare, ratio, summariseTimeline } from "@/lib/report";
import { formatInZone } from "@/lib/schedule";
import { useTenantTimezone } from "@/lib/useTenantTimezone";

const RECIPIENT_STATUS = ["all", "QUEUED", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "SKIPPED", "FAILED"] as const;

function timelineLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "numeric" }).format(d);
}

function Recipients({ campaign }: { campaign: Campaign }) {
  const [status, setStatus] = React.useState<string>("all");
  const list = useCursorList<RecipientRow>(["recipients", campaign.id, status], (cursor) => listRecipients(campaign.id, { status: status === "all" ? "" : status, cursor }));
  return (
    <Section
      title="Recipients"
      description="Everyone the campaign was addressed to, with what happened."
      actions={
        <div className="flex items-center gap-2">
          <label htmlFor="rcp-status" className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <SimpleSelect id="rcp-status" className="w-44" value={status} onChange={setStatus} options={RECIPIENT_STATUS.map((s) => ({ value: s, label: s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase() }))} />
        </div>
      }
    >
      {list.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recipients to show.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((r, i) => (
                <TableRow key={`${r.email}-${i}`}>
                  <TableCell>
                    {r.contactId ? (
                      <Link to={`/contacts/${r.contactId}`} className="hover:text-brand hover:underline">
                        {r.email}
                      </Link>
                    ) : (
                      r.email
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    {r.skipReason ? ` (${r.skipReason})` : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.opens}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.clicks}</TableCell>
                  <TableCell className="text-muted-foreground">{r.lastEventAt ? timeAgo(r.lastEventAt) : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.fetchMore} shown={list.items.length} total={list.total} />
        </>
      )}
    </Section>
  );
}

export default function CampaignReportPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const tz = useTenantTimezone();

  const report = useQuery({
    queryKey: ["campaign-report", id],
    queryFn: () => getCampaignReport(id),
    refetchInterval: (q) => {
      const s = q.state.data?.campaign.status;
      return s === "SENDING" ? 5_000 : s === "SCHEDULED" ? 15_000 : false;
    },
  });

  const act = (fn: (id: string) => Promise<unknown>, ok: string) => ({
    mutationFn: () => fn(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-report", id] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success(ok);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pause = useMutation(act(pauseCampaign, "Campaign paused."));
  const resume = useMutation(act(resumeCampaign, "Campaign resumed."));
  const cancel = useMutation(act(cancelCampaign, "Campaign cancelled."));
  const unschedule = useMutation(act(unscheduleCampaign, "Campaign moved back to drafts."));
  const dup = useMutation({
    mutationFn: () => duplicateCampaign(id),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      navigate(`/campaigns/${c.id}/edit`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = report.data;
  const funnel = React.useMemo(() => (data ? funnelSteps(data.campaign.stats) : []), [data]);

  if (report.isLoading) return <Skeleton className="h-96 w-full" />;
  if (report.isError || !data) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-danger">
          {(report.error as Error | null)?.message ?? "Campaign not found."}
        </p>
        <Link to="/campaigns" className="text-sm font-medium text-brand hover:underline">
          Back to campaigns
        </Link>
      </div>
    );
  }

  const c = data.campaign;
  const tl = summariseTimeline(data.timeline);
  const started = c.status !== "DRAFT" && c.status !== "SCHEDULED";
  const maxLink = Math.max(1, ...data.links.map((l) => l.clicks));
  const maxBounce = Math.max(1, ...data.bounces.map((b) => b.count));
  const machine = machineShare(data);

  return (
    <div className="space-y-8">
      <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All campaigns
      </Link>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <CampaignStatusText status={c.status} />
              {c.status === "SCHEDULED" && c.scheduledAt ? <span>Starts {formatInZone(c.scheduledAt, tz)}</span> : null}
              {c.startedAt ? <span>Started {formatInZone(c.startedAt, tz)}</span> : null}
              {c.completedAt ? <span>Finished {formatInZone(c.completedAt, tz)}</span> : null}
            </span>
            <span>Subject: {c.subject}</span>
            {c.pausedReason ? <span className="text-warning">Paused: {c.pausedReason}</span> : null}
          </span>
        }
        actions={
          <>
            {c.status === "SENDING" ? (
              <Button variant="outline" onClick={() => pause.mutate()} loading={pause.isPending}>
                <Pause aria-hidden /> Pause
              </Button>
            ) : null}
            {c.status === "PAUSED" ? (
              <Button onClick={() => resume.mutate()} loading={resume.isPending}>
                <Play aria-hidden /> Resume
              </Button>
            ) : null}
            {c.status === "SCHEDULED" ? (
              <>
                <Button variant="outline" onClick={() => unschedule.mutate()} loading={unschedule.isPending}>
                  <CalendarX aria-hidden /> Unschedule
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/campaigns/${c.id}/edit`}>
                    <Pencil aria-hidden /> Edit
                  </Link>
                </Button>
              </>
            ) : null}
            {c.status === "SCHEDULED" || c.status === "PAUSED" || c.status === "SENDING" ? (
              <Button
                variant="outline"
                onClick={async () => {
                  if (await confirm({ title: "Cancel this campaign?", description: "Emails already sent stay sent. The rest will not go out.", confirmText: "Cancel campaign", cancelText: "Keep it", destructive: true })) cancel.mutate();
                }}
              >
                <XCircle aria-hidden /> Cancel
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => dup.mutate()} loading={dup.isPending}>
              <Copy aria-hidden /> Duplicate
            </Button>
          </>
        }
      />

      {c.status === "SCHEDULED" && !started ? (
        <p className="border-y py-3 text-sm" role="status">
          This campaign has not started. Results appear here once it does. Unschedule it to edit the content.
        </p>
      ) : (
        <>
          <section aria-label="Results at a glance" className="grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
            <StatCard label="Recipients" value={formatNumber(c.stats.recipients)} hint={c.stats.skipped ? `${formatNumber(c.stats.skipped)} skipped` : undefined} />
            <StatCard label="Delivered" value={formatRate(data.rates.delivery)} hint={`${formatNumber(c.stats.delivered)} messages`} />
            <StatCard label="Opened" value={formatRate(data.rates.open)} hint={`${formatNumber(c.stats.opened)} opens`} />
            <StatCard label="Clicked" value={formatRate(data.rates.click)} hint={`${formatRate(data.rates.clickToOpen)} of openers`} />
            <StatCard label="Bounced" value={formatRate(data.rates.bounce)} hint={`${formatNumber(c.stats.bounced)} messages`} />
            <StatCard label="Complaints" value={formatRate(data.rates.complaint)} hint={`${formatNumber(c.stats.complained)} reports`} />
            <StatCard label="Unsubscribed" value={formatRate(data.rates.unsubscribe)} hint={`${formatNumber(c.stats.unsubscribed)} people`} />
            <StatCard label="Machine opens" value={formatNumber(data.machineOpens)} hint={c.stats.opened ? `${formatRate(machine)} of opens` : undefined} />
          </section>

          <p className="max-w-3xl border-y py-3 text-sm text-muted-foreground">
            <strong className="text-foreground">Read open rates with care.</strong> Opens include machine opens: Apple Mail Privacy Protection and some security scanners load images automatically, so an open does not always mean a person read the email. Clicks are the more reliable signal.
          </p>

          <Section title="Funnel" description="How many messages made it each step of the way. Percentages are of messages sent.">
            <FunnelChart steps={funnel} />
          </Section>

          <Section title="Opens and clicks over time" description={`Hourly for the first 48 hours, then daily. Times are in ${tz.replace(/_/g, " ")}.${tl.peakOpensAt ? ` Opens peaked around ${timelineLabel(tl.peakOpensAt, tz)}.` : ""}`}>
            {data.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No opens or clicks yet.</p>
            ) : (
              <LineChart
                title="Opens and clicks over time"
                labels={data.timeline.map((t) => timelineLabel(t.at, tz))}
                series={[
                  { name: "Opens (includes machine opens)", values: data.timeline.map((t) => t.opens), stroke: "stroke-brand" },
                  { name: "Clicks", values: data.timeline.map((t) => t.clicks), stroke: "stroke-success" },
                ]}
              />
            )}
          </Section>

          <Section title="Links" description="Clicks per link. Unique clicks count each recipient once.">
            {data.links.length === 0 ? (
              <p className="text-sm text-muted-foreground">No links were clicked yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Link</TableHead>
                    <TableHead className="w-48">Share</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">Unique</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.links.map((l) => (
                    <TableRow key={l.url}>
                      <TableCell className="max-w-md truncate" title={l.url}>
                        {l.url}
                      </TableCell>
                      <TableCell>
                        <InlineBar ratio={ratio(l.clicks, maxLink)} label={`${l.clicks} clicks`} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(l.clicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(l.uniqueClicks)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <div className="grid gap-10 lg:grid-cols-2">
            <Section title="Bounces" description="Why messages could not be delivered.">
              {data.bounces.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bounces.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reason</TableHead>
                      <TableHead className="w-32">Share</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.bounces.map((b) => (
                      <TableRow key={b.reason}>
                        <TableCell>{b.reason}</TableCell>
                        <TableCell>
                          <InlineBar ratio={ratio(b.count, maxBounce)} label={`${b.count} bounces`} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(b.count)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
            <Section title="Top recipient domains" description="Where your messages went.">
              {data.topDomains.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing delivered yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Opened</TableHead>
                      <TableHead className="text-right">Bounced</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topDomains.map((d) => (
                      <TableRow key={d.domain}>
                        <TableCell>{d.domain}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(d.delivered)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(d.opened)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(d.bounced)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          </div>

          <Recipients campaign={c} />
        </>
      )}
    </div>
  );
}
