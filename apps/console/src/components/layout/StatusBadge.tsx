import { sendingTone } from "@/lib/fleet";
import { cn } from "@/lib/utils";

// Status as plain small type led by a 6px dot. No pill. Covers tenant states
// (ACTIVE, SUSPENDED, CLOSED), operator states and the per-tenant sending
// states (WARNING, THROTTLED, PAUSED).
const STATUS_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  ACTIVE: { dot: "bg-success", text: "text-success", label: "Active" },
  SUSPENDED: { dot: "bg-warning", text: "text-warning", label: "Suspended" },
  CLOSED: { dot: "bg-destructive", text: "text-destructive", label: "Closed" },
  DISABLED: { dot: "bg-destructive", text: "text-destructive", label: "Disabled" },
  PENDING: { dot: "bg-warning", text: "text-warning", label: "Pending" },
  VERIFIED: { dot: "bg-success", text: "text-success", label: "Verified" },
  FAILED: { dot: "bg-destructive", text: "text-destructive", label: "Failed" },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const known = STATUS_STYLES[status];
  const style = known ?? {
    dot: sendingTone(status).dot,
    text: sendingTone(status).text,
    label: sendingTone(status).label === "Unknown" ? status : sendingTone(status).label,
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium",
        style.text,
        className
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}
