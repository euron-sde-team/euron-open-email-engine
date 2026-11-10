import { expect, test } from "@playwright/test";
import { apiLogin, DEMO, tenantApi, uniq, useSession, WEB } from "../helpers";

test.describe("sending domain wizard", () => {
  test("add a domain, read the grouped DNS records, check now", async ({ page, request }) => {
    const token = await apiLogin(request, DEMO.northwindAdmin());
    const domain = `wiz${uniq().slice(0, 10)}.example.com`;
    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/domains?new=1`);

    await page.getByLabel("Domain", { exact: true }).fill("not a domain");
    await page.getByRole("button", { name: /Add domain and get DNS records/ }).click();
    await expect(page.getByRole("alert")).toContainText("Enter a domain");

    await page.getByLabel("Domain", { exact: true }).fill(domain);
    await page.getByRole("button", { name: /Add domain and get DNS records/ }).click();
    await expect(page).toHaveURL(/\/domains\/[0-9A-Za-z]+/);
    const id = page.url().split("/domains/")[1];

    try {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(domain);
      // Records are grouped by purpose, each group with plain-language help.
      for (const title of ["DKIM signing keys", "Custom MAIL FROM", "SPF sender policy", "DMARC policy", "Tracking domain"]) {
        await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
      }
      await page.getByText("What does this do?").first().click();
      await expect(page.getByText(/digital signature/)).toBeVisible();
      // Every value has a copy button.
      await expect(page.getByRole("button", { name: /^Copy DKIM record value/ }).first()).toBeVisible();

      // Names can be shown relative to the zone for providers that append it.
      await page.getByLabel("My DNS provider adds the domain for me").check();

      // Check now re-reads DNS and the SES status. In simulated mode it verifies the domain;
      // against a real or emulated SES with no DNS it reports how many records were found.
      await page.getByRole("button", { name: "Check now" }).click();
      await expect(page.getByText(/Ready to send|of 5 required records found/).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/Last checked just now|Verified/).first()).toBeVisible();
    } finally {
      await tenantApi(request, token, "DELETE", `/email/domains/${id}`);
    }
  });

  test("a verified domain lists its senders", async ({ page, request }) => {
    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/domains`);
    await page.getByRole("link", { name: "mail.northwind.example" }).click();
    await expect(page.getByText("Ready to send")).toBeVisible();
    await expect(page.getByText(/@mail\.northwind\.example/).first()).toBeVisible();
  });
});
