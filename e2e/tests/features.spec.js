const { test, expect } = require("@playwright/test");
const fs = require("fs");
const { watchErrors } = require("./helpers");

test.describe.configure({ mode: "serial" });

test("post & mails: pasted e-mail updates the right contract", async ({ page }) => {
  const check = watchErrors(page);
  const res = await page.request.post("/api/contracts", {
    data: {
      name: "MagentaZuhause L",
      category: "internet",
      provider: "Telekom Deutschland GmbH",
      customer_number: "556677889",
      start_date: "2025-01-01",
      initial_price: { valid_from: "2025-01-01", amount: 44.95 },
    },
  });
  const contract = await res.json();
  await page.goto("/#/inbox");
  await page.fill("#paste [name=subject]", "Preisanpassung Ihres Tarifs");
  await page.fill(
    "#paste [name=text]",
    "Ihre Kundennummer: 556677889\nAb dem 01.03.2027 ändert sich Ihr monatlicher Grundpreis von 44,95 € auf 49,95 €.",
  );
  await page.click("#paste button[type=submit]");
  await expect(page.locator(".inbox-card h2")).toHaveText("Preiserhöhung");
  await expect(page.locator("#contract")).toHaveValue(String(contract.id));
  await expect(page.locator("#why")).toContainText("Kundennummer");
  await expect(page.locator("[data-amount]")).toHaveValue("49.95");
  await page.click("#apply");
  await expect(page).toHaveURL(new RegExp(`#/contracts/${contract.id}$`));
  const detail = await (await page.request.get(`/api/contracts/${contract.id}`)).json();
  expect(detail.prices.map((p) => p.amount)).toEqual([44.95, 49.95]);
  expect(detail.documents[0].description).toContain("Preiserhöhung");
  check();
});

test("yearly check: go through all cards and finish", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/checkup");
  await expect(page.getByRole("heading", { name: /Dein Jahres-Check/ })).toBeVisible();
  await page.getByRole("link", { name: /Los geht's/ }).click();
  await expect(page.locator(".checkup-card")).toBeVisible();
  const cards = await page.locator(".checkup-progress span").count();
  expect(cards).toBeGreaterThan(0);
  for (let i = 0; i < cards; i++) {
    // the first one is cancelled, the rest kept
    await page.locator(i === 0 ? "[data-d=cancel]" : "[data-d=ok]").click();
    if (i < cards - 1) await expect(page.locator(".checkup-progress span.done")).toHaveCount(i + 1);
  }
  await expect(page.getByRole("heading", { name: "Geschafft!" })).toBeVisible();
  await expect(page.locator("[data-letter]")).toHaveCount(1);
  await page.click("#finish");
  await expect(page).toHaveURL(/#\/$/);
  check();
});

test("emergency folder: encrypted file opens offline with the passphrase", async ({ page }, testInfo) => {
  const check = watchErrors(page);
  await page.goto("/#/emergency");
  await expect(page.locator(".emergency-contract").first()).toBeVisible();
  await page.fill("#note-form textarea", "Ordner mit Unterlagen: Arbeitszimmer, oberstes Fach");
  await page.click("#note-form button[type=submit]");
  await expect(page.locator("#folder")).toContainText("Arbeitszimmer");

  await page.fill("[name=passphrase]", "Familie-Notfall-2026");
  await page.fill("[name=passphrase2]", "Familie-Notfall-2026");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-form button[type=submit]")]);
  const file = testInfo.outputPath("notfall-mappe.html");
  await download.saveAs(file);
  const html = fs.readFileSync(file, "utf8");
  expect(html).not.toContain("Arbeitszimmer");

  // what a relative does: open the file, enter the passphrase
  const viewer = await page.context().newPage();
  const errors = [];
  viewer.on("pageerror", (e) => errors.push(e.message));
  await viewer.goto(`file://${file}`);
  await viewer.fill("#pw", "falsch-falsch");
  await viewer.click("button[type=submit]");
  await expect(viewer.locator("#err")).toHaveText("Das Passwort stimmt nicht.");
  await viewer.fill("#pw", "Familie-Notfall-2026");
  await viewer.click("button[type=submit]");
  await expect(viewer.getByRole("heading", { name: /Notfall-Mappe/ })).toBeVisible();
  await expect(viewer.locator("body")).toContainText("Arbeitszimmer");
  await expect(viewer.locator(".contract").first()).toBeVisible();
  expect(errors).toEqual([]);
  check();
});

test("loan: balance, special repayment and refinancing check", async ({ page }) => {
  const check = watchErrors(page);
  const contracts = await (await page.request.get("/api/contracts")).json();
  const loan = contracts.find((c) => c.category === "loan");
  await page.goto(`/#/contracts/${loan.id}`);
  await expect(page.locator(".loan-card")).toContainText("Restschuld heute");
  const before = await page.locator(".loan-balance .big").textContent();
  await page.locator(".loan-card summary", { hasText: "Sondertilgungen" }).click();
  await page.fill("#repayment-form [name=amount]", "500");
  await page.click("#repayment-form button[type=submit]");
  await expect(page.locator(".loan-balance .big")).not.toHaveText(before);
  await page.locator(".loan-card summary", { hasText: "Umschuldung" }).click();
  await page.fill("[name=new_rate]", "3.9");
  await page.click("#loan-compare button[type=submit]");
  await expect(page.locator("#loan-compare-result")).toContainText("weniger Zinsen");
  check();
});

test("income: salary with net only, raise and bonus", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/income");
  await expect(page.getByRole("heading", { name: "Einnahmen", exact: true })).toBeVisible();
  // the demo already has income; add a side job with net only
  await page.click("#add");
  await page.selectOption(".modal [name=kind]", "side_job");
  await page.fill(".modal [name=name]", "Nachhilfe");
  await page.fill(".modal [name=net]", "300");
  await page.click(".modal [data-save]");
  const card = page.locator(".income-card", { hasText: "Nachhilfe" });
  await expect(card).toContainText("300,00 €");
  // the page redraws inside its area: the tabs of "Auswertung" stay
  await expect(page.locator(".section-tabs a.active")).toHaveText("Einnahmen");
  await card.locator("[data-bonus]").click();
  await page.fill(".modal [name=net]", "150");
  await page.fill(".modal [name=note]", "Ferienkurs");
  await page.click(".modal [data-save]");
  await expect(page.locator(".income-card", { hasText: "Nachhilfe" })).toContainText("Ferienkurs");
  await expect(page.locator(".kpi.hero")).toContainText("%");
  check();
});

test("settings: 'Alle Daten löschen' only fires after typing the confirmation word", async ({ page }) => {
  const check = watchErrors(page);
  let sent = null;
  // the real deletion is covered by the backend tests; here it would wipe the shared test data
  await page.route("**/api/data/reset", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { contracts: 9, income_sources: 2, documents: 0 } });
  });
  await page.goto("/#/settings");
  await page.click("#reset");
  const ok = page.locator(".modal [data-ok]");
  await expect(ok).toBeDisabled();
  await page.fill(".modal [name=confirm]", "loeschen");
  await expect(ok).toBeDisabled();
  await page.fill(".modal [name=confirm]", "löschen");
  await expect(ok).toBeEnabled();
  await ok.click();
  await expect(page.locator(".toast").last()).toContainText("Gelöscht: 9 Verträge");
  expect(sent).toEqual({ confirm: "löschen" });
  await expect(page).toHaveURL(/#\/$/);
  check();
});

