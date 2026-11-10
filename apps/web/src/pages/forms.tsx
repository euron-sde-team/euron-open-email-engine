import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SubscribeForm } from "@open-email/types";
import { ExternalLink, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { CopyButton } from "@/components/common/CopyButton";
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
import { Switch } from "@/components/ui/switch";
import { createForm, deleteForm, listForms, listLists, updateForm } from "@/lib/api/contacts";
import { formatNumber } from "@/lib/format";

/** The API may return a path (/f/slug); embed snippets need an absolute address. */
const absolute = (url: string): string => (/^https?:\/\//.test(url) ? url : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`);

const iframeSnippet = (url: string, title: string): string =>
  `<iframe src="${absolute(url)}" title="${title.replace(/"/g, "")}" width="100%" height="360" style="border:0;max-width:480px"></iframe>`;
const linkSnippet = (url: string): string => `<a href="${absolute(url)}">Subscribe to our emails</a>`;

function FormDialog({ open, onOpenChange, form }: { open: boolean; onOpenChange: (o: boolean) => void; form: SubscribeForm | null }) {
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists, enabled: open });
  const [v, setV] = React.useState({ name: "", slug: "", listId: "", headline: "", description: "", buttonLabel: "Subscribe", successMessage: "Thanks for subscribing.", collectName: true, active: true });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setV(
      form
        ? { name: form.name, slug: form.slug, listId: form.listId, headline: form.headline, description: form.description, buttonLabel: form.buttonLabel, successMessage: form.successMessage, collectName: form.collectName, active: form.active }
        : { name: "", slug: "", listId: "", headline: "Stay in the loop", description: "", buttonLabel: "Subscribe", successMessage: "Thanks for subscribing.", collectName: true, active: true },
    );
  }, [open, form]);
  React.useEffect(() => {
    if (open && !form && !v.listId && lists.data?.[0]) setV((s) => ({ ...s, listId: lists.data![0].id }));
  }, [open, form, v.listId, lists.data]);

  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: v.name.trim(), slug: v.slug.trim() || undefined, listId: v.listId, headline: v.headline.trim(), description: v.description.trim(), buttonLabel: v.buttonLabel.trim() || "Subscribe", successMessage: v.successMessage.trim(), collectName: v.collectName, active: v.active };
      return form ? updateForm(form.id, body) : createForm(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forms"] });
      toast.success(form ? "Form updated." : "Form created.");
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form ? "Edit form" : "New subscribe form"}</DialogTitle>
          <DialogDescription>A hosted page people use to join a list. Lists with double opt-in send a confirmation email first.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!v.name.trim() || !v.listId || !v.headline.trim()) return void setError("A name, a list and a headline are required.");
            if (v.slug.trim() && !/^[a-z0-9-]{3,60}$/.test(v.slug.trim())) return void setError("The web address may use lowercase letters, numbers and hyphens, 3 to 60 characters.");
            setError(null);
            save.mutate();
          }}
        >
          <Field id="fm-name" label="Internal name">
            <Input id="fm-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Website footer" />
          </Field>
          <Field id="fm-list" label="Adds people to">
            <SimpleSelect id="fm-list" value={v.listId} onChange={(x) => set("listId", x)} placeholder="Choose a list" options={(lists.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <Field id="fm-slug" label="Web address" hint="Leave blank to generate one. The page lives at /f/your-address.">
            <Input id="fm-slug" value={v.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="newsletter" spellCheck={false} />
          </Field>
          <Field id="fm-head" label="Headline">
            <Input id="fm-head" value={v.headline} onChange={(e) => set("headline", e.target.value)} />
          </Field>
          <Field id="fm-desc" label="Short description">
            <Input id="fm-desc" value={v.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="fm-btn" label="Button label">
              <Input id="fm-btn" value={v.buttonLabel} onChange={(e) => set("buttonLabel", e.target.value)} />
            </Field>
            <Field id="fm-ok" label="Thank-you message">
              <Input id="fm-ok" value={v.successMessage} onChange={(e) => set("successMessage", e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="fm-name-sw" className="text-sm">
              Ask for first and last name
            </label>
            <Switch id="fm-name-sw" checked={v.collectName} onCheckedChange={(x) => set("collectName", x)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="fm-active" className="text-sm">
              Accepting sign-ups
            </label>
            <Switch id="fm-active" checked={v.active} onCheckedChange={(x) => set("active", x)} />
          </div>
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
              Save form
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton value={value} label={label.toLowerCase()} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all border-y py-2 font-mono text-xs">{value}</pre>
    </div>
  );
}

export default function FormsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const forms = useQuery({ queryKey: ["forms"], queryFn: listForms });
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const [editing, setEditing] = React.useState<SubscribeForm | null>(null);
  const [open, setOpen] = React.useState(false);
  const del = useMutation({
    mutationFn: (id: string) => deleteForm(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forms"] });
      toast.success("Form deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = forms.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscribe forms"
        description="Hosted sign-up pages you can link to or embed on your site. New subscribers land in the list you choose."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden /> New form
          </Button>
        }
      />
      {forms.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : forms.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(forms.error as Error).message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title="No forms yet" description="Create a form, then share its link or paste the embed code into your website." />
      ) : (
        <ul className="divide-y border-y">
          {rows.map((f) => (
            <li key={f.id} className="space-y-3 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-semibold tracking-tight">
                    {f.name} <Badge variant={f.active ? "success" : "neutral"} className="ml-2">{f.active ? "Accepting" : "Paused"}</Badge>
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Adds to {(lists.data ?? []).find((l) => l.id === f.listId)?.name ?? "a list"}. {formatNumber(f.submissions)} sign-ups.
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <a href={absolute(f.url)} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden /> Open<span className="sr-only"> {f.name} (new tab)</span>
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${f.name}`}
                    onClick={() => {
                      setEditing(f);
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${f.name}`}
                    onClick={async () => {
                      if (await confirm({ title: `Delete ${f.name}?`, description: "The page stops working. Contacts it collected stay.", confirmText: "Delete", destructive: true })) del.mutate(f.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <Snippet label="Page address" value={absolute(f.url)} />
                <Snippet label="Embed code" value={iframeSnippet(f.url, f.headline || f.name)} />
                <Snippet label="Link code" value={linkSnippet(f.url)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <FormDialog open={open} onOpenChange={setOpen} form={editing} />
    </div>
  );
}
