// Cloudflare Access in front of the app (simulated): when its session ends, the app has to lead to
// the Access login instead of hanging – and must never do so offline, without Access or on
// ordinary errors. Hosts are made up; no real team domain belongs in tests.
const { test, expect } = require("@playwright/test");
const { watchErrors } = require("./helpers");

const IDENTITY = "**/cdn-cgi/access/get-identity";
const ACCESS_HOST = "https://example-team.cloudflareaccess.com";
const ACCESS_LOGIN = `${ACCESS_HOST}/cdn-cgi/access/login/app.example.org`;

/** Access signed in: get-identity answers with the user's identity. */
const identityValid = (page) => page.route(IDENTITY, (r) => r.fulfill({ json: { email: "someone@example.org" } }));

/** Access session over: everything behind it redirects to the login on another origin. */
async function accessExpired(page, apiPattern = "**/api/**") {
  await page.unroute(IDENTITY);
  await page.route(IDENTITY, (r) => r.fulfill({ status: 302, headers: { location: ACCESS_LOGIN } }));
  await page.route(apiPattern, (r) => r.fulfill({ status: 302, headers: { location: ACCESS_LOGIN } }));
  // the login page sends no CORS headers: a fetch that follows the redirect fails
  await page.route(`${ACCESS_HOST}/**`, (r) => r.fulfill({ contentType: "text/html", body: "<h1>Sign in</h1>" }));
}

function countRequests(page, match) {
  const seen = [];
  page.on("request", (req) => match(req) && seen.push(req.url()));
  return seen;
}
const isIdentity = (req) => req.url().includes("/cdn-cgi/access/get-identity");
const isReloadOfApp = (req) => req.isNavigationRequest() && new URL(req.url()).pathname === "/" && req.frame() === req.frame().page().mainFrame();

test("expired Access session: notice, one top-level navigation, no loop", async ({ page }) => {
  await identityValid(page);
  await page.goto("/#/contracts");
  await expect(page.locator(".contract-row").first()).toBeVisible();

  await accessExpired(page);
  const navigations = countRequests(page, isReloadOfApp);
  const first = page.waitForRequest(isReloadOfApp);
  await page.evaluate(() => (location.hash = "#/reminders"));
  await expect(page.locator(".toast")).toContainText("Sitzung abgelaufen – Weiterleitung zur Anmeldung");
  await first;
  // after the reload Access is still gone: no second redirect within the minute
  await page.waitForTimeout(3000);
  expect(navigations).toHaveLength(1);
  await expect(page.getByText("Sitzung abgelaufen – bitte die Seite neu laden").first()).toBeVisible();
});

test("offline: no Access check, no navigation, a plain connection error", async ({ page, context }) => {
  await identityValid(page);
  await page.goto("/#/contracts");
  await expect(page.locator(".contract-row").first()).toBeVisible();
  const checks = countRequests(page, isIdentity);
  const navigations = countRequests(page, isReloadOfApp);

  await context.setOffline(true);
  await page.evaluate(() => (location.hash = "#/reminders"));
  await expect(page.getByText("Keine Verbindung – bist du offline?").first()).toBeVisible();
  await page.dispatchEvent("body", "click"); // any activity
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1500);
  expect(checks).toHaveLength(0);
  expect(navigations).toHaveLength(0);
  await context.setOffline(false);
});

