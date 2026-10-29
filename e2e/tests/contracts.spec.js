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
  await expect(page.locator(".kpi", { hasText: "Endet am" })).toContainText(`31.01.${year}`);
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
  await page.locator(".cat-tile", { hasText: "Bildung" }).click();
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


test("a contract that starts later shows its coming price, not 0,00 €", async ({ page }) => {
  const check = watchErrors(page);
  const d = new Date();
  const start = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 2, 1)).toISOString().slice(0, 10);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Kfz" }).click();
  await page.fill("[name=provider]", "Neue Kfz");
  await page.fill("[name=price_amount]", "900");
  await page.selectOption("[name=price_interval]", "yearly");
  await page.fill("[name=start_date]", start);
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Neue Kfz" })).toBeVisible();
  const hero = page.locator(".kpi.hero");
  await expect(hero).toContainText("Pro Monat ab");
  await expect(hero).toContainText("75,00");
  await expect(page.locator(".kpi", { hasText: "Beginnt am" })).toBeVisible();
  await expect(page.locator(".kpi", { hasText: "Bisher bezahlt" })).toHaveCount(0);
  await page.goto("/#/contracts");
  await expect(page.locator(".contract-row", { hasText: "Neue Kfz" })).toContainText("75,00");
  check();
});

test("the form shows when the contract renews and the last day to cancel", async ({ page }) => {
  const check = watchErrors(page);
  const y = new Date().getFullYear();
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Kfz" }).click();
  await page.fill("[name=provider]", "Renew Test");
  await page.fill("[name=price_amount]", "400");
  await page.fill("[name=start_date]", `${y - 2}-01-01`);
  await page.click("summary:has-text('Laufzeit, Kündigung')");
  // car insurance: 12 months, renews by 12 months, notice 1 month
  const preview = page.locator("#term-preview");
  await expect(preview).toContainText(`Verlängert sich am 01.01.${y + 1}`);
  await expect(preview).toContainText(`bis 30.11.${y}`);
  // a renewal date from the paper sets the minimum term
  await page.fill("[name=start_date]", `${y}-01-01`);
  await page.fill("#renews-on", `${y + 2}-01-01`);
  await page.locator("#renews-on").dispatchEvent("change");
  await expect(page.locator("[name=min_term_months]")).toHaveValue("24");
  await expect(preview).toContainText(`Verlängert sich am 01.01.${y + 2}`);
  check();
});

test("a contract paid once shows its amount, not 0,00 € a month", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Bildung" }).click();
  await page.fill("[name=provider]", "Sprachschule");
  await page.fill("[name=price_amount]", "490");
  await page.selectOption("[name=price_interval]", "once");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Sprachschule" })).toBeVisible();
  await expect(page.locator(".kpi.hero")).toContainText("Einmalig");
  await expect(page.locator(".kpi.hero")).toContainText("490,00");
  await page.goto("/#/contracts");
  await expect(page.locator(".contract-row", { hasText: "Sprachschule" })).toContainText("einmalig");
  check();
});

test("electricity base price can be entered per year", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/4/edit");
  await page.fill("[name=attr_base_price_month]", "180");
  await page.selectOption("[name=attr_base_price_month__period]", "year");
  await page.fill("[name=attr_installment]", "960");
  await page.selectOption("[name=attr_installment__period]", "year");
  await page.click("#save");
  await expect(page.locator(".fact", { hasText: "Grundpreis" })).toContainText("180 €/Jahr (15 €/Monat)");
  const c = await (await page.request.get("/api/contracts/4")).json();
  expect(c.attributes.base_price_month).toBe(15);
  expect(c.attributes.base_price_period).toBe("year");
  expect(c.attributes.installment).toBe(80);
  await expect(page.locator(".fact", { hasText: "Abschlag" }).first()).toContainText("960 €/Jahr (80 €/Monat)");
  // editing again shows it per year
  await page.goto("/#/contracts/4/edit");
  await expect(page.locator("[name=attr_base_price_month]")).toHaveValue("180");
  await expect(page.locator("[name=attr_base_price_month__period]")).toHaveValue("year");
  check();
});

test("electricity: the Abschlag is the price, with the expected settlement", async ({ page }) => {
  const check = watchErrors(page);
  // like a contract recorded before: 61 € in the facts, 58,18 € as the price
  const res = await page.request.post("/api/contracts", {
    data: {
      name: "Spar Strom", category: "electricity", provider: "Bodensee Energy", start_date: "2026-02-24",
      initial_price: { valid_from: "2026-02-24", amount: 58.18, interval: "monthly" },
      attributes: { installment: 61, base_price_month: 188.07 / 12, unit_price_ct: 25.7, consumption_kwh: 3000 },
    },
  });
  const id = (await res.json()).id;
  await page.goto(`/#/contracts/${id}`);
  const hint = page.locator(".callout", { hasText: "In den Eckdaten steht ein Abschlag" });
  await expect(hint).toContainText("61,00");
  // the edit form keeps the 61 € and asks from when they apply
  await page.goto(`/#/contracts/${id}/edit`);
  await expect(page.locator("[name=attr_installment]")).toHaveValue("61");
  await expect(page.locator("#inst-from")).toBeVisible();
  await page.check("[name=inst_always]");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Spar Strom" })).toBeVisible();
  const hero = page.locator(".kpi.hero");
  await expect(hero).toContainText("Abschlag pro Monat");
  await expect(hero).toContainText("61,00");
  // 188,07 € + 3.000 kWh × 25,7 ct = 959,07 € a year vs 732 € paid
  await expect(hero).toContainText("bei 3.000 kWh");
  await expect(hero).toContainText("Nachzahlung");
  await expect(hint).toHaveCount(0);
  const c = await (await page.request.get(`/api/contracts/${id}`)).json();
  expect(c.prices.filter((p) => p.interval !== "once")).toHaveLength(1);
  expect(c.monthly_cost).toBe(61);
  check();
});

test("electricity: a new Abschlag in the form becomes a price change from a date", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Strom" }).click();
  await expect(page.locator("label", { hasText: "Abschlag" }).first()).toBeVisible();
  await page.fill("[name=provider]", "Abschlag Test");
  await page.fill("[name=price_amount]", "70");
  await page.fill("[name=start_date]", "2025-01-01");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Abschlag Test" })).toBeVisible();
  const id = page.url().match(/contracts\/(\d+)/)[1];
  await page.goto(`/#/contracts/${id}/edit`);
  await expect(page.locator("[name=attr_installment]")).toHaveValue("70");
  await page.fill("[name=attr_installment]", "85");
  await expect(page.locator("#inst-from")).toBeVisible();
  await page.fill("[name=inst_from]", "2026-01-01");
  await page.click("#save");
  await expect(page.locator(".kpi.hero")).toContainText("85,00");
  const c = await (await page.request.get(`/api/contracts/${id}`)).json();
  const prices = c.prices.filter((p) => p.interval !== "once").map((p) => [p.valid_from, p.amount]);
  expect(prices).toEqual(expect.arrayContaining([["2025-01-01", 70], ["2026-01-01", 85]]));
  check();
});

