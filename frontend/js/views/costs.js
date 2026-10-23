// Cost history and projection ("Hochrechnung").

import { api } from "../api.js";
import { legendHtml, lines, stackedBars } from "../charts.js";
import { GROUPS, catColor, contractIcon, catLabel, cssVar, groupOf, slotColor } from "../store.js";
import { $, esc, fmtMonth, icon, isoDate, money } from "../ui.js";

const prefs = { range: 24, group: "category", months: 24, increase: 3, extras: true };

function fold(series, months) {
  const grouped = GROUPS.map((g) => ({ ...g, color: slotColor(g.slot), values: months.map(() => 0) }));
  for (const s of series) {
    const g = grouped.find((x) => x.key === groupOf(s.category || s.key));
    s.values.forEach((v, i) => (g.values[i] += v));
  }
  return grouped.filter((g) => g.values.some((v) => v));
}

export async function renderCosts(view) {
  view.innerHTML = `
    <div class="page-head"><div><h1>Kosten & Prognose</h1><p>Was haben deine Verträge gekostet – und was kommt auf dich zu?</p></div></div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-head">
        <div><h2>Kostenverlauf</h2><p>Tatsächliche Monatskosten inkl. Einmalzahlungen</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="segmented" id="group"><button data-g="category">Bereiche</button><button data-g="contract">Verträge</button></div>
          <div class="segmented" id="range">${[12, 24, 60, 0].map((r) => `<button data-r="${r}">${r ? (r < 24 ? r + " M" : r / 12 + " J") : "Alles"}</button>`).join("")}</div>
        </div>
      </div>
      <div class="chart-box lg"><canvas id="hist"></canvas></div>
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

  const markActive = () => {
    view.querySelectorAll("#group button").forEach((b) => b.classList.toggle("active", b.dataset.g === prefs.group));
    view.querySelectorAll("#range button").forEach((b) => b.classList.toggle("active", Number(b.dataset.r) === prefs.range));
  };
  const drawHistory = async () => {
    markActive();
    const now = new Date();
    const params = { group: prefs.group };
    if (prefs.range) params.start = isoDate(new Date(now.getFullYear(), now.getMonth() - prefs.range + 1, 1)).slice(0, 7);
    else params.start = "2000-01";
    const ts = await api.timeseries(params);
    // Trim leading empty months for "Alles".
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
    stackedBars($("#hist", view), months, series);
    $("#hist-legend", view).innerHTML = legendHtml(series.map((s) => ({ label: esc(s.label), color: s.color })));
  };

  const drawProjection = async () => {
    const p = await api.projection({ months: prefs.months, increase_pct: prefs.increase, group: "contract", include_extras: prefs.extras });
    $("#x-out", view).textContent = p.extras_monthly ? `(≈ ${money(p.extras_monthly)}/Monat)` : "(bisher keine)";
    const extra = p.sum - p.sum_without_increase;
    $("#proj-kpis", view).innerHTML = `
      <div class="card kpi hero"><div class="kpi-label">Gesamt in ${prefs.months} Monaten</div><div class="kpi-value num">${money(p.sum, true)}</div>
        <div class="kpi-sub">Ø ${money(p.sum / prefs.months)} pro Monat${prefs.extras && p.extras_monthly ? " inkl. Zusatzkosten" : ""}</div></div>
      <div class="card kpi"><div class="kpi-label">Davon Preissteigerung</div><div class="kpi-value num">${money(extra, true)}</div>
        <div class="kpi-sub">bei ${prefs.increase} % p.a.</div></div>
      <div class="card kpi"><div class="kpi-label">Letzter Monat</div><div class="kpi-value num">${money(p.totals[p.totals.length - 1])}</div>
        <div class="kpi-sub">${fmtMonth(p.months[p.months.length - 1])}</div></div>`;
    const base = await api.projection({ months: prefs.months, increase_pct: 0, group: "contract", include_extras: prefs.extras });
    lines($("#proj", view), p.months, [
      { label: `Mit ${prefs.increase} % Steigerung`, values: p.totals, color: slotColor(1), fill: true },
      { label: "Ohne Steigerung", values: base.totals, color: cssVar("--muted"), dash: true },
    ]);
    $("#proj-legend", view).innerHTML = legendHtml([
      { label: `Mit ${prefs.increase} % Steigerung`, color: slotColor(1) },
      { label: "Ohne Steigerung", color: cssVar("--muted") },
    ]);
    const maxYear = Math.max(...Object.values(p.yearly));
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
      drawHistory();
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
  await Promise.all([drawHistory(), drawProjection()]);
}