test("charts: whole history loaded, last two years shown, drag to go back, 'Alles' shows everything", async ({ page }) => {
  const check = watchErrors(page);
  // a contract with four years of history
  const start = `${new Date().getFullYear() - 4}-01-01`;
  await page.request.post("/api/contracts", {
    data: { name: "Altvertrag", category: "other", start_date: start, initial_price: { valid_from: start, amount: 20 } },
  });
  await page.goto("/#/costs");
  const state = () =>
    page.evaluate(() => {
      const c = Chart.getChart(document.getElementById("hist"));
      if (!c) return { count: 0, min: 0, max: 0 };
      return { count: c.data.labels.length, min: Math.round(c.scales.x.min), max: Math.round(c.scales.x.max) };
    });
  await expect.poll(async () => (await state()).count).toBeGreaterThan(40);
  let s = await state();
  expect(s.max - s.min + 1).toBe(24);
  expect(s.max).toBe(s.count - 1);
  // drag to the right = back in time
  // the chart sits below "Wohin dein Geld geht": bring it into view before dragging
  await page.locator("#hist").scrollIntoViewIfNeeded();
  const box = await page.locator("#hist").boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await state()).max).toBeLessThan(s.max);
  await page.click("#range [data-r='0']");
  await expect.poll(async () => (await state()).min).toBe(0);
  s = await state();
  expect(s.max).toBe(s.count - 1);

  await page.goto("/#/income");
  await page.click("#income-range [data-r='12']");
  await page.waitForTimeout(300);
  const inc = await page.evaluate(() => {
    const c = Chart.getChart(document.getElementById("income-chart"));
    return { count: c.data.labels.length, min: Math.round(c.scales.x.min), max: Math.round(c.scales.x.max) };
  });
  expect(inc.max - inc.min + 1).toBe(12);
  check();
});

test("costs: filter by payment interval, monthly reserve, when paid", async ({ page }) => {
  const check = watchErrors(page);
  const y = new Date().getFullYear() - 1;
  await page.request.post("/api/contracts", {
    data: { name: "Haftpflicht Jahr", category: "liability", start_date: `${y}-03-10`, initial_price: { valid_from: `${y}-03-10`, amount: 120, interval: "yearly" } },
  });
  await page.goto("/#/costs");
  await page.click("#filter-btn");
  await page.click("#f-int [data-int='yearly']");
  await expect(page.locator("#selection .kpi.hero")).toContainText("Monatliche Rücklage");
  await expect(page.locator("#selection .list")).toContainText("Haftpflicht Jahr");
  await expect(page.locator("#selection .list")).toContainText("nächste Zahlung");
  // only yearly contracts in the history
  await expect
    .poll(() => page.evaluate(() => Chart.getChart(document.getElementById("hist"))?.data.datasets.length || 0))
    .toBeGreaterThan(0);
  await page.click("#f-mode [data-mode='paid']");
  await page.click(".modal [data-close]");
  await expect(page.locator("#hist-sub")).toContainText("Fälligkeit");
  await expect(page.locator("#filter-count")).toHaveText("2");
  await page.click("#filter-btn");
  await page.click("#f-reset");
  await expect(page.locator("#selection")).toBeEmpty();
  check();
});
