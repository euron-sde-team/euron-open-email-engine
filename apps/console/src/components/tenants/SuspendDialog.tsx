import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { updateTenant } from "@/lib/api/tenants";
import type { Tenant } from "@/types";

interface SuspendDialogProps {
  tenant: Tenant | null;
  onOpenChange: (open: boolean) => void;
}

/** Confirms suspending an ACTIVE tenant or reactivating a SUSPENDED one. */
export function SuspendDialog({ tenant, onOpenChange }: SuspendDialogProps) {
  const queryClient = useQueryClient();
  const suspending = tenant?.status === "ACTIVE";
  const next = suspending ? "SUSPENDED" : "ACTIVE";

  const mutation = useMutation({
    mutationFn: () => updateTenant(tenant!.id, { status: next }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      queryClient.invalidateQueries({ queryKey: ["tenant", saved.id] });
      queryClient.invalidateQueries({ queryKey: ["fleet"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      toast.success(suspending ? `${saved.name} suspended` : `${saved.name} reactivated`);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Updating the tenant failed.");
    },
  });

  return (
    <Dialog open={tenant !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {suspending ? "Suspend" : "Reactivate"} {tenant?.name}
          </DialogTitle>
          <DialogDescription>
            {suspending
              ? "Its users are signed out of the workspace and nothing sends until you reactivate it. Data is kept."
              : "Its users can sign in again and sending follows its reputation state."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={suspending ? "destructive" : "default"}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="gap-1.5"
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {suspending ? "Suspend tenant" : "Reactivate tenant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
