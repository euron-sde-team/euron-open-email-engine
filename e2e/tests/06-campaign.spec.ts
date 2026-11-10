import { expect, test } from "@playwright/test";
import { apiLogin, DEMO, tenantApi, uniq, useSession, WEB } from "../helpers";

interface Id {
  id: string;
}

test.describe("campaigns", () => {
  test("compose in four steps, send in simulated mode, read the report, unsubscribe through the public link", async ({ page, request }) => {
    const token = await apiLogin(request, DEMO.northwindAdmin());
    const u = uniq("cmp");
    const list = await tenantApi<Id>(request, token, "POST", "/lists", { name: `List ${u}` });
    const people = [`${u}-a@example.com`, `${u}-b@example.com`, `bounce@${u}.example.com`];
    const contacts: Id[] = [];
    for (const email of people) {
      contacts.push(await tenantApi<Id>(request, token, "POST", "/contacts", { email, firstName: "Sam", listIds: [list.id] }));
    }

    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/campaigns/new`);
    await expect(page).toHaveURL(/\/campaigns\/new\/edit/);

    // 1. Setup: validation first, then the real values.
    await page.getByRole("button", { name: "Continue to audience" }).click();
    await expect(page.getByText(/Give the campaign a name/)).toBeVisible();
    await page.getByLabel("Campaign name").fill(`Campaign ${u}`);
    await page.getByLabel("Subject line").fill(`Hello {{first_name | default: "there"}} ${u}`);
    await page.getByLabel("From").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "Continue to audience" }).click();

    // 2. Audience: the list, with an estimate.
    await page.getByLabel(`List ${u}`).check();
    await expect(page.getByText(/About\s*3\s*contacts/)).toBeVisible();
    await page.getByRole("button", { name: "Continue to content" }).click();

    // 3. Content: HTML editor, merge tag inserter and a sandboxed preview.
    await page.getByRole("button", { name: "Merge tag" }).click();
    await page.getByRole("menuitem", { name: /First name/ }).click();
    const frame = page.locator('iframe[title^="Rendered email preview"]');
    await expect(frame).toHaveAttribute("sandbox", "");
    await page.getByRole("button", { name: "Continue to review" }).click();

    // 4. Review: preflight shows recipients, quota and issues before the send button.
    await expect(page.getByRole("heading", { name: "Preflight" })).toBeVisible();
    await expect(page.getByText("Will be sent to")).toBeVisible();
    const send = page.getByRole("button", { name: "Send campaign" });
    await expect(send).toBeEnabled({ timeout: 20_000 });
    await send.click();
    await page.getByRole("dialog").getByRole("button", { name: "Send campaign" }).click();

    // Report: finished, funnel, timeline, links and the machine-opens note.
    await expect(page).toHaveURL(/\/campaigns\/[0-9A-Za-z]+$/, { timeout: 30_000 });
    const campaignId = page.url().split("/campaigns/")[1];
    await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("img", { name: /Delivery funnel/ })).toBeVisible();
    await expect(page.getByText(/Opens include machine opens/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recipients" })).toBeVisible();
    await expect(page.getByText(`${u}-a@example.com`)).toBeVisible();
    // The simulated hard bounce is on the report and the contact is bounced.
    await expect(page.getByText(`bounce@${u}.example.com`)).toBeVisible();

    // Unsubscribe through the public link in the rendered email.
    const preview = await tenantApi<{ html: string }>(request, token, "GET", `/campaigns/${campaignId}/preview?contactId=${contacts[0].id}`);
    const href = /href="([^"]*\/u\/[^"]+)"/.exec(preview.html)?.[1];
    expect(href, "the rendered email carries an unsubscribe link").toBeTruthy();
    await page.goto(href!.replace(/&amp;/g, "&"));
    await page.getByRole("button", { name: /unsubscribe/i }).click();
    await expect(page.getByText(/unsubscribed/i).first()).toBeVisible();
    const after = await tenantApi<{ status: string }>(request, token, "GET", `/contacts/${contacts[0].id}`);
    expect(after.status).toBe("UNSUBSCRIBED");

    // Clean up.
    await tenantApi(request, token, "POST", "/contacts/bulk", { ids: contacts.map((c) => c.id), action: "delete" });
    await tenantApi(request, token, "DELETE", `/lists/${list.id}`);
  });

  test("schedule a draft for later, see it scheduled, then unschedule", async ({ page, request }) => {
    const token = await apiLogin(request, DEMO.northwindAdmin());
    const u = uniq("sch");
    const list = await tenantApi<Id>(request, token, "POST", "/lists", { name: `List ${u}` });
    const contact = await tenantApi<Id>(request, token, "POST", "/contacts", { email: `${u}@example.com`, listIds: [list.id] });
    const senders = await tenantApi<{ id: string; status: string }[]>(request, token, "GET", "/email/senders");
    const sender = (Array.isArray(senders) ? senders : []).find((s) => s.status === "ACTIVE");
    const draft = await tenantApi<Id>(request, token, "POST", "/campaigns", {
      name: `Scheduled ${u}`,
      subject: `Later ${u}`,
      html: '<p>Hi</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
      senderIdentityId: sender?.id,
      audience: { type: "LISTS", listIds: [list.id] },
    });

    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/campaigns/${draft.id}/edit`);
    // Step through setup, audience and content to the review step.
    await page.getByRole("button", { name: "Continue to audience" }).click();
    await page.getByRole("button", { name: "Continue to content" }).click();
    await page.getByRole("button", { name: "Continue to review" }).click();
    await page.getByLabel("Schedule for later").check();
    await expect(page.getByText(/UTC\./)).toBeVisible();
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Schedule campaign" }).click();

    await expect(page.getByText("Scheduled", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Starts /)).toBeVisible();
    await page.getByRole("button", { name: "Unschedule" }).click();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

    await tenantApi(request, token, "DELETE", `/campaigns/${draft.id}`);
    await tenantApi(request, token, "DELETE", `/contacts/${contact.id}`);
    await tenantApi(request, token, "DELETE", `/lists/${list.id}`);
  });

  test("a starter template opens in the editor with a sandboxed live preview", async ({ page, request }) => {
    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/templates`);
    await expect(page.getByRole("heading", { name: "Starter gallery" })).toBeVisible();
    await expect(page.locator('iframe[sandbox=""]').first()).toBeAttached();
    await page.getByRole("button", { name: /^Use / }).first().click();
    await expect(page).toHaveURL(/\/templates\/[0-9A-Za-z]+$/);
    const frame = page.locator('iframe[title^="Rendered email preview"]');
    await expect(frame).toHaveAttribute("sandbox", "");
    await page.getByRole("button", { name: "Merge tag" }).click();
    await expect(page.getByRole("menuitem", { name: /Unsubscribe link/ })).toBeVisible();
  });
});
