// App shell: routing, navigation state, theme, global search.

import { api } from "./api.js";
import { loadMeta, state } from "./store.js";
import { $, $$, esc, icon, modal, money, toast } from "./ui.js";
import { catColorVar, catIcon, catLabel } from "./store.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderContracts } from "./views/contracts.js";
import { renderContractDetail } from "./views/contract-detail.js";
import { renderContractForm } from "./views/contract-form.js";
import { renderTimeline } from "./views/timeline.js";
import { renderCosts } from "./views/costs.js";
import { renderReminders } from "./views/reminders.js";
import { renderSettings, renderMore } from "./views/settings.js";
import { hideAuth, showAuth } from "./views/auth.js";
import { renderImport } from "./views/import.js";
import { renderReport } from "./views/report.js";

const routes = [
  [/^\/?$/, "dashboard", renderDashboard],
  [/^\/contracts\/?$/, "contracts", renderContracts],
  [/^\/contracts\/new$/, "contracts", (el, _m, q) => renderContractForm(el, null, q)],
  [/^\/contracts\/(\d+)\/edit$/, "contracts", (el, m, q) => renderContractForm(el, Number(m[1]), q)],
  [/^\/contracts\/(\d+)$/, "contracts", (el, m, q) => renderContractDetail(el, Number(m[1]), q)],
  [/^\/timeline$/, "timeline", renderTimeline],
  [/^\/costs$/, "costs", renderCosts],
  [/^\/reminders$/, "reminders", renderReminders],
  [/^\/settings$/, "settings", renderSettings],
  [/^\/import$/, "import", renderImport],
  [/^\/report$/, "report", renderReport],
  [/^\/more$/, "more", renderMore],
];

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
  const [re, name, render] = match;
  $$("[data-route]").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
  view.innerHTML = `<div class="skeleton" style="height:120px;margin-bottom:20px"></div><div class="skeleton" style="height:300px"></div>`;
  try {
    await loadMeta();
    if (token !== renderToken) return;
    await render(view, path.match(re), query);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card empty"><div class="art">😕</div><h2>Da ist etwas schiefgelaufen</h2>
      <p>${esc(err.message)}</p><div class="actions"><a class="btn" href="#/">Zur Übersicht</a></div></div>`;
  }
  if (!location.hash.includes("tab=")) window.scrollTo({ top: 0 });
  refreshBadge();
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
              <span class="cat-icon sm" style="--c:${catColorVar(c.category)}">${catIcon(c.category)}</span>
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
      router();
    } finally {
      starting = null;
    }
  })();
  return starting;
}

async function logout() {
  await api.logout();
  authenticated = false;
  toast("Abgemeldet – deine Daten sind wieder verschlüsselt 🔒");
  start();
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
  start();
}

boot();
