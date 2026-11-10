import * as React from "react";

import { linePath, niceMax, scaleSeries } from "@/lib/report";
import { cn } from "@/lib/utils";

export interface LineSeries {
  name: string;
  values: number[];
  /** Tailwind stroke and fill classes, e.g. "stroke-brand". */
  stroke: string;
  dash?: string;
}

const W = 720;
const H = 220;
const PAD = { l: 44, r: 8, t: 10, b: 26 };

/**
 * A multi-series line chart in plain SVG. `labels` are the x positions (already formatted);
 * a visually hidden table carries the same numbers for screen readers.
 */
export function LineChart({
  labels,
  series,
  title,
  className,
}: {
  labels: string[];
  series: LineSeries[];
  title: string;
  className?: string;
}) {
  const id = React.useId();
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ticks = [0, max / 2, max];
  const tickIdx = labels.length <= 1 ? [0] : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
  return (
    <figure className={cn("m-0", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} className="h-auto w-full">
        <title id={`${id}-t`}>{title}</title>
        {ticks.map((t) => {
          const y = PAD.t + ih - (max > 0 ? t / max : 0) * ih;
          return (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
              <text x={PAD.l - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          );
        })}
        {tickIdx.map((i) => {
          const x = PAD.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
          return (
            <text key={i} x={x} y={H - 6} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
              {labels[i]}
            </text>
          );
        })}
        <g transform={`translate(${PAD.l} ${PAD.t})`}>
          {series.map((s) => {
            const pts = scaleSeries(s.values, iw, ih, max);
            return (
              <g key={s.name}>
                <path d={linePath(pts)} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dash} className={s.stroke} />
                {pts.length === 1 ? <circle cx={pts[0].x} cy={pts[0].y} r={3} className={cn(s.stroke, "fill-current")} /> : null}
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" x2="18" y1="3" y2="3" strokeWidth={2} strokeDasharray={s.dash} className={s.stroke} />
            </svg>
            {s.name}
          </span>
        ))}
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}-${i}`}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.name}>{s.values[i] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
