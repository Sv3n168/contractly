// Cost history and projection ("Hochrechnung").

import { api } from "../api.js";
import { chartHint, legendHtml, lines, showLast, stackedBars } from "../charts.js";
import { GROUPS, catColor, contractIcon, catLabel, cssVar, groupOf, slotColor, state } from "../store.js";
import { accountSwitch, otherAccounts } from "./components.js";
import { $, esc, fmtDate, fmtMonth, icon, money, today } from "../ui.js";

// Filters stay while moving between the tabs: payment intervals and areas (empty = all), view mode.
const prefs = {
  range: 24,
  group: "category",
  months: 24,
  increase: 3,
  extras: true,
  intervals: new Set(),
  groups: new Set(),
  mode: "spread",
};

const INTERVAL_CHIPS = [
  ["monthly", "Monatlich", 1],
  ["quarterly", "Vierteljährlich", 3],
  ["half_yearly", "Halbjährlich", 6],
  ["yearly", "Jährlich", 12],
];
const intervalMonths = (key) => INTERVAL_CHIPS.find(([k]) => k === key)?.[2] || 1;

function addMonthsIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  t.setUTCDate(Math.min(d, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  return t.toISOString().slice(0, 10);
}

/** Next date a recurring price falls due (from its start, every interval), or null after the contract ends. */
function nextDue(c) {
  const p = c.current_price;
  if (!p || p.interval === "once") return null;
  const step = intervalMonths(p.interval);
  const from = p.valid_from > c.start_date ? p.valid_from : c.start_date;
  let k = 0;
  let due = from;
  while (due < today() && k < 1200) due = addMonthsIso(from, ++k * step);
  return c.end_date && due > c.end_date ? null : due;
}

function onAccount(c) {
  if (state.account === "all") return true;
  if (state.account === "own") return !c.account;
  return c.account === state.account;
}

function fold(series, months) {
  const grouped = GROUPS.map((g) => ({ ...g, color: slotColor(g.slot), values: months.map(() => 0) }));
  for (const s of series) {
    const g = grouped.find((x) => x.key === groupOf(s.category || s.key));
    s.values.forEach((v, i) => (g.values[i] += v));
  }
  return grouped.filter((g) => g.values.some((v) => v));
}

export async function renderCosts(view) {
  const all = await api.contracts();
  const accounts = otherAccounts(all);
  if (!accounts.includes(state.account) && state.account !== "all") state.account = "own";
  const running = all.filter((c) => c.state === "active" || c.state === "cancelled");
  const usedGroups = GROUPS.filter((g) => running.some((c) => groupOf(c.category) === g.key));
  const usedIntervals = INTERVAL_CHIPS.filter(([k]) => running.some((c) => c.current_price?.interval === k));
  view.innerHTML = `
    <div class="page-head"><div><h1>Kosten & Prognose</h1><p>Was haben deine Verträge gekostet – und was kommt auf dich zu?</p></div>
      ${accountSwitch(accounts, state.account)}</div>

    <div class="filter-bar">
      <div class="filter-row"><span class="filter-label">Zahlweise</span>
        <div class="chips" id="f-int">${usedIntervals
          .map(([k, l]) => `<button type="button" class="chip ${prefs.intervals.has(k) ? "active" : ""}" data-int="${k}">${l}</button>`)
          .join("")}</div></div>
      <div class="filter-row"><span class="filter-label">Bereiche</span>
        <div class="chips" id="f-grp">${usedGroups
          .map((g) => `<button type="button" class="chip ${prefs.groups.has(g.key) ? "active" : ""}" data-grp="${g.key}">
            <span class="dot" style="background:var(--series-${g.slot})"></span>${esc(g.label)}</button>`)
          .join("")}</div></div>
      <div class="filter-row"><span class="filter-label">Ansicht</span>
        <div class="segmented" id="f-mode">
          <button type="button" data-mode="spread" class="${prefs.mode === "spread" ? "active" : ""}" title="Eine Jahreszahlung wird auf 12 Monate verteilt"><span class="label-long">Monatlich umgelegt</span><span class="label-short">Umgelegt</span></button>
          <button type="button" data-mode="paid" class="${prefs.mode === "paid" ? "active" : ""}" title="Jede Zahlung im Monat ihrer Fälligkeit"><span class="label-long">Wann bezahlt</span><span class="label-short">Fällig</span></button>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="f-reset" title="Filter zurücksetzen" aria-label="Filter zurücksetzen">${icon("x")}<span class="label-long"> Zurücksetzen</span></button></div>
    </div>
    <div id="selection"></div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-head">
        <div><h2>Kostenverlauf</h2><p id="hist-sub"></p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="segmented" id="group"><button data-g="category">Bereiche</button><button data-g="contract">Verträge</button></div>
          <div class="segmented" id="range">${[12, 24, 60, 0].map((r) => `<button data-r="${r}">${r ? (r < 24 ? r + " M" : r / 12 + " J") : "Alles"}</button>`).join("")}</div>
        </div>
      </div>
      <div class="chart-box lg"><canvas id="hist"></canvas></div>
      ${chartHint()}
      <div id="hist-legend"></div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><div><h2>${icon("trendUp")} Hochrechnung</h2><p>Basierend auf aktuellen Preisen, bekannten Vertragsenden und einer angenommenen Preissteigerung.</p></div></div>
      <div class="form-grid" style="margin-bottom:18px">
        <label class="field"><span>Zeitraum: <b id="m-out">${prefs.months}</b> Monate</span>
          <input type="range" class="range" id="months" min="6" max="120" step="6" value="${prefs.months}"/></label>
        <label class="field"><span>Preissteigerung: <b id="i-out">${prefs.increase}</b> % pro Jahr</span>
          <input type="range" class="range" id="increase" min="0" max="15" step="0.5" value="${prefs.increase}"/></label>
        <label class="check span-2" style="align-self:end"><input type="checkbox" id="extras" ${prefs.extras ? "checked" : ""}/>
          Ø Zusatzkosten der letzten 12 Monate einrechnen <span class="muted small" id="x-out"></span></label>
      </div>
      <div class="kpis" id="proj-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"></div>
      <div class="chart-box"><canvas id="proj"></canvas></div>
      <div id="proj-legend"></div>
    </div>

    <div class="grid grid-2">
      <div class="card"><div class="card-head"><div><h2>Pro Jahr</h2><p>Prognose nach Kalenderjahren</p></div></div><div id="years"></div></div>
      <div class="card"><div class="card-head"><div><h2>Je Vertrag</h2><p>Kosten im Prognosezeitraum</p></div></div><div id="per-contract" class="list"></div></div>
    </div>`;

  // the filters as API parameters
  const filterParams = () => {
    const cats = state.meta.categories.filter((c) => prefs.groups.has(groupOf(c.key))).map((c) => c.key);
    return {
      account: state.account,
      intervals: prefs.intervals.size ? [...prefs.intervals].join(",") : undefined,
      categories: prefs.groups.size ? cats.join(",") : undefined,
      mode: prefs.mode,
    };
  };
  const matches = (c) =>
    onAccount(c) &&
    (!prefs.intervals.size || prefs.intervals.has(c.current_price?.interval)) &&
    (!prefs.groups.size || prefs.groups.has(groupOf(c.category)));

  /** What the selection costs: per year, per month and the next due dates – e.g. the monthly reserve for yearly bills. */
  const drawSelection = () => {
    const filtered = prefs.intervals.size || prefs.groups.size;
    $("#f-reset", view).hidden = !filtered && prefs.mode === "spread";
    const box = $("#selection", view);
    if (!filtered) {
      box.innerHTML = "";
      return;
    }
    const picked = running.filter(matches).sort((a, b) => (nextDue(a) || "9999").localeCompare(nextDue(b) || "9999"));
    const monthly = picked.reduce((s, c) => s + c.monthly_cost, 0);
    const onlyLong = prefs.intervals.size && !prefs.intervals.has("monthly");
    box.innerHTML = `
      <div class="kpis selection-kpis">
        <div class="card kpi hero"><div class="kpi-label">${onlyLong ? "Monatliche Rücklage" : "Pro Monat umgerechnet"}</div>
          <div class="kpi-value num">${money(monthly)}</div>
          <div class="kpi-sub">${onlyLong ? "so viel jeden Monat zurücklegen, dann sind die Rechnungen gedeckt" : "Ø pro Monat für die Auswahl"}</div></div>
        <div class="card kpi"><div class="kpi-label">Pro Jahr</div><div class="kpi-value num">${money(monthly * 12, true)}</div>
          <div class="kpi-sub">deine Kosten</div></div>
        <div class="card kpi"><div class="kpi-label">Verträge</div><div class="kpi-value num">${picked.length}</div>
          <div class="kpi-sub">von ${running.filter(onAccount).length} laufenden</div></div>
      </div>
      ${
        picked.length
          ? `<div class="card" style="margin-bottom:20px"><div class="card-head"><div><h2>Auswahl</h2><p>Sortiert nach der nächsten Fälligkeit</p></div></div>
              <div class="list">${picked
                .map((c) => {
                  const p = c.current_price;
                  const due = nextDue(c);
                  const per = p && p.interval !== "monthly" ? `${money(c.monthly_cost * intervalMonths(p.interval))} ${INTERVAL_CHIPS.find(([k]) => k === p.interval)?.[1].toLowerCase() || ""}` : "";
                  return `<a class="list-item" href="#/contracts/${c.id}">
                    <span class="cat-icon sm" style="--c:${catColor(c.category)}">${esc(contractIcon(c))}</span>
                    <div class="grow"><div class="title">${esc(c.name)}</div>
                      <div class="sub">${due ? `nächste Zahlung ${fmtDate(due)}` : "keine weitere Zahlung"}${per ? ` · ${per}` : ""}</div></div>
                    <div class="end num"><b>${money(c.monthly_cost)}</b><div class="sub">pro Monat</div></div></a>`;
                })
                .join("")}</div></div>`
          : `<p class="muted">Keine laufenden Verträge passen zu den Filtern.</p>`
      }`;
  };

  let history = null;
  const markActive = () => {
    view.querySelectorAll("#group button").forEach((b) => b.classList.toggle("active", b.dataset.g === prefs.group));
    view.querySelectorAll("#range button").forEach((b) => b.classList.toggle("active", Number(b.dataset.r) === prefs.range));
  };
  const drawHistory = async () => {
    markActive();
    // always the whole history; the range buttons only choose the visible part
    $("#hist-sub", view).textContent =
      prefs.mode === "paid" ? "Jede Zahlung im Monat ihrer Fälligkeit inkl. Einmalzahlungen" : "Monatskosten, Jahres- und Halbjahreszahlungen auf die Monate verteilt";
    const ts = await api.timeseries({ group: prefs.group, start: "2000-01", ...filterParams() });
    // Trim leading empty months.
    let first = ts.totals.findIndex((v) => v);
    if (first < 0) first = 0;
    const months = ts.months.slice(first);
    let series;
    if (prefs.group === "category") series = fold(ts.series, ts.months);
    else {
      const top = ts.series.slice(0, 7);
      const rest = ts.series.slice(7);
      series = top.map((s, i) => ({ label: s.label, color: slotColor(i + 1), values: s.values }));
      if (rest.length)
        series.push({ label: `Weitere (${rest.length})`, color: cssVar("--muted"), values: ts.months.map((_, i) => rest.reduce((sum, s) => sum + s.values[i], 0)) });
    }
    series = series.map((s) => ({ ...s, values: s.values.slice(first) }));
    history = stackedBars($("#hist", view), months, series, { window: prefs.range || months.length });
    $("#hist-legend", view).innerHTML = legendHtml(series.map((s) => ({ label: esc(s.label), color: s.color })));
  };

  const drawProjection = async () => {
    const p = await api.projection({
      months: prefs.months,
      increase_pct: prefs.increase,
      group: "contract",
      include_extras: prefs.extras,
      ...filterParams(),
    });
    $("#x-out", view).textContent = p.extras_monthly ? `(≈ ${money(p.extras_monthly)}/Monat)` : "(bisher keine)";
    const extra = p.sum - p.sum_without_increase;
    $("#proj-kpis", view).innerHTML = `
      <div class="card kpi hero"><div class="kpi-label">Gesamt in ${prefs.months} Monaten</div><div class="kpi-value num">${money(p.sum, true)}</div>
        <div class="kpi-sub">Ø ${money(p.sum / prefs.months)} pro Monat${prefs.extras && p.extras_monthly ? " inkl. Zusatzkosten" : ""}</div></div>
      <div class="card kpi"><div class="kpi-label">Davon Preissteigerung</div><div class="kpi-value num">${money(extra, true)}</div>
        <div class="kpi-sub">bei ${prefs.increase} % p.a.</div></div>
      <div class="card kpi"><div class="kpi-label">Letzter Monat</div><div class="kpi-value num">${money(p.totals[p.totals.length - 1])}</div>
        <div class="kpi-sub">${fmtMonth(p.months[p.months.length - 1])}</div></div>`;
    const base = await api.projection({
      months: prefs.months,
      increase_pct: 0,
      group: "contract",
      include_extras: prefs.extras,
      ...filterParams(),
    });
    lines($("#proj", view), p.months, [
      { label: `Mit ${prefs.increase} % Steigerung`, values: p.totals, color: slotColor(1), fill: true },
      { label: "Ohne Steigerung", values: base.totals, color: cssVar("--muted"), dash: true },
    ]);
    $("#proj-legend", view).innerHTML = legendHtml([
      { label: `Mit ${prefs.increase} % Steigerung`, color: slotColor(1) },
      { label: "Ohne Steigerung", color: cssVar("--muted") },
    ]);
    const maxYear = Math.max(...Object.values(p.yearly), 1);
    $("#years", view).innerHTML = `<div class="bar-list">${Object.entries(p.yearly)
      .map(
        ([y, v]) => `<div class="bar-row"><div class="bar-label"><span>${y}</span><span class="num"><b>${money(v, true)}</b></span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(v / maxYear) * 100}%;background:var(--series-1)"></div></div></div>`,
      )
      .join("")}</div>`;
    const contracts = await api.contracts({ include_ended: false });
    const byId = Object.fromEntries(contracts.map((c) => [String(c.id), c]));
    $("#per-contract", view).innerHTML = p.series
      .slice(0, 12)
      .map((s) => {
        const c = byId[s.key];
        const sum = s.values.reduce((a, b) => a + b, 0);
        return `<a class="list-item" href="#/contracts/${s.key}">
          <span class="cat-icon sm" style="--c:${catColor(s.category)}">${esc(contractIcon(s))}</span>
          <div class="grow"><div class="title">${esc(s.label)}</div><div class="sub">${esc(c?.provider || catLabel(s.category))}${c?.end_date ? " · endet " + new Date(c.end_date).toLocaleDateString("de-DE") : ""}</div></div>
          <div class="end num"><b>${money(sum, true)}</b></div></a>`;
      })
      .join("");
  };

  view.querySelector(".account-switch")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-account]");
    if (!b) return;
    state.account = b.dataset.account;
    view.querySelectorAll(".account-switch button").forEach((x) => x.classList.toggle("active", x === b));
    redraw();
  });
  const redraw = () => {
    drawSelection();
    drawHistory();
    drawProjection();
  };
  const toggle = (set, key, btn) => {
    if (set.has(key)) set.delete(key);
    else set.add(key);
    btn.classList.toggle("active", set.has(key));
    redraw();
  };
  $("#f-int", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-int]");
    if (b) toggle(prefs.intervals, b.dataset.int, b);
  });
  $("#f-grp", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-grp]");
    if (b) toggle(prefs.groups, b.dataset.grp, b);
  });
  $("#f-mode", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || b.dataset.mode === prefs.mode) return;
    prefs.mode = b.dataset.mode;
    view.querySelectorAll("#f-mode button").forEach((x) => x.classList.toggle("active", x === b));
    redraw();
  });
  $("#f-reset", view).addEventListener("click", () => {
    prefs.intervals.clear();
    prefs.groups.clear();
    prefs.mode = "spread";
    renderCosts(view);
  });
  view.querySelector("#group").addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]");
    if (b) {
      prefs.group = b.dataset.g;
      drawHistory();
    }
  });
  view.querySelector("#range").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (b) {
      prefs.range = Number(b.dataset.r);
      markActive();
      if (history) showLast(history, prefs.range);
    }
  });
  let t;
  const debounced = () => {
    clearTimeout(t);
    t = setTimeout(drawProjection, 200);
  };
  $("#months", view).addEventListener("input", (e) => {
    prefs.months = Number(e.target.value);
    $("#m-out", view).textContent = prefs.months;
    debounced();
  });
  $("#increase", view).addEventListener("input", (e) => {
    prefs.increase = Number(e.target.value);
    $("#i-out", view).textContent = prefs.increase.toLocaleString("de-DE");
    debounced();
  });
  $("#extras", view).addEventListener("change", (e) => {
    prefs.extras = e.target.checked;
    drawProjection();
  });
  drawSelection();
  await Promise.all([drawHistory(), drawProjection()]);
}
