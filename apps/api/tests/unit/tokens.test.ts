import { describe, expect, it } from "vitest";
import { hashIp, signToken, verifyToken } from "../../src/utils/tokens";
import { clickUrlIsSafe } from "../../src/utils/url-safety";
import { clickUrl, confirmUrl, openPixelUrl, unsubscribeUrl } from "../../src/utils/links";

describe("signed tokens", () => {
  it("round-trips the payload", () => {
    const t = signToken({ kind: "u", parts: ["T1", "C1", "M1"] });
    expect(verifyToken(t, "u")).toMatchObject({ kind: "u", parts: ["T1", "C1", "M1"] });
  });

  it("rejects a token of another kind, even though the signature is valid for its own kind", () => {
    const t = signToken({ kind: "u", parts: ["T1", "C1", "M1"] });
    expect(verifyToken(t, "w")).toBeNull();
    expect(verifyToken(t, "o")).toBeNull();
  });

  it("rejects any change to the payload or the signature", () => {
    const t = signToken({ kind: "w", parts: ["M1"] });
    const [body, sig] = t.split("~");
    const forgedBody = Buffer.from(Buffer.from(body, "base64url").toString().replace("M1", "M2")).toString("base64url");
    expect(verifyToken(`${forgedBody}~${sig}`, "w")).toBeNull();
    expect(verifyToken(`${body}~${sig.slice(0, -2)}AA`, "w")).toBeNull();
    expect(verifyToken(`${body}~`, "w")).toBeNull();
    expect(verifyToken("garbage", "w")).toBeNull();
    expect(verifyToken("a~b~c", "w")).toBeNull();
    expect(verifyToken("x".repeat(700), "w")).toBeNull();
  });

  it("is signed with a secret, not just encoded", () => {
    const a = signToken({ kind: "w", parts: ["M1"] }, "secret-a-secret-a-secret-a-secret-a-");
    expect(verifyToken(a, "w", { secret: "secret-b-secret-b-secret-b-secret-b-" })).toBeNull();
    expect(verifyToken(a, "w", { secret: "secret-a-secret-a-secret-a-secret-a-" })).not.toBeNull();
  });

  it("tracking and unsubscribe links use different secrets", () => {
    const open = signToken({ kind: "o", parts: ["M1"] }, "t".repeat(40));
    expect(verifyToken(open, "o", { secret: "u".repeat(40) })).toBeNull();
  });

  it("honours expiry", () => {
    const t = signToken({ kind: "k", parts: ["T", "C", "L"], exp: 1000 });
    expect(verifyToken(t, "k", { now: 999_000 })).not.toBeNull();
    expect(verifyToken(t, "k", { now: 1_001_000 })).toBeNull();
  });

  it("refuses parts that could break the format", () => {
    expect(() => signToken({ kind: "w", parts: ["a|b"] })).toThrow();
    expect(() => signToken({ kind: "w", parts: ["a~b"] })).toThrow();
    expect(() => signToken({ kind: "w", parts: [""] })).toThrow();
  });

  it("builds public links on the configured origin", () => {
    const base = "https://links.example.com";
    expect(openPixelUrl(base, "M1")).toMatch(/^https:\/\/links\.example\.com\/t\/o\/[\w-]+~[\w-]+\.gif$/);
    expect(clickUrl(base, "M1", "tok")).toMatch(/\/t\/c\//);
    expect(unsubscribeUrl(base, "T", "C", null)).toMatch(/\/u\//);
    expect(confirmUrl(base, "T", "C", "L")).toMatch(/\/c\//);
  });

  it("hashes IPs without keeping them", () => {
    const h = hashIp("203.0.113.9");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(hashIp(null)).toBeNull();
  });
});

describe("redirect target safety", () => {
  it("allows http and https only, without credentials", () => {
    expect(clickUrlIsSafe("https://example.com/a?b=1")).toBe(true);
    expect(clickUrlIsSafe("http://example.com")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "//evil.example", "https://u:p@example.com", "not a url", "file:///etc/passwd", "https://" + "a".repeat(2100)]) {
      expect(clickUrlIsSafe(bad)).toBe(false);
    }
  });
});
