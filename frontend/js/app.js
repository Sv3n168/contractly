// App shell: routing, navigation state, theme, global search.

import { api } from "./api.js";
import { loadMeta, state } from "./store.js";
import { $, $$, countUp, esc, icon, modal, money, toast } from "./ui.js";
import { catColorVar, contractIcon, catLabel } from "./store.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderContracts } from "./views/contracts.js";
import { renderContractDetail } from "./views/contract-detail.js";
import { renderContractForm } from "./views/contract-form.js";
import { renderTimeline } from "./views/timeline.js";
import { renderCosts } from "./views/costs.js";
import { renderReminders } from "./views/reminders.js";
import { renderSettings } from "./views/settings.js";
import { hideAuth, showAuth } from "./views/auth.js";
import { renderImport } from "./views/import.js";
import { renderInbox, setSharedMessage } from "./views/inbox.js";
import { renderCheckup } from "./views/checkup.js";
import { renderEmergency } from "./views/emergency.js";
import { renderIncome } from "./views/income.js";
import { renderReport } from "./views/report.js";

// Four areas: Übersicht, Verträge, Zu tun, Auswertung (+ Einstellungen). Pages that belong to an
// area are shown as its tabs; the fourth column names the area.
const routes = [
  [/^\/?$/, "dashboard", renderDashboard],
  [/^\/contracts\/?$/, "contracts", renderContracts],
  [/^\/contracts\/new$/, "contracts", (el, _m, q) => renderContractForm(el, null, q)],
  [/^\/contracts\/(\d+)\/edit$/, "contracts", (el, m, q) => renderContractForm(el, Number(m[1]), q)],
  [/^\/contracts\/(\d+)$/, "contracts", (el, m, q) => renderContractDetail(el, Number(m[1]), q)],
  [/^\/reminders$/, "reminders", renderReminders, "todo"],
  [/^\/inbox$/, "inbox", renderInbox, "todo"],
  [/^\/checkup$/, "checkup", renderCheckup, "todo"],
  [/^\/costs$/, "costs", renderCosts, "insights"],
  [/^\/income$/, "income", renderIncome, "insights"],
  [/^\/timeline$/, "timeline", renderTimeline, "insights"],
  [/^\/report$/, "report", renderReport, "insights"],
  [/^\/settings$/, "settings", renderSettings],
  [/^\/import$/, "import", renderImport, "settings"],
  [/^\/emergency$/, "emergency", renderEmergency, "settings"],
];

const SECTIONS = {
  todo: {
    title: "Zu tun",
    tabs: [
      ["reminders", "Fristen & Erinnerungen"],
      ["inbox", "Post & Mails"],
      ["checkup", "Jahres-Check"],
    ],
  },
  insights: {
    title: "Auswertung",
    tabs: [
      ["costs", "Kosten & Prognose"],
      ["income", "Einnahmen"],
      ["timeline", "Zeitstrahl"],
      ["report", "Jahresbericht"],
    ],
  },
};

/** An area with tabs: its title and tab bar stay, the page renders below them. */
function sectionShell(view, section, name) {
  const s = SECTIONS[section];
  if (!s) return view;
  view.innerHTML = `
    <div class="section-head">
      <h1>${s.title}</h1>
      <nav class="section-tabs scroll-x" aria-label="${s.title}">${s.tabs
        .map(([key, label]) => `<a href="#/${key}" class="${key === name ? "active" : ""}"${key === name ? ' aria-current="page"' : ""}>${label}</a>`)
        .join("")}</nav>
    </div>
    <div class="section-body"><div class="skeleton" style="height:300px"></div></div>`;
  return view.querySelector(".section-body");
}

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(query)) };
}

