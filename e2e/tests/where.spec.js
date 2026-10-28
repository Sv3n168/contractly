const { test, expect } = require("@playwright/test");
const { watchErrors } = require("./helpers");

test("Auswertung answers first where the money goes", async ({ page }, testInfo) => {
  const check = watchErrors(page);
  await page.goto("/#/costs");
  const where = page.locator("#where");
  await expect(where).toContainText("Wohin dein Geld geht");
  const rows = where.locator(".where-row");
  await expect(rows.first()).toBeVisible();
  // largest area first
  const amounts = await where.locator(".where-amount b").allInnerTexts();
  const values = amounts.map((t) => Number(t.replace(/[^\d,]/g, "").replace(",", ".")));
  expect([...values].sort((a, b) => b - a)).toEqual(values);
  // an area opens its contracts
  // share of the net income, not of the total
  await expect(where.locator(".where-net")).not.toContainText("100 %");
  await rows.first().click();
  await expect(where.locator(".where-area.open .where-item").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`where-${testInfo.project.name}.png`), fullPage: false });
  check();
});
