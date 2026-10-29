// Cost history and projection ("Hochrechnung").

import { api } from "../api.js";
import { chartHint, legendHtml, lines, showLast, stackedBars } from "../charts.js";
import { GROUPS, catColor, contractIcon, catLabel, cssVar, groupOf, slotColor, state } from "../store.js";
import { accountSwitch, otherAccounts } from "./components.js";
import { $, esc, fmtDate, fmtMonth, icon, modal, money, today } from "../ui.js";

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
    <div class="page-head"><div><h1>Kosten & Prognose</h1><p>Wohin dein Geld geht, wie es sich entwickelt hat – und was auf dich zukommt.</p></div>
      ${accountSwitch(accounts, state.account)}</div>

    <div class="list-toolbar costs-toolbar">
      <div class="chips active-filters" id="active"></div>
      <button class="btn" id="filter-btn">${icon("layers")}<span class="label">Filter</span><span class="count" id="filter-count"></span></button>
    </div>
    <div class="card where-card" id="where" style="margin-bottom:20px"></div>
    <div id="selection"></div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-head">
        <div><h2>Kostenverlauf</h2><p id="hist-sub"></p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="segmented" id="range">${[12, 24, 60, 0].map((r) => `<button data-r="${r}">${r ? (r < 24 ? r + " M" : r / 12 + " J") : "Alles"}</button>`).join("")}</div>
        </div>
      </div>
      <div class="chart-box lg"><canvas id="hist"></canvas></div>
      ${chartHint()}
      <div id="hist-legend"></div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><div><h2>${icon("trendUp")} Hochrechnung</h2><p>Basierend auf aktuellen Preisen, bekannten Vertragsenden und einer angenommenen Preissteigerung.</p></div></div>
      <details class="assumptions">
        <summary>${icon("settings")} <span id="assume-text"></span>${icon("chevDown", "chev")}</summary>
      <div class="form-grid" style="margin:12px 0 6px">
        <label class="field"><span>Zeitraum: <b id="m-out">${prefs.months}</b> Monate</span>
          <input type="range" class="range" id="months" min="6" max="120" step="6" value="${prefs.months}"/></label>
        <label class="field"><span>Preissteigerung: <b id="i-out">${prefs.increase}</b> % pro Jahr</span>
          <input type="range" class="range" id="increase" min="0" max="15" step="0.5" value="${prefs.increase}"/></label>
        <label class="check span-2" style="align-self:end"><input type="checkbox" id="extras" ${prefs.extras ? "checked" : ""}/>
          Ø Zusatzkosten der letzten 12 Monate einrechnen <span class="muted small" id="x-out"></span></label>
      </div>
      </details>
      <div class="kpis kpis-3" id="proj-kpis"></div>
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

  // ------------------------------------------------------------- where the money goes
  // The first answer of the page: the monthly total split into areas, largest first, each one
  // opening its contracts. Same colours as the history chart below.
  const summaryP = api.summary({ account: state.account }).catch(() => null);
  const openAreas = new Set();
  const drawWhere = async () => {
    const box = $("#where", view);
    const picked = running.filter(matches);
    const total = picked.reduce((s, c) => s + c.monthly_cost, 0);
    if (!picked.length || total <= 0) {
      box.innerHTML = `<div class="card-head"><div><h2>Wohin dein Geld geht</h2></div></div><p class="muted" style="margin:0">Keine laufenden Kosten für diese Auswahl.</p>`;
      return;
    }
    const areas = GROUPS.map((g) => {
      const items = picked.filter((c) => groupOf(c.category) === g.key).sort((a, b) => b.monthly_cost - a.monthly_cost);
      return { ...g, items, sum: items.reduce((s, c) => s + c.monthly_cost, 0) };
    })
      .filter((a) => a.sum > 0)
      .sort((a, b) => b.sum - a.sum);
    const max = areas[0].sum;
    const pct = (v) => `${Math.round((v / total) * 100)} %`;
    const s = await summaryP;
    const filtered = prefs.intervals.size || prefs.groups.size;
    const net = !filtered && s?.income_monthly_net ? s.income_monthly_net : null;
    box.innerHTML = `
      <div class="card-head"><div><h2>Wohin dein Geld geht</h2>
        <p>${prefs.mode === "paid" ? "Durchschnitt pro Monat" : "Pro Monat"}, Jahres- und Halbjahreszahlungen umgerechnet · antippen für die Verträge</p></div></div>
      <div class="where-total">
        <span class="num where-sum">${money(total)}</span><span class="muted"> im Monat · ${money(total * 12, true)} im Jahr</span>
        ${net ? `<div class="where-net">${Math.round((total / net) * 100)} % von ${money(net)} Netto · <b>${money(net - total)}</b> bleiben</div>` : ""}
      </div>
      <div class="where-strip" aria-hidden="true">${areas
        .map((a) => `<span style="flex:${a.sum};background:var(--series-${a.slot})" title="${esc(a.label)}: ${money(a.sum)}"></span>`)
        .join("")}</div>
      <div class="where-list">${areas
        .map(
          (a) => `<div class="where-area ${openAreas.has(a.key) ? "open" : ""}" data-area="${a.key}">
            <button type="button" class="where-row" aria-expanded="${openAreas.has(a.key)}">
              <span class="where-label"><span class="dot" style="background:var(--series-${a.slot})"></span>${esc(a.label)}
                <span class="muted small">${a.items.length} ${a.items.length === 1 ? "Vertrag" : "Verträge"}</span></span>
              <span class="where-bar"><span style="width:${(a.sum / max) * 100}%;background:var(--series-${a.slot})"></span></span>
              <span class="where-amount num"><b>${money(a.sum)}</b><span class="muted">${pct(a.sum)}</span></span>
              ${icon("chevDown", "chev")}
            </button>
            <div class="where-items">${a.items
              .map(
                (c) => `<a class="where-item" href="#/contracts/${c.id}">
                  <span>${esc(contractIcon(c))} ${esc(c.name)}</span>
                  <span class="num">${money(c.monthly_cost)} <span class="muted">· ${pct(c.monthly_cost)}</span></span></a>`,
              )
              .join("")}</div>
          </div>`,
        )
        .join("")}</div>`;
  };
  $("#where", view).addEventListener("click", (e) => {
    const area = e.target.closest(".where-row")?.closest("[data-area]");
    if (!area) return;
    const k = area.dataset.area;
    openAreas.has(k) ? openAreas.delete(k) : openAreas.add(k);
    area.classList.toggle("open", openAreas.has(k));
    area.querySelector(".where-row").setAttribute("aria-expanded", openAreas.has(k));
  });

  /** What the selection costs: per year, per month and the next due dates – e.g. the monthly reserve for yearly bills. */
  const drawSelection = () => {
    const filtered = prefs.intervals.size || prefs.groups.size;
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
    drawWhere();
    drawSelection();
    drawHistory();
    drawProjection();
  };
  // active filters as removable chips; the defaults show nothing
  const drawActive = () => {
    const chips = [
      ...[...prefs.intervals].map((k) => [`int:${k}`, INTERVAL_CHIPS.find(([x]) => x === k)?.[1] ?? k]),
      ...[...prefs.groups].map((k) => [`grp:${k}`, esc(GROUPS.find((g) => g.key === k)?.label ?? k)]),
      ...(prefs.mode === "paid" ? [["mode", "Wann bezahlt"]] : []),
    ];
    $("#active", view).innerHTML = chips.length
      ? chips.map(([k, t]) => `<button class="chip active" data-clear="${k}" title="Filter entfernen">${t} ${icon("x")}</button>`).join("")
      : `<span class="muted small">Alle Verträge · monatlich umgelegt</span>`;
    $("#filter-count", view).textContent = chips.length || "";
  };
  $("#active", view).addEventListener("click", (e) => {
    const k = e.target.closest("[data-clear]")?.dataset.clear;
    if (!k) return;
    if (k === "mode") prefs.mode = "spread";
    else if (k.startsWith("int:")) prefs.intervals.delete(k.slice(4));
    else prefs.groups.delete(k.slice(4));
    update();
  });
  const update = () => {
    drawActive();
    redraw();
  };
  const chip = (attr, active, label) => `<button type="button" class="chip ${active ? "active" : ""}" ${attr}>${label}</button>`;
  $("#filter-btn", view).addEventListener("click", () => {
    const m = modal({
      title: "Filter & Ansicht",
      body: `<div class="filter-sheet">
          <div class="fs-group"><div class="fs-label">Zahlweise</div><div class="chips" id="f-int">
            ${usedIntervals.map(([k, l]) => chip(`data-int="${k}"`, prefs.intervals.has(k), l)).join("")}</div></div>
          <div class="fs-group"><div class="fs-label">Bereiche</div><div class="chips" id="f-grp">
            ${usedGroups
              .map((g) => chip(`data-grp="${g.key}"`, prefs.groups.has(g.key), `<span class="dot" style="background:var(--series-${g.slot})"></span>${esc(g.label)}`))
              .join("")}</div></div>
          <div class="fs-group"><div class="fs-label">Ansicht</div><div class="chips" id="f-mode">
            ${chip(`data-mode="spread"`, prefs.mode === "spread", "Monatlich umgelegt")}
            ${chip(`data-mode="paid"`, prefs.mode === "paid", "Wann bezahlt")}</div>
            <p class="small muted" style="margin:6px 0 0">Umgelegt: eine Jahreszahlung zählt mit 1/12 in jedem Monat. Wann bezahlt: im Monat der Fälligkeit.</p></div>
          <div class="fs-group"><div class="fs-label">Kostenverlauf gliedern nach</div><div class="chips" id="group">
            ${chip(`data-g="category"`, prefs.group === "category", "Bereichen")}
            ${chip(`data-g="contract"`, prefs.group === "contract", "Verträgen")}</div></div>
        </div>`,
      foot: `<button class="btn btn-ghost" id="f-reset" style="margin-right:auto">Zurücksetzen</button><button class="btn btn-primary" data-close>Fertig</button>`,
    });
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-int],[data-grp],[data-mode],[data-g]");
      if (b?.dataset.int) {
        prefs.intervals.has(b.dataset.int) ? prefs.intervals.delete(b.dataset.int) : prefs.intervals.add(b.dataset.int);
        b.classList.toggle("active", prefs.intervals.has(b.dataset.int));
        update();
      } else if (b?.dataset.grp) {
        prefs.groups.has(b.dataset.grp) ? prefs.groups.delete(b.dataset.grp) : prefs.groups.add(b.dataset.grp);
        b.classList.toggle("active", prefs.groups.has(b.dataset.grp));
        update();
      } else if (b?.dataset.mode && b.dataset.mode !== prefs.mode) {
        prefs.mode = b.dataset.mode;
        m.querySelectorAll("#f-mode .chip").forEach((x) => x.classList.toggle("active", x === b));
        update();
      } else if (b?.dataset.g && b.dataset.g !== prefs.group) {
        prefs.group = b.dataset.g;
        m.querySelectorAll("#group .chip").forEach((x) => x.classList.toggle("active", x === b));
        drawHistory();
      }
      if (e.target.closest("#f-reset")) {
        prefs.intervals.clear();
        prefs.groups.clear();
        prefs.mode = "spread";
        m.close();
        update();
      }
    });
  });
  const assumeText = () => {
    $("#assume-text", view).textContent = `Annahmen: ${prefs.months} Monate · ${prefs.increase.toLocaleString("de-DE")} % Preissteigerung · ${
      prefs.extras ? "mit" : "ohne"
    } Zusatzkosten`;
  };
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
    assumeText();
    debounced();
  });
  $("#increase", view).addEventListener("input", (e) => {
    prefs.increase = Number(e.target.value);
    $("#i-out", view).textContent = prefs.increase.toLocaleString("de-DE");
    assumeText();
    debounced();
  });
  $("#extras", view).addEventListener("change", (e) => {
    prefs.extras = e.target.checked;
    assumeText();
    drawProjection();
  });
  drawActive();
  assumeText();
  drawWhere();
  drawSelection();
  await Promise.all([drawHistory(), drawProjection()]);
}