let renderToken = 0;
let authenticated = false;
export async function router() {
  if (!authenticated) return;
  const { path, query } = parseHash();
  const view = $("#view");
  const token = ++renderToken;
  const match = routes.find(([re]) => re.test(path));
  if (!match) {
    location.hash = "#/";
    return;
  }
  const [re, name, render, section] = match;
  // A dialog belongs to the page it was opened on (a page refreshing itself keeps it).
  if (path !== router.lastPath) $$(".modal-backdrop").forEach((b) => b.remove());
  router.lastPath = path;
  $$("[data-route]").forEach((a) => a.classList.toggle("active", a.dataset.route === (section || name)));
  view.innerHTML = `<div class="skeleton" style="height:120px;margin-bottom:20px"></div><div class="skeleton" style="height:300px"></div>`;
  try {
    await loadMeta();
    if (token !== renderToken) return;
    const target = sectionShell(view, section, name);
    await render(target, path.match(re), query);
    if (token === renderToken && !view.contains(target)) {
      // An outdated page replaced the area shell while this tab was loading: draw it again.
      router();
      return;
    }
    if (token !== renderToken) {
      // A slower, outdated page finished after the current one and drew over it: draw the current one again.
      if (router.finished === renderToken) router();
      return;
    }
    router.finished = token;
    enter(view);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card empty"><div class="art">😕</div><h2>Da ist etwas schiefgelaufen</h2>
      <p>${esc(err.message)}</p><div class="actions"><a class="btn" href="#/">Zur Übersicht</a></div></div>`;
  }
  if (!location.hash.includes("tab=")) window.scrollTo({ top: 0 });
  refreshBadge();
}

/** Let the new page rise in (CSS does the motion; the class is removed once it's done). */
function enter(view) {
  view.classList.remove("entering");
  void view.offsetWidth; // restart the animation for consecutive navigations
  view.classList.add("entering");
  clearTimeout(enter.timer);
  enter.timer = setTimeout(() => view.classList.remove("entering"), 900);
  countUp(view);
}

export async function refreshBadge() {
  try {
    const up = await api.upcoming({ horizon_days: 0 });
    state.dueCount = up.due_count;
    $$("[data-due-badge]").forEach((b) => {
      b.textContent = up.due_count;
      b.classList.toggle("hidden", !up.due_count);
    });
  } catch {
    /* ignore */
  }
}

export function navigate(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}

// ------------------------------------------------------------------ theme

function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("contractly-theme", next);
  } catch {
    /* storage unavailable */
  }
  paintThemeIcons();
  router();
}
function paintThemeIcons() {
  $$('[data-action="theme"]').forEach((b) => (b.innerHTML = icon(currentTheme() === "dark" ? "sun" : "moon")));
}

// ------------------------------------------------------------------ search

async function openSearch() {
  const contracts = await api.contracts();
  let sel = 0;
  const m = modal({
    title: null,
    className: "search-pop",
    body: `<input class="search-input" placeholder="Vertrag, Anbieter, Kategorie, Nummer…" autocomplete="off" />
           <div class="search-results"></div>`,
  });
  m.querySelector(".modal-body").style.padding = "0";
  const input = $(".search-input", m);
  const out = $(".search-results", m);
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const hits = contracts
      .filter((c) =>
        !q ||
        [c.name, c.provider, catLabel(c.category), ...Object.values(c.attributes || {})]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 12);
    sel = Math.min(sel, Math.max(hits.length - 1, 0));
    out.innerHTML = hits.length
      ? hits
          .map(
            (c, i) => `<a href="#/contracts/${c.id}" class="${i === sel ? "sel" : ""}">
              <span class="cat-icon sm" style="--c:${catColorVar(c.category)}">${esc(contractIcon(c))}</span>
              <span style="flex:1;min-width:0"><b>${esc(c.name)}</b><br><span class="small muted">${esc(c.provider || catLabel(c.category))}</span></span>
              <span class="num small">${c.monthly_cost ? money(c.monthly_cost) + "/M" : ""}</span></a>`,
          )
          .join("")
      : `<p class="muted" style="padding:14px">Nichts gefunden.</p>`;
  };
  input.addEventListener("input", () => {
    sel = 0;
    draw();
  });
  input.addEventListener("keydown", (e) => {
    const links = $$("a", out);
    if (e.key === "ArrowDown") sel = Math.min(sel + 1, links.length - 1);
    else if (e.key === "ArrowUp") sel = Math.max(sel - 1, 0);
    else if (e.key === "Enter" && links[sel]) {
      location.hash = links[sel].getAttribute("href");
      m.close();
      return;
    } else return;
    e.preventDefault();
    draw();
  });
  out.addEventListener("click", () => m.close());
  draw();
  input.focus();
}

// ------------------------------------------------------------------ session

function paintUser() {
  const u = state.user;
  if (!u) return;
  $$("[data-user-name]").forEach((el) => (el.textContent = u.username));
  $$("[data-user-role]").forEach((el) => (el.textContent = u.role === "admin" ? "Administrator" : "Mitglied"));
  $$("[data-user-initial]").forEach((el) => (el.textContent = u.username.slice(0, 1).toUpperCase()));
  document.body.classList.toggle("is-admin", u.role === "admin");
}

let starting = null;
export function start() {
  // Several parallel 401s must not open several login screens.
  starting ||= (async () => {
    try {
      const st = await api.authStatus();
      authenticated = st.authenticated;
      if (!st.authenticated) {
        Object.assign(state, { user: null, profile: null, dueCount: 0 });
        $("#view").innerHTML = "";
        showAuth(st, () => {
          starting = null;
          start();
        });
        return;
      }
      state.user = st.user;
      hideAuth();
      paintUser();
      watchIdle();
      router();
    } finally {
      starting = null;
    }
  })();
  return starting;
}

async function logout(message = "Abgemeldet – deine Daten sind wieder verschlüsselt 🔒") {
  await api.logout().catch(() => {});
  authenticated = false;
  toast(message);
  start();
}

// ------------------------------------------------------------------ automatic logout
// The server ends an idle session on its own (and drops the key); here the screen follows at once,
// and activity on the page keeps the session alive even while no data is loaded.

let lastActivity = Date.now();
let lastPing = Date.now();
let idleTimer = null;

export function watchIdle() {
  clearInterval(idleTimer);
  const minutes = Number(state.user?.settings?.idle_minutes || 0);
  if (!minutes) return;
  lastActivity = Date.now();
  idleTimer = setInterval(() => {
    if (authenticated && Date.now() - lastActivity > minutes * 60000) {
      clearInterval(idleTimer);
      logout("Automatisch abgemeldet – deine Daten sind wieder verschlüsselt 🔒");
    }
  }, 15000);
}

function noteActivity() {
  lastActivity = Date.now();
  // keep the server session alive while someone is reading (at most one ping a minute)
  if (authenticated && state.user?.settings?.idle_minutes && Date.now() - lastPing > 60000) {
    lastPing = Date.now();
    api.authStatus().catch(() => {});
  }
}

// ------------------------------------------------------------------ boot

function boot() {
  $$("[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
  paintThemeIcons();
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (!a) return;
    if (a.dataset.action === "theme") toggleTheme();
    if (a.dataset.action === "search") openSearch();
    if (a.dataset.action === "logout") logout();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
    }
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) router();
  });
  window.addEventListener("hashchange", router);
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, noteActivity, { passive: true });
  window.addEventListener("auth-required", () => {
    if (authenticated) {
      authenticated = false;
      toast("Bitte erneut anmelden", "error");
      start();
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (authenticated) toast(e.reason?.message || "Fehler", "error");
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  takeSharedMessage();
  start();
}

/** "Teilen → Contractly" on the phone (PWA share target) opens /?title=…&text=… */
function takeSharedMessage() {
  const q = new URLSearchParams(location.search);
  if (!q.has("text") && !q.has("title")) return;
  setSharedMessage({ subject: q.get("title") || "", text: [q.get("text"), q.get("url")].filter(Boolean).join("\n") });
  history.replaceState(null, "", "/#/inbox");
}

boot();
