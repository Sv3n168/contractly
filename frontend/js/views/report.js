// Yearly report ("Dein Vertragsjahr") – printable as PDF – and tax export.

import { api } from "../api.js";
import { stackedBars } from "../charts.js";
import { catColorVar, catIcon, catLabel, slotColor, state } from "../store.js";
import { $, esc, fmtDate, icon, money, signedMoney } from "../ui.js";

export async function renderReport(view, _m, query = {}) {
  const now = new Date().getFullYear();
  const year = Number(query.year) || now;
  const r = await api.report(year);
  const name = state.profile?.name || state.user?.username || "";
  const maxCat = Math.max(...r.by_category.map((c) => c.total), 1);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Dein Vertragsjahr ${year}</h1><p>${r.complete ? "Abgeschlossenes Jahr" : `Stand ${new Date().toLocaleDateString("de-DE")}`}${name ? ` · ${esc(name)}` : ""}</p></div>
      <div class="page-actions no-print">
        <select class="input" id="year" style="width:auto">${Array.from({ length: 6 }, (_, i) => now - i)
          .map((y) => `<option ${y === year ? "selected" : ""}>${y}</option>`)
          .join("")}</select>
        <a class="btn" href="/api/stats/tax.csv?year=${year}">${icon("download")}<span class="label">Steuer-Export</span></a>
        <button class="btn btn-primary" id="print">${icon("printer")}<span class="label">Drucken / PDF</span></button>
      </div>
    </div>

    <div class="kpis">
      <div class="card kpi hero"><div class="kpi-label">Gesamtkosten ${year}</div><div class="kpi-value num">${money(r.total, true)}</div>
        <div class="kpi-sub">Ø ${money(r.monthly_average)} pro Monat</div></div>
      <div class="card kpi"><div class="kpi-label">Steuerlich relevant</div><div class="kpi-value num">${money(r.tax_total, true)}</div>
        <div class="kpi-sub">z. B. Versicherungen</div></div>
      <div class="card kpi"><div class="kpi-label">Zusatzkosten</div><div class="kpi-value num">${money(r.extras_total, true)}</div>
        <div class="kpi-sub">teurere Einzelmonate</div></div>
      <div class="card kpi"><div class="kpi-label">Wechsel</div><div class="kpi-value num">${r.switches.length}</div>
        <div class="kpi-sub">${r.price_changes.length} Preisänderungen</div></div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><div><h2>Monat für Monat</h2></div></div>
      <div class="chart-box sm"><canvas id="report-chart"></canvas></div>
    </div>

    <div class="grid grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-head"><div><h2>Nach Kategorie</h2></div></div>
        <div class="bar-list">${r.by_category
          .map(
            (c) => `<div class="bar-row"><div class="bar-label"><span>${catIcon(c.category)} ${esc(catLabel(c.category))}</span><span class="num"><b>${money(c.total)}</b></span></div>
              <div class="bar-track"><div class="bar-fill" style="width:${(c.total / maxCat) * 100}%;background:${catColorVar(c.category)}"></div></div></div>`,
          )
          .join("") || `<p class="muted">Keine Kosten in diesem Jahr.</p>`}</div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Was hat sich getan?</h2></div></div>
        <div class="list">
          ${r.switches
            .map(
              (s) => `<div class="list-item"><span class="kpi-icon">${icon("swap")}</span><div class="grow"><div class="title">${esc(s.from)} → ${esc(s.to)}</div>
                <div class="sub">${fmtDate(s.date)}${s.savings != null ? ` · ${s.savings >= 0 ? "gespart" : "Mehrkosten"} bisher ${money(Math.abs(s.savings))}` : ""}</div></div></div>`,
            )
            .join("")}
          ${r.price_changes
            .map(
              (p) => `<div class="list-item"><span class="kpi-icon" style="background:${p.new > p.old ? "var(--bad-soft);color:var(--bad)" : "var(--good-soft);color:var(--good)"}">${icon(p.new > p.old ? "trendUp" : "trendDown")}</span>
                <div class="grow"><div class="title">${esc(p.name)}</div><div class="sub">${fmtDate(p.date)} · ${money(p.old)} → ${money(p.new)} (${signedMoney(p.new - p.old)}/Monat)</div></div></div>`,
            )
            .join("")}
          ${!r.switches.length && !r.price_changes.length ? `<p class="muted">Keine Wechsel oder Preisänderungen – ein ruhiges Jahr. 😌</p>` : ""}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Alle Verträge</h2><p>Eigener Anteil · ${icon("check", "inline")} = steuerlich relevant (in den Vertragsdetails änderbar)</p></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Vertrag</th><th class="hide-sm">Kategorie</th><th class="r hide-sm">Anteil</th><th class="r">${year}</th><th>Steuer</th></tr></thead><tbody>
        ${r.contracts
          .map(
            (c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.provider || "")}</div></td>
              <td class="hide-sm">${catIcon(c.category)} ${esc(catLabel(c.category))}</td>
              <td class="r num hide-sm">${c.partner_amount ? `− ${money(c.partner_amount)}/M` : `${c.share_percent ?? 100} %`}</td>
              <td class="r num"><b>${money(c.total)}</b>${c.extras ? `<div class="small muted">inkl. ${money(c.extras)} extra</div>` : ""}</td>
              <td>${c.tax_relevant ? icon("check") : ""}</td></tr>`,
          )
          .join("")}
        <tr><td><b>Summe</b></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="r num"><b>${money(r.total)}</b></td><td></td></tr>
      </tbody></table></div>
    </div>`;

  stackedBars($("#report-chart", view), r.months, [{ label: "Kosten", color: slotColor(1), values: r.monthly }]);
  $("#year", view).addEventListener("change", (e) => (location.hash = `#/report?year=${e.target.value}`));
  $("#print", view).addEventListener("click", () => window.print());
}
