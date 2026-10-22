const { test, expect } = require("@playwright/test");
const { watchErrors, noHorizontalScroll } = require("./helpers");

for (const [name, hash] of [
  ["dashboard", "/"],
  ["contracts", "/contracts"],
  ["contract detail", "/contracts/1"],
  ["compare", "/contracts/1?tab=compare"],
  ["import", "/import"],
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

test("mobile: 'Mehr' menu leads to all pages", async ({ page }) => {
  await page.goto("/");
  await page.locator(".bottom-nav a[href='#/more']").click();
  await expect(page.locator(".main a[href='#/report']")).toBeVisible();
  await expect(page.locator(".main [data-action=logout]")).toBeVisible();
});
