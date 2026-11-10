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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTenant } from "@/lib/api/tenants";
import { slugify } from "@/lib/format";
import type { Plan } from "@/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreateTenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: Plan[];
}

export function CreateTenantDialog({ open, onOpenChange, plans }: CreateTenantDialogProps) {
  const queryClient = useQueryClient();
  const activePlans = plans.filter((p) => p.is_active);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [planKey, setPlanKey] = React.useState("");
  const [adminName, setAdminName] = React.useState("");
  const [adminEmail, setAdminEmail] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setSlug("");
    setSlugTouched(false);
    setPlanKey("");
    setAdminName("");
    setAdminEmail("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: createTenant,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      queryClient.invalidateQueries({ queryKey: ["fleet"] });
      queryClient.invalidateQueries({ queryKey: ["metrics-overview"] });
      toast.success(
        result.emailDispatched
          ? `${result.tenant.name} created. The admin invite was emailed.`
          : `${result.tenant.name} created. Email is not configured, so no invite was sent.`
      );
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Creating the tenant failed.");
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return toast.error("Name is required.");
    if (!planKey) return toast.error("Pick a plan.");
    if (!adminName.trim()) return toast.error("Admin name is required.");
    if (!EMAIL_PATTERN.test(adminEmail.trim())) return toast.error("Enter a valid admin email.");
    mutation.mutate({
      name: name.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      plan_key: planKey,
      admin: { name: adminName.trim(), email: adminEmail.trim().toLowerCase() },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create tenant</DialogTitle>
          <DialogDescription>
            Provisions a workspace on a plan and emails its first admin a temporary password.
          </DialogDescription>
        </DialogHeader>
        <form id="create-tenant-form" className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tenant-name">Name</Label>
              <Input
                id="tenant-name"
                placeholder="Northwind Mail"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugTouched) setSlug(slugify(event.target.value));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tenant-slug">Slug</Label>
              <Input
                id="tenant-slug"
                className="font-mono"
                placeholder="northwind-mail"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(slugify(event.target.value));
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-plan">Plan</Label>
            <Select value={planKey} onValueChange={setPlanKey}>
              <SelectTrigger id="tenant-plan">
                <SelectValue placeholder="Choose a plan" />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="admin-name">Admin name</Label>
              <Input
                id="admin-name"
                autoComplete="off"
                placeholder="Maya Rao"
                value={adminName}
                onChange={(event) => setAdminName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Admin email</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="off"
                placeholder="maya@northwind.example"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
              />
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-tenant-form" disabled={mutation.isPending} className="gap-1.5">
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Create tenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
