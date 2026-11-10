import { useQuery } from "@tanstack/react-query";
import { Building2, Plus, Search } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { CreateTenantDialog } from "@/components/tenants/CreateTenantDialog";
import { SuspendDialog } from "@/components/tenants/SuspendDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPlans } from "@/lib/api/plans";
import { listTenants } from "@/lib/api/tenants";
import { formatDate } from "@/lib/format";
import { formatCount } from "@/lib/fleet";
import { useDebouncedValue } from "@/lib/hooks";
import { isSuperadmin, useAuthStore } from "@/stores/auth-store";
import type { Tenant } from "@/types";

const STATUS_OPTIONS = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;
const ALL_STATUSES = "__ALL__";

export default function TenantsPage() {
  const user = useAuthStore((s) => s.user);
  const canWrite = isSuperadmin(user);

  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>(ALL_STATUSES);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [statusTarget, setStatusTarget] = React.useState<Tenant | null>(null);

  const debouncedQ = useDebouncedValue(q.trim());
  const effectiveStatus = status === ALL_STATUSES ? "" : status;

  const tenantsQuery = useQuery({
    queryKey: ["tenants", debouncedQ, effectiveStatus],
    queryFn: () =>
      listTenants({
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(effectiveStatus ? { status: effectiveStatus } : {}),
      }),
    placeholderData: (previous) => previous,
  });

  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: listPlans, staleTime: 5 * 60_000 });
  const planNames = new Map((plansQuery.data ?? []).map((p) => [p.key, p.name]));

  const tenants = tenantsQuery.data ?? [];
  const hasFilters = Boolean(debouncedQ || effectiveStatus);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tenants"
        description="Every workspace on this deployment, its plan, status and size."
        actions={
          canWrite ? (
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              Create tenant
            </Button>
          ) : null
        }
      />

      <div className="reveal flex flex-wrap items-center gap-2" style={{ animationDelay: "60ms" }}>
        <div className="relative w-full max-w-xs">
          <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search tenants"
            className="pl-9"
            placeholder="Search by name or slug"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status" className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option.charAt(0) + option.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {formatCount(tenants.length)} {tenants.length === 1 ? "tenant" : "tenants"}
        </span>
      </div>

      <div className="reveal border-t" style={{ animationDelay: "120ms" }}>
        {tenantsQuery.isLoading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : tenantsQuery.isError ? (
          <p role="alert" className="py-8 text-sm text-destructive">
            Could not load tenants. {tenantsQuery.error instanceof Error ? tenantsQuery.error.message : ""}
          </p>
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={hasFilters ? "No tenants match" : "No tenants yet"}
            description={
              hasFilters
                ? "Try a different search or clear the status filter."
                : "Create the first tenant to provision a workspace and its admin account."
            }
            action={
              canWrite && !hasFilters ? (
                <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                  <Plus className="size-4" />
                  Create tenant
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <Link
                      to={`/tenants/${tenant.id}`}
                      className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {tenant.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{tenant.slug}</TableCell>
                  <TableCell>
                    {tenant.plan_key ? (
                      <span className="text-sm">{planNames.get(tenant.plan_key) ?? tenant.plan_key}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">none</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={tenant.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(tenant.usage.users)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(tenant.usage.contacts)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(tenant.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {canWrite && tenant.status !== "CLOSED" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatusTarget(tenant)}
                        aria-label={`${tenant.status === "ACTIVE" ? "Suspend" : "Reactivate"} ${tenant.name}`}
                      >
                        {tenant.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} plans={plansQuery.data ?? []} />
      <SuspendDialog tenant={statusTarget} onOpenChange={(open) => !open && setStatusTarget(null)} />
    </div>
  );
}
