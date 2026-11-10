import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportJob, ImportUpload } from "@open-email/types";
import { FileUp, Upload } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Field, Section } from "@/components/common/Section";
import { SimpleSelect } from "@/components/common/SimpleSelect";
import { Stepper } from "@/components/common/Stepper";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/ui/tag-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getImport, listCustomFields, listImports, listLists, startImport, uploadImport } from "@/lib/api/contacts";
import { formatDateTime, formatNumber } from "@/lib/format";
import { mappedColumns, suggestMapping, validateMapping, type ImportMapping, type MappingTarget } from "@/lib/import-mapping";
import { cn } from "@/lib/utils";

const MAX_BYTES = 10 * 1024 * 1024;
const STEPS = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Map columns" },
  { key: "review", label: "Review and results" },
];

const TARGET_LABEL: Record<string, string> = {
  email: "Email address",
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name (split on the first space)",
  tags: "Tags (comma separated)",
  skip: "Do not import",
};

function Upload1({ onUploaded }: { onUploaded: (u: ImportUpload) => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const up = useMutation({
    mutationFn: (f: File) => uploadImport(f),
    onSuccess: onUploaded,
    onError: (e: Error) => setError(e.message),
  });
  const take = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") return void setError("Choose a .csv file.");
    if (f.size > MAX_BYTES) return void setError("That file is over 10 MB. Split it and import the parts.");
    up.mutate(f);
  };
  return (
    <div className="space-y-4">
      {/* Drag and drop is an extra; the button below is the keyboard path. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          take(e.dataTransfer.files[0]);
        }}
        className={cn("flex flex-col items-center gap-3 border-y border-dashed px-6 py-14 text-center transition-colors", drag && "bg-muted")}
      >
        <FileUp className="size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <p className="text-sm">Drop a CSV file here, or</p>
        <Button onClick={() => input.current?.click()} loading={up.isPending}>
          <Upload aria-hidden /> Choose a file
        </Button>
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => take(e.target.files?.[0])} />
        <p className="text-xs text-muted-foreground">Up to 10 MB and 100,000 rows. The first row must be column names.</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function JobResult({ job }: { job: ImportJob }) {
  const running = job.status === "QUEUED" || job.status === "PROCESSING";
  return (
    <div className="space-y-5">
      <p className="text-sm" role="status" aria-live="polite">
        {running ? "Importing... this page updates by itself." : job.status === "DONE" ? "Import finished." : "Import failed."}
      </p>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        {(
          [
            ["Rows", job.total],
            ["New contacts", job.created],
            ["Updated", job.updated],
            ["Skipped", job.skipped],
          ] as const
        ).map(([l, n]) => (
          <div key={l} className="border-t pt-2">
            <dt className="text-xs text-muted-foreground">{l}</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{formatNumber(n)}</dd>
          </div>
        ))}
      </dl>
      {job.errors.length > 0 ? (
        <Section title="Rows that were skipped" description="Fix these in your file and import again. Contacts who unsubscribed, bounced or complained are never changed by an import." headingLevel={3}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {job.errors.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="tabular-nums">{e.row}</TableCell>
                  <TableCell>{e.email ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </div>
  );
}

export default function ImportPage() {
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFields });
  const lists = useQuery({ queryKey: ["lists"], queryFn: listLists });
  const history = useQuery({ queryKey: ["imports"], queryFn: listImports });

  const [step, setStep] = React.useState(0);
  const [upload, setUpload] = React.useState<ImportUpload | null>(null);
  const [mapping, setMapping] = React.useState<ImportMapping>({});
  const [listId, setListId] = React.useState("none");
  const [tags, setTags] = React.useState<string[]>([]);
  const [consent, setConsent] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(null);

  const job = useQuery({
    queryKey: ["import", jobId],
    queryFn: () => getImport(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "QUEUED" || q.state.data.status === "PROCESSING") ? 1500 : false),
  });
  const done = job.data && (job.data.status === "DONE" || job.data.status === "FAILED");
  React.useEffect(() => {
    if (done) {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["imports"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  }, [done, qc]);

  const start = useMutation({
    mutationFn: () => startImport(upload!.id, { mapping, listId: listId === "none" ? null : listId, tags, consentConfirmed: consent }),
    onSuccess: (j) => setJobId(j.id),
    onError: (e: Error) => toast.error(e.message),
  });

  const customOptions = (fields.data ?? []).map((f) => ({ key: f.key, label: f.label }));
  const targetOptions = [
    ...Object.entries(TARGET_LABEL).map(([value, label]) => ({ value, label })),
    ...customOptions.map((f) => ({ value: `attr:${f.key}`, label: `Custom field: ${f.label}` })),
  ];
  const check = validateMapping(mapping);
  const columns = mappedColumns(mapping);

  const reset = () => {
    setStep(0);
    setUpload(null);
    setMapping({});
    setListId("none");
    setTags([]);
    setConsent(false);
    setJobId(null);
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Import contacts" description="Bring contacts in from a CSV file. Existing contacts are matched by email and updated, never duplicated." />
      <Stepper steps={STEPS} current={step} onSelect={jobId ? undefined : setStep} />

      {step === 0 ? (
        <>
          <Upload1
            onUploaded={(u) => {
              setUpload(u);
              setMapping(suggestMapping(u.headers, customOptions));
              setStep(1);
            }}
          />
          {(history.data ?? []).length > 0 ? (
            <Section title="Recent imports">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead className="text-right">Skipped</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history.data ?? []).slice(0, 8).map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>{j.fileName}</TableCell>
                      <TableCell className="text-muted-foreground">{j.status.charAt(0) + j.status.slice(1).toLowerCase()}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(j.total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(j.created)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(j.skipped)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(j.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          ) : null}
        </>
      ) : null}

      {step === 1 && upload ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{upload.fileName}</strong>: {formatNumber(upload.totalRows)} rows. Tell us what each column holds. We guessed from the headings.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Map each CSV column to a contact field</caption>
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Column
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Examples
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Import as
                  </th>
                </tr>
              </thead>
              <tbody>
                {upload.headers.map((h, i) => (
                  <tr key={`${h}-${i}`} className="border-b align-middle">
                    <th scope="row" className="py-2.5 pr-4 font-medium">
                      {h || <span className="text-muted-foreground">(no heading)</span>}
                    </th>
                    <td className="max-w-64 truncate py-2.5 pr-4 text-muted-foreground">{upload.sampleRows.slice(0, 3).map((r) => r[i]).filter(Boolean).join(", ") || "-"}</td>
                    <td className="py-2.5">
                      <SimpleSelect aria-label={`Import column ${h || i + 1} as`} className="w-72" value={mapping[h] ?? "skip"} onChange={(v) => setMapping((m) => ({ ...m, [h]: v as MappingTarget }))} options={targetOptions} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field id="imp-list" label="Add everyone to a list">
              <SimpleSelect id="imp-list" value={listId} onChange={setListId} options={[{ value: "none", label: "Do not add to a list" }, ...(lists.data ?? []).map((l) => ({ value: l.id, label: l.name }))]} />
            </Field>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Tag everyone (optional)</span>
              <TagInput value={tags} onChange={setTags} placeholder="Type a tag and press Enter" />
            </div>
          </div>
          {!check.ok ? (
            <ul role="alert" className="space-y-1 text-sm text-danger">
              {check.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset}>
              Start over
            </Button>
            <Button disabled={!check.ok} onClick={() => setStep(2)}>
              Continue to review
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 && upload ? (
        <div className="space-y-6">
          {!jobId ? (
            <>
              <Section title="Ready to import" headingLevel={2}>
                <dl className="divide-y border-y text-sm">
                  <div className="flex justify-between py-2.5">
                    <dt className="text-muted-foreground">File</dt>
                    <dd>
                      {upload.fileName} ({formatNumber(upload.totalRows)} rows)
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">Columns imported</dt>
                    <dd className="text-right">{columns.map((c) => `${c.header} as ${(TARGET_LABEL[c.target] ?? c.target.replace("attr:", "")).split(" (")[0].toLowerCase()}`).join("; ")}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-muted-foreground">List</dt>
                    <dd>{listId === "none" ? "None" : (lists.data ?? []).find((l) => l.id === listId)?.name}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-muted-foreground">Tags</dt>
                    <dd>{tags.join(", ") || "None"}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">People who already unsubscribed, bounced or complained keep that status. Rows without a valid email are skipped and listed in the results.</p>
              </Section>
              <label className="flex max-w-2xl cursor-pointer items-start gap-2.5 text-sm">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 accent-[rgb(var(--brand))]" />
                <span>I confirm these people agreed to receive email from me, and I will honour unsubscribes.</span>
              </label>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button disabled={!consent} loading={start.isPending} onClick={() => start.mutate()}>
                  Start import
                </Button>
              </div>
            </>
          ) : job.data ? (
            <>
              <JobResult job={job.data} />
              {done ? (
                <div className="flex gap-2">
                  <Button asChild>
                    <Link to="/contacts">View contacts</Link>
                  </Button>
                  <Button variant="outline" onClick={reset}>
                    Import another file
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Starting...</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
