// Campaign report math: the funnel, rate formatting and the geometry for the plain
// SVG charts. Kept free of React so it can be tested.

import type { CampaignReport, CampaignStats } from "@open-email/types";

/** 0 when there is nothing to divide by. */
export const ratio = (n: number, d: number): number => (d > 0 ? n / d : 0);

/** 0.1234 as "12.3%"; values under 0.1% show two decimals so a tiny complaint rate is not "0.0%". */
export function formatRate(r: number): string {
  if (!Number.isFinite(r) || r <= 0) return "0%";
  const pct = r * 100;
  if (pct < 0.1) return `${pct.toFixed(2)}%`;
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

export interface FunnelStep {
  key: "sent" | "delivered" | "opened" | "clicked";
  label: string;
  value: number;
  /** Share of the first step. */
  ofSent: number;
  /** Share of the previous step. */
  ofPrevious: number;
}

export function funnelSteps(stats: CampaignStats): FunnelStep[] {
  const raw: Pick<FunnelStep, "key" | "label" | "value">[] = [
    { key: "sent", label: "Sent", value: stats.sent },
    { key: "delivered", label: "Delivered", value: stats.delivered },
    { key: "opened", label: "Opened", value: stats.opened },
    { key: "clicked", label: "Clicked", value: stats.clicked },
  ];
  return raw.map((s, i) => ({
    ...s,
    ofSent: ratio(s.value, stats.sent),
    ofPrevious: i === 0 ? 1 : ratio(s.value, raw[i - 1].value),
  }));
}

/** Round a chart maximum up to 1, 2, 5 times a power of ten so the axis reads cleanly. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export interface ChartPoint {
  x: number;
  y: number;
}

/** Points for one series scaled into a width x height box (y grows downward). */
export function scaleSeries(values: number[], width: number, height: number, max: number): ChartPoint[] {
  const n = values.length;
  return values.map((v, i) => ({
    x: n <= 1 ? width / 2 : (i / (n - 1)) * width,
    y: height - (max > 0 ? Math.min(v / max, 1) : 0) * height,
  }));
}

export const linePath = (pts: ChartPoint[]): string =>
  pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

export interface TimelineSummary {
  peakOpensAt: string | null;
  totalOpens: number;
  totalClicks: number;
}

export function summariseTimeline(timeline: CampaignReport["timeline"]): TimelineSummary {
  let peak = -1;
  let peakAt: string | null = null;
  let opens = 0;
  let clicks = 0;
  for (const t of timeline) {
    opens += t.opens;
    clicks += t.clicks;
    if (t.opens > peak) {
      peak = t.opens;
      peakAt = t.opens > 0 ? t.at : peakAt;
    }
  }
  return { peakOpensAt: peakAt, totalOpens: opens, totalClicks: clicks };
}

/** Share of opens flagged as machine opens, 0 to 1. */
export const machineShare = (report: Pick<CampaignReport, "machineOpens" | "campaign">): number =>
  ratio(report.machineOpens, report.campaign.stats.opened);
