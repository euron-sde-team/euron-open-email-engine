import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  CONSOLE,
  DEMO,
  OPERATOR_API,
  SESSIONS_FILE,
  call,
  operatorApi,
  uniq,
  useSession,
  type Account,
} from "../helpers";

/**
 * Operator console: tenants, plans, fleet, account health, dead-letter queue, audit.
 * Runs against the demo seed (`make demo`): "Northwind Mail" (Growth, a verified domain
 * and a reputation history with one WARNING episode) and "Acme Robotics" (Starter,
 * pending domain). The operator signs in with EMAIL_DEMO_PASSWORD like every demo account.
 */

const operator = (): Account => DEMO.operator();

const NORTHWIND = "Northwind Mail";
const ACME = "Acme Robotics";

let cachedToken: string | undefined;

/** The operator's bearer token: the session global-setup signed in (the sign-in limiter is tight). */
async function token(request: APIRequestContext): Promise<string> {
  if (cachedToken) return cachedToken;
  try {
    const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")) as Record<string, { token: string }>;
    const found = sessions[`console:${operator().email}`]?.token;
    if (found) return (cachedToken = found);
  } catch {
    /* fall through to a real sign-in */
  }
  const r = await call<{ token: string }>(request, "POST", `${OPERATOR_API}/auth/login`, { data: operator() });
  return (cachedToken = r.token);
}

async function open(page: Page, request: APIRequestContext, path: string) {
  await useSession(page, request, operator(), { app: "console" });
  await page.goto(`${CONSOLE}${path}`);
}

