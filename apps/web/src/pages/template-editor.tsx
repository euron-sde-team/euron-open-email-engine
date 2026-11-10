import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Copy } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Field } from "@/components/common/Section";
import { HtmlEditor } from "@/components/email/HtmlEditor";
import { PreviewFrame } from "@/components/email/PreviewFrame";
import { useRenderedPreview } from "@/components/email/useRenderedPreview";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { listCustomFields } from "@/lib/api/contacts";
import { createTemplate, duplicateTemplate, getTemplate, updateTemplate } from "@/lib/api/templates";
import { hasUnsubscribeTag, unknownTags } from "@/lib/merge-tags";
import { BLANK_TEMPLATE_HTML } from "@/lib/template-defaults";

export default function TemplateEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFields });
  const existing = useQuery({ queryKey: ["template", id], queryFn: () => getTemplate(id!), enabled: !isNew });

  const [name, setName] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [preheader, setPreheader] = React.useState("");
  const [html, setHtml] = React.useState(BLANK_TEMPLATE_HTML);
  const [text, setText] = React.useState("");
  const [loaded, setLoaded] = React.useState(isNew);

  React.useEffect(() => {
    const t = existing.data;
    if (t && !loaded) {
      setName(t.name);
      setSubject(t.subject);
      setPreheader(t.preheader);
      setHtml(t.html);
      setText(t.text ?? "");
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  const readOnly = Boolean(existing.data?.isStarter);
  const render = useRenderedPreview({ subject, preheader, html });
  const fieldKeys = (fields.data ?? []).map((f) => f.key);
  const unknown = unknownTags(html + " " + subject, fieldKeys);
  const noUnsub = !hasUnsubscribeTag(html);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), subject: subject.trim(), preheader: preheader.trim(), html, text: text.trim() ? text : null };
      return isNew ? createTemplate(body) : updateTemplate(id!, body);
    },
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: ["template", t.id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Template saved.");
      if (isNew) navigate(`/templates/${t.id}`, { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const dup = useMutation({
    mutationFn: () => duplicateTemplate(id!),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      navigate(`/templates/${t.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isNew && existing.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!isNew && existing.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {(existing.error as Error).message}
      </p>
    );
  }

  const previewHtml = render.data?.html ?? html;

  return (
    <div className="space-y-6">
      <Link to="/templates" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All templates
      </Link>
      <PageHeader
        title={isNew ? "New template" : name || "Template"}
        description={readOnly ? "This is a starter template. Make a copy to edit it." : "Edit on the left, see the rendered email on the right."}
        actions={
          readOnly ? (
            <Button onClick={() => dup.mutate()} loading={dup.isPending}>
              <Copy aria-hidden /> Make an editable copy
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (!name.trim() || !subject.trim() || !html.trim()) return void toast.error("A name, a subject and some HTML are required.");
                save.mutate();
              }}
              loading={save.isPending}
            >
              Save template
            </Button>
          )
        }
      />

      <div className="grid gap-8 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="t-name" label="Template name">
              <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} readOnly={readOnly} />
            </Field>
            <Field id="t-subject" label="Subject line">
              <Input id="t-subject" value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={readOnly} placeholder="Hello {{first_name | default: &quot;there&quot;}}" />
            </Field>
          </div>
          <Field id="t-pre" label="Preheader" hint="The grey preview text some inboxes show after the subject.">
            <Input id="t-pre" value={preheader} onChange={(e) => setPreheader(e.target.value)} readOnly={readOnly} />
          </Field>
          {readOnly ? (
            <div className="space-y-2">
              <label htmlFor="t-html-ro" className="text-sm font-medium">
                HTML
              </label>
              <textarea id="t-html-ro" readOnly value={html} rows={22} className="block w-full rounded-md border border-input bg-muted/40 p-3 font-mono text-[13px]" />
            </div>
          ) : (
            <HtmlEditor id="t-html" value={html} onChange={setHtml} customFields={fields.data ?? []} />
          )}
          {!readOnly ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Plain-text version (optional)</summary>
              <p className="mt-1 text-xs text-muted-foreground">Leave empty to generate one from the HTML.</p>
              <textarea aria-label="Plain-text version" value={text} onChange={(e) => setText(e.target.value)} rows={6} className="mt-2 block w-full rounded-md border border-input bg-card p-3 font-mono text-[13px]" />
            </details>
          ) : null}
        </div>

        <div className="space-y-3">
          <div aria-live="polite" className="space-y-1.5 text-sm">
            {unknown.length > 0 ? (
              <p className="flex items-start gap-2 text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Unknown merge tags: <span className="font-mono">{unknown.map((u) => `{{${u}}}`).join(" ")}</span>. They will be empty unless a contact field has that key.
                </span>
              </p>
            ) : null}
            {noUnsub ? (
              <p className="flex items-start gap-2 text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  No <span className="font-mono">{"{{unsubscribe_url}}"}</span> link. A campaign needs one; we add a footer link if you leave it out, but placing it yourself looks better.
                </span>
              </p>
            ) : null}
            {render.data?.missingTags?.length ? (
              <p className="text-muted-foreground">Empty for the sample contact: {render.data.missingTags.join(", ")}</p>
            ) : null}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Subject preview</p>
            <p className="border-y py-2 text-sm font-medium">{render.data?.subject ?? subject ?? ""}</p>
          </div>
          <PreviewFrame html={previewHtml} title="Rendered email preview, scripts disabled" height={640} />
          <p className="text-xs text-muted-foreground">The preview runs in a sandbox: scripts and forms are switched off, exactly as in most inboxes.</p>
        </div>
      </div>
    </div>
  );
}
