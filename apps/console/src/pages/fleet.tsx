import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { SortableTh } from "@/components/fleet/SortableTh";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getFleet } from "@/lib/api/email";
import {
  RATE_TEXT,
  SENDING_STATUSES,
  defaultDir,
  formatCount,
  formatRate,
  rateTone,
  sendingTone,
  sortFleet,
  type FleetSortKey,
  type SortDir,
} from "@/lib/fleet";
import { cn } from "@/lib/utils";

export default function FleetPage() {
  const fleetQuery = useQuery({ queryKey: ["fleet"], queryFn: getFleet });
  const [sortKey, setSortKey] = React.useState<FleetSortKey>("bounceRate");
  const [dir, setDir] = React.useState<SortDir>("desc");

  const onSort = (key: FleetSortKey) => {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(defaultDir(key));
    }
  };

  const fleet = fleetQuery.data;
  const rows = React.useMemo(() => sortFleet(fleet?.tenants ?? [], sortKey, dir), [fleet, sortKey, dir]);
  const th = (key: FleetSortKey, label: string, align: "left" | "right" = "right") => (
    <SortableTh label={label} active={sortKey === key} dir={dir} onSort={() => onSort(key)} align={align} />
  );

  const counts: Record<string, number> = fleet
    ? {
        ACTIVE: fleet.totals.active,
        WARNING: fleet.totals.warning,
        THROTTLED: fleet.totals.throttled,
        PAUSED: fleet.totals.paused,
      }
    : {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        description="Sending health of every tenant over the last 14 days. A paused tenant cannot send marketing mail until you lift it from its page."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fleetQuery.refetch()}
            disabled={fleetQuery.isFetching}
          >
            <RefreshCw className={cn("size-3.5", fleetQuery.isFetching && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        }
      />

      <section aria-label="Tenants by sending status" className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-5">
        {SENDING_STATUSES.map((status, index) => {
          const tone = sendingTone(status);
          return (
            <StatCard
              key={status}
              label={tone.label}
              value={formatCount(counts[status])}
              loading={fleetQuery.isLoading}
              hint={
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className={cn("size-1.5 rounded-full", tone.dot)} />
                  tenants {tone.label.toLowerCase()}
                </span>
              }
              className="reveal"
              style={{ animationDelay: `${60 + index * 45}ms` }}
            />
          );
        })}
        <StatCard
          label="Sent this month"
          value={formatCount(fleet?.totals.sentThisMonth)}
          loading={fleetQuery.isLoading}
          hint="All tenants, UTC month"
          className="reveal"
          style={{ animationDelay: "240ms" }}
        />
      </section>

      <section aria-labelledby="fleet-table-title" className="reveal" style={{ animationDelay: "280ms" }}>
        <h2 id="fleet-table-title" className="sr-only">
          Tenants
        </h2>
        {fleetQuery.isLoading ? (
          <div className="space-y-2 border-t py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : fleetQuery.isError ? (
          <p role="alert" className="border-t py-8 text-sm text-destructive">
            Could not load the fleet. {fleetQuery.error instanceof Error ? fleetQuery.error.message : ""}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No tenants yet"
            description="Once tenants exist and send, their reputation appears here."
          />
        ) : (
          <div className="border-t">
            <Table>
              <caption className="sr-only">
                Tenant sending health, sorted by {sortKey} {dir === "asc" ? "ascending" : "descending"}
              </caption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {th("name", "Tenant", "left")}
                  <TableHead>Plan</TableHead>
                  {th("status", "Status", "left")}
                  {th("sent14d", "Sent 14d")}
                  {th("bounceRate", "Bounce")}
                  {th("complaintRate", "Complaint")}
                  {th("verifiedDomains", "Domains")}
                  {th("contacts", "Contacts")}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.tenantId}>
                    <TableCell>
                      <Link
                        to={`/tenants/${row.tenantId}`}
                        className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.plan ?? "none"}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.sent14d)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", RATE_TEXT[rateTone("bounce", row.bounceRate)])}>
                      {formatRate(row.bounceRate)}
                    </TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", RATE_TEXT[rateTone("complaint", row.complaintRate)])}
                    >
                      {formatRate(row.complaintRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(row.verifiedDomains)} of {formatCount(row.domains)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.contacts)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t py-3 text-xs text-muted-foreground">
              Rate colours follow Amazon SES guidance: bounce review at 5% and risk at 10%, complaint
              review at 0.1% and risk at 0.5%.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
