import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MessageCategory, SuppressionEntry } from "@open-email/types";
import { Plus, ShieldOff, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Field } from "@/components/common/Section";
import { LoadMore } from "@/components/common/LoadMore";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { useCursorList } from "@/components/common/useAccumulated";
import { useDebounced } from "@/components/common/useDebounced";
import { useConfirm } from "@/components/confirm-provider";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addSuppression, listSuppressions, removeSuppression } from "@/lib/api/monitoring";
import { formatDate } from "@/lib/format";

const REASONS: Record<SuppressionEntry["reason"], string> = {
  HARD_BOUNCE: "Hard bounce",
  COMPLAINT: "Spam complaint",
  UNSUBSCRIBE: "Unsubscribed",
  ADMIN_BLOCK: "Blocked by you",
  IMPORTED: "Imported",
};

function AddDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [scope, setScope] = React.useState("all");
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setEmail("");
      setScope("all");
      setNote("");
    }
  }, [open]);
  const add = useMutation({
    mutationFn: () => addSuppression({ email: email.trim().toLowerCase(), category: scope === "all" ? null : (scope as MessageCategory), note: note.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppressions"] });
      toast.success("Address suppressed. It will not be emailed.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Block an address</DialogTitle>
          <DialogDescription>Suppressed addresses are skipped by every campaign.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return void toast.error("Enter a valid email address.");
            add.mutate();
          }}
        >
          <Field id="s-email" label="Email address">
            <Input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Field id="s-scope" label="Applies to">
            <SimpleSelect
              id="s-scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: "All email" },
                { value: "MARKETING", label: "Marketing only" },
              ]}
            />
          </Field>
          <Field id="s-note" label="Note (optional)">
            <Input id="s-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending}>
              Block address
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SuppressionsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = React.useState("");
  const [reason, setReason] = React.useState("all");
  const [open, setOpen] = React.useState(false);
  const dq = useDebounced(q.trim(), 300);
  const filters = { q: dq, reason: reason === "all" ? "" : reason };
  const list = useCursorList<SuppressionEntry>(["suppressions", filters], (cursor) => listSuppressions({ ...filters, cursor }));
  const del = useMutation({
    mutationFn: (id: string) => removeSuppression(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppressions"] });
      toast.success("Removed from suppressions.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppressions"
        description="Addresses that will never be emailed: hard bounces, spam complaints, unsubscribes and anyone you block. Removing one is your responsibility, so only do it when the person asked to hear from you again."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus aria-hidden /> Block an address
          </Button>
        }
      />
      <form role="search" aria-label="Filter suppressions" className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-1.5">
          <label htmlFor="sup-q" className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input id="sup-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email address" className="w-64" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="sup-reason" className="text-xs font-medium text-muted-foreground">
            Reason
          </label>
          <SimpleSelect id="sup-reason" className="w-48" value={reason} onChange={setReason} options={[{ value: "all", label: "Any reason" }, ...Object.entries(REASONS).map(([value, label]) => ({ value, label }))]} />
        </div>
      </form>
      {list.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger">
          {list.error?.message}
        </p>
      ) : list.items.length === 0 ? (
        <EmptyState icon={ShieldOff} title="Nobody is suppressed" description="Bounces, complaints and unsubscribes are added here automatically." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {s.email}
                    {s.note ? <div className="text-xs text-muted-foreground">{s.note}</div> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{REASONS[s.reason] ?? s.reason}</TableCell>
                  <TableCell className="text-muted-foreground">{s.category ? s.category.charAt(0) + s.category.slice(1).toLowerCase() : "All email"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${s.email} from suppressions`}
                      onClick={async () => {
                        if (await confirm({ title: `Allow email to ${s.email} again?`, description: s.reason === "COMPLAINT" || s.reason === "HARD_BOUNCE" ? "This address bounced or complained before. Sending to it again can hurt your reputation." : "Only do this if they asked to be re-added.", confirmText: "Remove from suppressions", destructive: true })) del.mutate(s.id);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.fetchMore} shown={list.items.length} total={list.total} />
        </>
      )}
      <AddDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
