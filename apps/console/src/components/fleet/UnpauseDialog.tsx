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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { unpauseTenant } from "@/lib/api/email";

export const MIN_REASON_LENGTH = 10;

interface UnpauseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  tenantName: string;
  status: string;
}

export function UnpauseDialog({ open, onOpenChange, tenantId, tenantName, status }: UnpauseDialogProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_REASON_LENGTH;

  const mutation = useMutation({
    mutationFn: () => unpauseTenant(tenantId, { reason: trimmed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-email", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["fleet"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      toast.success(`Sending restored for ${tenantName}`);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Unpausing failed.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Lift the {status.toLowerCase()} state for {tenantName}</DialogTitle>
          <DialogDescription>
            Marketing sends resume immediately and the reputation clock restarts. The reason is
            written to the operator audit log with your name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !mutation.isPending) mutation.mutate();
          }}
        >
          <Label htmlFor="unpause-reason">Reason (required)</Label>
          <Textarea
            id="unpause-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="unpause-reason-hint"
            placeholder="For example: root cause fixed, list cleaned, tenant confirmed by email."
            rows={4}
          />
          <p id="unpause-reason-hint" className="text-xs text-muted-foreground">
            At least {MIN_REASON_LENGTH} characters. {trimmed.length} so far.
          </p>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending} className="gap-1.5">
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Lift restriction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
