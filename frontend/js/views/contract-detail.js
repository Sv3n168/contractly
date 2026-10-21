import { api } from "../api.js";
import { chainLine, legendHtml } from "../charts.js";
import { catColorVar, category, catIcon, catLabel, catSlot, intervalLabel, isEnergy, slotColor, state } from "../store.js";
import {
  $,
  $$,
  busy,
  confirmDialog,
  daysUntil,
  durationText,
  esc,
  fileSize,
  fmtDate,
  formData,
  icon,
  modal,
  money,
  monthsBetween,
  num,
  relDays,
  signedMoney,
  toast,
  today,
} from "../ui.js";
import { attrValue, reminderItem, stateBadge } from "./components.js";
import { renderCompare } from "./compare.js";
import { setupDrop } from "./contract-form.js";
import { contractPayload, suggestionPicker } from "./ocr.js";
import { openLetter } from "./letter.js";
import { navigate, refreshBadge } from "../app.js";
import { reminderForm } from "./reminders.js";
import { basePriceAt, extraModal, isExtra, monthLabel } from "./extras.js";

export async function renderContractDetail(view, id, query = {}) {
  const c = await api.contract(id);
  const tab = query.tab || "overview";
  const energy = isEnergy(c.category);
  const tabs = [
    ["overview", "Übersicht"],
    ["prices", "Preise", c.prices.length],
    ["compare", "Vergleich", c.offer_count || null],
    ["documents", "Dokumente", c.documents.length || null],
    ...(energy ? [["readings", "Zählerstände", c.meter_readings.length || null]] : []),
    ["reminders", "Erinnerungen", c.reminders.length || null],
  ];
  view.innerHTML = `
    <a class="back-link" href="#/contracts">${icon("back")} Alle Verträge</a>
    <div class="detail-head">
      <div class="cat-icon lg" style="--c:${catColorVar(c.category)}">${catIcon(c.category)}</div>
      <div class="title">
        <h1>${esc(c.name)}</h1>
        <div class="sub">${esc(c.provider || "")}${c.provider ? " · " : ""}${esc(catLabel(c.category))} ${stateBadge(c)}</div>
      </div>
      <div class="page-actions">
        ${c.state !== "ended" ? `<a class="btn btn-primary" href="#/contracts/${id}?tab=compare">${icon("scale")} Vergleichen</a>` : ""}
        <a class="btn" href="#/contracts/${id}/edit">${icon("edit")}<span class="label">Bearbeiten</span></a>
        <div class="menu">
          <button class="btn btn-icon" data-menu aria-label="Mehr Aktionen">${icon("more")}</button>
          <div class="menu-pop">
            <button data-act="extra">${icon("plus")} Zusatzkosten erfassen</button>
            <button data-act="price">${icon("euro")} Preisänderung erfassen</button>
            ${
              c.state === "active"
                ? `<button data-act="cancel">${icon("ban")} Als gekündigt markieren</button>`
                : c.state === "cancelled"
                  ? `<button data-act="reactivate">${icon("refresh")} Kündigung zurücknehmen</button>`
                  : ""
            }
            <button data-act="letter">${icon("mail")} Kündigungsschreiben</button>
            <button data-act="successor">${icon("swap")} Durch neuen Vertrag ersetzen</button>
            <button data-act="reminder">${icon("bell")} Erinnerung hinzufügen</button>
            <hr/>
            <button data-act="delete" class="danger">${icon("trash")} Löschen</button>
          </div>
        </div>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${tabs
        .map(
          ([k, l, n]) => `<button class="tab ${k === tab ? "active" : ""}" data-tab="${k}" role="tab">${l}${
            n ? `<span class="count">${n}</span>` : ""
          }</button>`,
        )
        .join("")}
    </div>
    <div id="tab"></div>`;

  $$(".tab", view).forEach((b) =>
    b.addEventListener("click", () => history.replaceState(null, "", `#/contracts/${id}?tab=${b.dataset.tab}`) || renderTab(b.dataset.tab)),
  );
  const reload = (t = tab) => navigate(`#/contracts/${id}?tab=${t}`);

  view.querySelector(".menu-pop").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "price") priceModal(c, null, () => reload("prices"));
    if (act === "extra") extraModal(c, null, () => reload());
    if (act === "cancel") cancelModal(c, () => reload());
    if (act === "reactivate") {
      await api.reactivateContract(id);
      toast("Kündigung zurückgenommen");
      reload();
    }
    if (act === "letter") openLetter(c);
    if (act === "successor") location.hash = `#/contracts/new?predecessor=${id}`;
    if (act === "reminder") reminderForm({ contract_id: id }, () => reload("reminders"));
    if (act === "delete") {
      if (await confirmDialog(`„${c.name}“ mit allen Preisen und Dokumenten löschen?`)) {
        await api.deleteContract(id);
        toast("Vertrag gelöscht");
        location.hash = "#/contracts";
      }
    }
  });

  const renderTab = async (t) => {
    $$(".tab", view).forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
    // Fresh container so listeners of the previous tab don't pile up.
    const old = $("#tab", view);
    const el = old.cloneNode(false);
    old.replaceWith(el);
    if (t === "overview") await overviewTab(el, c, reload);
    if (t === "prices") pricesTab(el, c, reload);
    if (t === "compare") await renderCompare(el, c, reload);
    if (t === "documents") documentsTab(el, c, reload);
    if (t === "readings") readingsTab(el, c, reload);
    if (t === "reminders") remindersTab(el, c, reload);
  };
  await renderTab(tab);
}

