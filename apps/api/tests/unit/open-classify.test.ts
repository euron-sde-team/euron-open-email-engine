import { describe, expect, it } from "vitest";
import { classifyHit } from "../../src/utils/open-classify";

const APPLE_IP = ["17", "58", "12", "4"].join(".");

describe("machine hit classification", () => {
  it("flags Apple Mail Privacy Protection by its network", () => {
    expect(classifyHit({ kind: "open", ip: APPLE_IP, userAgent: "Mozilla/5.0 (Macintosh)" })).toEqual({ machine: true, uaClass: "apple-mpp" });
    expect(classifyHit({ kind: "open", ip: "172.16.0.1", userAgent: "Mozilla/5.0" }).uaClass).not.toBe("apple-mpp");
  });

  it("flags Google and Yahoo image proxies", () => {
    expect(classifyHit({ kind: "open", userAgent: "Mozilla/5.0 (Windows NT 5.1) GoogleImageProxy" }).uaClass).toBe("google-proxy");
    expect(classifyHit({ kind: "open", userAgent: "YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html" }).uaClass).toBe("yahoo-proxy");
  });

  it("flags prefetch purpose headers and instant hits", () => {
    expect(classifyHit({ kind: "open", purpose: "prefetch", userAgent: "Mozilla/5.0" })).toEqual({ machine: true, uaClass: "prefetch" });
    expect(classifyHit({ kind: "open", sinceSentMs: 1200, userAgent: "Mozilla/5.0 Safari" })).toEqual({ machine: true, uaClass: "prefetch" });
    expect(classifyHit({ kind: "open", sinceSentMs: 60_000, userAgent: "Mozilla/5.0 Safari" }).machine).toBe(false);
  });

  it("flags link scanners and bots on clicks", () => {
    expect(classifyHit({ kind: "click", userAgent: "Mozilla/5.0 (compatible; Proofpoint)" }).uaClass).toBe("scanner");
    expect(classifyHit({ kind: "click", userAgent: "curl/8.4.0" }).uaClass).toBe("bot");
  });

  it("treats an ordinary browser as a person", () => {
    expect(classifyHit({ kind: "click", ip: "198.51.100.4", userAgent: "Mozilla/5.0 (iPhone) AppleWebKit Safari", sinceSentMs: 3_600_000 })).toEqual({ machine: false, uaClass: "browser" });
    expect(classifyHit({ kind: "open", userAgent: "" })).toEqual({ machine: false, uaClass: "unknown" });
  });

  it("does not treat the Apple network as a machine for clicks", () => {
    expect(classifyHit({ kind: "click", ip: APPLE_IP, userAgent: "Mozilla/5.0 Safari", sinceSentMs: 100_000 }).machine).toBe(false);
  });
});
