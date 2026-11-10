import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import config, { assertProductionConfig } from "../../src/config";
import { planSnapshotSpecs } from "../../src/services/operator/plan-snapshot";
import storageService from "../../src/services/storage.service";
import type { PlanRow } from "../../src/repositories/operator/plans.repository";

const random = (n: number) => "x".repeat(n);

describe("production config guard", () => {
  const prod = { ...config, isProduction: true };
  const strong = {
    ...prod,
    JWT_SECRET: random(40),
    EMAIL_UNSUBSCRIBE_SIGNING_SECRET: random(40),
    EMAIL_TRACKING_SIGNING_SECRET: random(40),
    EMAIL_SES_MODE: "aws" as const,
    APP_PUBLIC_URL: "https://mail.example.com",
  };

  it("refuses the development JWT secret", () => {
    expect(() => assertProductionConfig(prod)).toThrow(/JWT_SECRET/);
  });

  it("refuses short secrets, an empty origin list and weak link-signing secrets", () => {
    expect(() => assertProductionConfig({ ...strong, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
    expect(() => assertProductionConfig({ ...strong, CORS_ORIGINS: [] })).toThrow(/CORS_ORIGINS/);
    expect(() => assertProductionConfig({ ...strong, EMAIL_TRACKING_SIGNING_SECRET: "dev-only-jwt-secret-change-me" })).toThrow(/EMAIL_TRACKING_SIGNING_SECRET/);
    expect(() => assertProductionConfig({ ...strong, EMAIL_UNSUBSCRIBE_SIGNING_SECRET: "x" })).toThrow(/EMAIL_UNSUBSCRIBE_SIGNING_SECRET/);
  });

  it("refuses simulated sending and a non-public link origin", () => {
    expect(() => assertProductionConfig({ ...strong, EMAIL_SES_MODE: "simulated" })).toThrow(/EMAIL_SES_MODE/);
    // Unset is refused too: production must say aws explicitly, never rely on key detection.
    expect(() => assertProductionConfig({ ...strong, EMAIL_SES_MODE: "" })).toThrow(/EMAIL_SES_MODE must be set to aws/);
    expect(() => assertProductionConfig({ ...strong, APP_PUBLIC_URL: "http://localhost:5126" })).toThrow(/APP_PUBLIC_URL/);
    expect(() => assertProductionConfig({ ...strong, APP_PUBLIC_URL: "http://mail.example.com" })).toThrow(/APP_PUBLIC_URL/);
  });

  it("accepts a fully configured production environment", () => {
    expect(() => assertProductionConfig(strong)).not.toThrow();
  });

  it("does nothing outside production", () => {
    expect(() => assertProductionConfig({ ...config, isProduction: false })).not.toThrow();
  });
});

describe("CORS", () => {
  it("echoes an allowed origin", async () => {
    const origin = config.CORS_ORIGINS[0];
    const res = await request(app).options("/api/v1/contacts").set("Origin", origin);
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("gives an unknown origin no CORS headers", async () => {
    const res = await request(app).options("/api/v1/contacts").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("local file links", () => {
  it("serves a file only through an unexpired signed link", async () => {
    const key = `test/hardening-${Date.now()}.txt`;
    await storageService.upload({ key, body: Buffer.from("hello"), contentType: "text/plain" });
    const url = new URL(await storageService.getDownloadUrl(key, 60));
    const path = `${url.pathname}${url.search}`;

    const ok = await request(app).get(path);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("hello");

    expect((await request(app).get(url.pathname)).status).toBe(403);
    const tampered = path.replace(/sig=[^&]+/, "sig=AAAA");
    expect((await request(app).get(tampered)).status).toBe(403);
    const expired = path.replace(/expires=\d+/, "expires=1");
    expect((await request(app).get(expired)).status).toBe(403);

    await storageService.delete(key);
  });

  it("refuses keys that escape the storage root", async () => {
    await expect(
      storageService.upload({ key: "../escape.txt", body: Buffer.from("x") })
    ).rejects.toThrow(/invalid storage key/);
  });
});

describe("plan snapshot", () => {
  const plan = (modules: string[], limits: Record<string, number | null>) =>
    ({ modules, limits }) as unknown as PlanRow;

  it("writes a module gate per module and one row per limit", () => {
    const specs = planSnapshotSpecs(plan(["audience", "campaigns"], { monthlyEmails: 5000, maxContacts: 100, maxDomains: 1, maxUsers: 3 }));
    expect(specs.filter((s) => s.code.startsWith("module.")).map((s) => s.code)).toEqual(["module.audience", "module.campaigns"]);
    expect(specs.find((s) => s.code === "limit.monthly_emails")?.limit_value).toBe(5000);
    expect(specs.find((s) => s.code === "limit.max_users")?.limit_value).toBe(3);
  });

  it("treats a missing or null limit as unlimited", () => {
    const specs = planSnapshotSpecs(plan(["audience"], { monthlyEmails: null }));
    expect(specs.find((s) => s.code === "limit.monthly_emails")?.limit_value).toBeNull();
    expect(specs.find((s) => s.code === "limit.max_contacts")?.limit_value).toBeNull();
  });
});
