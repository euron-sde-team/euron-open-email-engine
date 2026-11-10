import type { SegmentCondition, SegmentField, SegmentOp, SegmentRules } from "@open-email/types";
import { Plus, X } from "lucide-react";
import * as React from "react";

import { SimpleSelect } from "@/components/common/SimpleSelect";
import { contactStatusLabel } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BASE_FIELDS,
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  OP_LABELS,
  changeField,
  changeOp,
  newCondition,
  opsFor,
  valueKind,
  type AttrTypeLookup,
} from "@/lib/segments";
import type { ContactList, CustomField } from "@/types";

/** Builds the rules of a segment: "match all or any" and a row per condition. */
export function RuleBuilder({
  rules,
  onChange,
  lists,
  customFields,
}: {
  rules: SegmentRules;
  onChange: (next: SegmentRules) => void;
  lists: ContactList[];
  customFields: CustomField[];
}) {
  const uid = React.useId();
  const attrType: AttrTypeLookup = (key) => customFields.find((f) => f.key === key)?.type ?? "text";
  const fieldOptions = [
    ...BASE_FIELDS.map((f) => ({ value: f.field as string, label: f.label })),
    ...customFields.map((f) => ({ value: `attr:${f.key}`, label: f.label })),
  ];

  const set = (i: number, c: SegmentCondition) => onChange({ ...rules, conditions: rules.conditions.map((x, j) => (j === i ? c : x)) });
  const remove = (i: number) => onChange({ ...rules, conditions: rules.conditions.filter((_, j) => j !== i) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Contacts who match</span>
        <SimpleSelect
          aria-label="Match all or any condition"
          className="w-24"
          value={rules.match}
          onChange={(v) => onChange({ ...rules, match: v as SegmentRules["match"] })}
          options={[
            { value: "all", label: "all" },
            { value: "any", label: "any" },
          ]}
        />
        <span>of these conditions</span>
      </div>

      {rules.conditions.length === 0 ? <p className="text-sm text-muted-foreground">No conditions yet, so this segment matches every contact.</p> : null}

      <ul className="divide-y border-y">
        {rules.conditions.map((c, i) => {
          const kind = valueKind(c.field, c.op, attrType);
          const ops = opsFor(c.field, attrType);
          const rowLabel = `Condition ${i + 1}`;
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 py-3" role="group" aria-label={rowLabel}>
              <SimpleSelect aria-label={`${rowLabel} field`} className="w-48" value={c.field} onChange={(v) => set(i, changeField(c, v as SegmentField, attrType))} options={fieldOptions} />
              {ops.length > 1 || kind !== "none" ? (
                <SimpleSelect aria-label={`${rowLabel} operator`} className="w-44" value={c.op} onChange={(v) => set(i, changeOp(c, v as SegmentOp, attrType))} options={ops.map((o) => ({ value: o, label: OP_LABELS[o] }))} />
              ) : (
                <span className="px-1 text-sm text-muted-foreground">{OP_LABELS[c.op]}</span>
              )}
              <ValueInput id={`${uid}-${i}`} label={`${rowLabel} value`} kind={kind} cond={c} lists={lists} onChange={(v) => set(i, { ...c, value: v })} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${rowLabel.toLowerCase()}`} onClick={() => remove(i)} className="ml-auto">
                <X />
              </Button>
            </li>
          );
        })}
      </ul>

      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...rules, conditions: [...rules.conditions, newCondition("tag", attrType)] })}>
        <Plus aria-hidden /> Add condition
      </Button>
    </div>
  );
}

function ValueInput({
  id,
  label,
  kind,
  cond,
  lists,
  onChange,
}: {
  id: string;
  label: string;
  kind: ReturnType<typeof valueKind>;
  cond: SegmentCondition;
  lists: ContactList[];
  onChange: (v: SegmentCondition["value"]) => void;
}) {
  const v = cond.value;
  switch (kind) {
    case "none":
      return null;
    case "days":
      return (
        <div className="flex items-center gap-2">
          <Input id={id} aria-label={label} type="number" min={1} max={3650} className="w-24" value={v === undefined ? "" : String(v)} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
      );
    case "number":
      return <Input id={id} aria-label={label} type="number" className="w-32" value={v === undefined ? "" : String(v)} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <Input id={id} aria-label={label} type="date" className="w-44" value={typeof v === "string" ? v : ""} onChange={(e) => onChange(e.target.value)} />;
    case "boolean":
      return (
        <SimpleSelect
          aria-label={label}
          className="w-28"
          value={v === false ? "false" : "true"}
          onChange={(x) => onChange(x === "true")}
          options={[
            { value: "true", label: "yes" },
            { value: "false", label: "no" },
          ]}
        />
      );
    case "status":
      return <SimpleSelect aria-label={label} className="w-52" value={typeof v === "string" ? v : ""} placeholder="Choose status" onChange={onChange} options={CONTACT_STATUSES.map((s) => ({ value: s, label: contactStatusLabel(s) }))} />;
    case "source":
      return <SimpleSelect aria-label={label} className="w-40" value={typeof v === "string" ? v : ""} placeholder="Choose source" onChange={onChange} options={CONTACT_SOURCES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />;
    case "list":
      return <SimpleSelect aria-label={label} className="w-52" value={typeof v === "string" ? v : ""} placeholder="Choose list" onChange={onChange} options={lists.map((l) => ({ value: l.id, label: l.name }))} />;
    default:
      return <Input id={id} aria-label={label} className="w-56" value={typeof v === "string" ? v : ""} onChange={(e) => onChange(e.target.value)} placeholder={kind === "tag" ? "Tag name" : "Value"} />;
  }
}
