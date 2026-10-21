const { test, expect } = require("@playwright/test");
const path = require("path");
const { watchErrors } = require("./helpers");

test("bank statement import suggests contracts", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/import");
  await page.setInputFiles("#drop input[type=file]", path.join(__dirname, "..", "fixtures", "umsaetze.csv"));
  await expect(page.locator("#bank-result")).toContainText("regelmäßige Zahlungen");
  await page.click("#apply");
  await expect(page).toHaveURL(/#\/contracts$/);
  await expect(page.locator(".contract-card", { hasText: "FitX Deutschland" })).toBeVisible();
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
