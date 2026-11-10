import { cn } from "@/lib/utils";

export interface Step {
  key: string;
  label: string;
}

/** A row of numbered steps on a hairline. The current step is marked for screen readers. */
export function Stepper({ steps, current, onSelect }: { steps: Step[]; current: number; onSelect?: (index: number) => void }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex flex-wrap gap-x-8 gap-y-2 border-b">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          const clickable = Boolean(onSelect) && i < current;
          const inner = (
            <>
              <span className={cn("tabular-nums", state === "todo" ? "text-muted-foreground" : "text-brand")}>{i + 1}</span>
              <span>{s.label}</span>
              {state === "done" ? <span className="sr-only"> (completed)</span> : null}
            </>
          );
          const cls = cn(
            "-mb-px inline-flex items-center gap-2 border-b-2 py-2.5 text-sm font-medium",
            state === "current" ? "border-brand text-foreground" : "border-transparent",
            state === "todo" ? "text-muted-foreground" : state === "done" ? "text-foreground" : "",
          );
          return (
            <li key={s.key}>
              {clickable ? (
                <button type="button" onClick={() => onSelect?.(i)} className={cn(cls, "hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
                  {inner}
                </button>
              ) : (
                <span className={cls} aria-current={state === "current" ? "step" : undefined}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
