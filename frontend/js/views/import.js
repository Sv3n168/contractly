// Import of contract lists (CSV/Excel).

import { api } from "../api.js";
import { catColorVar, catIcon, intervalLabel, state } from "../store.js";
import { $, busy, esc, fmtDate, icon, money, toast } from "../ui.js";
import { setupDrop } from "./contract-form.js";

const categoryOptions = (selected) =>
  state.meta.categories.map((c) => `<option value="${c.key}" ${c.key === selected ? "selected" : ""}>${c.icon} ${esc(c.label)}</option>`).join("");

export async function renderImport(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Importieren</h1><p>Verträge aus einer Tabelle übernehmen statt abzutippen.</p></div>
    </div>
    <div id="import-body"></div>`;
  listStep(view);
}

function listStep(view) {
  const body = $("#import-body", view);
  body.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>${icon("list")} Vertragsliste übernehmen</h2>
        <p>Du pflegst deine Verträge schon in Excel oder einer Tabelle? Einfach hochladen – Spalten werden automatisch erkannt.</p></div>
        <a class="btn btn-sm" href="/api/import/template.csv">${icon("download")} Vorlage (CSV)</a></div>
      <label class="dropzone" id="drop">${icon("upload")}<b>Excel- oder CSV-Datei auswählen</b>
        <span class="muted small">Spalten z. B. Bezeichnung, Anbieter, Kategorie, Preis, Zahlweise, Beginn</span>
        <input type="file" accept=".csv,.xlsx" hidden/></label>
      <div id="list-result" class="mt-3"></div>
    </div>`;
  setupDrop(body, async (file) => {
    const out = $("#list-result", body);
    out.innerHTML = `<div class="callout"><span class="spinner"></span><div>Lese ${esc(file.name)} …</div></div>`;
    try {
      const { rows } = await api.analyzeContractList(file);
      out.innerHTML = `
        <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Bezeichnung</th><th>Anbieter</th><th>Kategorie</th><th class="r">Preis</th><th>Beginn</th></tr></thead><tbody>
        ${rows
          .map(
            (r, i) => `<tr><td><input type="checkbox" data-row="${i}" checked style="width:18px;height:18px;accent-color:var(--primary)"/></td>
              <td><span class="cat-icon sm" style="--c:${catColorVar(r.category)};display:inline-grid;vertical-align:middle;margin-right:6px">${catIcon(r.category)}</span>${esc(r.name)}</td>
              <td>${esc(r.provider || "")}</td>
              <td><select class="input" data-cat="${i}">${categoryOptions(r.category)}</select></td>
              <td class="r num">${money(r.amount)} <span class="small muted">${intervalLabel(r.interval)}</span></td>
              <td class="num">${fmtDate(r.start_date)}</td></tr>`,
          )
          .join("")}</tbody></table></div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" id="apply">${icon("check")} ${rows.length} Verträge übernehmen</button></div>`;
      $("#apply", out).addEventListener("click", async (e) => {
        const create = rows
          .map((r, i) => ({ ...r, category: $(`[data-cat="${i}"]`, out).value, _on: $(`[data-row="${i}"]`, out).checked }))
          .filter((r) => r._on)
          .map(({ _on, ...r }) => r);
        busy(e.currentTarget);
        try {
          const res = await api.applyImport({ create });
          toast(`${res.created} Verträge übernommen 🎉`);
          location.hash = "#/contracts";
        } catch (err) {
          busy(e.currentTarget, false);
          toast(err.message, "error");
        }
      });
    } catch (err) {
      out.innerHTML = `<div class="callout bad">${icon("alert")}<div>${esc(err.message)}</div></div>`;
    }
  });
}
