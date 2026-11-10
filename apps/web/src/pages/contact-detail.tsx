import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ContactStatusText } from "@/components/common/status";
import { Field, FactList, Section } from "@/components/common/Section";
import { useConfirm } from "@/components/confirm-provider";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TagInput } from "@/components/ui/tag-input";
import {
  addListMembers,
  deleteContact,
  getContact,
  getContactTimeline,
  listCustomFields,
  listLists,
  removeListMembers,
  updateContact,
} from "@/lib/api/contacts";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContactTimelineEntry } from "@/types";

const EVENT_TEXT: Record<ContactTimelineEntry["type"], string> = {
  SEND: "Sent",
  DELIVERY: "Delivered",
  BOUNCE: "Bounced",
  COMPLAINT: "Marked as spam",
  REJECT: "Rejected",
  OPEN: "Opened",
  CLICK: "Clicked a link",
  UNSUBSCRIBE: "Unsubscribed",
  SUBSCRIBED: "Subscribed",
  CONFIRMED: "Confirmed subscription",
  IMPORTED: "Imported",
};

const TONE: Partial<Record<ContactTimelineEntry["type"], string>> = {
  BOUNCE: "bg-danger",
  COMPLAINT: "bg-danger",
  REJECT: "bg-danger",
  UNSUBSCRIBE: "bg-warning",
  OPEN: "bg-brand",
  CLICK: "bg-success",
  DELIVERY: "bg-success",
};

export default function ContactDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const contact = useQuery({ queryKey: ["contact", id], queryFn: () => getContact(id) });
  const timeline = useQuery({ queryKey: ["contact-timeline", id], queryFn: () => getContactTimeline(id) });
  const fields = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFields });
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [attrs, setAttrs] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const c = contact.data;
    if (!c) return;
    setFirstName(c.firstName ?? "");
    setLastName(c.lastName ?? "");
    setTags(c.tags);
    setAttrs(Object.fromEntries(Object.entries(c.attributes).map(([k, v]) => [k, v === null ? "" : String(v)])));
  }, [contact.data]);

  const save = useMutation({
    mutationFn: () => {
      const attributes: Record<string, string | number | boolean | null> = {};
      for (const f of fields.data ?? []) {
        const raw = (attrs[f.key] ?? "").trim();
        attributes[f.key] = raw === "" ? null : f.type === "number" ? Number(raw) : f.type === "boolean" ? raw === "true" : raw;
      }
      return updateContact(id, { firstName: firstName.trim(), lastName: lastName.trim(), tags, attributes });
    },
    onSuccess: (c) => {
      qc.setQueryData(["contact", id], c);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contact saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const member = useMutation({
    mutationFn: async ({ listId, on }: { listId: string; on: boolean }) => {
      if (on) await addListMembers(listId, [id]);
      else await removeListMembers(listId, [id]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact", id] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteContact(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contact deleted.");
      navigate("/contacts", { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (contact.isLoading) return <Skeleton className="h-64 w-full" />;
  if (contact.isError || !contact.data) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-danger">
          {(contact.error as Error | null)?.message ?? "Contact not found."}
        </p>
        <Link to="/contacts" className="text-sm font-medium text-brand hover:underline">
          Back to contacts
        </Link>
      </div>
    );
  }
  const c = contact.data;

  return (
    <div className="space-y-8">
      <Link to="/contacts" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All contacts
      </Link>
      <PageHeader
        title={c.email}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <ContactStatusText status={c.status} />
            <span>Added {formatDateTime(c.createdAt)}</span>
            <span>Source: {c.source.toLowerCase()}</span>
          </span>
        }
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              if (await confirm({ title: `Delete ${c.email}?`, description: "Their history is removed. If you only want to stop emailing them, add them to suppressions instead.", confirmText: "Delete", destructive: true })) remove.mutate();
            }}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <Section title="Details">
            <form
              className="max-w-lg space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field id="d-first" label="First name">
                  <Input id="d-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </Field>
                <Field id="d-last" label="Last name">
                  <Input id="d-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </Field>
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Tags</span>
                <TagInput value={tags} onChange={setTags} placeholder="Type a tag and press Enter" />
              </div>
              {(fields.data ?? []).map((f) => (
                <Field key={f.key} id={`attr-${f.key}`} label={f.label}>
                  <Input id={`attr-${f.key}`} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={attrs[f.key] ?? ""} onChange={(e) => setAttrs((a) => ({ ...a, [f.key]: e.target.value }))} />
                </Field>
              ))}
              <Button type="submit" loading={save.isPending}>
                Save changes
              </Button>
            </form>
          </Section>

          <Section title="Timeline" description="What happened to the email sent to this person, newest first.">
            {timeline.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (timeline.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet. Events appear here once this contact is sent a campaign.</p>
            ) : (
              <ol className="divide-y border-y">
                {(timeline.data ?? []).map((t) => (
                  <li key={t.id} className="flex items-start gap-3 py-2.5 text-sm">
                    <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE[t.type] ?? "bg-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p>
                        <span className="font-medium">{EVENT_TEXT[t.type] ?? t.type}</span>
                        {t.machine ? <span className="text-muted-foreground"> (likely a mail client, not a person)</span> : null}
                        {t.campaignName ? (
                          <>
                            {" "}
                            <span className="text-muted-foreground">in</span>{" "}
                            <Link to={`/campaigns/${t.campaignId}`} className="hover:text-brand hover:underline">
                              {t.campaignName}
                            </Link>
                          </>
                        ) : null}
                      </p>
                      {t.url ? <p className="truncate text-xs text-muted-foreground">{t.url}</p> : t.detail ? <p className="text-xs text-muted-foreground">{t.detail}</p> : null}
                    </div>
                    <time dateTime={t.at} className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(t.at)}>
                      {timeAgo(t.at)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <aside className="space-y-8">
          <Section title="Engagement" headingLevel={2}>
            <FactList
              items={[
                { label: "Received", value: String(c.emailsReceived) },
                { label: "Last opened", value: c.lastOpenedAt ? timeAgo(c.lastOpenedAt) : "never" },
                { label: "Last clicked", value: c.lastClickedAt ? timeAgo(c.lastClickedAt) : "never" },
              ]}
            />
          </Section>
          <Section title="Lists">
            {(lists.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No lists yet.</p>
            ) : (
              <ul className="space-y-2">
                {(lists.data ?? []).map((l) => (
                  <li key={l.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input type="checkbox" checked={c.listIds.includes(l.id)} onChange={(e) => member.mutate({ listId: l.id, on: e.target.checked })} className="size-4 accent-[rgb(var(--brand))]" />
                      {l.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
