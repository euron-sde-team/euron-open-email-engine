import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Filter, Pencil, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteSegment, listCustomFields, listLists, listSegments } from "@/lib/api/contacts";
import { formatNumber } from "@/lib/format";
import { describeRules } from "@/lib/segments";

export default function SegmentsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const segments = useQuery({ queryKey: ["segments", "counted"], queryFn: () => listSegments(true) });
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const fields = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFields });
  const del = useMutation({
    mutationFn: (id: string) => deleteSegment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["segments"] });
      toast.success("Segment deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = segments.data ?? [];
  const ctx = {
    listName: (id: string) => (lists.data ?? []).find((l) => l.id === id)?.name ?? "a deleted list",
    attrLabel: (k: string) => (fields.data ?? []).find((f) => f.key === k)?.label ?? k,
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Segments"
        description="Saved rules that pick contacts for you, such as everyone tagged vip who opened an email this month. A segment stays up to date as contacts change."
        actions={
          <Button asChild>
            <Link to="/segments/new">
              <Plus aria-hidden /> New segment
            </Link>
          </Button>
        }
      />
      {segments.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : segments.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(segments.error as Error).message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Filter}
          title="No segments yet"
          description="Build one with the rule editor and see how many contacts match before you save."
          action={
            <Button asChild>
              <Link to="/segments/new">
                <Plus aria-hidden /> New segment
              </Link>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Segment</TableHead>
              <TableHead>Rules</TableHead>
              <TableHead className="text-right">Contacts</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">
                  <Link to={`/segments/${s.id}`} className="hover:text-brand hover:underline">
                    {s.name}
                  </Link>
                </TableCell>
                <TableCell className="max-w-md text-muted-foreground">{describeRules(s.rules, ctx)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.contactCount === null ? "-" : formatNumber(s.contactCount)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="icon" aria-label={`Edit ${s.name}`}>
                      <Link to={`/segments/${s.id}`}>
                        <Pencil />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${s.name}`}
                      onClick={async () => {
                        if (await confirm({ title: `Delete ${s.name}?`, description: "Draft campaigns that use it need a new audience.", confirmText: "Delete", destructive: true })) del.mutate(s.id);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