test("ordinary API errors stay ordinary errors", async ({ page }) => {
  const check = watchErrors(page);
  await identityValid(page);
  await page.goto("/");
  await expect(page.locator(".kpi.hero")).toBeVisible();
  const checks = countRequests(page, isIdentity);
  const navigations = countRequests(page, isReloadOfApp);

  await page.route(/\/api\/contracts(\?|$)/, (r) => r.fulfill({ status: 500, json: { detail: "Datenbank kaputt" } }));
  await page.evaluate(() => (location.hash = "#/contracts"));
  await expect(page.getByText("Datenbank kaputt").first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(checks).toHaveLength(0);
  expect(navigations).toHaveLength(0);
  check();
});

test("without Access in front (LAN): a failed request never redirects", async ({ page }) => {
  // no identity route: the backend itself answers /cdn-cgi/… with an error, as on a LAN install
  await page.goto("/#/contracts");
  await expect(page.locator(".contract-row").first()).toBeVisible();
  const checks = countRequests(page, isIdentity);
  const navigations = countRequests(page, isReloadOfApp);

  await page.route("**/api/reminders/**", (r) => r.fulfill({ status: 302, headers: { location: ACCESS_LOGIN } }));
  await page.route(`${ACCESS_HOST}/**`, (r) => r.fulfill({ contentType: "text/html", body: "<h1>Sign in</h1>" }));
  await page.evaluate(() => (location.hash = "#/reminders"));
  await expect(page.locator(".card.empty", { hasText: "Da ist etwas schiefgelaufen" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(checks.length).toBeGreaterThan(0); // it did look …
  expect(navigations).toHaveLength(0); // … and found no Access session to renew
});

test("Access still valid but the API answers HTML: no redirect", async ({ page }) => {
  await identityValid(page);
  await page.goto("/");
  await expect(page.locator(".kpi.hero")).toBeVisible();
  const navigations = countRequests(page, isReloadOfApp);

  await page.route(/\/api\/contracts(\?|$)/, (r) => r.fulfill({ contentType: "text/html", body: "<html>Bad gateway</html>" }));
  await page.evaluate(() => (location.hash = "#/contracts"));
  await expect(page.locator(".card.empty", { hasText: "Da ist etwas schiefgelaufen" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(navigations).toHaveLength(0);
});

test("check on start and when the app comes back, at most every 5 minutes", async ({ page }) => {
  await page.clock.install();
  await identityValid(page);
  const checks = countRequests(page, isIdentity);
  await page.goto("/");
  await expect(page.locator(".kpi.hero")).toBeVisible();
  await expect.poll(() => checks.length).toBe(1); // on start

  const backToApp = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await backToApp();
  await page.clock.runFor(60_000);
  await backToApp();
  expect(checks).toHaveLength(1); // throttled

  await page.clock.runFor(5 * 60_000);
  await backToApp();
  await expect.poll(() => checks.length).toBe(2);

  // the Access session ended while the app was in the background
  await accessExpired(page);
  await page.clock.runFor(5 * 60_000 + 1000);
  const navigation = page.waitForRequest(isReloadOfApp);
  await backToApp();
  await expect(page.locator(".toast")).toContainText("Sitzung abgelaufen – Weiterleitung zur Anmeldung");
  await page.clock.runFor(2000);
  await navigation;
});

test("service worker: opens offline, never caches the API, /cdn-cgi or redirects", async ({ page, context }) => {
  // the app registers it on https only; localhost counts as secure for this test
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator(".kpi.hero")).toBeVisible();

  // a same-origin redirect (here: trailing slash) and Cloudflare's own path pass the worker uncached
  await page.evaluate(() => Promise.all([fetch("/cdn-cgi/access/get-identity"), fetch("/healthz/").catch(() => null)]));
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const keys = [];
    for (const name of names) for (const req of await (await caches.open(name)).keys()) keys.push(new URL(req.url).pathname);
    return { names, keys };
  });
  expect(cached.names).toEqual(["contractly-v4"]);
  expect(cached.keys).toContain("/");
  expect(cached.keys).toContain("/static/js/app.js");
  expect(cached.keys.filter((k) => /^\/(api|cdn-cgi|healthz)/.test(k))).toEqual([]);

  // offline the app shell still opens, a share link (/?text=…) as well
  await context.setOffline(true);
  await page.goto("/?text=Hallo");
  await expect(page).toHaveTitle("Contractly");
  await context.setOffline(false);
});

test("Access expired already on start: one notice, one navigation", async ({ page }) => {
  // the device has seen Access before
  await page.addInitScript(() => localStorage.setItem("contractly.access", "1"));
  await page.route(IDENTITY, (r) => r.fulfill({ status: 302, headers: { location: ACCESS_LOGIN } }));
  await page.route("**/api/**", (r) => r.fulfill({ status: 302, headers: { location: ACCESS_LOGIN } }));
  await page.route(`${ACCESS_HOST}/**`, (r) => r.fulfill({ contentType: "text/html", body: "<h1>Sign in</h1>" }));
  const navigation = page.waitForRequest(isReloadOfApp);
  await page.goto("/");
  await expect(page.locator(".toast")).toHaveCount(1);
  await expect(page.locator(".toast")).toContainText("Weiterleitung zur Anmeldung");
  await navigation;
});
