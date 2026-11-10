import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiLogin, CONSOLE, DEMO, tenantApi, useSession, WEB } from "../helpers";

// The sandboxed email preview iframes are excluded: axe cannot open an opaque-origin frame.
// Serious and critical axe violations fail the run; moderate ones are reported only.
async function audit(page: Page, label: string) {
  // Measure the settled page, not a frame of an entrance animation.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("iframe").analyze();
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.flatMap((v) =>
      v.nodes.map((n) => `${label}: ${v.id} ${n.target.join(" ")} ${n.any[0]?.message ?? ""}`),
    ),
  ).toEqual([]);
}

const TENANT_PAGES = [
  "/dashboard",
  "/domains",
  "/senders",
  "/contacts",
  "/lists",
  "/segments",
  "/segments/new",
  "/forms",
  "/import",
  "/templates",
  "/campaigns",
  "/campaigns/new/edit",
  "/messages",
  "/suppressions",
  "/reputation",
  "/team",
  "/audit",
  "/settings",
  "/profile",
];

for (const theme of ["light", "dark"] as const) {
  test(`tenant app pages pass axe in ${theme} mode`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.addInitScript((t) => localStorage.setItem("mail-theme", t), theme);
    await page.goto(`${WEB}/login`);
    await audit(page, "login");
    await useSession(page, request, DEMO.northwindAdmin());
    for (const path of TENANT_PAGES) {
      await page.goto(`${WEB}${path}`);
      await page.waitForLoadState("networkidle");
      await audit(page, path);
    }
  });

  test(`detail pages pass axe in ${theme} mode`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const token = await apiLogin(request, DEMO.northwindAdmin());
    const domains = await tenantApi<{ id: string }[]>(request, token, "GET", "/email/domains");
    const campaigns = await tenantApi<{ id: string; status: string }[]>(request, token, "GET", "/campaigns");
    const templates = await tenantApi<{ id: string }[]>(request, token, "GET", "/templates");
    const sent = (Array.isArray(campaigns) ? campaigns : []).find((c) => c.status === "SENT");
    const paths = [
      ...(Array.isArray(domains) && domains[0] ? [`/domains/${domains[0].id}`] : []),
      ...(sent ? [`/campaigns/${sent.id}`] : []),
      ...(Array.isArray(templates) && templates[0] ? [`/templates/${templates[0].id}`] : []),
    ];
    await page.addInitScript((t) => localStorage.setItem("mail-theme", t), theme);
    await useSession(page, request, DEMO.northwindAdmin());
    for (const path of paths) {
      await page.goto(`${WEB}${path}`);
      await page.waitForLoadState("networkidle");
      await audit(page, path);
    }
  });
}

test("console pages pass axe", async ({ page, request }) => {
  await page.goto(`${CONSOLE}/login`);
  await audit(page, "console login");
  await useSession(page, request, DEMO.operator(), { app: "console" });
  for (const path of ["/", "/tenants", "/plans"]) {
    await page.goto(`${CONSOLE}${path}`);
    await page.waitForLoadState("networkidle");
    await audit(page, `console ${path}`);
  }
});
