/**
 * Shared helpers for the end-to-end suite. Setup goes through the real REST API (never the
 * database) so each test spends browser time only on the behaviour under test.
 *
 * The demo accounts come from the seed (apps/api/scripts/seed.ts, `make demo`): the
 * tenants Northwind Mail and Acme Robotics with an admin each, plus an operator for the console. Every
 * one signs in with the demo password: E2E_DEMO_PASSWORD, else EMAIL_DEMO_PASSWORD from
 * deploy/compose/.env (`make env`).
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const trim = (u: string) => u.replace(/\/+$/, "");

export const WEB = trim(process.env.E2E_BASE_URL || "http://localhost:3650");
export const CONSOLE = trim(process.env.E2E_CONSOLE_URL || "http://localhost:3660");
/** The tenant API base, as the tenant app uses it (VITE_API_BASE_URL). */
export const API = trim(process.env.E2E_API_URL || "http://localhost:5126/api/v1");
/** The operator plane, as the console uses it. */
export const OPERATOR_API = `${API}/operator`;
export const API_ORIGIN = API.replace(/\/api\/v1$/, "");
export const MAILPIT = trim(process.env.E2E_MAILPIT_URL || "http://localhost:8126");

export interface Account {
  email: string;
  password: string;
}

/** The password `make demo` seeded every account with. */
export function demoPassword(): string {
  if (process.env.E2E_DEMO_PASSWORD) return process.env.E2E_DEMO_PASSWORD;
  const file = path.join(__dirname, "..", "deploy", "compose", ".env");
  const line = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("EMAIL_DEMO_PASSWORD="))
    : undefined;
  if (!line) throw new Error("No demo password: run `make env && make demo`, or set E2E_DEMO_PASSWORD");
  return line.slice("EMAIL_DEMO_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
}

const demo = (email: string): Account => ({ email, password: demoPassword() });

/** Seeded demo accounts (see the seed's login summary). */
export const DEMO = {
  /** Northwind Mail (Growth plan, verified domain mail.northwind.example). */
  northwindAdmin: () => demo("maya@northwind.example"),
  /** Acme Robotics (Starter plan, domain still pending). Override with E2E_ACME_ADMIN. */
  acmeAdmin: () => demo(process.env.E2E_ACME_ADMIN || "sam@acme-robotics.example"),
  operator: () => demo("operator@example.com"),
} satisfies Record<string, () => Account>;

const run = randomBytes(3).toString("hex");
let seq = 0;

/** A unique suffix for names and addresses (lowercase letters and digits). */
export function uniq(prefix = "e2e"): string {
  seq += 1;
  return `${prefix}${run}${seq}${randomBytes(2).toString("hex")}`;
}

type Json = Record<string, unknown>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Calls the API, failing the test on an unexpected status. Returns the `data` of the
 * response envelope ({ success, data, message, statusCode }).
 */
export async function call<T = Json>(
  request: APIRequestContext,
  method: Method,
  url: string,
  opts: { token?: string; data?: unknown; expect?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const r = await request.fetch(url, { method, headers, data: opts.data as never, maxRedirects: 0 });
  const text = await r.text();
  if (opts.expect !== undefined) expect(r.status(), `${method} ${url}: ${text}`).toBe(opts.expect);
  else expect(r.ok(), `${method} ${url} -> ${r.status()}: ${text}`).toBe(true);
  try {
    const body = text ? JSON.parse(text) : {};
    return (body && typeof body === "object" && "data" in body ? body.data : body) as T;
  } catch {
    return {} as T;
  }
}

/** A tenant API call (relative to /api/v1). */
export function tenantApi<T = Json>(request: APIRequestContext, token: string, method: Method, route: string, data?: unknown) {
  return call<T>(request, method, `${API}${route}`, { token, data });
}

/** An operator API call (relative to /api/v1/operator). */
export function operatorApi<T = Json>(request: APIRequestContext, token: string, method: Method, route: string, data?: unknown) {
  return call<T>(request, method, `${OPERATOR_API}${route}`, { token, data });
}

/** Signs a workspace user in through the API; returns the bearer token. */
export async function apiLogin(request: APIRequestContext, account: Account = DEMO.northwindAdmin()): Promise<string> {
  const cached = sessions.get(`web:${account.email}`);
  if (cached) return cached.token;
  const r = await call<{ token: string }>(request, "POST", `${API}/auth/login`, { data: account });
  return r.token;
}

/** Signs the operator in through the API; returns the bearer token. */
export async function operatorLogin(request: APIRequestContext, account: Account = DEMO.operator()): Promise<string> {
  const r = await call<{ token: string }>(request, "POST", `${OPERATOR_API}/auth/login`, { data: account });
  return r.token;
}

/** Signs in through a login form (the workspace app by default, or the console). */
export async function signIn(page: Page, account: Account, opts: { app?: "web" | "console" } = {}) {
  const origin = opts.app === "console" ? CONSOLE : WEB;
  await page.goto(`${origin}/login`);
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(account.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** The newest mail Mailpit received for `to` (SES on Floci relays every send there). */
export async function latestMail(request: APIRequestContext, to: string): Promise<{ Subject: string; Text: string; HTML: string }> {
  let message: { Subject: string; Text: string; HTML: string } | undefined;
  await expect
    .poll(
      async () => {
        const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`).catch(() => null);
        const id = r?.ok() ? (((await r.json()).messages ?? []) as { ID: string }[])[0]?.ID : undefined;
        if (!id) return false;
        message = await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
        return true;
      },
      { timeout: 30_000, message: `mail to ${to}` },
    )
    .toBe(true);
  return message!;
}

/** Written by global-setup: one API session per demo account for the run. */
export const SESSIONS_FILE = path.join(__dirname, ".results", "sessions.json");

const sessions = new Map<string, { token: string; user: unknown }>(
  fs.existsSync(SESSIONS_FILE) ? Object.entries(JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"))) : [],
);

/**
 * Starts a session without the sign-in form: signs in through the API once per
 * account and process (the sign-in rate limit would otherwise trip across a run),
 * then seeds the app's persisted auth state before any page script runs.
 */
export async function useSession(
  page: Page,
  request: APIRequestContext,
  account: Account,
  opts: { app?: "web" | "console" } = {},
) {
  const isConsole = opts.app === "console";
  const key = `${isConsole ? "console" : "web"}:${account.email}`;
  let session = sessions.get(key);
  if (!session) {
    session = await call<{ token: string; user: unknown }>(
      request,
      "POST",
      `${isConsole ? OPERATOR_API : API}/auth/login`,
      { data: account },
    );
    sessions.set(key, session);
  }
  const storageKey = isConsole ? "operator-auth" : "mail-auth";
  await page.addInitScript(
    ([k, v]) => {
      localStorage.setItem(k, v);
    },
    [storageKey, JSON.stringify({ state: { token: session.token, user: session.user }, version: 0 })] as const,
  );
}
