const { test, expect } = require("@playwright/test");
const path = require("path");
const { watchErrors } = require("./helpers");

test("contract list import", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/import");
  await page.setInputFiles("#drop input[type=file]", path.join(__dirname, "..", "fixtures", "vertraege.csv"));
  await expect(page.locator("#list-result")).toContainText("Yoga-Studio Sonnenschein");
  await page.click("#apply");
  await expect(page).toHaveURL(/#\/contracts$/);
  await expect(page.locator(".contract-card", { hasText: "Yoga-Studio Sonnenschein" })).toBeVisible();
  check();
});

test("yearly report and tax export", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/report");
  await expect(page.getByRole("heading", { name: /Dein Vertragsjahr/ })).toBeVisible();
  const csv = await page.request.get("/api/stats/tax.csv");
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).toContain("Summe");
  check();
});
