import { expect, test } from "@playwright/test";
import { DEMO, signIn, useSession, WEB } from "../helpers";

test.describe("tenant app: sign in and shell", () => {
  test("an admin signs in and lands on the dashboard", async ({ page }) => {
    await signIn(page, DEMO.northwindAdmin());
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello");
    await expect(page.getByText("Northwind Mail").first()).toBeVisible();
    // The email-engine navigation, and none of the old CRM one.
    const nav = page.getByRole("navigation").first();
    for (const label of ["Contacts", "Segments", "Campaigns", "Templates", "Domains", "Messages", "Reputation"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Pipeline" })).toHaveCount(0);
  });

  test("a wrong password is refused", async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await page.locator("#email").fill(DEMO.northwindAdmin().email);
    await page.locator("#password").fill("not-the-password");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a visitor without a session is sent to sign-in", async ({ page }) => {
    await page.goto(`${WEB}/campaigns`);
    await expect(page).toHaveURL(/\/login/);
  });

  test("the command palette jumps to a page by keyboard", async ({ page, request }) => {
    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/dashboard`);
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Jump to a page/).fill("segm");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/segments/);
  });

  test("a new workspace is walked through setup by the dashboard checklist", async ({ page, request }) => {
    await useSession(page, request, DEMO.acmeAdmin());
    await page.goto(`${WEB}/dashboard`);
    const checklist = page.getByRole("region", { name: "Get set up to send" });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText("Add and verify a sending domain")).toBeVisible();
    await expect(checklist.getByRole("link", { name: /Add a domain/ })).toHaveAttribute("href", /\/domains\?new=1/);
  });
});
