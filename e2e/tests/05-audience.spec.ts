import { expect, test } from "@playwright/test";
import { apiLogin, DEMO, tenantApi, uniq, useSession, WEB } from "../helpers";

test.describe("audience: import and segments", () => {
  test("import a CSV through the three steps, then build a segment with a live count", async ({ page, request }) => {
    const token = await apiLogin(request, DEMO.northwindAdmin());
    const u = uniq("imp");
    const tag = `tag-${u}`;
    const emails = [1, 2, 3].map((n) => `${u}-${n}@example.com`);
    const csv = ["Email Address,First Name,Notes", ...emails.map((e, i) => `${e},Person${i},ignore me`), "not-an-email,Broken,x"].join("\n");

    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/import`);

    // 1. Upload
    await page.locator('input[type="file"]').setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    // 2. Map columns: the headings were recognised, the third column is skipped.
    await expect(page.getByRole("heading", { name: /Map columns|Email Address/ }).or(page.getByText("Tell us what each column holds"))).toBeVisible();
    await expect(page.getByLabel("Import column Email Address as")).toContainText("Email address");
    await expect(page.getByLabel("Import column First Name as")).toContainText("First name");
    await expect(page.getByLabel("Import column Notes as")).toContainText("Do not import");
    await page.getByPlaceholder("Type a tag and press Enter").fill(tag);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Continue to review" }).click();

    // 3. Review, consent, results.
    const start = page.getByRole("button", { name: "Start import" });
    await expect(start).toBeDisabled();
    await page.getByLabel(/I confirm these people agreed/).check();
    await start.click();
    await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Rows that were skipped")).toBeVisible();
    await expect(page.getByText("not-an-email")).toBeVisible();

    // The contacts exist and carry the tag.
    await page.goto(`${WEB}/contacts`);
    await page.getByLabel("Tag", { exact: true }).fill(tag);
    for (const e of emails) await expect(page.getByRole("link", { name: e })).toBeVisible();

    // A segment with a live count.
    await page.goto(`${WEB}/segments/new`);
    await page.getByLabel("Name", { exact: true }).fill(`Seg ${u}`);
    await page.getByRole("button", { name: "Add condition" }).click();
    await page.getByLabel("Condition 1 value").fill(tag);
    await expect(page.getByLabel("Live count")).toContainText(/3\s*contacts/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Save segment" }).click();
    await expect(page).toHaveURL(/\/segments$/);
    await expect(page.getByRole("link", { name: `Seg ${u}`, exact: true })).toBeVisible();

    // Clean up.
    const segments = await tenantApi<{ id: string; name: string }[]>(request, token, "GET", "/segments");
    for (const s of (Array.isArray(segments) ? segments : []).filter((s) => s.name === `Seg ${u}`)) {
      await tenantApi(request, token, "DELETE", `/segments/${s.id}`);
    }
    const found = await tenantApi<{ items: { id: string }[] }>(request, token, "GET", `/contacts?tag=${encodeURIComponent(tag)}`);
    await tenantApi(request, token, "POST", "/contacts/bulk", { ids: (found.items ?? []).map((c) => c.id), action: "delete" });
  });

  test("a bulk action tags selected contacts", async ({ page, request }) => {
    const token = await apiLogin(request, DEMO.northwindAdmin());
    const u = uniq("blk");
    const c = await tenantApi<{ id: string; email: string }>(request, token, "POST", "/contacts", { email: `${u}@example.com` });
    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/contacts`);
    await page.getByLabel("Search", { exact: true }).fill(u);
    await page.getByLabel(`Select ${c.email}`).check();
    await page.getByRole("button", { name: "Add tag" }).click();
    await page.getByLabel("Tag", { exact: true }).last().fill("bulk-tagged");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(/Updated 1 contacts/)).toBeVisible();
    await tenantApi(request, token, "DELETE", `/contacts/${c.id}`);
  });
});
