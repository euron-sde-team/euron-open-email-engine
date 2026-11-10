import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign, CampaignAudience, CampaignStatus } from "@open-email/types";
import { Copy, Megaphone, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { SimpleSelect } from "@/components/common/SimpleSelect";
import { CampaignStatusText } from "@/components/common/status";
import { useConfirm } from "@/components/confirm-provider";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteCampaign, duplicateCampaign, listCampaigns } from "@/lib/api/campaigns";
import { listLists, listSegments } from "@/lib/api/contacts";
import { formatNumber } from "@/lib/format";
import { formatRate, ratio } from "@/lib/report";
import { formatInZone } from "@/lib/schedule";
import { useTenantTimezone } from "@/lib/useTenantTimezone";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "SENDING", label: "Sending" },
  { value: "PAUSED", label: "Paused" },
  { value: "SENT", label: "Sent" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "FAILED", label: "Failed" },
];

export const campaignHref = (c: Pick<Campaign, "id" | "status">): string => (c.status === "DRAFT" ? `/campaigns/${c.id}/edit` : `/campaigns/${c.id}`);

export function audienceLabel(a: CampaignAudience, lists: { id: string; name: string }[], segments: { id: string; name: string }[]): string {
  if (a.type === "ALL") return "Everyone subscribed";
  if (a.type === "SEGMENT") return `Segment: ${segments.find((s) => s.id === a.segmentId)?.name ?? "deleted segment"}`;
  const names = a.listIds.map((id) => lists.find((l) => l.id === id)?.name ?? "deleted list");
  return names.length ? `List${names.length > 1 ? "s" : ""}: ${names.join(", ")}` : "No list chosen";
}

export default function CampaignsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const tz = useTenantTimezone();
  const [status, setStatus] = React.useState("all");
  const campaigns = useQuery({
    queryKey: ["campaigns", status],
    queryFn: () => listCampaigns(status === "all" ? "" : (status as CampaignStatus)),
    placeholderData: (p) => p,
    refetchInterval: 15_000,
  });
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const segments = useQuery({ queryKey: ["segments"], queryFn: () => listSegments(false) });

  const dup = useMutation({
    mutationFn: (id: string) => duplicateCampaign(id),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      navigate(`/campaigns/${c.id}/edit`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteCampaign(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = campaigns.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="One-off emails to a list or segment. Draft, schedule or send now, then follow the results."
        actions={
          <Button asChild>
            <Link to="/campaigns/new">
              <Plus aria-hidden /> New campaign
            </Link>
          </Button>
        }
      />
      <div className="space-y-1.5">
        <label htmlFor="c-status" className="text-xs font-medium text-muted-foreground">
          Status
        </label>
        <SimpleSelect id="c-status" className="w-48" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>

      {campaigns.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : campaigns.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(campaigns.error as Error).message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={status === "all" ? "No campaigns yet" : "No campaigns with that status"}
          description={status === "all" ? "A campaign takes four short steps: setup, audience, content, then review and send." : undefined}
          action={
            status === "all" ? (
              <Button asChild>
                <Link to="/campaigns/new">
                  <Plus aria-hidden /> Create your first campaign
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="text-right">Delivered</TableHead>
              <TableHead className="text-right">Opens</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => {
              const when = c.status === "SCHEDULED" ? c.scheduledAt : c.completedAt ?? c.startedAt;
              const started = c.status !== "DRAFT" && c.status !== "SCHEDULED";
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link to={campaignHref(c)} className="font-medium hover:text-brand hover:underline">
                      {c.name}
                    </Link>
                    <div className="max-w-64 truncate text-xs text-muted-foreground">{c.subject}</div>
                  </TableCell>
                  <TableCell>
                    <CampaignStatusText status={c.status} />
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">{audienceLabel(c.audience, lists.data ?? [], segments.data ?? [])}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{when ? formatInZone(when, tz) : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{started ? formatNumber(c.stats.delivered) : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{started ? formatRate(ratio(c.stats.opened, c.stats.delivered)) : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{started ? formatRate(ratio(c.stats.clicked, c.stats.delivered)) : "-"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Duplicate ${c.name}`} onClick={() => dup.mutate(c.id)}>
                        <Copy />
                      </Button>
                      {c.status === "DRAFT" || c.status === "CANCELLED" ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${c.name}`}
                          onClick={async () => {
                            if (await confirm({ title: `Delete ${c.name}?`, confirmText: "Delete", destructive: true })) del.mutate(c.id);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">Opens include machine opens from mail apps that load images automatically, so treat them as a trend. Clicks are the stronger signal.</p>
    </div>
  );
}
