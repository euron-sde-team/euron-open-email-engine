import type { FunnelStep } from "@/lib/report";
import { formatRate } from "@/lib/report";
import { formatNumber } from "@/lib/format";

const W = 640;
const ROW = 44;
const LABEL_W = 96;
const VALUE_W = 150;

/** Sent, delivered, opened, clicked as horizontal bars scaled to the number sent. */
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const h = steps.length * ROW + 4;
  const barW = W - LABEL_W - VALUE_W;
  const summary = steps.map((s) => `${s.label} ${formatNumber(s.value)} (${formatRate(s.ofSent)} of sent)`).join(", ");
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`Delivery funnel: ${summary}`} className="h-auto w-full">
        {steps.map((s, i) => {
          const y = i * ROW + 6;
          const w = Math.max(s.value > 0 ? 3 : 0, s.ofSent * barW);
          return (
            <g key={s.key}>
              <text x={0} y={y + 20} className="fill-foreground text-[14px] font-medium">
                {s.label}
              </text>
              <rect x={LABEL_W} y={y + 4} width={barW} height={22} className="fill-muted" />
              <rect x={LABEL_W} y={y + 4} width={w} height={22} className={s.key === "clicked" ? "fill-brand" : s.key === "opened" ? "fill-brand/70" : "fill-brand/40"} />
              <text x={W} y={y + 20} textAnchor="end" className="fill-foreground text-[14px] tabular-nums">
                {formatNumber(s.value)}
                <tspan className="fill-muted-foreground"> {i === 0 ? "" : formatRate(s.ofSent)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
