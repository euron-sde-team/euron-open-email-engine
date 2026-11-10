import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { PlanDialog } from "@/components/plans/PlanDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { listPlans, updatePlan } from "@/lib/api/plans";
import { moduleLabel } from "@/lib/constants/modules";
import { formatLimit } from "@/lib/fleet";
import { isSuperadmin, useAuthStore } from "@/stores/auth-store";
import type { Plan } from "@/types";

function Limit({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{formatLimit(value)}</dd>
    </div>
  );
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWrite = isSuperadmin(user);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingPlan, setEditingPlan] = React.useState<Plan | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: listPlans });

  const toggleMutation = useMutation({
    mutationFn: ({ plan, isActive }: { plan: Plan; isActive: boolean }) =>
      updatePlan(plan.id, { is_active: isActive }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast.success(`Plan ${saved.key} is now ${saved.is_active ? "active" : "inactive"}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Toggling the plan failed.");
    },
    onSettled: () => setTogglingId(null),
  });

  const plans = [...(plansQuery.data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)
  );

  const openCreate = () => {
    setEditingPlan(null);
    setDialogOpen(true);
  };
  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Plans"
        description="Send quotas and module access for each plan. A tenant's entitlements are snapshotted when it is created; editing a plan never changes tenants that already exist."
        actions={
          canWrite ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="size-4" />
              New plan
            </Button>
          ) : null
        }
      />

      {plansQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : plansQuery.isError ? (
        <p role="alert" className="py-8 text-sm text-destructive">
          Could not load plans. {plansQuery.error instanceof Error ? plansQuery.error.message : ""}
        </p>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No plans yet"
          description="Create a plan so tenants can be created on it."
          action={
            canWrite ? (
              <Button onClick={openCreate} className="gap-1.5">
                <Plus className="size-4" />
                New plan
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="reveal divide-y border-b">
          {plans.map((plan) => (
            <li key={plan.id} className="grid gap-4 py-5 lg:grid-cols-[14rem_1fr_auto]">
              <div>
                <h2 className="font-display text-base font-semibold tracking-tight">{plan.name}</h2>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{plan.key}</p>
                {plan.description ? (
                  <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
                ) : null}
              </div>

              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Limit label="Emails per month" value={plan.limits.monthlyEmails} />
                  <Limit label="Contacts" value={plan.limits.maxContacts} />
                  <Limit label="Sending domains" value={plan.limits.maxDomains} />
                  <Limit label="Users" value={plan.limits.maxUsers} />
                </dl>
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground">Modules:</span>{" "}
                  {plan.modules.length === 0 ? "none" : plan.modules.map(moduleLabel).join(", ")}
                </p>
              </div>

              <div className="flex items-start gap-4 lg:flex-col lg:items-end">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  {plan.is_active ? "Active" : "Inactive"}
                  <Switch
                    aria-label={`${plan.name} plan active`}
                    checked={plan.is_active}
                    disabled={!canWrite || (togglingId === plan.id && toggleMutation.isPending)}
                    onCheckedChange={(checked) => {
                      setTogglingId(plan.id);
                      toggleMutation.mutate({ plan, isActive: checked });
                    }}
                  />
                </label>
                {canWrite ? (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(plan)}>
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <PlanDialog open={dialogOpen} onOpenChange={setDialogOpen} plan={editingPlan} />
    </div>
  );
}
