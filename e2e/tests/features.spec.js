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
