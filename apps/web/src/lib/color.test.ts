import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex } from "./color";

describe("color contrast", () => {
  it("parses six-digit hex only", () => {
    expect(parseHex("#ab1757")).toEqual([171, 23, 87]);
    expect(parseHex("ab1757")).toEqual([171, 23, 87]);
    expect(parseHex("#fff")).toBeNull();
  });

  it("matches known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // The default accent against white clears AA for body text.
    expect(contrastRatio("#ab1757", "#ffffff")!).toBeGreaterThan(7);
    expect(contrastRatio("nope", "#fff")).toBeNull();
  });
});
