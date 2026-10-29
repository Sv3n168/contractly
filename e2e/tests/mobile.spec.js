const { test, expect } = require("@playwright/test");
const { watchErrors, noHorizontalScroll } = require("./helpers");

for (const [name, hash] of [
  ["dashboard", "/"],
  ["contracts", "/contracts"],
  ["contract detail", "/contracts/1"],
  ["new contract", "/contracts/new?category=mobile"],
  ["edit contract", "/contracts/1/edit"],
  ["compare", "/contracts/1?tab=compare"],
  ["import", "/import"],
  ["reminders", "/reminders"],
  ["costs", "/costs"],
  ["timeline", "/timeline"],
  ["post & mails", "/inbox"],
  ["yearly check", "/checkup"],
  ["emergency folder", "/emergency"],
  ["income", "/income"],
  ["report", "/report"],
  ["settings", "/settings"],
]) {
  test(`mobile layout: ${name}`, async ({ page }) => {
    const check = watchErrors(page);
    await page.goto(`/#${hash}`);
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeHidden();
    await page.waitForLoadState("networkidle");
    await noHorizontalScroll(page);
    check();
  });
}

test("mobile: four areas, their tabs and settings reach every page", async ({ page }) => {
  await page.goto("/");
  await page.locator(".bottom-nav a", { hasText: "Zu tun" }).click();
  await expect(page.locator(".section-head h1")).toHaveText("Zu tun");
  await expect(page.locator(".section-tabs a[href='#/inbox']")).toBeVisible();
  await expect(page.locator(".section-tabs a[href='#/checkup']")).toBeVisible();
  await page.locator(".bottom-nav a", { hasText: "Auswertung" }).click();
  await expect(page.locator(".section-head h1")).toHaveText("Auswertung");
  await page.locator(".section-tabs a[href='#/income']").click();
  await expect(page.locator(".section-tabs a.active")).toHaveText("Einnahmen");
  await page.locator(".topbar a[href='#/settings']").click();
  await expect(page.locator(".main a[href='#/emergency']")).toBeVisible();
  await expect(page.locator(".main a[href='#/import']")).toBeVisible();
  await expect(page.locator(".main [data-action=logout]")).toBeVisible();
});