// ------------------------------------------------------------------ overview

async function overviewTab(el, c, reload) {
  const hist = await api.history(c.id, { months_ahead: 6 });
  const chain = hist.chain;
  const colors = hist.series.map((s, i) => slotColor(((catSlot(c.category) - 1 + i) % 8) + 1));
  const cat = category(c.category);
  const facts = (cat.fields || [])
    .map((f) => [f.label, attrValue(f, c.attributes?.[f.key])])
    .filter(([, v]) => v !== null);
  if (c.attributes?.iban) facts.push(["IBAN (Abbuchung)", c.attributes.iban]);

  const termStart = c.next_term_end ? termStartFor(c) : null;
  const progress = termStart && c.next_term_end ? progressPct(termStart, c.next_term_end) : null;
  const runtime = monthsBetween(c.start_date, c.end_date && c.end_date < today() ? c.end_date : today());

  el.innerHTML = `
    <div class="kpis">
      <div class="card kpi hero">
        <div class="kpi-label"><span class="kpi-icon">${icon("euro")}</span>Pro Monat</div>
        <div class="kpi-value num">${money(c.monthly_cost)}</div>
        <div class="kpi-sub">${c.current_price && c.current_price.interval !== "monthly" ? `${money(c.current_price.amount)} ${intervalLabel(c.current_price.interval)}` : "aktueller Preis"}</div>
      </div>
      <div class="card kpi"><div class="kpi-label"><span class="kpi-icon">${icon("calendar")}</span>Pro Jahr</div>
        <div class="kpi-value num">${money(c.yearly_cost)}</div><div class="kpi-sub">${
          c.extras_12m ? `+ ${money(c.extras_12m)} Zusatzkosten (12 M.)` : "hochgerechnet"
        }</div></div>
      <div class="card kpi"><div class="kpi-label"><span class="kpi-icon">${icon("layers")}</span>Bisher bezahlt</div>
        <div class="kpi-value num">${money(c.total_paid, true)}</div><div class="kpi-sub">in ${durationText(Math.max(runtime, 0))} Laufzeit</div></div>
      ${
        c.switch_savings != null
          ? `<div class="card kpi"><div class="kpi-label"><span class="kpi-icon" style="background:var(--good-soft);color:var(--good)">${icon("piggy")}</span>Seit dem Wechsel</div>
             <div class="kpi-value num ${c.switch_savings >= 0 ? "better" : "worse"}">${signedMoney(c.switch_savings)}</div>
             <div class="kpi-sub">${c.switch_savings >= 0 ? "gespart ggü. altem Vertrag" : "Mehrkosten ggü. altem Vertrag"}</div></div>`
          : `<div class="card kpi"><div class="kpi-label"><span class="kpi-icon">${icon("clock")}</span>Kündbar bis</div>
             <div class="kpi-value num" style="font-size:22px">${c.cancellation_deadline ? fmtDate(c.cancellation_deadline) : c.end_date ? "endet " + fmtDate(c.end_date) : "–"}</div>
             <div class="kpi-sub">${c.cancellation_deadline ? relDays(daysUntil(c.cancellation_deadline)) : ""}</div></div>`
      }
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-head" style="align-items:flex-start"><div><h2>Kostenverlauf</h2>
        <p>${chain.length > 1 ? `Durchgehend über alle Wechsel: ${chain.map((x) => esc(x.name)).join(" → ")}` : "Monatliche Kosten · gestrichelt = Vorschau"}${hist.extras.some((v) => v) ? " · Punkte = Monate mit Zusatzkosten" : ""}</p></div>
        ${c.state !== "ended" ? `<button class="btn btn-sm" id="extra-btn">${icon("plus")} Zusatzkosten</button>` : ""}</div>
      <div class="chart-box"><canvas id="hist"></canvas></div>
      ${hist.series.length > 1 ? legendHtml(hist.series.map((s, i) => ({ label: esc(s.name), color: colors[i] }))) : ""}
      ${
        chain.length > 1
          ? `<div class="chips" style="margin-top:14px">${chain
              .map(
                (x) => `<a class="chip ${x.id === c.id ? "active" : ""}" href="#/contracts/${x.id}">${esc(x.name)}
                  <span class="count">${fmtDate(x.start_date)}${x.end_date ? " – " + fmtDate(x.end_date) : " – heute"}</span></a>`,
              )
              .join(`<span class="muted" style="align-self:center">${icon("chevRight")}</span>`)}</div>`
          : ""
      }
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>Leistungen & Eckdaten</h2></div>
            <a class="btn btn-sm btn-ghost" href="#/contracts/${c.id}/edit">${icon("edit")} Ändern</a></div>
          ${
            facts.length
              ? `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>`
              : `<p class="muted" style="margin:0">Noch keine Eckdaten hinterlegt. <a href="#/contracts/${c.id}/edit">Jetzt ergänzen</a> – oder ein Dokument hochladen und erkennen lassen.</p>`
          }
          <div class="facts" style="margin-top:10px">
            ${c.customer_number ? `<div class="fact"><div class="k">Kundennummer</div><div class="v">${esc(c.customer_number)}</div></div>` : ""}
            ${c.contract_number ? `<div class="fact"><div class="k">Vertragsnummer</div><div class="v">${esc(c.contract_number)}</div></div>` : ""}
          </div>
        </div>
        ${energyCard(c)}
        ${c.notes ? `<div class="card"><div class="card-head"><h2>Notizen</h2></div><p style="margin:0;white-space:pre-wrap">${esc(c.notes)}</p></div>` : ""}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Laufzeit & Kündigung</h2></div></div>
        ${
          c.state === "ended"
            ? `<div class="callout">${icon("info")}<div>Beendet am <b>${fmtDate(c.end_date)}</b>.${
                c.successor_ids.length ? ` Nachfolger: <a href="#/contracts/${c.successor_ids[0]}">ansehen</a>` : ""
              }</div></div>`
            : c.state === "cancelled"
              ? `<div class="callout warn">${icon("clock")}<div>Gekündigt${c.cancelled_on ? ` am ${fmtDate(c.cancelled_on)}` : ""} – läuft noch bis <b>${fmtDate(c.end_date)}</b> (${relDays(daysUntil(c.end_date))}).</div></div>`
              : c.cancellation_deadline
                ? deadlineCallout(c)
                : ""
        }
        ${
          progress != null && c.state === "active"
            ? `<div class="term-bar"><div style="width:${progress}%"></div></div>
               <div class="term-legend"><span>${fmtDate(termStart)}</span><span>Laufzeitende ${fmtDate(c.next_term_end)}</span></div>`
            : ""
        }
        <div class="facts" style="margin-top:16px">
          <div class="fact"><div class="k">Beginn</div><div class="v">${fmtDate(c.start_date)}</div></div>
          <div class="fact"><div class="k">Mindestlaufzeit</div><div class="v">${c.min_term_months ? `${c.min_term_months} Monat${c.min_term_months === 1 ? "" : "e"}` : "keine"}</div></div>
          <div class="fact"><div class="k">Verlängerung</div><div class="v">${c.renewal_months ? `um ${c.renewal_months} Monat${c.renewal_months > 1 ? "e" : ""}` : "–"}</div></div>
          <div class="fact"><div class="k">Kündigungsfrist</div><div class="v">${noticeText(c)}</div></div>
          <div class="fact"><div class="k">Erinnerung</div><div class="v">${c.reminder_days != null ? `${c.reminder_days} Tage vorher` : "aus"}</div></div>
          ${c.predecessor_id ? `<div class="fact"><div class="k">Vorgänger</div><div class="v"><a href="#/contracts/${c.predecessor_id}">ansehen</a></div></div>` : ""}
        </div>
        ${
          c.state === "active"
            ? `<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
                <button class="btn" id="cancel-btn">${icon("ban")} Kündigen</button>
                <button class="btn btn-ghost" id="letter-btn">${icon("mail")} Kündigungsschreiben</button></div>`
            : ""
        }
      </div>
    </div>`;

  chainLine($("#hist", el), hist.months, hist.series, colors, { currentMonth: hist.current_month, extras: hist.extras });
  $("#extra-btn", el)?.addEventListener("click", () => extraModal(c, null, () => reload()));
  $("#cancel-btn", el)?.addEventListener("click", () => cancelModal(c, () => reload()));
  $("#letter-btn", el)?.addEventListener("click", () => openLetter(c));
}

