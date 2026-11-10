import { describe, expect, it } from "vitest";
import type { CampaignStats } from "@open-email/types";
import { formatRate, funnelSteps, linePath, niceMax, ratio, scaleSeries, summariseTimeline } from "./report";

const stats: CampaignStats = { recipients: 1100, sent: 1000, delivered: 960, opened: 480, clicked: 96, bounced: 40, complained: 1, unsubscribed: 3, skipped: 100 };

describe("report math", () => {
  it("never divides by zero", () => {
    expect(ratio(5, 0)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });

  it("formats rates with sensible precision", () => {
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(0.0004)).toBe("0.04%");
    expect(formatRate(0.045)).toBe("4.5%");
    expect(formatRate(0.5)).toBe("50%");
    expect(formatRate(NaN)).toBe("0%");
  });

  it("builds the funnel from sent to clicked", () => {
    const steps = funnelSteps(stats);
    expect(steps.map((s) => s.key)).toEqual(["sent", "delivered", "opened", "clicked"]);
    expect(steps[1].ofSent).toBeCloseTo(0.96);
    expect(steps[2].ofPrevious).toBeCloseTo(0.5);
    expect(steps[3].ofPrevious).toBeCloseTo(0.2);
    expect(funnelSteps({ ...stats, sent: 0, delivered: 0, opened: 0, clicked: 0 })[3].ofSent).toBe(0);
  });

  it("rounds chart maxima to 1, 2, 5", () => {
    expect([0, 1, 3, 7, 12, 480, 1200].map(niceMax)).toEqual([1, 1, 5, 10, 20, 500, 2000]);
  });

  it("scales a series into the chart box", () => {
    const pts = scaleSeries([0, 5, 10], 100, 50, 10);
    expect(pts).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 25 },
      { x: 100, y: 0 },
    ]);
    expect(scaleSeries([3], 100, 50, 0)).toEqual([{ x: 50, y: 50 }]);
    expect(linePath(pts)).toBe("M0.0 50.0 L50.0 25.0 L100.0 0.0");
  });

  it("summarises the timeline", () => {
    const s = summariseTimeline([
      { at: "a", opens: 1, clicks: 0 },
      { at: "b", opens: 9, clicks: 2 },
      { at: "c", opens: 3, clicks: 1 },
    ]);
    expect(s).toEqual({ peakOpensAt: "b", totalOpens: 13, totalClicks: 3 });
    expect(summariseTimeline([]).peakOpensAt).toBeNull();
  });
});
