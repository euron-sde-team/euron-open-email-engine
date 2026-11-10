import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createPlan, updatePlan } from "@/lib/api/plans";
import { MODULES, moduleLabel } from "@/lib/constants/modules";
import { limitToText, parseLimit } from "@/lib/fleet";
import type { Plan, PlanLimits } from "@/types";

const PLAN_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this plan; otherwise it creates a new one. */
  plan: Plan | null;
}

interface FormState {
  key: string;
  name: string;
  description: string;
  modules: string[];
  monthlyEmails: string;
  maxContacts: string;
  maxDomains: string;
  maxUsers: string;
}

const EMPTY_FORM: FormState = {
  key: "",
  name: "",
  description: "",
  modules: [...MODULES],
  monthlyEmails: "5000",
  maxContacts: "5000",
  maxDomains: "1",
  maxUsers: "3",
};

const formFromPlan = (plan: Plan): FormState => ({
  key: plan.key,
  name: plan.name,
  description: plan.description ?? "",
  modules: [...plan.modules],
  monthlyEmails: limitToText(plan.limits.monthlyEmails),
  maxContacts: limitToText(plan.limits.maxContacts),
  maxDomains: limitToText(plan.limits.maxDomains),
  maxUsers: limitToText(plan.limits.maxUsers),
});

const LIMIT_FIELDS: { field: keyof PlanLimits; formKey: keyof FormState; label: string }[] = [
  { field: "monthlyEmails", formKey: "monthlyEmails", label: "Emails per month" },
  { field: "maxContacts", formKey: "maxContacts", label: "Contacts" },
  { field: "maxDomains", formKey: "maxDomains", label: "Sending domains" },
  { field: "maxUsers", formKey: "maxUsers", label: "Users" },
];

export function PlanDialog({ open, onOpenChange, plan }: PlanDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = plan !== null;
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);

  React.useEffect(() => {
    if (open) setForm(plan ? formFromPlan(plan) : EMPTY_FORM);
  }, [open, plan]);

  const patch = (changes: Partial<FormState>) => setForm((prev) => ({ ...prev, ...changes }));

  const toggleModule = (moduleKey: string) =>
    setForm((prev) => ({
      ...prev,
      modules: prev.modules.includes(moduleKey)
        ? prev.modules.filter((m) => m !== moduleKey)
        : [...prev.modules, moduleKey],
    }));

  const mutation = useMutation({
    mutationFn: (payload: {
      key: string;
      name: string;
      description?: string;
      modules: string[];
      limits: PlanLimits;
    }) =>
      isEdit
        ? updatePlan(plan.id, {
            name: payload.name,
            description: payload.description ?? null,
            modules: payload.modules,
            limits: payload.limits,
          })
        : createPlan(payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast.success(isEdit ? `Plan ${saved.key} updated` : `Plan ${saved.key} created`);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Saving the plan failed.");
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const key = form.key.trim();
    if (!isEdit && !PLAN_KEY_PATTERN.test(key)) {
      toast.error("Key must be UPPER_SNAKE_CASE (letters, digits, underscores).");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (form.modules.length === 0) {
      toast.error("Pick at least one module.");
      return;
    }
    const limits: PlanLimits = { monthlyEmails: null, maxContacts: null, maxDomains: null, maxUsers: null };
    for (const { field, formKey, label } of LIMIT_FIELDS) {
      const parsed = parseLimit(form[formKey] as string);
      if (!parsed.ok) {
        toast.error(`${label} must be a whole number, or blank for unlimited.`);
        return;
      }
      limits[field] = parsed.value;
    }
    mutation.mutate({
      key,
      name: form.name.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      modules: form.modules,
      limits,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit plan ${plan.key}` : "New plan"}</DialogTitle>
          <DialogDescription>
            Entitlements are snapshotted when a tenant is created. Editing a plan changes what new
            tenants get; use a tenant&apos;s page to change one that exists.
          </DialogDescription>
        </DialogHeader>

        <form id="plan-form" className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-key">Key</Label>
              <Input
                id="plan-key"
                placeholder="GROWTH"
                className="font-mono"
                value={form.key}
                disabled={isEdit}
                onChange={(event) => patch({ key: event.target.value.toUpperCase() })}
              />
              {!isEdit ? (
                <p className="text-xs text-muted-foreground">UPPER_SNAKE_CASE, fixed after creation.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Name</Label>
              <Input
                id="plan-name"
                placeholder="Growth"
                value={form.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-description">Description</Label>
            <Textarea
              id="plan-description"
              placeholder="For teams sending regular newsletters and launches."
              value={form.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Limits</legend>
            <p className="mt-0.5 text-xs text-muted-foreground">Leave a field blank for unlimited.</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              {LIMIT_FIELDS.map(({ formKey, label }) => (
                <div key={formKey} className="space-y-1.5">
                  <Label htmlFor={`plan-${formKey}`}>{label}</Label>
                  <Input
                    id={`plan-${formKey}`}
                    inputMode="numeric"
                    placeholder="Unlimited"
                    className="tabular-nums"
                    value={form[formKey] as string}
                    onChange={(event) => patch({ [formKey]: event.target.value } as Partial<FormState>)}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">
              Modules{" "}
              <span className="font-normal tabular-nums text-muted-foreground">
                ({form.modules.length} of {MODULES.length})
              </span>
            </legend>
            <div className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {MODULES.map((moduleKey) => (
                <label key={moduleKey} className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[rgb(var(--brand))]"
                    checked={form.modules.includes(moduleKey)}
                    onChange={() => toggleModule(moduleKey)}
                  />
                  {moduleLabel(moduleKey)}
                </label>
              ))}
            </div>
          </fieldset>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="plan-form" disabled={mutation.isPending} className="gap-1.5">
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
