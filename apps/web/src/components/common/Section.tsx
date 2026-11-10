import * as React from "react";

import { cn } from "@/lib/utils";

/** A titled block set on a top hairline. No box. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const H = `h${headingLevel}` as "h2" | "h3";
  return (
    <section className={cn("border-t pt-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <H className="font-display text-base font-semibold tracking-tight">{title}</H>
          {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Label, control and hint or error in one place, so every form reads the same. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** "Key: value" rows on hairlines. */
export function FactList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="divide-y border-y text-sm">
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-[10rem_1fr] gap-3 py-2.5">
          <dt className="text-muted-foreground">{i.label}</dt>
          <dd className="min-w-0 break-words">{i.value || <span className="text-muted-foreground">-</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
