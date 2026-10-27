const { test, expect } = require("@playwright/test");
const { watchErrors } = require("./helpers");

test("dashboard shows key figures", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".kpi.hero .kpi-value")).toContainText("€");
  await expect(page.locator("#dash-chart")).toBeVisible();
  check();
});

test("create a contract with the wizard", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Fitness" }).click();
  await page.fill("[name=provider]", "Urban Sports Club");
  await page.fill("[name=name]", "USC M");
  await page.fill("[name=price_amount]", "49");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "USC M" })).toBeVisible();
  await expect(page.locator(".kpi.hero .kpi-value")).toContainText("49,00");
  await page.goto("/#/contracts");
  await expect(page.locator(".contract-row", { hasText: "USC M" })).toBeVisible();
  check();
});

test("new contract that is already cancelled ends on the given date", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Streaming" }).click();
  await page.fill("[name=name]", "Jahresabo Zeitung");
  await page.fill("[name=price_amount]", "150");
  await page.selectOption("[name=price_interval]", "yearly");
  await page.check("#already-cancelled");
  // prefilled with the end of the current term
  await expect(page.locator("[name=cancel_end]")).not.toHaveValue("");
  const year = new Date().getFullYear() + 1;
  await page.fill("[name=cancel_end]", `${year}-01-31`);
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Jahresabo Zeitung" })).toBeVisible();
  await expect(page.locator(".detail-head .badge, .page-head .badge").first()).toContainText("Gekündigt");
  check();
});

test("own emoji for a contract", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Streaming" }).click();
  await page.fill("[name=name]", "Hundeschule");
  await page.fill("[name=price_amount]", "25");
  await page.click(".icon-pick");
  await page.click(".icon-grid [data-emoji='🐶']");
  await expect(page.locator(".icon-pick")).toHaveText("🐶");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Hundeschule" })).toBeVisible();
  await expect(page.locator(".cat-icon.lg")).toHaveText("🐶");
  await page.goto("/#/contracts");
  await expect(page.locator(".contract-row", { hasText: "Hundeschule" }).locator(".cat-icon")).toHaveText("🐶");
  check();
});

test("record extra charges by invoice amount", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/1?tab=prices");
  await page.click("[data-add=extra]");
  await page.click(".modal [data-m=total]");
  await page.fill(".modal [name=amount]", "60");
  await expect(page.locator("#preview")).toContainText("Zusatzkosten");
  await page.click(".modal [data-t='Roaming']");
  await page.click(".modal [data-save]");
  await expect(page.locator(".table", { hasText: "Roaming" })).toBeVisible();
  check();
});

test("compare an offer with switching bonus and promo price", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/1?tab=compare");
  await page.fill("#offer-form [name=provider]", "E2E Mobil");
  await page.fill("#offer-form [name=name]", "E2E Tarif");
  await page.fill("#offer-form [name=monthly_price]", "20");
  await page.click("#offer-form [data-add-bonus=switch]");
  await page.fill("#offer-form .bonus-row [data-f=amount]", "50");
  await page.click("#offer-form [data-add-promo]");
  await page.fill("#offer-form [name=promo_price]", "5");
  await page.click("#offer-form button[type=submit]");
  const card = page.locator(".offer-card", { hasText: "E2E Tarif" });
  await expect(card).toContainText("Wechselbonus");
  await expect(card).toContainText("Wechsel lohnt sich");
  await page.click("#bonus-toggle [data-b='0']");
  await expect(page.locator(".offer-card", { hasText: "E2E Tarif" })).toBeVisible();
  check();
});

test("pause a subscription", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/10");
  await page.click("[data-menu]");
  await page.click("[data-act=pause]");
  await page.click(".modal [data-ok]");
  await expect(page.locator(".kpi.hero")).toContainText("pausiert");
  check();
});

test("reminders and calendar link", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/reminders");
  await expect(page.locator("#cal")).toHaveValue(/\/api\/calendar\/.+\.ics$/);
  const url = await page.inputValue("#cal");
  const res = await page.request.get(url);
  expect(res.ok()).toBeTruthy();
  expect(await res.text()).toContain("BEGIN:VCALENDAR");
  check();
});
