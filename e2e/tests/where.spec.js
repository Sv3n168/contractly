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

test("Bildung is a category and its own area", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Bildung" }).click();
  await page.fill("[name=provider]", "Fernhochschule");
  await page.fill("[name=name]", "Studium");
  await page.fill("[name=price_amount]", "300");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Studium" })).toBeVisible();
  await page.goto("/#/costs");
  await expect(page.locator("#where .where-area", { hasText: "Bildung" })).toContainText("300,00");
  await expect(page.locator("#where .where-area", { hasText: "Strom & Gas" })).toBeVisible();
  check();
});
