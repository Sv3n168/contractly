const { test, expect } = require("@playwright/test");
const { ADMIN } = require("../global-setup");
const { watchErrors } = require("./helpers");

test.use({ storageState: { cookies: [], origins: [] } });

test("login, wrong password, logout", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await page.fill("[name=username]", ADMIN.username);
  await page.fill("[name=password]", "falsches-passwort");
  await page.click("button[type=submit]");
  await expect(page.locator(".toast.error")).toContainText("falsch");
  await page.fill("[name=password]", ADMIN.password);
  await page.click("button[type=submit]");
  await expect(page.locator(".kpis")).toBeVisible();
  await page.locator(".sidebar [data-action=logout]").click();
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  // data is locked again
  expect((await page.request.get("/api/contracts")).status()).toBe(401);
  check();
});
