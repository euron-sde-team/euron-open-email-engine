import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Loader2 } from "lucide-react";
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Meter } from "@/components/fleet/Meter";
import { UnpauseDialog } from "@/components/fleet/UnpauseDialog";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { StatusBadge } from "@/components/layout/StatusBadge";
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
import { Switch } from "@/components/ui/switch";
import { getTenantEmail } from "@/lib/api/email";
import { listPlans } from "@/lib/api/plans";
import { getTenant, overrideEntitlement, updateTenant } from "@/lib/api/tenants";
import {
  LIMIT_CODE_PREFIX,
  MODULE_CODE_PREFIX,
  limitLabel,
  moduleLabel,
} from "@/lib/constants/modules";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import {
  RATE_TEXT,
  canUnpause,
  formatCount,
  formatRate,
  limitToText,
  parseLimit,
  rateTone,
  sendingTone,
} from "@/lib/fleet";
import { isSuperadmin, useAuthStore } from "@/stores/auth-store";
import type { Entitlement } from "@/types";

type OverridePayload = { code: string; enabled?: boolean; limit_value?: number | null };

function SourceText({ source }: { source: string }) {
  return (
    <span className="text-xs text-muted-foreground">{source === "ADMIN" ? "Set by operator" : "From plan"}</span>
  );
}

function ModuleRow({
  row,
  canWrite,
  saving,
  onSave,
}: {
  row: Entitlement;
  canWrite: boolean;
  saving: boolean;
  onSave: (payload: OverridePayload) => void;
}) {
  const name = moduleLabel(row.code.replace(MODULE_CODE_PREFIX, ""));
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm font-medium">{name}</span>
      <span className="flex items-center gap-4">
        <SourceText source={row.source} />
        <Switch
          aria-label={`${name} module`}
          checked={row.enabled}
          disabled={!canWrite || saving}
          onCheckedChange={(enabled) => onSave({ code: row.code, enabled })}
        />
      </span>
    </li>
  );
}

function LimitRow({
  row,
  canWrite,
  saving,
  onSave,
}: {
  row: Entitlement;
  canWrite: boolean;
  saving: boolean;
  onSave: (payload: OverridePayload) => void;
}) {
  const [value, setValue] = React.useState(limitToText(row.limit_value));
  React.useEffect(() => setValue(limitToText(row.limit_value)), [row.limit_value]);

  const parsed = parseLimit(value);
  const dirty = parsed.ok && parsed.value !== row.limit_value;
  const label = limitLabel(row.code);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <label htmlFor={`limit-${row.code}`} className="text-sm font-medium">
        {label}
      </label>
      <span className="flex items-center gap-3">
        <SourceText source={row.source} />
        <Input
          id={`limit-${row.code}`}
          inputMode="numeric"
          placeholder="Unlimited"
          aria-invalid={!parsed.ok}
          className="h-8 w-32 tabular-nums"
          value={value}
          disabled={!canWrite || saving}
          onChange={(event) => setValue(event.target.value)}
        />
        {canWrite ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => parsed.ok && onSave({ code: row.code, limit_value: parsed.value })}
            aria-label={`Save ${label}`}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save
          </Button>
        ) : null}
      </span>
    </li>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 font-display text-[15px] font-semibold tracking-tight">
      {children}
    </h2>
  );
}

