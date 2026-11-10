import { Check, CircleHelp, Minus, X } from "lucide-react";
import * as React from "react";

import { CopyButton } from "@/components/common/CopyButton";
import { groupRecords, parentZone, relativeName, type GroupState, type RecordGroup } from "@/lib/dns";
import { cn } from "@/lib/utils";
import type { DnsRecord } from "@/types";

function FoundText({ found }: { found: boolean | null }) {
  if (found === true)
    return (
      <span className="inline-flex items-center gap-1.5 text-success">
        <Check className="size-3.5" aria-hidden /> Found
      </span>
    );
  if (found === false)
    return (
      <span className="inline-flex items-center gap-1.5 text-danger">
        <X className="size-3.5" aria-hidden /> Not found
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Minus className="size-3.5" aria-hidden /> Not checked yet
    </span>
  );
}

const STATE_TEXT: Record<GroupState, { label: string; cls: string }> = {
  found: { label: "All found", cls: "text-success" },
  missing: { label: "Not found yet", cls: "text-danger" },
  unchecked: { label: "Not checked yet", cls: "text-muted-foreground" },
};

function RecordRow({ record, zone, relative }: { record: DnsRecord; zone: string; relative: boolean }) {
  const name = relative ? relativeName(record.name, zone) : record.name;
  return (
    <tr className="border-b last:border-b-0 align-top">
      <td className="w-16 py-3 pr-3 text-xs font-semibold">{record.type}</td>
      <td className="py-3 pr-3">
        <div className="flex items-start gap-1">
          <code className="min-w-0 break-all font-mono text-xs">{name}</code>
          <CopyButton value={name} label={`${record.purpose} record name`} />
        </div>
      </td>
      <td className="py-3 pr-3">
        <div className="flex items-start gap-1">
          <code className="min-w-0 break-all font-mono text-xs">{record.value}</code>
          <CopyButton value={record.value} label={`${record.purpose} record value`} />
        </div>
      </td>
      <td className="whitespace-nowrap py-3 text-xs">
        <FoundText found={record.found} />
      </td>
    </tr>
  );
}

function Group({ group, zone, relative }: { group: RecordGroup; zone: string; relative: boolean }) {
  const st = STATE_TEXT[group.state];
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="border-t pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={id} className="font-display text-[15px] font-semibold tracking-tight">
          {group.title}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{group.required ? "Required" : "Recommended"}</span>
        </h3>
        <p className={cn("text-xs font-medium", st.cls)}>
          {st.label}
          <span className="font-normal text-muted-foreground">
            {" "}
            ({group.foundCount} of {group.records.length})
          </span>
        </p>
      </div>
      {group.help ? (
        <details className="group mt-1.5">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
            <CircleHelp className="size-3.5" aria-hidden /> What does this do?
          </summary>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{group.help}</p>
        </details>
      ) : null}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left">
          <caption className="sr-only">{group.title} DNS records</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Name</th>
              <th scope="col">Value</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {group.records.map((r, i) => (
              <RecordRow key={`${r.type}-${r.name}-${i}`} record={r} zone={zone} relative={relative} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** DNS records grouped by what they do, each with copy buttons and a found or not found status. */
export function DnsWizard({ domain, records }: { domain: string; records: DnsRecord[] }) {
  const [relative, setRelative] = React.useState(false);
  const zone = parentZone(domain);
  const groups = React.useMemo(() => groupRecords(records), [records]);
  return (
    <div className="space-y-5">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input type="checkbox" checked={relative} onChange={(e) => setRelative(e.target.checked)} className="mt-1 size-4 accent-[rgb(var(--brand))]" />
        <span>
          My DNS provider adds the domain for me
          <span className="block text-xs text-muted-foreground">
            Cloudflare, Route 53 and most registrars want the name without <span className="font-mono">.{zone}</span> on the end. Tick this to show names that way.
          </span>
        </span>
      </label>
      {groups.map((g) => (
        <Group key={g.purpose} group={g} zone={zone} relative={relative} />
      ))}
    </div>
  );
}
