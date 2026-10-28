const { test, expect } = require("@playwright/test");
const { ADMIN } = require("../global-setup");

// A fresh login in its own context: logging out here doesn't end the session the other tests use.
test.use({ storageState: { cookies: [], origins: [] } });

async function login(page, landing = ".dash-hero") {
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await page.fill("[name=username]", ADMIN.username);
  await page.fill("[name=password]", ADMIN.password);
  await page.click("button[type=submit]");
  await expect(page.locator(landing)).toBeVisible();
}

test("automatic logout after the chosen idle time", async ({ page }) => {
  await page.goto("/");
  await login(page);
  await page.goto("/#/settings");
  await expect(page.locator("#idle")).toBeVisible();
  await page.clock.install();
  await page.selectOption("#idle", "5");
  await expect(page.locator(".toast").last()).toContainText("Automatische Abmeldung");
  await page.clock.fastForward("06:00");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  expect((await page.request.get("/api/contracts")).status()).toBe(401);
  // after logging in again you are back where you were; then "off" for the rest of the suite
  await login(page, "#idle");
  await page.selectOption("#idle", "0");
  await expect(page.locator(".toast").last()).toContainText("aus");
});
