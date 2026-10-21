const { test, expect } = require("@playwright/test");
const { watchErrors } = require("./helpers");

test("invite a user who gets a separate, empty area", async ({ page, browser }) => {
  const check = watchErrors(page);
  await page.goto("/#/settings");
  await page.fill("#invite [name=username]", "Partnerin");
  await page.click("#invite button[type=submit]");
  const code = (await page.locator(".modal .recovery-key").textContent()).trim();
  await page.click(".modal .modal-foot [data-close]");

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const other = await ctx.newPage();
  await other.goto("/");
  await other.click("[data-mode=activate]");
  await other.fill("[name=username]", "partnerin");
  await other.fill("[name=code]", code);
  await other.fill("[name=password]", "Wiesenweg-2026-x");
  await other.fill("[name=password2]", "Wiesenweg-2026-x");
  await other.click("button[type=submit]");
  await other.check("#ack");
  await other.click("#go");
  await expect(other.getByRole("heading", { name: "Noch keine Verträge" })).toBeVisible();
  expect((await other.request.get("/api/contracts/1")).status()).toBe(404);
  await ctx.close();
  check();
});
