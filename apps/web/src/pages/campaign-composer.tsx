import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampaignAudience, CampaignInput } from "@open-email/types";
import { AlertTriangle, ArrowLeft, Check, X } from "lucide-react";
import * as React from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { FactList, Field, Section } from "@/components/common/Section";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { Stepper } from "@/components/common/Stepper";
import { useConfirm } from "@/components/confirm-provider";
import { HtmlEditor } from "@/components/email/HtmlEditor";
import { PreviewFrame } from "@/components/email/PreviewFrame";
import { useRenderedPreview } from "@/components/email/useRenderedPreview";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { createCampaign, getCampaign, getPreflight, scheduleCampaign, testCampaign, updateCampaign } from "@/lib/api/campaigns";
import { listCustomFields, listLists, listSegments } from "@/lib/api/contacts";
import { getDashboard } from "@/lib/api/dashboard";
import { listDomains, listSenders } from "@/lib/api/domains";
import { getTemplate, listTemplates } from "@/lib/api/templates";
import { formatNumber } from "@/lib/format";
import { hasUnsubscribeTag, unknownTags } from "@/lib/merge-tags";
import { formatInZone, scheduleProblem, utcToZonedInput, zonedToUtcIso } from "@/lib/schedule";
import { BLANK_TEMPLATE_HTML } from "@/lib/template-defaults";
import { useTenantTimezone } from "@/lib/useTenantTimezone";
import { cn } from "@/lib/utils";
import { audienceLabel } from "@/pages/campaigns";

const STEPS = [
  { key: "setup", label: "Setup" },
  { key: "audience", label: "Audience" },
  { key: "content", label: "Content" },
  { key: "review", label: "Review and schedule" },
];

interface Draft {
  name: string;
  subject: string;
  preheader: string;
  senderIdentityId: string;
  audience: CampaignAudience;
  templateId: string | null;
  html: string;
}

const EMPTY: Draft = { name: "", subject: "", preheader: "", senderIdentityId: "", audience: { type: "LISTS", listIds: [] }, templateId: null, html: BLANK_TEMPLATE_HTML };

/** The API rejects an audience with no list or segment chosen yet, so a half-made one is left out of the draft. */
const audienceReady = (a: CampaignAudience): boolean => (a.type === "LISTS" ? a.listIds.length > 0 : a.type === "SEGMENT" ? Boolean(a.segmentId) : true);

const toInput = (d: Draft): CampaignInput => ({
  name: d.name.trim(),
  subject: d.subject.trim(),
  preheader: d.preheader.trim(),
  html: d.html,
  templateId: d.templateId,
  senderIdentityId: d.senderIdentityId || null,
  ...(audienceReady(d.audience) ? { audience: d.audience } : {}),
});

export function NewCampaignRedirect() {
  return <Navigate to="/campaigns/new/edit" replace />;
}