test.describe("operator console", () => {
  test("signs in through the form and lands on the platform overview", async ({ page }) => {
    await page.goto(`${CONSOLE}/login`);
    await page.locator("#email").fill(operator().email);
    await page.locator("#password").fill(operator().password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: "Platform overview", level: 1 })).toBeVisible();
    await expect(page.getByText("Emails sent this month")).toBeVisible();
  });

  test("the navigation has the sending pages and no billing", async ({ page, request }) => {
    await open(page, request, "/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const name of ["Dashboard", "Tenants", "Plans", "Fleet", "Account health", "Dead-letter queue", "Operators", "Audit"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: /billing/i })).toHaveCount(0);
    await page.goto(`${CONSOLE}/billing`);
    await expect(page.getByText(/not found/i).first()).toBeVisible();
  });

  test("the skip link moves focus to the main content", async ({ page, request }) => {
    await open(page, request, "/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("fleet lists every tenant and sorts by bounce and complaint rate", async ({ page, request }) => {
    await open(page, request, "/fleet");
    await expect(page.getByRole("heading", { name: "Fleet", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: NORTHWIND })).toBeVisible();
    await expect(page.getByRole("link", { name: ACME })).toBeVisible();

    const bounce = page.getByRole("columnheader", { name: /bounce/i });
    await expect(bounce).toHaveAttribute("aria-sort", "descending");
    const rates = async (col: number) =>
      (await page.locator(`tbody tr td:nth-child(${col})`).allInnerTexts()).map((t) => parseFloat(t));

    const desc = await rates(5);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));

    // Keyboard: the header is a real button.
    await bounce.getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(bounce).toHaveAttribute("aria-sort", "ascending");
    const asc = await rates(5);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));

    await page.getByRole("columnheader", { name: /complaint/i }).getByRole("button").click();
    await expect(page.getByRole("columnheader", { name: /complaint/i })).toHaveAttribute("aria-sort", "descending");
    const complaints = await rates(6);
    expect(complaints).toEqual([...complaints].sort((a, b) => b - a));
  });

  test("fleet counts match the API", async ({ page, request }) => {
    const t = await token(request);
    const fleet = await operatorApi<{ totals: { tenants: number; active: number; paused: number }; tenants: unknown[] }>(
      request,
      t,
      "GET",
      "/email/fleet",
    );
    await open(page, request, "/fleet");
    await expect(page.locator("tbody tr")).toHaveCount(fleet.tenants.length);
    const active = page.locator("section[aria-label='Tenants by sending status'] > div", { hasText: "Active" }).first();
    await expect(active).toContainText(String(fleet.totals.active));
  });

  test("account health shows the provider mode, sandbox and quota", async ({ page, request }) => {
    await open(page, request, "/account-health");
    await expect(page.getByRole("heading", { name: "Account health", level: 1 })).toBeVisible();
    await expect(page.getByText("Provider mode")).toBeVisible();
    await expect(page.getByText("Sandbox", { exact: true })).toBeVisible();
    await expect(page.getByRole("meter", { name: /last 24 hours/i })).toBeVisible();
    await expect(page.getByText("Bounce rate, 14 days")).toBeVisible();
    await expect(page.getByText("Complaint rate, 14 days")).toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Provider mode")).toBeVisible();
  });

  test("the dead-letter queue page reports depth and age", async ({ page, request }) => {
    const t = await token(request);
    const dlq = await operatorApi<{ configured: boolean; depth: number }>(request, t, "GET", "/email/dlq");
    await open(page, request, "/dlq");
    await expect(page.getByRole("heading", { name: "Dead-letter queue", level: 1 })).toBeVisible();
    if (!dlq.configured) {
      await expect(page.getByText("No dead-letter queue is configured")).toBeVisible();
    } else {
      await expect(page.getByText("Messages waiting")).toBeVisible();
      await expect(page.getByText("Oldest message")).toBeVisible();
    }
  });

  test("tenant detail shows the fleet row, usage against limits, domains and reputation history", async ({ page, request }) => {
    await open(page, request, "/tenants");
    await page.getByRole("link", { name: NORTHWIND }).click();
    await expect(page.getByRole("heading", { name: NORTHWIND, level: 1 })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Sending" })).toBeVisible();
    await expect(page.getByText("Bounce rate", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Usage this month" })).toBeVisible();
    await expect(page.getByRole("meter", { name: "Emails sent" })).toBeVisible();
    await expect(page.getByText(/ of 50,000/)).toBeVisible(); // Growth plan quota

    await expect(page.getByText("mail.northwind.example")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reputation history" })).toBeVisible();
    await expect(page.getByText("Warning").first()).toBeVisible(); // the seeded WARNING episode
  });

  test("lifting a restriction needs a reason, is audited, and is hidden for healthy tenants", async ({ page, request }) => {
    const t = await token(request);
    const fleet = await operatorApi<{ tenants: { tenantId: string; name: string; status: string }[] }>(
      request,
      t,
      "GET",
      "/email/fleet",
    );

    // The API rejects an empty reason regardless of the UI.
    const target = fleet.tenants.find((x) => x.status !== "ACTIVE");
    const probe = (fleet.tenants.find((x) => x.status === "ACTIVE") ?? fleet.tenants[0]).tenantId;
    const rejected = await request.post(`${OPERATOR_API}/tenants/${probe}/email/unpause`, {
      headers: { Authorization: `Bearer ${t}` },
      data: { reason: "" },
    });
    expect([400, 422]).toContain(rejected.status());

    // A healthy tenant offers no unpause action.
    const healthy = fleet.tenants.find((x) => x.status === "ACTIVE");
    if (healthy) {
      await open(page, request, `/tenants/${healthy.tenantId}`);
      await expect(page.getByRole("heading", { name: healthy.name, level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Lift restriction" })).toHaveCount(0);
    }

    test.skip(!target, "No restricted tenant in the seed; the unpause dialog is covered when one exists.");
    await open(page, request, `/tenants/${target!.tenantId}`);
    await page.getByRole("button", { name: "Lift restriction" }).click();
    const dialog = page.getByRole("dialog");
    const submit = dialog.getByRole("button", { name: "Lift restriction" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill("too short");
    await expect(submit).toBeDisabled();
    const reason = `Root cause fixed ${uniq("why")}`;
    await dialog.getByLabel(/Reason/).fill(reason);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog).toBeHidden();

    await page.goto(`${CONSOLE}/audit`);
    await expect(page.getByText(/unpause|restriction|lifted/i).first()).toBeVisible();
  });

  test("creates a tenant, suspends and reactivates it, and the audit log records it", async ({ page, request }) => {
    const name = `E2E ${uniq("tenant")}`;
    const admin = `${uniq("admin")}@example.com`;
    await open(page, request, "/tenants");

    await page.getByRole("button", { name: "Create tenant" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByLabel("Plan").click();
    await page.getByRole("option", { name: "Starter" }).click();
    await dialog.getByLabel("Admin name").fill("Test Admin");
    await dialog.getByLabel("Admin email").fill(admin);
    await dialog.getByRole("button", { name: "Create tenant" }).click();
    await expect(dialog).toBeHidden();

    await page.getByLabel("Search tenants").fill(name);
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Active")).toBeVisible();

    await row.getByRole("button", { name: `Suspend ${name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Suspend tenant" }).click();
    await expect(row.getByText("Suspended")).toBeVisible();

    await row.getByRole("button", { name: `Reactivate ${name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reactivate tenant" }).click();
    await expect(row.getByText("Active")).toBeVisible();

    await page.goto(`${CONSOLE}/audit`);
    await expect(page.getByText(new RegExp(name)).first()).toBeVisible();

    // Tidy up: tenants cannot be deleted, so close it.
    const t = await token(request);
    const list = await operatorApi<{ id: string; name: string }[]>(request, t, "GET", `/tenants?q=${encodeURIComponent(name)}`);
    for (const tenant of list.filter((x) => x.name === name)) {
      await request.put(`${OPERATOR_API}/tenants/${tenant.id}`, {
        headers: { Authorization: `Bearer ${t}` },
        data: { status: "CLOSED" },
      });
    }
  });

  test("creates and edits a plan: email limits and email modules only", async ({ page, request }) => {
    const key = `E2E_${uniq("plan").toUpperCase()}`;
    await open(page, request, "/plans");
    await expect(page.getByText("Emails per month").first()).toBeVisible();
    await expect(page.getByText(/leads|seats|AI credits|billing/i)).toHaveCount(0);

    await page.getByRole("button", { name: "New plan" }).first().click();
    const dialog = page.getByRole("dialog");
    // The module list is the email modules.
    for (const m of ["Audience", "Templates", "Campaigns", "Analytics", "Messages and suppressions", "Audit log"]) {
      await expect(dialog.getByLabel(m)).toBeVisible();
    }
    await dialog.getByLabel("Key").fill(key);
    await dialog.getByLabel("Name", { exact: true }).fill("E2E plan");
    await dialog.getByLabel("Emails per month").fill("1234");
    await dialog.getByLabel("Contacts").fill("");
    await dialog.getByLabel("Sending domains").fill("2");
    await dialog.getByLabel("Users").fill("4");
    await dialog.getByLabel("Campaigns").uncheck();
    await dialog.getByRole("button", { name: "Create plan" }).click();
    await expect(dialog).toBeHidden();

    const item = page.locator("main li").filter({ hasText: key });
    await expect(item).toContainText("1,234");
    await expect(item).toContainText("Unlimited");
    await expect(item).not.toContainText("Campaigns");

    await item.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("Emails per month").fill("99999");
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(item).toContainText("99,999");

    // Plans cannot be deleted: retire it.
    await item.getByRole("switch", { name: "E2E plan plan active" }).click();
    await expect(item).toContainText("Inactive");
  });

  test("a bad limit is refused before it reaches the API", async ({ page, request }) => {
    await open(page, request, "/plans");
    await page.getByRole("button", { name: "New plan" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Key").fill("E2E_BAD");
    await dialog.getByLabel("Name", { exact: true }).fill("Bad");
    await dialog.getByLabel("Emails per month").fill("-5");
    await dialog.getByRole("button", { name: "Create plan" }).click();
    await expect(page.getByText(/whole number/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

// Serious and critical axe violations fail the run, in both themes.
async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.flatMap((v) => v.nodes.map((n) => `${label}: ${v.id} ${n.target.join(" ")} ${n.any[0]?.message ?? ""}`)),
  ).toEqual([]);
}

for (const theme of ["dark", "light"] as const) {
  test(`console pages pass axe in ${theme} mode`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("operator-theme", t), theme);
    await page.goto(`${CONSOLE}/login`);
    await audit(page, `login ${theme}`);

    await useSession(page, request, operator(), { app: "console" });
    const t = await token(request);
    const tenants = await operatorApi<{ id: string }[]>(request, t, "GET", "/tenants");
    const paths = ["/", "/tenants", "/plans", "/fleet", "/account-health", "/dlq", "/operators", "/audit", "/profile"];
    if (tenants[0]) paths.push(`/tenants/${tenants[0].id}`);
    for (const path of paths) {
      await page.goto(`${CONSOLE}${path}`);
      await page.waitForLoadState("networkidle");
      await audit(page, `${path} ${theme}`);
    }

    // Open dialogs too: they are the densest forms.
    await page.goto(`${CONSOLE}/plans`);
    await page.getByRole("button", { name: "New plan" }).first().click();
    await audit(page, `new plan dialog ${theme}`);
    await page.keyboard.press("Escape");
    await page.goto(`${CONSOLE}/tenants`);
    await page.getByRole("button", { name: "Create tenant" }).first().click();
    await audit(page, `create tenant dialog ${theme}`);
  });
}
