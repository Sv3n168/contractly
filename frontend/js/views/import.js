// Import: bank statement (recurring debits -> contracts, price changes) and contract lists.

import { api } from "../api.js";
import { catColorVar, catIcon, intervalLabel, state } from "../store.js";
import { $, $$, busy, esc, fmtDate, icon, money, toast } from "../ui.js";
import { setupDrop } from "./contract-form.js";

let mode = "bank";

const categoryOptions = (selected) =>
  state.meta.categories.map((c) => `<option value="${c.key}" ${c.key === selected ? "selected" : ""}>${c.icon} ${esc(c.label)}</option>`).join("");

export async function renderImport(view, _m, query = {}) {
  if (query.mode) mode = query.mode;
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Importieren</h1><p>Statt abzutippen: Contractly findet deine Verträge selbst.</p></div>
      <div class="segmented" id="mode">
        <button data-m="bank" class="${mode === "bank" ? "active" : ""}">${icon("euro", "inline")} Kontoauszug</button>
        <button data-m="list" class="${mode === "list" ? "active" : ""}">${icon("list", "inline")} Vertragsliste</button>
      </div>
    </div>
    <div id="import-body"></div>`;
  $("#mode", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    mode = b.dataset.m;
    $$("#mode button", view).forEach((x) => x.classList.toggle("active", x === b));
    draw();
  });
  const draw = () => (mode === "bank" ? bankStep(view) : listStep(view));
  draw();
}

// ------------------------------------------------------------------ bank statement

function bankStep(view) {
  const body = $("#import-body", view);
  body.innerHTML = `
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head"><div><h2>${icon("sparkles")} Kontoauszug auswerten</h2>
          <p>Regelmäßige Abbuchungen werden erkannt – inklusive Preiserhöhungen und einzelner Ausreißer-Monate.</p></div></div>
        <label class="dropzone" id="drop">${icon("upload")}<b>CSV- oder Excel-Export auswählen</b>
          <span class="muted small">Sparkasse, Volksbank, DKB, ING, comdirect, N26 & Co.</span>
          <input type="file" accept=".csv,.txt,.xlsx" hidden/></label>
        <div id="bank-result" style="margin-top:16px"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>So geht's</h2></div></div>
        <ol class="small text-2" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px">
          <li>Im Online-Banking die Umsätze der <b>letzten 12 Monate</b> als CSV exportieren.</li>
          <li>Datei hier hochladen.</li>
          <li>Vorschläge prüfen, Häkchen setzen, übernehmen – fertig.</li>
        </ol>
        <div class="callout good" style="margin-top:14px">${icon("lock")}<div class="small">Die Datei wird nur ausgewertet und <b>nicht gespeichert</b>. Übernommen werden nur die Verträge, die du auswählst.</div></div>
      </div>
    </div>`;
  setupDrop(body, async (file) => {
    const out = $("#bank-result", body);
    out.innerHTML = `<div class="callout"><span class="spinner"></span><div>Werte <b>${esc(file.name)}</b> aus …</div></div>`;
    try {
      showBankResult(out, await api.analyzeBank(file));
    } catch (err) {
      out.innerHTML = `<div class="callout bad">${icon("alert")}<div>${esc(err.message)}</div></div>`;
    }
  });
}

function showBankResult(out, res) {
  const fresh = res.suggestions.filter((s) => s.status === "new");
  const changed = res.suggestions.filter((s) => s.status === "changed");
  const known = res.suggestions.filter((s) => s.status === "known");
  const perMonth = (s) => s.amount / (state.meta.intervals[s.interval]?.months || 1);
  out.innerHTML = `
    <div class="callout">${icon("info")}<div>${res.transactions} Buchungen vom ${fmtDate(res.period.from)} bis ${fmtDate(res.period.to)} –
      <b>${res.suggestions.length} regelmäßige Zahlungen</b> gefunden.</div></div>
    ${
      changed.length
        ? `<h3 style="margin:20px 0 8px">${icon("trendUp", "inline")} Preisänderungen bei bestehenden Verträgen</h3>
           <div class="list">${changed
             .map(
               (s, i) => `<label class="list-item" style="cursor:pointer">
                 <input type="checkbox" data-change="${i}" checked style="width:18px;height:18px;accent-color:var(--primary)"/>
                 <div class="grow"><div class="title">${esc(s.match.name)}</div>
                   <div class="sub">bisher ${money(s.match.current_monthly)}/Monat → laut Konto ${money(perMonth(s))}/Monat · ab ${fmtDate(s.change_from)}</div></div>
                 <span class="badge ${perMonth(s) > s.match.current_monthly ? "bad" : "good"}">${perMonth(s) > s.match.current_monthly ? "teurer" : "günstiger"}</span></label>`,
             )
             .join("")}</div>`
        : ""
    }
    ${
      fresh.length
        ? `<h3 style="margin:20px 0 8px">${icon("plus", "inline")} Neue Verträge</h3>
           <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Bezeichnung</th><th>Kategorie</th><th class="r">Betrag</th><th>Seit</th><th></th></tr></thead><tbody>
           ${fresh
             .map(
               (s, i) => `<tr>
                 <td><input type="checkbox" data-new="${i}" ${s.count >= 3 ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--primary)"/></td>
                 <td style="min-width:170px"><input class="input" data-name="${i}" value="${esc(s.name)}"/>
                   <div class="small muted" style="margin-top:4px">${esc(s.purpose || "")}</div></td>
                 <td style="min-width:170px"><select class="input" data-cat="${i}">${categoryOptions(s.category)}</select></td>
                 <td class="r num" style="white-space:nowrap"><b>${money(s.amount)}</b><div class="small muted">${intervalLabel(s.interval)} · ${s.count}×</div></td>
                 <td class="num small">${fmtDate(s.first_date)}</td>
                 <td class="small">${s.price_changes.map((c) => `<span class="badge warn">${money(c.old)} → ${money(c.new)}</span>`).join(" ")}
                   ${s.extras.length ? `<span class="badge">${s.extras.length}× Zusatzkosten</span>` : ""}</td></tr>`,
             )
             .join("")}</tbody></table></div>
           <p class="small muted">Vorausgewählt sind Zahlungen, die mindestens dreimal vorkamen. Erkannte Preisänderungen werden als Preisverlauf übernommen.</p>`
        : ""
    }
    ${
      known.length
        ? `<details class="more" style="margin-top:16px"><summary>${icon("check")} ${known.length} bereits erfasst & unverändert${icon("chevDown", "chev")}</summary>
            <div class="body small">${known.map((s) => `${esc(s.match.name)} (${money(perMonth(s))}/Monat)`).join(" · ")}</div></details>`
        : ""
    }
    ${
      fresh.length || changed.length
        ? `<div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" id="apply">${icon("check")} Ausgewählte übernehmen</button></div>`
        : `<div class="callout good" style="margin-top:12px">${icon("check")}<div>Alles schon erfasst – nichts zu tun. 👍</div></div>`
    }`;

  $("#apply", out)?.addEventListener("click", async (e) => {
    const create = fresh
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => $(`[data-new="${i}"]`, out).checked)
      .map(({ s, i }) => ({
        name: $(`[data-name="${i}"]`, out).value || s.name,
        provider: s.provider,
        category: $(`[data-cat="${i}"]`, out).value,
        amount: s.amount,
        interval: s.interval,
        start_date: s.first_date,
        price_changes: s.price_changes,
      }));
    const price_updates = changed
      .filter((_s, i) => $(`[data-change="${i}"]`, out).checked)
      .map((s) => ({ contract_id: s.match.contract_id, valid_from: s.change_from, amount: s.amount, interval: s.interval }));
    if (!create.length && !price_updates.length) return toast("Nichts ausgewählt", "error");
    busy(e.currentTarget);
    try {
      const r = await api.applyImport({ create, price_updates });
      toast(`${r.created} Verträge angelegt, ${r.updated} Preise aktualisiert 🎉`);
      location.hash = "#/contracts";
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

// ------------------------------------------------------------------ contract list

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
      <div id="list-result" style="margin-top:16px"></div>
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
