// Optional Cloudflare Access in front of Contractly.
//
// When the Access session ends, Cloudflare answers API requests with a redirect to its login page
// (another origin), which a fetch can't follow: it fails with a TypeError (CORS) or returns HTML.
// The app then looks hung. Here such a failure is checked once against Access' own identity
// endpoint; if the Access session is gone, a top-level navigation lets Cloudflare show its login.
//
// Without Access in front (LAN, development) the identity endpoint doesn't exist. A failed check
// therefore only counts as "expired" on a device that has seen a valid Access identity before.

import { toast } from "./ui.js";

const IDENTITY_URL = "/cdn-cgi/access/get-identity";
const SEEN_KEY = "contractly.access"; // localStorage: this origin sits behind Access
const REDIRECT_KEY = "contractly.accessRedirect"; // sessionStorage: time of the last redirect
const LOOP_MS = 60_000; // at most one redirect a minute
const CHECK_EVERY_MS = 5 * 60_000; // start / back to the tab: at most every 5 minutes
export const EXPIRED_MESSAGE = "Sitzung abgelaufen – Weiterleitung zur Anmeldung…";

const storage = (area) => ({
  get(key) {
    try {
      return window[area].getItem(key);
    } catch {
      return null; // private mode, blocked storage
    }
  },
  set(key, value) {
    try {
      window[area].setItem(key, value);
    } catch {
      /* not essential */
    }
  },
});
const local = storage("localStorage");
const session = storage("sessionStorage");

let pending = null;
let lastCheck = 0;
let leaving = false; // this page already navigates to the login

export function isAccessHost(url) {
  try {
    return /(^|\.)cloudflareaccess\.com$/i.test(new URL(url, location.href).hostname);
  } catch {
    return false;
  }
}

/**
 * Could Access have stepped in? `res` is null when fetch itself failed. A failure while the device
 * is offline is an ordinary network error, never Access.
 */
export function looksLikeAccess(res, { expectHtml = false } = {}) {
  if (!res) return navigator.onLine;
  if (res.redirected || res.type === "opaqueredirect" || isAccessHost(res.url)) return true;
  return !expectHtml && (res.headers.get("content-type") || "").includes("text/html");
}

/** "valid", "expired" or "none" (no Access in front, or offline). Parallel callers share one check. */
export function checkIdentity() {
  pending ||= (async () => {
    lastCheck = Date.now();
    try {
      // "manual": an expired session answers with a redirect, which needn't be followed
      const res = await fetch(IDENTITY_URL, { credentials: "include", cache: "no-store", redirect: "manual" });
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
        await res.json();
        local.set(SEEN_KEY, "1");
        return "valid";
      }
    } catch {
      if (!navigator.onLine) return "none";
    }
    return local.get(SEEN_KEY) ? "expired" : "none";
  })().finally(() => (pending = null));
  return pending;
}

/** Top-level navigation, so Cloudflare can show its login. False when one happened a minute ago. */
export function goToAccessLogin() {
  if (leaving) return true; // several requests noticed it at once
  const last = Number(session.get(REDIRECT_KEY) || 0);
  if (Date.now() - last < LOOP_MS) return false;
  leaving = true;
  session.set(REDIRECT_KEY, String(Date.now()));
  toast(EXPIRED_MESSAGE, "error", 4000);
  setTimeout(() => window.location.assign(window.location.pathname), 1200);
  return true;
}

/**
 * After a suspicious API answer: "redirect" (navigating to the Access login), "expired" (Access
 * ended, but a redirect just happened – no loop) or "ok" (carry on with the normal error handling).
 */
export async function handleSuspect() {
  if (!navigator.onLine || (await checkIdentity()) !== "expired") return "ok";
  return goToAccessLogin() ? "redirect" : "expired";
}

/** On start and when the tab becomes visible again (throttled). */
export async function periodicCheck({ force = false } = {}) {
  if (!navigator.onLine || (!force && Date.now() - lastCheck < CHECK_EVERY_MS)) return;
  if ((await checkIdentity()) === "expired") goToAccessLogin();
}