function deadlineCallout(c) {
  if (c.monthly_cancellable) {
    return `<div class="callout good">${icon("check")}<div>Mindestlaufzeit vorbei – <b>monatlich kündbar</b>.
      Nächstmögliches Ende: ${fmtDate(c.next_term_end)} (Kündigung bis ${fmtDate(c.cancellation_deadline)}).</div></div>`;
  }
  const d = daysUntil(c.cancellation_deadline);
  const cls = d <= 14 ? "bad" : d <= 45 ? "warn" : "good";
  return `<div class="callout ${cls}">${icon(cls === "good" ? "check" : "alert")}<div>
    Nächste Kündigungsmöglichkeit: bis <b>${fmtDate(c.cancellation_deadline)}</b> (${relDays(d)}) zum ${fmtDate(c.next_term_end)}.
    ${cls === "good" ? "Entspannt – genug Zeit zum Vergleichen." : "Jetzt vergleichen lohnt sich!"}</div></div>`;
}

function energyCard(c) {
  const e = c.energy;
  if (!e) return "";
  if (!e.expected_yearly_cost) {
    return `<div class="card"><div class="card-head"><div><h2>${icon("gauge")} Verbrauch & Abrechnung</h2></div></div>
      <p class="muted" style="margin:0">Trage Grundpreis, Arbeitspreis und Jahresverbrauch ein (oder erfasse Zählerstände), dann schätzt Contractly deine Jahresabrechnung.</p></div>`;
  }
  const s = e.settlement_estimate;
  return `<div class="card">
    <div class="card-head"><div><h2>${icon("gauge")} Verbrauch & Abrechnung</h2>
      <p>${e.consumption_source === "readings" ? `Hochgerechnet aus ${e.readings} Zählerständen` : "Basierend auf hinterlegtem Jahresverbrauch"}</p></div></div>
    <div class="facts">
      <div class="fact"><div class="k">Verbrauch / Jahr</div><div class="v">${num(e.consumption_used)} kWh</div></div>
      <div class="fact"><div class="k">Erwartete Kosten / Jahr</div><div class="v">${money(e.expected_yearly_cost)}</div></div>
      ${e.installment ? `<div class="fact"><div class="k">Abschlag</div><div class="v">${money(e.installment)} / Monat</div></div>` : ""}
      <div class="fact"><div class="k">Passender Abschlag</div><div class="v">${money(e.suggested_installment)} / Monat</div></div>
    </div>
    ${
      s != null
        ? `<div class="callout ${s >= 0 ? "good" : Math.abs(s) < 30 ? "warn" : "bad"}" style="margin-top:12px">${icon(s >= 0 ? "piggy" : "alert")}
            <div>Voraussichtlich <b>${s >= 0 ? "Guthaben" : "Nachzahlung"} von ${money(Math.abs(s))}</b> bei der Jahresabrechnung.
            ${s < -30 ? "Überleg dir, den Abschlag anzupassen." : ""}</div></div>`
        : ""
    }
  </div>`;
}