export default function TenantDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWrite = isSuperadmin(user);

  const detailQuery = useQuery({ queryKey: ["tenant", id], queryFn: () => getTenant(id), enabled: Boolean(id) });
  const emailQuery = useQuery({ queryKey: ["tenant-email", id], queryFn: () => getTenantEmail(id), enabled: Boolean(id) });
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: listPlans, staleTime: 5 * 60_000 });

  const [statusOpen, setStatusOpen] = React.useState(false);
  const [unpauseOpen, setUnpauseOpen] = React.useState(false);
  const [savingCode, setSavingCode] = React.useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant", id] });
    queryClient.invalidateQueries({ queryKey: ["tenant-email", id] });
    queryClient.invalidateQueries({ queryKey: ["tenants"] });
    queryClient.invalidateQueries({ queryKey: ["fleet"] });
  };

  const planMutation = useMutation({
    mutationFn: (planKey: string) => updateTenant(id, { plan_key: planKey }),
    onSuccess: (updated) => {
      invalidate();
      toast.success(`Plan changed to ${updated.plan_key}. Entitlements were re-snapshotted.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Plan change failed."),
  });

  const entitlementMutation = useMutation({
    mutationFn: (payload: OverridePayload) => overrideEntitlement(id, payload),
    onSuccess: (row) => {
      invalidate();
      toast.success(`${row.code} saved`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Entitlement update failed."),
    onSettled: () => setSavingCode(null),
  });

  const saveEntitlement = (payload: OverridePayload) => {
    setSavingCode(payload.code);
    entitlementMutation.mutate(payload);
  };

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <EmptyState
        icon={Building2}
        title="Tenant not found"
        description="It may have been removed, or the link is wrong."
        action={
          <Button asChild variant="outline">
            <Link to="/tenants">Back to tenants</Link>
          </Button>
        }
      />
    );
  }

  const { tenant, entitlements, adminUsers } = detailQuery.data;
  const email = emailQuery.data;
  const modules = entitlements.filter((e) => e.code.startsWith(MODULE_CODE_PREFIX));
  const limits = entitlements.filter((e) => e.code.startsWith(LIMIT_CODE_PREFIX));
  const activePlans = (plansQuery.data ?? []).filter((p) => p.is_active || p.key === tenant.plan_key);
  const tone = email ? sendingTone(email.fleet.status) : null;

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/tenants"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Tenants
        </Link>
        <PageHeader
          title={tenant.name}
          description={
            <span className="inline-flex flex-wrap items-center gap-x-3">
              <span className="font-mono text-xs">{tenant.slug}</span>
              <StatusBadge status={tenant.status} />
              <span>Created {formatDate(tenant.created_at)}</span>
            </span>
          }
          actions={
            canWrite && tenant.status !== "CLOSED" ? (
              <Button
                variant={tenant.status === "ACTIVE" ? "outline" : "default"}
                onClick={() => setStatusOpen(true)}
              >
                {tenant.status === "ACTIVE" ? "Suspend tenant" : "Reactivate tenant"}
              </Button>
            ) : null
          }
        />
      </div>

      {/* Sending */}
      <section aria-labelledby="sending-title" className="reveal space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <SectionTitle id="sending-title">Sending</SectionTitle>
          {canWrite && email && canUnpause(email.fleet.status) ? (
            <Button size="sm" onClick={() => setUnpauseOpen(true)}>
              Lift restriction
            </Button>
          ) : null}
        </div>
        {emailQuery.isLoading ? (
          <Skeleton className="h-20" />
        ) : emailQuery.isError || !email ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load sending data. {emailQuery.error instanceof Error ? emailQuery.error.message : ""}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-5">
              <StatCard
                label="Status"
                value={<span className={tone?.text}>{tone?.label}</span>}
                hint={email.reputation.note ?? "Marketing and transactional send normally."}
              />
              <StatCard label="Sent, 14 days" value={formatCount(email.fleet.sent14d)} />
              <StatCard
                label="Bounce rate"
                value={<span className={RATE_TEXT[rateTone("bounce", email.fleet.bounceRate)]}>{formatRate(email.fleet.bounceRate)}</span>}
              />
              <StatCard
                label="Complaint rate"
                value={<span className={RATE_TEXT[rateTone("complaint", email.fleet.complaintRate)]}>{formatRate(email.fleet.complaintRate)}</span>}
              />
              <StatCard
                label="Verified domains"
                value={`${formatCount(email.fleet.verifiedDomains)} of ${formatCount(email.fleet.domains)}`}
              />
            </div>
          </>
        )}
      </section>

      {/* Usage */}
      <section aria-labelledby="usage-title" className="reveal">
        <SectionTitle id="usage-title">Usage this month</SectionTitle>
        {email ? (
          <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            <Meter label="Emails sent" used={email.usage.emails.used} limit={email.usage.emails.limit} />
            <Meter label="Contacts" used={email.usage.contacts.used} limit={email.usage.contacts.limit} />
            <Meter label="Sending domains" used={email.usage.domains.used} limit={email.usage.domains.limit} />
            <Meter label="Users" used={email.usage.users.used} limit={email.usage.users.limit} />
          </div>
        ) : (
          <Skeleton className="h-20" />
        )}
        {email ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Email counts reset {formatDateTime(email.usage.resetsAt)}.
          </p>
        ) : null}
      </section>

      {/* Domains */}
      <section aria-labelledby="domains-title" className="reveal">
        <SectionTitle id="domains-title">Domains</SectionTitle>
        {!email ? (
          <Skeleton className="h-16" />
        ) : email.domains.length === 0 ? (
          <p className="border-t py-5 text-sm text-muted-foreground">This tenant has not added a sending domain.</p>
        ) : (
          <ul className="divide-y border-y">
            {email.domains.map((d) => (
              <li key={d.id} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-baseline sm:gap-6">
                <span>
                  <span className="font-mono text-sm">{d.domain}</span>
                  {d.failureReason ? (
                    <span className="mt-0.5 block text-xs text-destructive">{d.failureReason}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  Domain <StatusBadge status={d.status} />
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  Tracking <StatusBadge status={d.trackingStatus} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Reputation history */}
      <section aria-labelledby="history-title" className="reveal">
        <SectionTitle id="history-title">Reputation history</SectionTitle>
        {!email ? (
          <Skeleton className="h-16" />
        ) : email.reputation.history.length === 0 ? (
          <p className="border-t py-5 text-sm text-muted-foreground">No status changes. This tenant has always been active.</p>
        ) : (
          <ol className="divide-y border-y">
            {email.reputation.history.map((h) => (
              <li key={`${h.at}-${h.to}`} className="py-3">
                <p className="flex flex-wrap items-center gap-x-3 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusBadge status={h.from} />
                    <span aria-hidden className="text-muted-foreground">to</span>
                    <span className="sr-only">to</span>
                    <StatusBadge status={h.to} />
                  </span>
                  <span className="text-xs text-muted-foreground" title={formatDateTime(h.at)}>
                    {timeAgo(h.at)}, by {h.trigger.toLowerCase().replace(/_/g, " ")}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{h.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Plan and entitlements */}
      <section aria-labelledby="plan-title" className="reveal">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <SectionTitle id="plan-title">Plan and entitlements</SectionTitle>
          <div className="flex items-center gap-2">
            <label htmlFor="tenant-plan-select" className="text-sm text-muted-foreground">
              Plan
            </label>
            <Select
              value={tenant.plan_key ?? ""}
              onValueChange={(key) => planMutation.mutate(key)}
              disabled={!canWrite || planMutation.isPending}
            >
              <SelectTrigger id="tenant-plan-select" className="h-8 w-48">
                <SelectValue placeholder="No plan" />
              </SelectTrigger>
              <SelectContent>
                {activePlans.map((plan) => (
                  <SelectItem key={plan.key} value={plan.key}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Changing the plan re-snapshots every entitlement, including ones an operator set.
        </p>
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
          <div>
            <h3 className="border-b pb-2 text-sm font-semibold">Modules</h3>
            <ul className="divide-y">
              {modules.map((row) => (
                <ModuleRow key={row.id} row={row} canWrite={canWrite} saving={savingCode === row.code} onSave={saveEntitlement} />
              ))}
            </ul>
          </div>
          <div>
            <h3 className="border-b pb-2 text-sm font-semibold">Limits</h3>
            <ul className="divide-y">
              {limits.map((row) => (
                <LimitRow key={row.id} row={row} canWrite={canWrite} saving={savingCode === row.code} onSave={saveEntitlement} />
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Admins */}
      <section aria-labelledby="admins-title" className="reveal">
        <SectionTitle id="admins-title">Admins</SectionTitle>
        {adminUsers.length === 0 ? (
          <p className="border-t py-5 text-sm text-muted-foreground">No admin users.</p>
        ) : (
          <ul className="divide-y border-y">
            {adminUsers.map((u) => (
              <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5">
                <span className="text-sm font-medium">{u.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{u.email}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SuspendDialog tenant={statusOpen ? tenant : null} onOpenChange={setStatusOpen} />
      {email ? (
        <UnpauseDialog
          open={unpauseOpen}
          onOpenChange={setUnpauseOpen}
          tenantId={id}
          tenantName={tenant.name}
          status={email.fleet.status}
        />
      ) : null}
    </div>
  );
}
