// Service worker: Contractly opens offline, but online the network always wins.
//
// - Navigations and assets: network first. Only a real network error falls back to the cache.
// - Redirects are passed through and never cached: when a login in front of the app (e.g.
//   Cloudflare Access) answers with a redirect, the browser has to see it instead of an old copy.
// - The API and /cdn-cgi/ (Cloudflare's own endpoints) are never touched.
// Bump CACHE on changes: activation deletes every other cache, so old copies leave the devices.
const CACHE = "contractly-v4";
const SHELL_URL = "/";
const PRECACHE = [
  SHELL_URL,
  "/static/css/app.css",
  "/static/vendor/chart.umd.min.js",
  "/static/vendor/hammer.min.js",
  "/static/vendor/chartjs-plugin-zoom.min.js",
  "/icon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((url) => fetchFresh(new Request(url)).then((res) => cacheable(res) && c.put(url, res)))))
      .catch(() => {}) // e.g. installed while a login sits in front: the cache fills on the next visits
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Only the app's own, complete, not redirected answers. */
function cacheable(res) {
  return Boolean(res) && res.ok && res.type === "basic" && !res.redirected && res.status === 200;
}

/**
 * From the network; a redirect comes back as one (opaqueredirect) instead of being followed, so
 * a login redirect is never mistaken for a network error. Navigations do that on their own; assets
 * are always same-origin (see bypass), so they can be fetched by URL in that mode.
 */
function fetchFresh(request) {
  if (request.mode === "navigate") return fetch(request);
  return fetch(request.url, { redirect: "manual", credentials: "same-origin" });
}

function bypass(request, url) {
  return (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/cdn-cgi/") ||
    url.pathname === "/sw.js"
  );
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (bypass(e.request, url)) return;
  const navigate = e.request.mode === "navigate";
  e.respondWith(
    fetchFresh(e.request).then(
      (res) => {
        // every page is the same app shell (routes live in the #hash)
        if (cacheable(res)) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(navigate ? SHELL_URL : e.request, copy)));
        }
        return res;
      },
      // offline: the cached copy (a share link /?text=… opens the shell as well)
      () =>
        caches
          .match(navigate ? SHELL_URL : e.request, { ignoreSearch: navigate })
          .then((hit) => hit || Response.error()),
    ),
  );
});