export default function CampaignComposerPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const tz = useTenantTimezone();

  const [campaignId, setCampaignId] = React.useState<string | null>(params.id && params.id !== "new" ? params.id : null);
  const [step, setStep] = React.useState(0);
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [loaded, setLoaded] = React.useState(!campaignId);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const existing = useQuery({ queryKey: ["campaign", campaignId], queryFn: () => getCampaign(campaignId!), enabled: Boolean(campaignId) && !loaded });
  React.useEffect(() => {
    const c = existing.data;
    if (c && !loaded) {
      setDraft({ name: c.name, subject: c.subject, preheader: c.preheader, senderIdentityId: c.senderIdentityId ?? "", audience: c.audience, templateId: c.templateId, html: c.html || BLANK_TEMPLATE_HTML });
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  const senders = useQuery({ queryKey: ["senders"], queryFn: listSenders });
  const domains = useQuery({ queryKey: ["domains"], queryFn: listDomains });
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const segments = useQuery({ queryKey: ["segments", "counted"], queryFn: () => listSegments(true) });
  const templates = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const fields = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFields });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: getDashboard });

  const sendable = (senders.data ?? []).filter((s) => s.status === "ACTIVE" && (domains.data ?? []).find((d) => d.id === s.domainId)?.status === "VERIFIED");

  // Save the draft (create it the first time). Resolves to the campaign id.
  const persist = useMutation({
    mutationFn: async () => {
      if (campaignId) return (await updateCampaign(campaignId, toInput(draft))).id;
      const c = await createCampaign(toInput(draft));
      setCampaignId(c.id);
      navigate(`/campaigns/${c.id}/edit`, { replace: true });
      return c.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      qc.invalidateQueries({ queryKey: ["preflight", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validate = (s: number): Record<string, string> => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!draft.name.trim()) e.name = "Give the campaign a name only you will see.";
      if (!draft.subject.trim()) e.subject = "Write the subject line recipients will see.";
      if (!draft.senderIdentityId) e.sender = "Choose who the email is from.";
    }
    if (s === 1) {
      if (draft.audience.type === "LISTS" && draft.audience.listIds.length === 0) e.audience = "Choose at least one list.";
      if (draft.audience.type === "SEGMENT" && !draft.audience.segmentId) e.audience = "Choose a segment.";
    }
    if (s === 2 && !draft.html.trim()) e.html = "The email has no content yet.";
    return e;
  };

  const go = async (target: number) => {
    if (target > step) {
      // Validate every step we are leaving or skipping.
      for (let s = step; s < target; s++) {
        const e = validate(s);
        if (Object.keys(e).length) {
          setErrors(e);
          setStep(s);
          return;
        }
      }
    }
    setErrors({});
    // A new draft is created as soon as it has a name and subject; later steps only update it.
    if (draft.name.trim() && draft.subject.trim()) {
      try {
        await persist.mutateAsync();
      } catch {
        return;
      }
    }
    setStep(target);
    window.scrollTo({ top: 0 });
  };

  const applyTemplate = async (id: string) => {
    if (id === "none") {
      set("templateId", null);
      return;
    }
    if (draft.html.trim() && draft.html !== BLANK_TEMPLATE_HTML && draft.templateId !== id) {
      if (!(await confirm({ title: "Replace the current content?", description: "Applying a template overwrites the HTML you have written here.", confirmText: "Replace" }))) return;
    }
    try {
      const t = await getTemplate(id);
      setDraft((d) => ({ ...d, templateId: id, html: t.html, subject: d.subject.trim() ? d.subject : t.subject, preheader: d.preheader.trim() ? d.preheader : t.preheader }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const render = useRenderedPreview({ subject: draft.subject, preheader: draft.preheader, html: draft.html });
  const unknown = unknownTags(draft.html + " " + draft.subject, (fields.data ?? []).map((f) => f.key));

  if (!loaded && existing.isLoading) return <Skeleton className="h-96 w-full" />;
  if (existing.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {(existing.error as Error).message}
      </p>
    );
  }
  if (existing.data && existing.data.status !== "DRAFT") return <Navigate to={`/campaigns/${existing.data.id}`} replace />;

  const audienceEstimate = (() => {
    const a = draft.audience;
    if (a.type === "ALL") return dash.data?.audience.subscribed ?? null;
    if (a.type === "SEGMENT") return segments.data?.find((s) => s.id === a.segmentId)?.contactCount ?? null;
    if (a.listIds.length === 0) return 0;
    return (lists.data ?? []).filter((l) => a.listIds.includes(l.id)).reduce((n, l) => n + l.memberCount, 0);
  })();

  return (
    <div className="space-y-6">
      <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All campaigns
      </Link>
      <PageHeader
        title={draft.name.trim() || "New campaign"}
        description="Drafts save as you move between steps."
        actions={
          draft.name.trim() && draft.subject.trim() ? (
            <Button variant="outline" onClick={() => persist.mutate(undefined, { onSuccess: () => toast.success("Draft saved.") })} loading={persist.isPending}>
              Save draft
            </Button>
          ) : null
        }
      />
      <Stepper steps={STEPS} current={step} onSelect={(i) => void go(i)} />

      {step === 0 ? (
        <div className="max-w-xl space-y-5">
          <Field id="cp-name" label="Campaign name" hint="For your own reference. Recipients never see it." error={errors.name}>
            <Input id="cp-name" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="November newsletter" aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field id="cp-subject" label="Subject line" error={errors.subject} hint="Short and specific works best. You can use merge tags such as {{first_name}}.">
            <Input id="cp-subject" value={draft.subject} onChange={(e) => set("subject", e.target.value)} aria-invalid={Boolean(errors.subject)} />
          </Field>
          <Field id="cp-pre" label="Preheader (optional)" hint="The grey preview text inboxes show after the subject.">
            <Input id="cp-pre" value={draft.preheader} onChange={(e) => set("preheader", e.target.value)} />
          </Field>
          <Field id="cp-sender" label="From" error={errors.sender}>
            {sendable.length === 0 && !senders.isLoading ? (
              <p className="text-sm">
                No sender is ready. Campaigns only go out from a verified domain.{" "}
                <Link to="/domains" className="font-medium text-brand hover:underline">
                  Verify a domain
                </Link>{" "}
                and{" "}
                <Link to="/senders?new=1" className="font-medium text-brand hover:underline">
                  create a sender
                </Link>
                .
              </p>
            ) : (
              <SimpleSelect
                id="cp-sender"
                value={draft.senderIdentityId}
                onChange={(v) => set("senderIdentityId", v)}
                placeholder="Choose a sender"
                options={sendable.map((s) => ({ value: s.id, label: s.displayName ? `${s.displayName} <${s.email}>` : s.email }))}
              />
            )}
          </Field>
          <Button onClick={() => void go(1)} loading={persist.isPending}>
            Continue to audience
          </Button>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="max-w-xl space-y-5">
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Send to</legend>
            {(
              [
                ["LISTS", "One or more lists", "People on the lists you choose."],
                ["SEGMENT", "A segment", "Contacts that match saved rules."],
                ["ALL", "Everyone subscribed", "Every contact who is subscribed."],
              ] as const
            ).map(([type, label, hint]) => (
              <label key={type} className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="radio"
                  name="audience-type"
                  checked={draft.audience.type === type}
                  onChange={() => set("audience", type === "ALL" ? { type: "ALL" } : type === "LISTS" ? { type: "LISTS", listIds: [] } : { type: "SEGMENT", segmentId: "" })}
                  className="mt-1 size-4 accent-[rgb(var(--brand))]"
                />
                <span>
                  {label}
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {draft.audience.type === "LISTS" ? (
            <fieldset className="space-y-2 border-t pt-4">
              <legend className="sr-only">Lists</legend>
              {(lists.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No lists yet.{" "}
                  <Link to="/lists" className="font-medium text-brand hover:underline">
                    Create one
                  </Link>
                  .
                </p>
              ) : (
                (lists.data ?? []).map((l) => {
                  const ids = draft.audience.type === "LISTS" ? draft.audience.listIds : [];
                  return (
                    <label key={l.id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={ids.includes(l.id)}
                          onChange={(e) => set("audience", { type: "LISTS", listIds: e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id) })}
                          className="size-4 accent-[rgb(var(--brand))]"
                        />
                        {l.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{formatNumber(l.memberCount)}</span>
                    </label>
                  );
                })
              )}
            </fieldset>
          ) : null}

          {draft.audience.type === "SEGMENT" ? (
            <div className="border-t pt-4">
              <Field id="cp-seg" label="Segment">
                <SimpleSelect
                  id="cp-seg"
                  value={draft.audience.segmentId}
                  onChange={(v) => set("audience", { type: "SEGMENT", segmentId: v })}
                  placeholder="Choose a segment"
                  options={(segments.data ?? []).map((s) => ({ value: s.id, label: s.contactCount === null ? s.name : `${s.name} (${formatNumber(s.contactCount)})` }))}
                />
              </Field>
            </div>
          ) : null}

          {errors.audience ? (
            <p role="alert" className="text-sm text-danger">
              {errors.audience}
            </p>
          ) : null}
          <p className="border-t pt-3 text-sm" aria-live="polite">
            About <strong className="tabular-nums">{audienceEstimate === null ? "..." : formatNumber(audienceEstimate)}</strong> contacts. People who unsubscribed, bounced, complained or are on the suppression list are removed when you send; the review step shows the exact number.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void go(0)}>
              Back
            </Button>
            <Button onClick={() => void go(2)} loading={persist.isPending}>
              Continue to content
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-5">
          <div className="grid gap-8 xl:grid-cols-2">
            <div className="space-y-4">
              <Field id="cp-tpl" label="Start from a template" hint="Optional. Choosing one copies its HTML into this campaign.">
                <SimpleSelect
                  id="cp-tpl"
                  value={draft.templateId ?? "none"}
                  onChange={(v) => void applyTemplate(v)}
                  options={[{ value: "none", label: "No template (write HTML)" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.isStarter ? `${t.name} (starter)` : t.name }))]}
                />
              </Field>
              <HtmlEditor id="cp-html" value={draft.html} onChange={(v) => set("html", v)} customFields={fields.data ?? []} rows={24} />
              {errors.html ? (
                <p role="alert" className="text-sm text-danger">
                  {errors.html}
                </p>
              ) : null}
            </div>
            <div className="space-y-3">
              <div aria-live="polite" className="space-y-1.5 text-sm">
                {unknown.length > 0 ? (
                  <p className="flex items-start gap-2 text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      Unknown merge tags: <span className="font-mono">{unknown.map((u) => `{{${u}}}`).join(" ")}</span>
                    </span>
                  </p>
                ) : null}
                {!hasUnsubscribeTag(draft.html) ? (
                  <p className="flex items-start gap-2 text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      No <span className="font-mono">{"{{unsubscribe_url}}"}</span> link in the body. A footer link is added when you send.
                    </span>
                  </p>
                ) : null}
              </div>
              <PreviewFrame html={render.data?.html ?? draft.html} title="Rendered email preview, scripts disabled" height={640} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void go(1)}>
              Back
            </Button>
            <Button onClick={() => void go(3)} loading={persist.isPending}>
              Continue to review
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 && campaignId ? (
        <ReviewStep
          campaignId={campaignId}
          draft={draft}
          audienceText={audienceLabel(draft.audience, lists.data ?? [], segments.data ?? [])}
          senderText={sendable.find((s) => s.id === draft.senderIdentityId)?.email ?? "No sender chosen"}
          tz={tz}
          onBack={() => void go(2)}
          onDone={(id) => {
            qc.invalidateQueries({ queryKey: ["campaigns"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            navigate(`/campaigns/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

function ReviewStep({
  campaignId,
  draft,
  audienceText,
  senderText,
  tz,
  onBack,
  onDone,
}: {
  campaignId: string;
  draft: Draft;
  audienceText: string;
  senderText: string;
  tz: string;
  onBack: () => void;
  onDone: (id: string) => void;
}) {
  const confirm = useConfirm();
  const preflight = useQuery({ queryKey: ["preflight", campaignId], queryFn: () => getPreflight(campaignId), staleTime: 0, gcTime: 0, refetchOnMount: "always" });
  const [mode, setMode] = React.useState<"now" | "later">("now");
  const [local, setLocal] = React.useState(() => {
    const t = new Date(Date.now() + 24 * 3600_000);
    const base = utcToZonedInput(t.toISOString(), tz);
    return `${base.slice(0, 11)}09:00`;
  });
  const [testTo, setTestTo] = React.useState("");

  const at = mode === "later" ? zonedToUtcIso(local, tz) : null;
  const problem = mode === "later" ? scheduleProblem(at) : null;
  const p = preflight.data;
  const blocked = !p || p.issues.some((i) => i.severity === "error") || p.recipients === 0;

  const send = useMutation({
    mutationFn: () => scheduleCampaign(campaignId, mode === "later" && at ? { at } : {}),
    onSuccess: () => {
      toast.success(mode === "later" ? "Campaign scheduled." : "Campaign is sending.");
      onDone(campaignId);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => {
      const to = testTo.split(/[\s,;]+/).filter(Boolean);
      if (to.length === 0 || to.length > 5 || to.some((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))) throw new Error("Enter up to 5 valid email addresses, separated by commas.");
      return testCampaign(campaignId, { to });
    },
    onSuccess: () => toast.success("Test email sent. Check the inbox."),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-8">
      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Summary">
          <FactList
            items={[
              { label: "Name", value: draft.name },
              { label: "Subject", value: draft.subject },
              { label: "From", value: senderText },
              { label: "Audience", value: audienceText },
            ]}
          />
        </Section>
        <Section title="Preflight" description="What we checked before sending.">
          {preflight.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : preflight.isError ? (
            <p role="alert" className="text-sm text-danger">
              {(preflight.error as Error).message}
            </p>
          ) : p ? (
            <div className="space-y-3">
              <dl className="divide-y border-y text-sm">
                <div className="flex justify-between py-2.5">
                  <dt>Will be sent to</dt>
                  <dd className="font-semibold tabular-nums">{formatNumber(p.recipients)}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-muted-foreground">Left out (suppressed, unsubscribed, bounced)</dt>
                  <dd className="tabular-nums text-muted-foreground">{formatNumber(p.suppressed)}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-muted-foreground">Emails left this month</dt>
                  <dd className="tabular-nums text-muted-foreground">{p.quotaRemaining === null ? "Unlimited" : formatNumber(p.quotaRemaining)}</dd>
                </div>
              </dl>
              {p.issues.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <Check className="size-4" aria-hidden /> No problems found.
                </p>
              ) : (
                <ul className="space-y-2 text-sm" aria-label="Preflight issues">
                  {p.issues.map((i, idx) => (
                    <li key={`${i.code}-${idx}`} className={cn("flex items-start gap-2", i.severity === "error" ? "text-danger" : "text-warning")}>
                      {i.severity === "error" ? <X className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
                      <span>
                        <span className="font-semibold">{i.severity === "error" ? "Must fix: " : "Heads up: "}</span>
                        {i.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {p.recipients === 0 && p.issues.length === 0 ? <p className="text-sm text-danger">Nobody would receive this campaign. Go back and choose an audience with subscribed contacts.</p> : null}
            </div>
          ) : null}
        </Section>
      </div>

      <Section title="Send a test" description="Check the real email in a real inbox before it goes to everyone. Up to 5 addresses.">
        <form
          className="flex max-w-xl flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            test.mutate();
          }}
        >
          <Field id="cp-test" label="Send test to" className="min-w-64 flex-1">
            <Input id="cp-test" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com, teammate@example.com" />
          </Field>
          <Button type="submit" variant="outline" loading={test.isPending}>
            Send test
          </Button>
        </form>
      </Section>

      <Section title="When to send">
        <fieldset className="max-w-xl space-y-3">
          <legend className="sr-only">When to send</legend>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="radio" name="when" checked={mode === "now"} onChange={() => setMode("now")} className="mt-1 size-4 accent-[rgb(var(--brand))]" />
            <span>
              Send now
              <span className="block text-xs text-muted-foreground">Sending starts right away, paced to protect your reputation.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="radio" name="when" checked={mode === "later"} onChange={() => setMode("later")} className="mt-1 size-4 accent-[rgb(var(--brand))]" />
            <span>
              Schedule for later
              <span className="block text-xs text-muted-foreground">You can unschedule or reschedule until it starts.</span>
            </span>
          </label>
          {mode === "later" ? (
            <div className="space-y-1.5 pl-6">
              <label htmlFor="cp-at" className="text-sm font-medium">
                Date and time ({tz.replace(/_/g, " ")})
              </label>
              <Input id="cp-at" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} className="w-64" aria-invalid={Boolean(problem)} aria-describedby="cp-at-note" />
              <p id="cp-at-note" className={cn("text-xs", problem ? "text-danger" : "text-muted-foreground")} role={problem ? "alert" : undefined}>
                {problem ?? (at ? `Sends ${formatInZone(at, tz)}, which is ${at.slice(0, 16).replace("T", " ")} UTC.` : "")}
              </p>
            </div>
          ) : null}
        </fieldset>
      </Section>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          disabled={blocked || Boolean(problem) || (mode === "later" && !at)}
          loading={send.isPending}
          onClick={async () => {
            const n = formatNumber(p?.recipients ?? 0);
            const ok = await confirm({
              title: mode === "later" ? `Schedule for ${n} people?` : `Send to ${n} people now?`,
              description: mode === "later" && at ? `It will start ${formatInZone(at, tz)}.` : "Once sending starts you can pause it, but emails already sent cannot be recalled.",
              confirmText: mode === "later" ? "Schedule campaign" : "Send campaign",
            });
            if (ok) send.mutate();
          }}
        >
          {mode === "later" ? "Schedule campaign" : "Send campaign"}
        </Button>
      </div>
      {blocked && p ? <p className="text-xs text-muted-foreground">Fix the items marked "Must fix" to enable sending.</p> : null}
    </div>
  );
}
