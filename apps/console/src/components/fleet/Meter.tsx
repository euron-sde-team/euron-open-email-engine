import { formatUsage, usageRatio, usageTone } from "@/lib/fleet";
import { cn } from "@/lib/utils";

const FILL: Record<string, string> = {
  ok: "bg-brand",
  warn: "bg-warning",
  danger: "bg-destructive",
};

interface MeterProps {
  label: string;
  used: number;
  limit: number | null;
}

/** Usage against a limit: a label, "used of limit" and a thin hairline bar. */
export function Meter({ label, used, limit }: MeterProps) {
  const ratio = usageRatio(used, limit);
  const tone = usageTone(used, limit);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{formatUsage(used, limit)}</span>
      </div>
      {ratio == null ? (
        <p className="mt-2 text-xs text-muted-foreground">No limit on this plan.</p>
      ) : (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit ?? 0}
          aria-valuenow={Math.min(used, limit ?? used)}
          aria-valuetext={formatUsage(used, limit)}
          className="mt-2 h-0.5 w-full bg-border"
        >
          <div
            className={cn("h-full transition-[width] duration-300", FILL[tone])}
            style={{ width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
          />
        </div>
      )}
    </div>
  );
}