function noticeText(c) {
  if (!c.notice_value) return "keine";
  const unit = { days: "Tag", weeks: "Woche", months: "Monat" }[c.notice_unit] || "";
  const plural = c.notice_value > 1 ? (c.notice_unit === "months" ? "e" : c.notice_unit === "weeks" ? "n" : "e") : "";
  return `${c.notice_value} ${unit}${plural}`;
}

function termStartFor(c) {
  // Start of the current term period = previous term end + 1 day (approximation for the progress bar).
  const end = new Date(c.next_term_end);
  const months = c.min_term_months && monthsBetween(c.start_date, c.next_term_end) < c.min_term_months + 1 ? c.min_term_months : c.renewal_months || 1;
  const s = new Date(end.getFullYear(), end.getMonth() - months, end.getDate() + 1);
  const start = new Date(c.start_date);
  return (s < start ? start : s).toISOString().slice(0, 10);
}
function progressPct(a, b) {
  const s = new Date(a).getTime(), e = new Date(b).getTime(), n = Date.now();
  return Math.max(2, Math.min(100, ((n - s) / (e - s)) * 100));
}

// ------------------------------------------------------------------ prices

function pricesTab(el, c, reload) {
  const recurring = c.prices.filter((p) => p.interval !== "once").sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const once = c.prices.filter((p) => p.interval === "once").sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const actions = (p) => `<td class="r" style="white-space:nowrap">
      <button class="btn btn-ghost btn-sm" data-edit="${p.id}" aria-label="Bearbeiten">${icon("edit")}</button>
      <button class="btn btn-ghost btn-sm btn-danger" data-del="${p.id}" aria-label="Löschen">${icon("trash")}</button></td>`;
  el.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><div><h2>Preishistorie</h2><p>Der reguläre Preis – jede Änderung gilt ab ihrem Datum bis zur nächsten.</p></div>
        <button class="btn btn-sm btn-primary" data-add="price">${icon("plus")} Preisänderung</button></div>
      ${
        recurring.length
          ? `<div class="table-wrap"><table class="table"><thead><tr>
              <th>Gültig ab</th><th class="r">Betrag</th><th>Zahlweise</th><th class="r">pro Monat</th><th class="r">Änderung</th><th>Notiz</th><th></th></tr></thead><tbody>
              ${recurring
                .map((p, i) => {
                  const prev = recurring[i + 1];
                  const diff = prev ? p.monthly_equivalent - prev.monthly_equivalent : null;
                  return `<tr>
                    <td class="num">${fmtDate(p.valid_from)}</td>
                    <td class="r num"><b>${money(p.amount)}</b></td>
                    <td>${intervalLabel(p.interval)}</td>
                    <td class="r num">${money(p.monthly_equivalent)}</td>
                    <td class="r num">${diff ? `<span class="${diff > 0 ? "worse" : "better"}">${signedMoney(diff)}</span>` : ""}</td>
                    <td class="muted">${esc(p.note || "")}${p.details?.unit_price_ct ? ` <span class="small">(${num(p.details.base_price_month)} €/M + ${num(p.details.unit_price_ct)} ct)</span>` : ""}</td>
                    ${actions(p)}</tr>`;
                })
                .join("")}</tbody></table></div>`
          : `<p class="muted">Noch keine Preise erfasst.</p>`
      }
    </div>
    <div class="card">
      <div class="card-head"><div><h2>Zusatzkosten & Einmalzahlungen</h2>
        <p>Teurere Monate (z. B. Auslandstelefonate), Gebühren, Boni und Gutschriften – ändern den regulären Preis nicht.</p></div>
        <div class="page-actions">
          <button class="btn btn-sm" data-add="once">${icon("plus")} Einmalzahlung / Bonus</button>
          <button class="btn btn-sm btn-primary" data-add="extra">${icon("plus")} Zusatzkosten</button>
        </div></div>
      ${
        c.extras_12m
          ? `<div class="callout" style="margin-bottom:14px">${icon("info")}<div>Letzte 12 Monate: <b>${money(c.extras_12m)}</b> Zusatzkosten in
             ${c.extras_months_12m} Monat${c.extras_months_12m === 1 ? "" : "en"} – im Schnitt <b>${money(c.extras_12m / 12)}</b> pro Monat zusätzlich.</div></div>`
          : ""
      }
      ${
        once.length
          ? `<div class="table-wrap"><table class="table"><thead><tr><th>Monat</th><th>Art</th><th>Grund</th><th class="r">Betrag</th><th class="r">Rechnung gesamt</th><th></th></tr></thead><tbody>
              ${once
                .map((p) => {
                  const extra = isExtra(p);
                  const ym = p.valid_from.slice(0, 7);
                  const kind = extra
                    ? `<span class="badge warn">Zusatzkosten</span>`
                    : `<span class="badge ${p.amount < 0 ? "good" : ""}">${p.amount < 0 ? "Gutschrift" : "einmalig"}</span>`;
                  return `<tr>
                    <td class="num">${extra ? esc(monthLabel(ym)) : fmtDate(p.valid_from)}</td>
                    <td>${kind}</td>
                    <td class="muted">${esc(p.note || "")}</td>
                    <td class="r num"><b class="${p.amount > 0 ? "" : "better"}">${signedMoney(p.amount)}</b></td>
                    <td class="r num muted">${extra ? money(basePriceAt(c, ym) + p.amount) : "–"}</td>
                    ${actions(p)}</tr>`;
                })
                .join("")}</tbody></table></div>`
          : `<p class="muted" style="margin:0">Keine Zusatzkosten erfasst. War eine Rechnung mal höher als sonst? Einfach oben eintragen.</p>`
      }
    </div>`;
  el.addEventListener("click", async (e) => {
    const add = e.target.closest("[data-add]");
    const edit = e.target.closest("[data-edit]");
    const del = e.target.closest("[data-del]");
    const done = () => reload("prices");
    if (add?.dataset.add === "extra") extraModal(c, null, done);
    else if (add) priceModal(c, add.dataset.add === "once" ? { interval: "once" } : null, done);
    if (edit) {
      const p = c.prices.find((x) => x.id === Number(edit.dataset.edit));
      if (isExtra(p)) extraModal(c, p, done);
      else priceModal(c, p, done);
    }
    if (del && (await confirmDialog("Diesen Eintrag löschen?"))) {
      await api.deletePrice(c.id, del.dataset.del);
      toast("Gelöscht");
      done();
    }
  });
}

export function priceModal(c, existing, done) {
  const energy = isEnergy(c.category);
  const cur = c.current_price;
  const p = existing || {};
  const isOnce = p.interval === "once";
  const m = modal({
    title: p.id ? "Preis bearbeiten" : isOnce ? "Einmalzahlung / Bonus" : "Preisänderung erfassen",
    body: `<form class="form-grid" id="pf">
      <label class="field"><span>Gültig ab</span><input type="date" name="valid_from" value="${esc(p.valid_from || today())}" required/></label>
      <label class="field"><span>${isOnce ? "Betrag (negativ = Gutschrift)" : "Neuer Preis"}</span><div class="input-group">
        <input type="number" step="0.01" name="amount" value="${esc(p.amount ?? "")}" placeholder="${cur && !isOnce ? cur.amount : ""}" required inputmode="decimal"/><span class="addon">€</span></div></label>
      ${
        isOnce
          ? `<input type="hidden" name="interval" value="once"/>`
          : `<label class="field"><span>Zahlweise</span><select name="interval">${Object.entries(state.meta.intervals)
              .map(([k, v]) => `<option value="${k}" ${(p.interval || cur?.interval || "monthly") === k ? "selected" : ""}>${v.label}</option>`)
              .join("")}</select></label>`
      }
      ${
        energy && !isOnce
          ? `<label class="field"><span>Grundpreis</span><div class="input-group"><input type="number" step="any" name="base_price_month" value="${esc(p.details?.base_price_month ?? c.attributes?.base_price_month ?? "")}"/><span class="addon">€/Monat</span></div></label>
             <label class="field"><span>Arbeitspreis</span><div class="input-group"><input type="number" step="any" name="unit_price_ct" value="${esc(p.details?.unit_price_ct ?? c.attributes?.unit_price_ct ?? "")}"/><span class="addon">ct/kWh</span></div></label>
             <div class="field span-all"><small>Tipp: Preis = neuer Abschlag. Grund- & Arbeitspreis werden zusätzlich als aktueller Tarif gespeichert.</small></div>`
          : ""
      }
      <label class="field span-all"><span>Notiz</span><input name="note" value="${esc(p.note ?? "")}" placeholder="${isOnce ? "z. B. Neukundenbonus, Anschlussgebühr" : "z. B. Preiserhöhung, Aktionspreis endet"}"/></label>
    </form>`,
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon("check")} Speichern</button>`,
  });
  $("[data-save]", m).addEventListener("click", async (e) => {
    const d = formData($("#pf", m));
    if (d.amount == null) return toast("Bitte Betrag angeben", "error");
    const details = {};
    if (d.base_price_month != null) details.base_price_month = d.base_price_month;
    if (d.unit_price_ct != null) details.unit_price_ct = d.unit_price_ct;
    const payload = { valid_from: d.valid_from, amount: d.amount, interval: d.interval || "monthly", note: d.note, details };
    busy(e.currentTarget);
    try {
      if (p.id) await api.updatePrice(c.id, p.id, payload);
      else await api.addPrice(c.id, payload);
      if (energy && Object.keys(details).length && !p.id) {
        const body = contractPayload(c);
        Object.assign(body.attributes, details, { installment: d.amount });
        await api.updateContract(c.id, body);
      }
      m.close();
      toast("Preis gespeichert");
      done();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

// ------------------------------------------------------------------ cancel

function cancelModal(c, done) {
  const m = modal({
    title: "Vertrag kündigen",
    body: `
      <p style="margin-top:0">Markiert <b>${esc(c.name)}</b> als gekündigt. Der Vertrag läuft bis zum Laufzeitende weiter und wird dann automatisch beendet.</p>
      <div class="form-grid">
        <label class="field"><span>Gekündigt am</span><input type="date" name="cancelled_on" value="${today()}"/></label>
        <label class="field"><span>Vertragsende</span><input type="date" name="end_date" value="${esc(c.next_term_end || "")}"/>
          <small>Berechnet aus Laufzeit & Frist</small></label>
      </div>
      ${c.cancellation_deadline && c.cancellation_deadline < today() ? `<div class="callout warn" style="margin-top:12px">${icon("alert")}<div>Die Frist für das nächste Laufzeitende ist schon vorbei – das Ende wurde entsprechend berechnet.</div></div>` : ""}
      <label class="check" style="margin-top:16px"><input type="checkbox" name="letter" checked/> Danach Kündigungsschreiben erstellen</label>`,
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-ok>${icon("ban")} Kündigung speichern</button>`,
  });
  $("[data-ok]", m).addEventListener("click", async (e) => {
    const body = $(".modal-body", m);
    const cancelled_on = $("[name=cancelled_on]", body).value || null;
    const end_date = $("[name=end_date]", body).value || null;
    const letter = $("[name=letter]", body).checked;
    busy(e.currentTarget);
    try {
      const updated = await api.cancelContract(c.id, { cancelled_on, end_date });
      m.close();
      toast("Als gekündigt markiert");
      if (letter) openLetter(updated);
      done();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

// ------------------------------------------------------------------ documents

function documentsTab(el, c, reload) {
  const ocrOk = state.meta.ocr?.tesseract || state.meta.ocr?.pdftotext;
  el.innerHTML = `
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head"><div><h2>Dokumente</h2><p>Verträge, Rechnungen, Preisanpassungen – alles an einem Ort.</p></div></div>
        ${
          c.documents.length
            ? `<div class="list">${c.documents
                .map(
                  (d) => `<div class="list-item">
                    <span class="cat-icon sm" style="--c:var(--series-1)">${d.content_type?.includes("pdf") ? "📕" : d.content_type?.startsWith("image") ? "🖼️" : "📄"}</span>
                    <a class="grow" href="/api/documents/${d.id}" target="_blank" rel="noopener" style="color:inherit">
                      <div class="title">${esc(d.original_name)}</div>
                      <div class="sub">${fileSize(d.size)} · ${fmtDate(d.uploaded_at)}${d.description ? " · " + esc(d.description) : ""}</div></a>
                    ${ocrOk ? `<button class="btn btn-sm" data-ocr="${d.id}" title="Daten erkennen">${icon("scan")}<span class="label">Erkennen</span></button>` : ""}
                    <a class="btn btn-sm btn-ghost" href="/api/documents/${d.id}?download=true" aria-label="Herunterladen">${icon("download")}</a>
                    <button class="btn btn-sm btn-ghost btn-danger" data-del="${d.id}" aria-label="Löschen">${icon("trash")}</button></div>`,
                )
                .join("")}</div>`
            : `<p class="muted">Noch keine Dokumente.</p>`
        }
      </div>
      <div class="card">
        <label class="dropzone" id="drop">${icon("upload")}<b>Dokument hochladen</b>
          <span class="muted small">PDF oder Bild, max. Größe laut Server</span><input type="file" hidden/></label>
        <label class="check small" style="margin-top:12px"><input type="checkbox" id="auto-ocr" ${ocrOk ? "checked" : "disabled"}/> Nach dem Upload Daten erkennen (OCR)</label>
        ${ocrOk ? "" : `<p class="small muted">OCR ist auf diesem Server nicht verfügbar.</p>`}
      </div>
    </div>`;
  setupDrop(el, async (file) => {
    const status = $("#drop b", el);
    status.innerHTML = `<span class="spinner"></span> Lade hoch…`;
    try {
      const doc = await api.uploadDocument(c.id, file);
      toast("Hochgeladen");
      if ($("#auto-ocr", el).checked) await runOcr(c, doc.id, reload);
      else reload("documents");
    } catch (err) {
      toast(err.message, "error");
      status.textContent = "Dokument hochladen";
    }
  });
  el.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    const ocrBtn = e.target.closest("[data-ocr]");
    if (del && (await confirmDialog("Dokument endgültig löschen?"))) {
      await api.deleteDocument(del.dataset.del);
      toast("Gelöscht");
      reload("documents");
    }
    if (ocrBtn) {
      busy(ocrBtn);
      await runOcr(c, Number(ocrBtn.dataset.ocr), reload).finally(() => busy(ocrBtn, false));
    }
  });
}

async function runOcr(c, docId, reload) {
  try {
    toast("Texterkennung läuft …");
    const res = await api.extractDocument(docId);
    suggestionPicker(c, res, () => reload("overview"));
  } catch (err) {
    toast(err.message, "error");
    reload("documents");
  }
}

// ------------------------------------------------------------------ meter readings

function readingsTab(el, c, reload) {
  const rows = [...c.meter_readings].sort((a, b) => b.reading_date.localeCompare(a.reading_date));
  el.innerHTML = `
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head"><div><h2>Zählerstände</h2><p>Mindestens zwei Ablesungen ergeben eine Verbrauchs-Hochrechnung.</p></div></div>
        ${
          rows.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>Datum</th><th class="r">Stand</th><th class="r">Verbrauch seit vorher</th><th class="r">pro Tag</th><th></th></tr></thead><tbody>
              ${rows
                .map((r, i) => {
                  const prev = rows[i + 1];
                  const used = prev ? r.value - prev.value : null;
                  const days = prev ? (new Date(r.reading_date) - new Date(prev.reading_date)) / 86400000 : null;
                  return `<tr><td>${fmtDate(r.reading_date)}</td><td class="r num"><b>${num(r.value)}</b> kWh</td>
                    <td class="r num">${used != null ? num(used) + " kWh" : "–"}</td><td class="r num">${days ? num(used / days) + " kWh" : "–"}</td>
                    <td class="r"><button class="btn btn-ghost btn-sm btn-danger" data-del="${r.id}" aria-label="Löschen">${icon("trash")}</button></td></tr>`;
                })
                .join("")}</tbody></table></div>`
            : `<p class="muted">Noch keine Zählerstände erfasst.</p>`
        }
      </div>
      <div class="stack">
        <form class="card" id="rf">
          <div class="card-head"><h2>Neuer Zählerstand</h2></div>
          <div class="stack" style="gap:12px">
            <label class="field"><span>Datum</span><input type="date" name="reading_date" value="${today()}"/></label>
            <label class="field"><span>Zählerstand</span><div class="input-group"><input type="number" step="any" name="value" required inputmode="decimal"/><span class="addon">kWh</span></div></label>
            <button class="btn btn-primary btn-block" type="submit">${icon("plus")} Speichern</button>
          </div>
        </form>
        ${energyCard(c)}
      </div>
    </div>`;
  $("#rf", el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (d.value == null) return;
    await api.addReading(c.id, d);
    toast("Zählerstand gespeichert");
    reload("readings");
  });
  el.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del && (await confirmDialog("Zählerstand löschen?"))) {
      await api.deleteReading(c.id, del.dataset.del);
      reload("readings");
    }
  });
}

// ------------------------------------------------------------------ reminders

function remindersTab(el, c, reload) {
  const items = c.reminders.map((r) => ({
    kind: "custom",
    reminder_id: r.id,
    title: r.title,
    date: r.due_date,
    days_left: daysUntil(r.due_date),
    detail: [r.repeat !== "none" ? { monthly: "monatlich", quarterly: "vierteljährlich", half_yearly: "halbjährlich", yearly: "jährlich" }[r.repeat] : "", r.note]
      .filter(Boolean)
      .join(" · "),
    key: `r${r.id}`,
  }));
  el.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><div><h2>Erinnerungen</h2><p>Eigene Erinnerungen zu diesem Vertrag</p></div>
          <button class="btn btn-sm btn-primary" id="add-rem">${icon("plus")} Neu</button></div>
        <div class="list" id="rem-list">${items.length ? items.map((i) => reminderItem(i)).join("") : `<p class="muted">Keine eigenen Erinnerungen.</p>`}</div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Automatisch</h2></div></div>
        ${
          c.reminder_days != null && c.cancellation_deadline
            ? `<div class="callout">${icon("bell")}<div>Du wirst <b>${c.reminder_days} Tage</b> vor der Kündigungsfrist (${fmtDate(c.cancellation_deadline)}) erinnert.</div></div>`
            : c.reminder_days == null
              ? `<div class="callout warn">${icon("info")}<div>Automatische Fristerinnerung ist aus. <a href="#/contracts/${c.id}/edit">Einschalten</a></div></div>`
              : `<p class="muted">Keine anstehende Frist.</p>`
        }
      </div>
    </div>`;
  $("#add-rem", el).addEventListener("click", () => reminderForm({ contract_id: c.id }, () => reload("reminders")));
  $("#rem-list", el).addEventListener("click", async (e) => {
    const done = e.target.closest("[data-done]");
    if (done) {
      await api.completeReminder(done.dataset.done);
      toast("Erledigt ✓");
      refreshBadge();
      reload("reminders");
    }
  });
}
