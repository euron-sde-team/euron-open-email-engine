import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContactList, CustomField } from "@open-email/types";
import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Field, Section } from "@/components/common/Section";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { useConfirm } from "@/components/confirm-provider";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createCustomField, createList, deleteCustomField, deleteList, listCustomFields, listLists, updateList } from "@/lib/api/contacts";
import { formatDate, formatNumber } from "@/lib/format";

function ListDialog({ open, onOpenChange, list }: { open: boolean; onOpenChange: (o: boolean) => void; list: ContactList | null }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [doi, setDoi] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setName(list?.name ?? "");
    setDescription(list?.description ?? "");
    setDoi(list?.doubleOptIn ?? false);
  }, [open, list]);
  const save = useMutation({
    mutationFn: () => (list ? updateList(list.id, { name: name.trim(), description: description.trim(), doubleOptIn: doi }) : createList({ name: name.trim(), description: description.trim(), doubleOptIn: doi })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      toast.success(list ? "List updated." : "List created.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{list ? "Edit list" : "New list"}</DialogTitle>
          <DialogDescription>A list is a group you add people to on purpose, such as a newsletter.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return void toast.error("Give the list a name.");
            save.mutate();
          }}
        >
          <Field id="l-name" label="Name">
            <Input id="l-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="l-desc" label="Description">
            <Input id="l-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor="l-doi" className="text-sm font-medium">
                Double opt-in
              </label>
              <p className="text-xs text-muted-foreground">New subscribers must click a confirmation link before they count.</p>
            </div>
            <Switch id="l-doi" checked={doi} onCheckedChange={setDoi} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes or no" },
];

function CustomFields() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const fields = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFields });
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState<CustomField["type"]>("text");
  const add = useMutation({
    mutationFn: () => {
      const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      return createCustomField({ key, label: label.trim(), type });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields"] });
      setLabel("");
      toast.success("Field added.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (key: string) => deleteCustomField(key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-fields"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Section title="Custom fields" description="Extra facts about each contact, such as plan or city. Use them in merge tags and segment rules.">
      {(fields.data ?? []).length > 0 ? (
        <ul className="mb-4 divide-y border-y text-sm">
          {(fields.data ?? []).map((f) => (
            <li key={f.key} className="flex items-center justify-between py-2.5">
              <span>
                {f.label} <span className="ml-2 font-mono text-xs text-muted-foreground">{`{{attr.${f.key}}}`}</span>
                <span className="ml-2 text-xs text-muted-foreground">{f.type}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete field ${f.label}`}
                onClick={async () => {
                  if (await confirm({ title: `Delete the ${f.label} field?`, description: "The values stored on contacts are removed.", confirmText: "Delete", destructive: true })) del.mutate(f.key);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return void toast.error("Name the field.");
          add.mutate();
        }}
      >
        <Field id="cf-label" label="New field name">
          <Input id="cf-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Plan" className="w-52" />
        </Field>
        <Field id="cf-type" label="Type">
          <SimpleSelect id="cf-type" className="w-40" value={type} onChange={(v) => setType(v as CustomField["type"])} options={FIELD_TYPES} />
        </Field>
        <Button type="submit" variant="outline" loading={add.isPending}>
          <Plus aria-hidden /> Add field
        </Button>
      </form>
    </Section>
  );
}

export default function ListsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const [editing, setEditing] = React.useState<ContactList | null>(null);
  const [open, setOpen] = React.useState(false);
  const del = useMutation({
    mutationFn: (id: string) => deleteList(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      toast.success("List deleted. The contacts are kept.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = lists.data ?? [];
  return (
    <div className="space-y-8">
      <PageHeader
        title="Lists"
        description="Groups of contacts you build on purpose. Send a campaign to one or more lists."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden /> New list
          </Button>
        }
      />
      {lists.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : lists.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(lists.error as Error).message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ListChecks} title="No lists yet" description="Create a list for your newsletter, customers or event guests." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>List</TableHead>
              <TableHead className="text-right">Subscribed</TableHead>
              <TableHead>Opt-in</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <Link to={`/contacts?listId=${l.id}`} className="font-medium hover:text-brand hover:underline">
                    {l.name}
                  </Link>
                  {l.description ? <div className="text-xs text-muted-foreground">{l.description}</div> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(l.memberCount)}</TableCell>
                <TableCell className="text-muted-foreground">{l.doubleOptIn ? "Double opt-in" : "Single opt-in"}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(l.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${l.name}`}
                      onClick={() => {
                        setEditing(l);
                        setOpen(true);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${l.name}`}
                      onClick={async () => {
                        if (await confirm({ title: `Delete ${l.name}?`, description: "Only the list is removed; its contacts stay in your audience.", confirmText: "Delete", destructive: true })) del.mutate(l.id);
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
      <CustomFields />
      <ListDialog open={open} onOpenChange={setOpen} list={editing} />
    </div>
  );
}
