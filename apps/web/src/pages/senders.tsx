import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MessageCategory, SenderIdentity } from "@open-email/types";
import { Archive, Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Field } from "@/components/common/Section";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { useConfirm } from "@/components/confirm-provider";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSender, deleteSender, listDomains, listSenders, testSender, updateSender } from "@/lib/api/domains";

const CATEGORIES: { value: MessageCategory; label: string; hint: string }[] = [
  { value: "MARKETING", label: "Marketing", hint: "Campaigns and newsletters" },
  { value: "TRANSACTIONAL", label: "Transactional", hint: "Confirmations such as subscribe forms" },
  { value: "NOTIFICATION", label: "Notification", hint: "Account and system notices" },
];

const LOCAL_RE = /^[a-z0-9._%+-]{1,64}$/;

function SenderDialog({
  open,
  onOpenChange,
  sender,
  presetDomain,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sender: SenderIdentity | null;
  presetDomain: string | null;
}) {
  const qc = useQueryClient();
  const domains = useQuery({ queryKey: ["domains"], queryFn: listDomains });
  const verified = (domains.data ?? []).filter((d) => d.status === "VERIFIED");
  const [domainId, setDomainId] = React.useState("");
  const [localPart, setLocalPart] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [replyTo, setReplyTo] = React.useState("");
  const [defaults, setDefaults] = React.useState<MessageCategory[]>(["MARKETING"]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setDomainId(sender?.domainId ?? presetDomain ?? "");
    setLocalPart(sender ? sender.email.split("@")[0] : "");
    setDisplayName(sender?.displayName ?? "");
    setReplyTo(sender?.replyTo ?? "");
    setDefaults(sender?.defaults ?? ["MARKETING"]);
  }, [open, sender, presetDomain]);

  React.useEffect(() => {
    if (open && !sender && !domainId && verified[0]) setDomainId(verified[0].id);
  }, [open, sender, domainId, verified]);

  const domain = (domains.data ?? []).find((d) => d.id === domainId);

  const save = useMutation({
    mutationFn: () =>
      sender
        ? updateSender(sender.id, { displayName: displayName.trim() || null, replyTo: replyTo.trim() || null, defaults })
        : createSender({ domainId, localPart: localPart.trim().toLowerCase(), displayName: displayName.trim() || undefined, replyTo: replyTo.trim() || undefined, defaults }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["senders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(sender ? "Sender updated." : "Sender created.");
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggle = (c: MessageCategory) => setDefaults((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{sender ? "Edit sender" : "Create a sender"}</DialogTitle>
          <DialogDescription>The From name and address recipients see. Only verified domains can have senders.</DialogDescription>
        </DialogHeader>
        {!sender && !domains.isLoading && verified.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p>You need a verified sending domain first.</p>
            <Button asChild>
              <Link to="/domains" onClick={() => onOpenChange(false)}>
                Go to domains
              </Link>
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!sender) {
                if (!domainId) return void setError("Choose a domain.");
                if (!LOCAL_RE.test(localPart.trim().toLowerCase())) return void setError("Use letters, numbers and . _ % + - before the @.");
              }
              if (replyTo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo.trim())) return void setError("Reply-to must be an email address.");
              setError(null);
              save.mutate();
            }}
          >
            {!sender ? (
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <Field id="sender-local" label="Address">
                  <Input id="sender-local" value={localPart} onChange={(e) => setLocalPart(e.target.value)} placeholder="hello" autoComplete="off" spellCheck={false} />
                </Field>
                <span className="pb-2 text-muted-foreground" aria-hidden>
                  @
                </span>
                <Field id="sender-domain" label="Domain">
                  <SimpleSelect id="sender-domain" value={domainId} onChange={setDomainId} options={verified.map((d) => ({ value: d.id, label: d.domain }))} />
                </Field>
              </div>
            ) : (
              <p className="text-sm">
                <span className="text-muted-foreground">Address: </span>
                {sender.email}
              </p>
            )}
            <Field id="sender-name" label="From name" hint={`Shown as: ${displayName.trim() || "Your name"} <${(localPart || "hello").toLowerCase()}@${domain?.domain ?? "your domain"}>`}>
              <Input id="sender-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Northwind Mail" />
            </Field>
            <Field id="sender-reply" label="Reply-to (optional)" hint="Replies go here instead of the From address.">
              <Input id="sender-reply" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="support@example.com" />
            </Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Default sender for</legend>
              {CATEGORIES.map((c) => (
                <label key={c.value} className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={defaults.includes(c.value)} onChange={() => toggle(c.value)} className="mt-1 size-4 accent-[rgb(var(--brand))]" />
                  <span>
                    {c.label}
                    <span className="block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={save.isPending}>
                {sender ? "Save" : "Create sender"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function SendersPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const senders = useQuery({ queryKey: ["senders"], queryFn: listSenders });
  const domains = useQuery({ queryKey: ["domains"], queryFn: listDomains });
  const [editing, setEditing] = React.useState<SenderIdentity | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => {
    if (params.get("new") === "1") {
      setEditing(null);
      setDialogOpen(true);
    }
  }, [params]);

  const closeDialog = (o: boolean) => {
    setDialogOpen(o);
    if (!o && params.has("new")) {
      const next = new URLSearchParams(params);
      next.delete("new");
      next.delete("domain");
      setParams(next, { replace: true });
    }
  };

  const domainName = (id: string) => (domains.data ?? []).find((d) => d.id === id)?.domain ?? "";

  const archive = useMutation({
    mutationFn: (s: SenderIdentity) => updateSender(s.id, { status: s.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["senders"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSender(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["senders"] });
      toast.success("Sender deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: (id: string) => testSender(id),
    onSuccess: (r) => toast.success(`Test message sent${r?.sentTo ? ` to ${r.sentTo}` : ""}.`),
    onError: (e: Error) => toast.error(e.message),
  });

  const list = senders.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Senders"
        description="The From addresses your campaigns use. A sender belongs to one verified domain."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden /> Create sender
          </Button>
        }
      />
      {senders.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : senders.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(senders.error as Error).message}
        </p>
      ) : list.length === 0 ? (
        <EmptyState icon={Mail} title="No senders yet" description="Verify a sending domain, then create the address your campaigns come from." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sender</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Default for</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="font-medium">{s.displayName || s.email}</div>
                  {s.displayName ? <div className="text-xs text-muted-foreground">{s.email}</div> : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{domainName(s.domainId)}</TableCell>
                <TableCell className="text-muted-foreground">{s.defaults.length ? s.defaults.map((c) => c.toLowerCase()).join(", ") : "none"}</TableCell>
                <TableCell>
                  <Badge variant={s.status === "ACTIVE" ? "success" : "neutral"}>{s.status === "ACTIVE" ? "Active" : "Archived"}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Send a test message from ${s.email}`} title="Send a test to yourself" onClick={() => test.mutate(s.id)} disabled={s.status !== "ACTIVE"}>
                      <Send />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${s.email}`}
                      onClick={() => {
                        setEditing(s);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={s.status === "ACTIVE" ? `Archive ${s.email}` : `Restore ${s.email}`} onClick={() => archive.mutate(s)}>
                      <Archive />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${s.email}`}
                      onClick={async () => {
                        if (await confirm({ title: `Delete ${s.email}?`, description: "Campaigns that use it need another sender before they can send.", confirmText: "Delete", destructive: true })) remove.mutate(s.id);
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
      <SenderDialog open={dialogOpen} onOpenChange={closeDialog} sender={editing} presetDomain={params.get("domain")} />
    </div>
  );
}
