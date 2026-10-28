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
  // not every provider confirms – the hint can be dismissed
  await expect(page.getByText("Bestätigung des Anbieters steht noch aus")).toBeVisible();
  await page.click("#no-confirm-btn");
  await expect(page.getByText("Bestätigung des Anbieters steht noch aus")).toHaveCount(0);
  check();
});

test("agreed total: last payment is smaller, so the total comes out exactly", async ({ page }) => {
  const check = watchErrors(page);
  const d = new Date();
  const start = new Date(Date.UTC(d.getFullYear(), d.getMonth() - 13, 1)).toISOString().slice(0, 10);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Streaming" }).click();
  await page.fill("[name=name]", "Master");
  await page.fill("[name=price_amount]", "1105");
  await page.fill("[name=start_date]", start);
  await page.click("#total-toggle");
  await page.fill("[name=max_total]", "19900");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Master" })).toBeVisible();
  const card = page.locator(".budget-card");
  await expect(card).toContainText("15.470,00 € von 19.900,00 € bezahlt");
  await expect(card).toContainText("4 × 1.105,00 €");
  await expect(card).toContainText("10,00 € statt 1.105,00 €");
  await expect(page.locator(".kpi", { hasText: "Bisher bezahlt" })).toContainText("14 Buchungen");
  check();
});

test("partner pays a fixed amount; a contract without own name is called like its provider", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Strom" }).click();
  await page.fill("[name=provider]", "Stadtwerke Musterstadt");
  await page.fill("[name=price_amount]", "95");
  await page.click("summary:has-text('Anteil, Konto')");
  await page.click("#share-mode [data-mode=amount]");
  await page.fill("[name=partner_amount]", "20");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Stadtwerke Musterstadt", exact: true })).toBeVisible();
  await expect(page.locator(".kpi.hero .kpi-value")).toContainText("75,00");
  await expect(page.locator(".kpi.hero")).toContainText("Gesamt 95,00");
  await expect(page.locator(".kpi.hero")).toContainText("Partner:in zahlt 20,00");
  await page.goto("/#/contracts");
  const row = page.locator(".contract-row", { hasText: "Stadtwerke Musterstadt" });
  // under the name the category instead of the provider a second time
  await expect(row.locator(".cr-title span")).toHaveText("Strom");
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
  await page.click("[data-add=choose]");
  await page.click(".modal [data-k=extra]");
  await page.click(".modal [data-m=total]");
  await page.fill(".modal [name=amount]", "60");
  await expect(page.locator("#preview")).toContainText("Zusatzkosten");
  await page.click(".modal [data-t='Roaming']");
  await page.click(".modal [data-save]");
  await expect(page.locator(".table", { hasText: "Roaming" })).toBeVisible();
  check();
});

test("a bonus is entered as a positive amount and stored as a credit; rows open their dialog", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/1?tab=prices");
  await page.click("[data-add=choose]");
  await page.click(".modal [data-k=credit]");
  await page.fill(".modal [name=amount]", "50");
  await page.fill(".modal [name=note]", "Treuebonus");
  await page.click(".modal [data-save]");
  const row = page.locator("tr.row-link", { hasText: "Treuebonus" });
  await expect(row).toContainText("Gutschrift");
  await expect(row).toContainText("50,00");
  await row.click();
  await expect(page.locator(".modal .segmented [data-s=credit]")).toHaveClass(/active/);
  await page.click(".modal [data-del]");
  await page.click(".modal [data-ok]");
  await expect(page.locator("tr.row-link", { hasText: "Treuebonus" })).toHaveCount(0);
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

test("reminders: one check mark per row, the row opens every option", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/reminders");
  const row = page.locator("#later .reminder-item").first();
  await expect(row.locator(".quick-done")).toHaveCount(1);
  await row.locator("[data-open]").click();
  await expect(page.locator(".reminder-sheet .sheet-actions .btn").first()).toBeVisible();
  await page.locator(".reminder-sheet [data-close]").click();
  check();
});

test("calendar link lives in the settings", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/settings");
  await expect(page.locator("#cal")).toHaveValue(/\/api\/calendar\/.+\.ics$/);
  const url = await page.inputValue("#cal");
  const res = await page.request.get(url);
  expect(res.ok()).toBeTruthy();
  expect(await res.text()).toContain("BEGIN:VCALENDAR");
  check();
});

test("contract paid from the joint account doesn't count as own cost", async ({ page }) => {
  const check = watchErrors(page);
  const before = await (await page.request.get("/api/stats/summary")).json();
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Streaming" }).click();
  await page.fill("[name=name]", "Familien-Streaming");
  await page.fill("[name=price_amount]", "18");
  await page.click("summary:has-text('Anteil, Konto')");
  await page.fill("[name=account]", "Gemeinschaftskonto");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Familien-Streaming" })).toBeVisible();
  const after = await (await page.request.get("/api/stats/summary")).json();
  expect(after.monthly_total).toBeCloseTo(before.monthly_total, 2);
  await page.goto("/#/");
  await expect(page.locator(".dash-hero")).toContainText("über Gemeinschaftskonto");
  await page.goto("/#/costs");
  await page.click(".account-switch [data-account='Gemeinschaftskonto']");
  await expect(page.locator(".account-switch [data-account='Gemeinschaftskonto']")).toHaveClass(/active/);
  await page.goto("/#/contracts");
  await expect(page.locator(".contract-row", { hasText: "Familien-Streaming" })).toContainText("Gemeinschaftskonto");
  check();
});

test("own fields: rename the customer number, add a field", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Fitness" }).click();
  await page.fill("[name=name]", "Kletterhalle");
  await page.fill("[name=price_amount]", "39");
  await page.click("summary:has-text('Anteil, Konto')");
  const own = page.locator("#own-fields");
  await page.fill("[name=managed_by]", "Makler Schmidt");
  await own.locator("[data-key=customer_number] [data-rename]").click();
  await own.locator("[data-key=customer_number] .lbl-input").fill("Mitgliedsnummer");
  await page.keyboard.press("Enter");
  await page.fill("[name=customer_number]", "M-4711");
  await page.click("#own-add");
  await page.keyboard.type("Chipkarte");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Nr. 0815");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Kletterhalle" })).toBeVisible();
  await expect(page.locator(".fact", { hasText: "Mitgliedsnummer" })).toContainText("M-4711");
  await expect(page.locator(".fact", { hasText: "Chipkarte" })).toContainText("Nr. 0815");
  await expect(page.locator(".detail-head .sub")).toContainText("Verwaltet von Makler Schmidt");
  check();
});

test("contract list: search plus one filter button, active filters removable", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts");
  await page.click("#filter-btn");
  await page.click("[data-set=category] [data-v=mobile]");
  await page.click(".modal [data-close]");
  await expect(page.locator(".contract-row")).toHaveCount(1);
  await expect(page.locator("#filter-count")).toHaveText("1");
  await page.click("#active [data-clear=category]");
  await expect(page.locator(".contract-row").nth(1)).toBeVisible();
  await expect(page.locator("#filter-count")).toHaveText("");
  check();
});

test("a mis-tap on the check mark can be undone", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/reminders");
  const first = page.locator("#later .reminder-item:has([data-dismiss])").first();
  const title = await first.locator(".title").innerText();
  await first.locator(".quick-done").click();
  await expect(page.locator("#later .reminder-item .title", { hasText: title })).toHaveCount(0);
  await page.click(".toast-action");
  await expect(page.locator("#later .reminder-item .title", { hasText: title })).toHaveCount(1);
  check();
});
