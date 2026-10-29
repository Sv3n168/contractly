const { test, expect } = require("@playwright/test");
const { watchErrors } = require("./helpers");

/** Create a contract through the app's own API (same origin, so the CSRF check passes). */
async function createContract(page, body) {
  await page.locator(".kpi.hero").waitFor(); // signed in and the app is ready
  const c = await page.evaluate(async (b) => {
    const start = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    const r = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: start, initial_price: { valid_from: start, amount: 30, interval: "monthly" }, ...b }),
    });
    return { status: r.status, ...(await r.json()) };
  }, body);
  expect(c.status, JSON.stringify(c)).toBe(201);
  return c;
}

test("plausibility: a price without comma is questioned and can be corrected", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Streaming" }).click();
  await page.fill("[name=name]", "Kommafehler TV");
  await page.fill("[name=price_amount]", "1299");
  await page.click("#save");
  const dialog = page.locator(".modal", { hasText: "Bitte kurz prüfen" });
  await expect(dialog).toContainText("Komma vergessen");
  await dialog.getByRole("button", { name: "Korrigieren" }).click();
  await expect(page.locator("[name=price_amount]")).toBeFocused();
  await page.fill("[name=price_amount]", "12.99");
  await page.click("#save");
  await expect(page.getByRole("heading", { name: "Kommafehler TV" })).toBeVisible();
  check();
});

test("plausibility: long renewal of a new fitness contract is questioned, saving anyway works", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Fitness" }).click();
  await page.fill("[name=name]", "Studio Zwölf");
  await page.fill("[name=price_amount]", "39");
  await page.click("summary:has-text('Laufzeit, Kündigung')");
  await page.fill("[name=renewal_months]", "12");
  await page.click("#save");
  const dialog = page.locator(".modal", { hasText: "Bitte kurz prüfen" });
  await expect(dialog).toContainText("§ 309 Nr. 9 BGB");
  await dialog.getByRole("button", { name: "Trotzdem speichern" }).click();
  await expect(page.getByRole("heading", { name: "Studio Zwölf" })).toBeVisible();
  check();
});

test("a known provider brings its address and customer number; the name suggests the category", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/");
  await createContract(page, {
    name: "Handy Muster",
    category: "mobile",
    provider: "Musterfunk",
    provider_address: "Musterfunk GmbH\nPostfach 1\n12345 Musterstadt",
    customer_number: "K-4711",
  });
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile", { hasText: "Internet" }).click();
  await page.fill("[name=provider]", "Musterfunk");
  await page.locator("[name=provider]").blur();
  await expect(page.locator(".toast")).toContainText("Von „Handy Muster“ übernommen: Anschrift, Kundennummer");
  await expect(page.locator("[name=customer_number]")).toHaveValue("K-4711");
  await expect(page.locator("[name=provider_address]")).toHaveValue(/Postfach 1/);

  // a streaming service typed into "Sonstiges": switch with the typed values kept
  await page.goto("/#/contracts");
  await page.goto("/#/contracts/new");
  await page.locator(".cat-tile[data-cat=other]").click();
  await page.fill("[name=provider]", "Netflix");
  await page.fill("[name=price_amount]", "13.99");
  await page.locator("[name=provider]").blur();
  await page.getByRole("button", { name: "Zu Streaming" }).click();
  await expect(page.locator(".card-head h2").first()).toHaveText("Streaming & Abos");
  await expect(page.locator("[name=provider]")).toHaveValue("Netflix");
  await expect(page.locator("[name=price_amount]")).toHaveValue("13.99");
  check();
});

test("missing data: the contract names it, jumps to the field, and can drop it", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/");
  const c = await createContract(page, { name: "Lückenhaft", category: "mobile", provider: "Lücke AG" });
  await page.goto(`/#/contracts/${c.id}`);
  const card = page.locator("#gaps");
  await expect(card).toContainText("4 Angaben offen");
  await card.locator(".gap-row", { hasText: "Vertragsunterlagen" }).getByRole("button", { name: "Brauche ich nicht" }).click();
  await expect(card).toContainText("3 Angaben offen");
  await page.locator(".toast").getByRole("button", { name: "Rückgängig" }).click();
  await expect(card).toContainText("4 Angaben offen");
  await card.locator(".gap-row", { hasText: "Anschrift" }).getByRole("link", { name: "Ergänzen" }).click();
  await expect(page.locator("[name=provider_address]")).toBeFocused();
  check();
});

test("dashboard: insights can be dismissed", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/");
  await createContract(page, { name: "Kfz Monatlich", category: "car_insurance" });
  await page.goto("/");
  const card = page.locator("#smart");
  await expect(card).toContainText("Gut zu wissen");
  const first = card.locator(".insight").first();
  const title = await first.locator("b").textContent();
  await first.getByRole("button", { name: "Hinweis ausblenden" }).click();
  await expect(card.locator(".insight b", { hasText: title })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#smart .insight b", { hasText: title })).toHaveCount(0);
  check();
});

test("dashboard: the open-data note can be acknowledged and comes back for new gaps", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("/");
  await createContract(page, { name: "Offen Eins", category: "mobile" });
  await page.goto("/#/contracts");
  await page.goto("/");
  const line = page.locator("#smart .gaps-line");
  await expect(line).toContainText("mit offenen Angaben");
  await line.getByRole("button", { name: "Zur Kenntnis genommen" }).click();
  await expect(page.locator("#smart .gaps-line")).toHaveCount(0);
  await page.locator(".toast").getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.locator("#smart .gaps-line")).toBeVisible();
  await page.locator("#smart .gaps-line").getByRole("button", { name: "Zur Kenntnis genommen" }).click();
  await page.reload();
  await expect(page.locator(".kpi.hero")).toBeVisible();
  await expect(page.locator("#smart .gaps-line")).toHaveCount(0);
  // something new missing: the note is back, naming only the new contract
  await createContract(page, { name: "Offen Zwei", category: "internet" });
  await page.reload();
  await expect(page.locator("#smart .gaps-line")).toContainText("1 Vertrag mit offenen Angaben: Offen Zwei");
  check();
});
