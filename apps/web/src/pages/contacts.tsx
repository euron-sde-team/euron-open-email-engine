import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, ContactBulkInput, ContactStatus } from "@open-email/types";
import { Download, Plus, Upload, Users } from "lucide-react";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Field } from "@/components/common/Section";
import { LoadMore } from "@/components/common/LoadMore";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { ContactStatusText } from "@/components/common/status";
import { useDebounced } from "@/components/common/useDebounced";
import { useCursorList } from "@/components/common/useAccumulated";
import { useConfirm } from "@/components/confirm-provider";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TagInput } from "@/components/ui/tag-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bulkContacts, createContact, downloadContactsCsv, listContacts, listLists, listSegments } from "@/lib/api/contacts";
import { formatDate, timeAgo } from "@/lib/format";
import { CONTACT_STATUSES } from "@/lib/segments";
import { contactStatusLabel } from "@/components/common/status";

type BulkKind = ContactBulkInput["action"];

function AddContactDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists, enabled: open });
  const [email, setEmail] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [listId, setListId] = React.useState("none");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setFirstName("");
      setLastName("");
      setTags([]);
      setListId("none");
      setError(null);
    }
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      createContact({ email: email.trim(), firstName: firstName.trim() || undefined, lastName: lastName.trim() || undefined, tags, listIds: listId === "none" ? undefined : [listId] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Contact added.");
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a contact</DialogTitle>
          <DialogDescription>Only add people who agreed to receive your email.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return void setError("Enter a valid email address.");
            setError(null);
            save.mutate();
          }}
        >
          <Field id="c-email" label="Email" error={error}>
            <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" aria-invalid={Boolean(error)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="c-first" label="First name">
              <Input id="c-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field id="c-last" label="Last name">
              <Input id="c-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
          </div>
          <div className="space-y-1.5">
            <span id="c-tags-l" className="text-sm font-medium">
              Tags
            </span>
            <TagInput value={tags} onChange={setTags} placeholder="Type a tag and press Enter" />
          </div>
          <Field id="c-list" label="Add to list">
            <SimpleSelect id="c-list" value={listId} onChange={setListId} options={[{ value: "none", label: "No list" }, ...(lists.data ?? []).map((l) => ({ value: l.id, label: l.name }))]} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Add contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BulkDialog({ kind, ids, onClose, onDone }: { kind: BulkKind | null; ids: string[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists, enabled: kind === "addToList" || kind === "removeFromList" });
  const [value, setValue] = React.useState("");
  React.useEffect(() => setValue(""), [kind]);
  const run = useMutation({
    mutationFn: () => bulkContacts({ ids, action: kind!, value: value.trim() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
      toast.success(`Updated ${r?.affected ?? ids.length} contacts.`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const isList = kind === "addToList" || kind === "removeFromList";
  const title = kind === "tag" ? "Add a tag" : kind === "untag" ? "Remove a tag" : kind === "addToList" ? "Add to a list" : "Remove from a list";
  return (
    <Dialog open={kind !== null && kind !== "delete"} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {ids.length} selected {ids.length === 1 ? "contact" : "contacts"}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!value.trim()) return void toast.error(isList ? "Choose a list." : "Enter a tag.");
            run.mutate();
          }}
        >
          {isList ? (
            <Field id="bulk-list" label="List">
              <SimpleSelect id="bulk-list" value={value} onChange={setValue} placeholder="Choose a list" options={(lists.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
          ) : (
            <Field id="bulk-tag" label="Tag">
              <Input id="bulk-tag" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={run.isPending}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ContactsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [tag, setTag] = React.useState("");
  const [listId, setListId] = React.useState(params.get("listId") ?? "all");
  const [segmentId, setSegmentId] = React.useState(params.get("segmentId") ?? "all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulk, setBulk] = React.useState<BulkKind | null>(null);
  const [addOpen, setAddOpen] = React.useState(params.get("new") === "1");

  const dq = useDebounced(q.trim(), 300);
  const dtag = useDebounced(tag.trim(), 300);
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const segments = useQuery({ queryKey: ["segments"], queryFn: () => listSegments(false) });

  const filters = {
    q: dq,
    status: status === "all" ? "" : (status as ContactStatus),
    tag: dtag,
    listId: listId === "all" ? "" : listId,
    segmentId: segmentId === "all" ? "" : segmentId,
  };
  const list = useCursorList<Contact>(["contacts", filters], (cursor) => listContacts({ ...filters, cursor, limit: 50 }));

  // A new filter set is a new result set; selection from the old one no longer applies.
  React.useEffect(() => setSelected(new Set()), [dq, status, dtag, listId, segmentId]);

  const closeAdd = (o: boolean) => {
    setAddOpen(o);
    if (!o && params.has("new")) {
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  };

  const allSelected = list.items.length > 0 && list.items.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(list.items.map((c) => c.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const del = useMutation({
    mutationFn: () => bulkContacts({ ids: [...selected], action: "delete" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Deleted ${r?.affected ?? selected.size} contacts.`);
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = useMutation({
    mutationFn: () => downloadContactsCsv(filters),
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = Boolean(dq || dtag || status !== "all" || listId !== "all" || segmentId !== "all");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        description="Everyone you can email, with their status, tags and engagement."
        actions={
          <>
            <Button variant="outline" onClick={() => exportCsv.mutate()} loading={exportCsv.isPending}>
              <Download aria-hidden /> Export CSV
            </Button>
            <Button variant="outline" asChild>
              <Link to="/import">
                <Upload aria-hidden /> Import
              </Link>
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus aria-hidden /> Add contact
            </Button>
          </>
        }
      />

      <form role="search" aria-label="Filter contacts" className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-1.5">
          <label htmlFor="f-q" className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input id="f-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email or name" className="w-60" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="f-status" className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <SimpleSelect id="f-status" className="w-48" value={status} onChange={setStatus} options={[{ value: "all", label: "Any status" }, ...CONTACT_STATUSES.map((s) => ({ value: s, label: contactStatusLabel(s) }))]} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="f-tag" className="text-xs font-medium text-muted-foreground">
            Tag
          </label>
          <Input id="f-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Any tag" className="w-36" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="f-list" className="text-xs font-medium text-muted-foreground">
            List
          </label>
          <SimpleSelect id="f-list" className="w-44" value={listId} onChange={setListId} options={[{ value: "all", label: "Any list" }, ...(lists.data ?? []).map((l) => ({ value: l.id, label: l.name }))]} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="f-seg" className="text-xs font-medium text-muted-foreground">
            Segment
          </label>
          <SimpleSelect id="f-seg" className="w-44" value={segmentId} onChange={setSegmentId} options={[{ value: "all", label: "Any segment" }, ...(segments.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        </div>
      </form>

      {selected.size > 0 ? (
        <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-y py-2.5 text-sm">
          <span className="mr-2 font-medium" aria-live="polite">
            {selected.size} selected
          </span>
          <Button size="sm" variant="outline" onClick={() => setBulk("tag")}>
            Add tag
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulk("untag")}>
            Remove tag
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulk("addToList")}>
            Add to list
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulk("removeFromList")}>
            Remove from list
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-danger"
            onClick={async () => {
              if (await confirm({ title: `Delete ${selected.size} contacts?`, description: "Their history is removed. This cannot be undone.", confirmText: "Delete", destructive: true })) del.mutate();
            }}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {list.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger">
          {list.error?.message}
        </p>
      ) : list.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={Users} title="No contacts match" description="Loosen a filter or clear the search." />
        ) : (
          <EmptyState
            icon={Users}
            title="No contacts yet"
            description="Import a CSV, add someone by hand, or share a subscribe form."
            action={
              <Button asChild>
                <Link to="/import">
                  <Upload aria-hidden /> Import contacts
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input type="checkbox" aria-label="Select all contacts on this page" checked={allSelected} onChange={toggleAll} className="size-4 accent-[rgb(var(--brand))]" />
                </TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead>Last opened</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((c) => {
                const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
                return (
                  <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                    <TableCell>
                      <input type="checkbox" aria-label={`Select ${c.email}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="size-4 accent-[rgb(var(--brand))]" />
                    </TableCell>
                    <TableCell>
                      <Link to={`/contacts/${c.id}`} className="font-medium hover:text-brand hover:underline">
                        {c.email}
                      </Link>
                      {name ? <div className="text-xs text-muted-foreground">{name}</div> : null}
                    </TableCell>
                    <TableCell>
                      <ContactStatusText status={c.status} />
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">{c.tags.join(", ") || "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.emailsReceived}</TableCell>
                    <TableCell className="text-muted-foreground">{c.lastOpenedAt ? timeAgo(c.lastOpenedAt) : "never"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.fetchMore} shown={list.items.length} total={list.total} />
        </>
      )}

      <AddContactDialog open={addOpen} onOpenChange={closeAdd} />
      <BulkDialog
        kind={bulk}
        ids={[...selected]}
        onClose={() => setBulk(null)}
        onDone={() => {
          setBulk(null);
          setSelected(new Set());
        }}
      />
    </div>
  );
}
