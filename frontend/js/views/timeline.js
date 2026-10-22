// Gantt-style timeline. Each row is a contract chain, so a provider switch shows as
// consecutive segments on the same row (e.g. FitX → Sportnavi).

import { api } from "../api.js";
import { catColorVar, contractIcon, catLabel } from "../store.js";
import { $, esc, fmtDate, icon, money, parseDate, today } from "../ui.js";
import { emptyState } from "./components.js";

const prefs = { range: "5y", showEnded: true };

export async function renderTimeline(view) {
  const contracts = await api.contracts();
  if (!contracts.length) {
    view.innerHTML = `<div class="page-head"><div><h1>Zeitstrahl</h1></div></div>${emptyState({
      art: "🗓️",
      title: "Noch nichts auf dem Zeitstrahl",
      text: "Sobald Verträge angelegt sind, siehst du hier, wann was begonnen hat, gewechselt wurde und endet.",
      actions: `<a class="btn btn-primary" href="#/contracts/new">${icon("plus")} Vertrag anlegen</a>`,
    })}`;
    return;
  }

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Zeitstrahl</h1><p>Wann wurde was abgeschlossen, gewechselt und wann kannst du kündigen?</p></div>
      <div class="page-actions">
        <div class="segmented" id="range">
          ${[["2y", "2 Jahre"], ["5y", "5 Jahre"], ["all", "Alles"]].map(([k, l]) => `<button data-r="${k}" class="${prefs.range === k ? "active" : ""}">${l}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-head">
        <div class="legend" style="margin:0">
          <span><span class="sw" style="background:var(--primary);width:16px"></span>Vertragslaufzeit</span>
          <span><span class="sw" style="background:var(--bad);width:3px;height:14px;border-radius:1px"></span>Kündigungsfrist</span>
          <span><span class="sw" style="border-left:2px dashed var(--primary);width:2px;height:14px;border-radius:0"></span>Heute</span>
        </div>
        <label class="check small"><input type="checkbox" id="ended" ${prefs.showEnded ? "checked" : ""}/> Beendete Verträge</label>
      </div>
      <div class="timeline"><div class="tl-inner" id="tl"></div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h2>Chronik</h2><p>Abschlüsse, Wechsel und Fristen</p></div></div>
      <div class="list" id="events"></div>
    </div>`;

  const draw = () => drawTimeline(view, contracts);
  $("#range", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (!b) return;
    prefs.range = b.dataset.r;
    view.querySelectorAll("#range button").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  });
  $("#ended", view).addEventListener("change", (e) => {
    prefs.showEnded = e.target.checked;
    draw();
  });
  draw();
  drawEvents($("#events", view), contracts);
}

function chainsOf(contracts) {
  const byId = Object.fromEntries(contracts.map((c) => [c.id, c]));
  const rootOf = (c) => {
    const seen = new Set();
    while (c.predecessor_id && byId[c.predecessor_id] && !seen.has(c.id)) {
      seen.add(c.id);
      c = byId[c.predecessor_id];
    }
    return c.id;
  };
  const chains = {};
  for (const c of contracts) (chains[rootOf(c)] ||= []).push(c);
  return Object.values(chains).map((list) => list.sort((a, b) => a.start_date.localeCompare(b.start_date)));
}

function drawTimeline(view, contracts) {
  const now = parseDate(today());
  let chains = chainsOf(contracts);
  if (!prefs.showEnded) chains = chains.filter((ch) => ch.some((c) => c.state !== "ended"));
  chains.sort((a, b) => catLabel(a[0].category).localeCompare(catLabel(b[0].category), "de") || a[0].start_date.localeCompare(b[0].start_date));

  const earliest = parseDate(contracts.reduce((m, c) => (c.start_date < m ? c.start_date : m), today()));
  const startYears = { "2y": 2, "5y": 5 }[prefs.range];
  const from = startYears ? new Date(Math.max(earliest, new Date(now.getFullYear() - startYears, now.getMonth(), 1))) : earliest;
  from.setDate(1);
  const to = new Date(now.getFullYear(), now.getMonth() + 13, 1);
  const span = to - from;
  const pos = (d) => Math.max(0, Math.min(100, ((parseDate(d) - from) / span) * 100));

  const years = [];
  const stepMonths = span / (365 * 86400000) > 3 ? 12 : 6;
  for (let d = new Date(from.getFullYear(), stepMonths === 12 ? 0 : Math.floor(from.getMonth() / 6) * 6, 1); d < to; d = new Date(d.getFullYear(), d.getMonth() + stepMonths, 1)) {
    if (d > from) years.push(d);
  }

  const rows = chains
    .map((chain) => {
      const head = chain[chain.length - 1];
      const visible = chain.filter((c) => !c.end_date || parseDate(c.end_date) >= from);
      if (!visible.length) return "";
      const bars = visible
        .map((c) => {
          const left = pos(c.start_date);
          const end = c.end_date ? parseDate(c.end_date) : to;
          const width = Math.max(pos(end) - left, 0.6);
          return `<a class="tl-bar ${c.end_date ? "" : "open-end"} ${c.state === "ended" ? "ended" : ""}" href="#/contracts/${c.id}"
              style="left:${left}%;width:${width}%;--c:${catColorVar(c.category)}"
              title="${esc(c.name)} · ${fmtDate(c.start_date)} – ${c.end_date ? fmtDate(c.end_date) : "läuft"} · ${money(c.monthly_cost)}/Monat">
              ${esc(c.name)}${c.monthly_cost ? " · " + money(c.monthly_cost) : ""}</a>`;
        })
        .join("");
      const marker =
        head.cancellation_deadline && !head.monthly_cancellable && parseDate(head.cancellation_deadline) < to
          ? `<span class="tl-marker" style="left:${pos(head.cancellation_deadline)}%" title="Kündigen bis ${fmtDate(head.cancellation_deadline)}"></span>`
          : "";
      return `<div class="tl-row">
        <a class="tl-label" href="#/contracts/${head.id}">
          <span class="cat-icon sm" style="--c:${catColorVar(head.category)}">${esc(contractIcon(head))}</span>
          <span style="min-width:0"><div class="t">${esc(head.name)}</div>
            <div class="s">${chain.length > 1 ? `${chain.length - 1}× gewechselt` : esc(head.provider || catLabel(head.category))}</div></span>
        </a>
        <div class="tl-track">${bars}${marker}</div>
      </div>`;
    })
    .join("");

  $("#tl", view).innerHTML = `
    <div class="tl-axis">${years.map((y) => `<span style="left:${pos(y)}%">${stepMonths === 12 ? y.getFullYear() : y.toLocaleDateString("de-DE", { month: "short", year: "2-digit" })}</span>`).join("")}</div>
    <div style="position:relative">
      ${rows}
      <div style="position:absolute;top:0;bottom:0;left:200px;right:0;pointer-events:none" class="tl-today-wrap">
        <div class="tl-today" style="left:${pos(now)}%"><span>heute</span></div>
      </div>
    </div>`;
  // Match the label column width on small screens.
  const label = view.querySelector(".tl-label");
  if (label) view.querySelector(".tl-today-wrap").style.left = label.offsetWidth + "px";
}

function drawEvents(el, contracts) {
  const events = [];
  for (const c of contracts) {
    events.push({ date: c.start_date, text: c.predecessor_id ? `Gewechselt zu ${c.name}` : `${c.name} abgeschlossen`, c, kind: c.predecessor_id ? "swap" : "plus" });
    if (c.end_date) events.push({ date: c.end_date, text: `${c.name} ${c.end_date < today() ? "beendet" : "endet"}`, c, kind: "ban" });
    if (c.cancellation_deadline && !c.monthly_cancellable) events.push({ date: c.cancellation_deadline, text: `Kündigungsfrist ${c.name}`, c, kind: "alert" });
  }
  events.sort((a, b) => b.date.localeCompare(a.date));
  const future = events.filter((e) => e.date > today()).reverse().slice(0, 6);
  const past = events.filter((e) => e.date <= today()).slice(0, 14);
  const item = (e) => `<a class="list-item" href="#/contracts/${e.c.id}">
      <span class="cat-icon sm" style="--c:${catColorVar(e.c.category)}">${icon(e.kind)}</span>
      <div class="grow"><div class="title">${esc(e.text)}</div><div class="sub">${esc(e.c.provider || catLabel(e.c.category))}</div></div>
      <div class="end small muted num">${fmtDate(e.date)}</div></a>`;
  el.innerHTML = `
    ${future.length ? `<div class="nav-section" style="margin:0 0 4px">Demnächst</div>${future.map(item).join("")}` : ""}
    <div class="nav-section" style="margin:14px 0 4px">Bisher</div>${past.map(item).join("")}`;
}
