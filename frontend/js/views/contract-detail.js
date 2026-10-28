import { api } from "../api.js";
import { chainLine } from "../charts.js";
import { catColorVar, category, contractIcon, catLabel, catSlot, intervalLabel, isEnergy, slotColor, state } from "../store.js";
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
import { attrValue, bindReminderActions, reminderItem, stateBadge } from "./components.js";
import { renderCompare } from "./compare.js";
import { setupDrop } from "./contract-form.js";
import { contractPayload, suggestionPicker } from "./ocr.js";
import { openLetter } from "./letter.js";
import { bindLoan, loanCard } from "./loan.js";
import { navigate, refreshBadge } from "../app.js";
import { reminderForm } from "./reminders.js";
import { basePriceAt, extraModal, isExtra, monthLabel } from "./extras.js";

export async function renderContractDetail(view, id, query = {}) {
  const c = await api.contract(id);
  const tab = query.tab || "overview";
  const energy = isEnergy(c.category);
  const loan = c.category === "loan";
  const tabs = [
    ["overview", "Übersicht"],
    ["prices", "Preise", c.prices.length],
    // Loans are compared with the refinancing check on the overview, not with tariff offers.
    ...(loan ? [] : [["compare", "Vergleich", c.offer_count || null]]),
    ["documents", "Dokumente", c.documents.length || null],
    ...(energy ? [["readings", "Zählerstände", c.meter_readings.length || null]] : []),
    ["reminders", "Erinnerungen", c.reminders.length || null],
  ];
  view.innerHTML = `
    <a class="back-link" href="#/contracts">${icon("back")} Alle Verträge</a>
    <div class="detail-head">
      <div class="cat-icon lg" style="--c:${catColorVar(c.category)}">${esc(contractIcon(c))}</div>
      <div class="title">
        <h1>${esc(c.name)}</h1>
        <div class="sub">${esc(c.provider || "")}${c.provider ? " · " : ""}${esc(catLabel(c.category))}${
          c.attributes?.managed_by ? ` · ${esc(c.attributes?.field_labels?.managed_by || "Verwaltet von")} ${esc(c.attributes.managed_by)}` : ""
        } ${stateBadge(c)}</div>
      </div>
      <div class="page-actions">
        <a class="btn" href="#/contracts/${id}/edit">${icon("edit")}<span class="label">Bearbeiten</span></a>
        <div class="menu">
          <button class="btn btn-icon" data-menu aria-label="Mehr Aktionen">${icon("more")}</button>
          <div class="menu-pop">
            <button data-act="extra">${icon("plus")} Zusatzkosten erfassen</button>
            <button data-act="price">${icon("euro")} Preisänderung erfassen</button>
            ${c.state === "active" ? `<button data-act="pause">${icon("clock")} Pausieren (ruhend stellen)</button>` : ""}
            ${
              c.state === "active"
                ? `<button data-act="cancel">${icon("ban")} Kündigen …</button>`
                : c.state === "cancelled"
                  ? `${c.cancellation_confirmed_on ? "" : `<button data-act="confirmed">${icon("check")} Kündigungsbestätigung erhalten</button>`}
                     <button data-act="reactivate">${icon("refresh")} Kündigung zurücknehmen</button>`
                  : ""
            }
            ${c.state === "cancelled" ? `<button data-act="letter">${icon("mail")} Kündigungsschreiben</button>` : ""}
            <button data-act="successor">${icon("swap")} Anbieter oder Tarif wechseln</button>
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
    if (act === "pause") pauseModal(c, () => reload());
    if (act === "confirmed") {
      await api.confirmCancellation(c.id);
      toast("Bestätigung vermerkt ✓");
      reload();
    }
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

  // Shared costs: next to the own part always the whole contract's price.
  const shared = Boolean(c.partner_amount) || (c.share_percent != null && c.share_percent !== 100);
  const fullYearly = c.full_monthly_cost * 12;
  // neighbours in the chain of switches (old contract → new contract)
  const pos = chain.findIndex((x) => x.id === c.id);
  const prev = pos > 0 ? chain[pos - 1] : null;
  const next = pos >= 0 && pos < chain.length - 1 ? chain[pos + 1] : null;
  const ended = c.state === "ended";
  el.innerHTML = `
    ${ended ? endedBanner(c, next) : ""}
    ${ended ? endedKpis(c, next, runtime) : c.state === "planned" ? plannedKpis(c) : `
    <div class="kpis">
      <div class="card kpi hero">
        <div class="kpi-label"><span class="kpi-icon">${icon("euro")}</span>Pro Monat</div>
        <div class="kpi-value num">${money(c.monthly_cost)}</div>
        <div class="kpi-sub">${
          c.current_price?.details?.kind === "pause"
            ? "pausiert – keine Kosten"
            : c.partner_amount
            ? `Gesamt ${money(c.full_monthly_cost)} · Partner:in zahlt ${money(c.partner_amount)}`
            : c.share_percent != null && c.share_percent !== 100
            ? `dein Anteil ${c.share_percent} % · Gesamt ${money(c.full_monthly_cost)}`
            : c.current_price && c.current_price.interval !== "monthly"
              ? `${money(c.current_price.amount)} ${intervalLabel(c.current_price.interval)}`
              : "aktueller Preis"
        }</div>
      </div>
      <div class="card kpi"><div class="kpi-label"><span class="kpi-icon">${icon("calendar")}</span>Pro Jahr</div>
        <div class="kpi-value num">${money(c.yearly_cost)}</div><div class="kpi-sub">${
          shared ? `Gesamt ${money(fullYearly)}${c.extras_12m ? ` · + ${money(c.extras_12m)} Zusatzkosten` : ""}`
          : c.extras_12m ? `+ ${money(c.extras_12m)} Zusatzkosten (12 M.)` : "hochgerechnet"
        }</div></div>
      <div class="card kpi"><div class="kpi-label"><span class="kpi-icon">${icon("layers")}</span>Bisher bezahlt</div>
        <div class="kpi-value num">${money(c.total_paid, true)}</div><div class="kpi-sub">${
          shared ? `Gesamt ${money(c.full_total_paid, true)} · ` : ""
        }${
          c.payments?.count
            ? `${c.payments.count} ${c.payments.count === 1 ? "Buchung" : "Buchungen"}${
                c.payments.first ? ` seit ${fmtDate(c.payments.first)}` : ""
              }${c.payments.next ? ` · nächste ${fmtDate(c.payments.next)}` : ""}`
            : `in ${durationText(Math.max(runtime, 0))} Laufzeit`
        }</div></div>
      ${
        c.loan?.balance != null
          ? `<div class="card kpi"><div class="kpi-label"><span class="kpi-icon" style="background:var(--good-soft);color:var(--good)">${icon("trendDown")}</span>Restschuld</div>
             <div class="kpi-value num">${money(c.loan.balance, true)}</div>
             <div class="kpi-sub">${c.loan.payoff_date ? `schuldenfrei ${new Date(c.loan.payoff_date).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}` : ""}</div></div>`
          : c.switch_savings != null
          ? `<div class="card kpi"><div class="kpi-label"><span class="kpi-icon" style="background:var(--good-soft);color:var(--good)">${icon("piggy")}</span>${c.switch_savings >= 0 ? "Gespart seit dem Wechsel" : "Mehrkosten seit dem Wechsel"}</div>
             <div class="kpi-value num ${c.switch_savings >= 0 ? "better" : "worse"}">${money(Math.abs(c.switch_savings), true)}</div>
             <div class="kpi-sub">ggü. ${prev ? `<a href="#/contracts/${prev.id}">${esc(prev.name)}</a>` : "altem Vertrag"}</div></div>`
          : c.state === "cancelled" && c.end_date
          ? `<div class="card kpi"><div class="kpi-label"><span class="kpi-icon">${icon("clock")}</span>Endet am</div>
             <div class="kpi-value num kpi-date">${fmtDate(c.end_date)}</div>
             <div class="kpi-sub">${relDays(daysUntil(c.end_date))} · gekündigt</div></div>`
          : `<div class="card kpi"><div class="kpi-label"><span class="kpi-icon">${icon("clock")}</span>Kündbar bis</div>
             <div class="kpi-value num kpi-date">${c.cancellation_deadline ? fmtDate(c.cancellation_deadline) : c.end_date ? "endet " + fmtDate(c.end_date) : "–"}</div>
             <div class="kpi-sub">${c.cancellation_deadline ? relDays(daysUntil(c.cancellation_deadline)) : ""}</div></div>`
      }
    </div>`}

    ${budgetCard(c)}

    <div class="card" style="margin-bottom:20px">
      <div class="card-head" style="align-items:flex-start"><div><h2>Kostenverlauf</h2>
        <p>${chain.length > 1 ? "Durchgehend über alle Wechsel" : "Monatliche Kosten"} · gestrichelt = Vorschau${hist.extras.some((v) => v) || hist.credits.some((v) => v) ? " · Punkte = Zusatzkosten oder Bonus" : ""}</p></div>
</div>
      <div class="chart-box"><canvas id="hist"></canvas></div>
      ${
        hist.series.length > 1
          ? `<div class="chain-legend">${hist.series
              .map(
                (s, i) => `<a class="chain-item ${s.contract_id === c.id ? "current" : ""}" href="#/contracts/${s.contract_id}">
                  <span class="dot" style="background:${colors[i]}"></span>
                  <span><b>${esc(s.name)}</b><span class="muted"> · ${
                    s.start_date > today()
                      ? `ab ${fmtDate(s.start_date)}`
                      : `${fmtDate(s.start_date)} – ${s.end_date ? fmtDate(s.end_date) : "heute"}`
                  }</span></span></a>`,
              )
              .join(`<span class="chain-arrow">${icon("chevRight")}</span>`)}</div>`
          : ""
      }
    </div>

    <div class="grid grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>Leistungen & Eckdaten</h2></div></div>
          ${
            facts.length
              ? `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>`
              : `<p class="muted" style="margin:0">Noch keine Eckdaten hinterlegt. <a href="#/contracts/${c.id}/edit">Jetzt ergänzen</a> – oder ein Dokument hochladen und erkennen lassen.</p>`
          }
          <div class="facts" style="margin-top:10px">
            ${c.attributes?.managed_by ? `<div class="fact"><div class="k">${esc(c.attributes?.field_labels?.managed_by || "Verwaltet von")}</div><div class="v">${esc(c.attributes.managed_by)}</div></div>` : ""}
            ${c.customer_number ? `<div class="fact"><div class="k">${esc(c.attributes?.field_labels?.customer_number || "Kundennummer")}</div><div class="v">${esc(c.customer_number)}</div></div>` : ""}
            ${c.contract_number ? `<div class="fact"><div class="k">${esc(c.attributes?.field_labels?.contract_number || "Vertragsnummer")}</div><div class="v">${esc(c.contract_number)}</div></div>` : ""}
            ${(c.attributes?.custom_fields || [])
              .filter((f) => f.value)
              .map((f) => `<div class="fact"><div class="k">${esc(f.label)}</div><div class="v">${esc(f.value)}</div></div>`)
              .join("")}
          </div>
        </div>
        ${ended ? "" : energyCard(c)}
        ${loanCard(c)}
        ${c.notes ? `<div class="card"><div class="card-head"><h2>Notizen</h2></div><p style="margin:0;white-space:pre-wrap">${esc(c.notes)}</p></div>` : ""}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Laufzeit & Kündigung</h2></div></div>
        ${
          ended
            ? ""
            : c.state === "cancelled"
              ? `<div class="callout warn">${icon("clock")}<div>Gekündigt${c.cancelled_on ? ` am ${fmtDate(c.cancelled_on)}` : ""} – läuft noch bis <b>${fmtDate(c.end_date)}</b> (${relDays(daysUntil(c.end_date))}).
                  ${
                    c.cancellation_confirmed_on
                      ? `<br/>${icon("check", "inline")} Bestätigung erhalten am ${fmtDate(c.cancellation_confirmed_on)}`
                      : c.attributes?.no_confirmation
                        ? ""
                        : `<br/><b>Bestätigung des Anbieters steht noch aus.</b>
                           <span style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
                             <button class="btn btn-sm" id="confirm-btn">${icon("check")} Bestätigung erhalten</button>
                             <button class="btn btn-sm btn-ghost" id="no-confirm-btn">${icon("x")} Kommt keine – ausblenden</button>
                           </span>`
                  }</div></div>`
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
        ${
          ended
            ? `<div class="facts">
                <div class="fact"><div class="k">Beginn</div><div class="v">${fmtDate(c.start_date)}</div></div>
                <div class="fact"><div class="k">Beendet</div><div class="v">${fmtDate(c.end_date)}</div></div>
                ${c.cancelled_on ? `<div class="fact"><div class="k">Gekündigt am</div><div class="v">${fmtDate(c.cancelled_on)}</div></div>` : ""}
              </div>`
            : `
        <div class="facts" style="margin-top:16px">
          <div class="fact"><div class="k">Beginn</div><div class="v">${fmtDate(c.start_date)}</div></div>
          <div class="fact"><div class="k">Mindestlaufzeit</div><div class="v">${c.min_term_months ? `${c.min_term_months} Monat${c.min_term_months === 1 ? "" : "e"}` : "keine"}</div></div>
          <div class="fact"><div class="k">Verlängerung</div><div class="v">${c.renewal_months ? `um ${c.renewal_months} Monat${c.renewal_months > 1 ? "e" : ""}` : "–"}</div></div>
          <div class="fact"><div class="k">Kündigungsfrist</div><div class="v">${noticeText(c)}</div></div>
          <div class="fact"><div class="k">Erinnerung</div><div class="v">${c.reminder_days != null ? `${c.reminder_days} Tage vorher` : "aus"}</div></div>
        </div>`
        }
      </div>
    </div>`;

  chainLine($("#hist", el), hist.months, hist.series, colors, {
    currentMonth: hist.current_month,
    extras: hist.extras,
    credits: hist.credits,
  });
  $("#extra-btn", el)?.addEventListener("click", () => extraModal(c, null, () => reload()));
  $("#cancel-btn", el)?.addEventListener("click", () => cancelModal(c, () => reload()));
  $("#confirm-btn", el)?.addEventListener("click", async () => {
    await api.confirmCancellation(c.id);
    toast("Bestätigung vermerkt ✓");
    reload();
  });
  $("#no-confirm-btn", el)?.addEventListener("click", async () => {
    await api.noConfirmation(c.id);
    toast("Hinweis ausgeblendet");
    reload();
  });
  $("#letter-btn", el)?.addEventListener("click", () => openLetter(c));
  bindLoan(el, c, reload);
}

function deadlineCallout(c) {
  if (c.monthly_cancellable) {
    return `<div class="callout good">${icon("check")}<div>Mindestlaufzeit vorbei – <b>monatlich kündbar</b>.
      Nächstmögliches Ende: ${fmtDate(c.next_term_end)} (Kündigung bis ${fmtDate(c.cancellation_deadline)}).</div></div>`;
  }
  const d = daysUntil(c.cancellation_deadline);
  const cls = d <= 14 ? "bad" : d <= 45 ? "warn" : "good";
  // the actions show up only when they matter: a deadline coming up
  return `<div class="callout ${cls}">${icon(cls === "good" ? "check" : "alert")}<div>
    Nächste Kündigungsmöglichkeit: bis <b>${fmtDate(c.cancellation_deadline)}</b> (${relDays(d)}) zum ${fmtDate(c.next_term_end)}.
    ${cls === "good" ? "Entspannt – genug Zeit zum Vergleichen." : "Jetzt vergleichen lohnt sich."}${
      cls === "good"
        ? ""
        : `<div class="callout-actions">
            ${c.category === "loan" ? "" : `<a class="btn btn-sm" href="#/contracts/${c.id}?tab=compare">${icon("scale")} Angebote vergleichen</a>`}
            <button class="btn btn-sm btn-ghost" id="cancel-btn">${icon("ban")} Kündigen …</button>
          </div>`
    }</div></div>`;
}

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const readingUnit = (c) => (c.category === "gas" ? "m³" : "kWh");

function forecastText(e) {
  const f = e.forecast;
  if (!f) return "Basierend auf dem hinterlegten Jahresverbrauch";
  const how = f.learned ? "an deinen Haushalt angepasst" : "mit typischem Jahresverlauf";
  const rough = f.relative_uncertainty >= 0.3 ? " – noch grobe Schätzung" : "";
  return `Prognose aus ${e.readings} Zählerständen, ${how}${rough}`;
}

function monthBars(f) {
  const max = Math.max(...f.monthly_kwh);
  const now = new Date().getMonth();
  return `<div class="month-bars" role="img" aria-label="Erwarteter Verbrauch pro Monat">${f.monthly_kwh
    .map(
      (v, i) => `<div class="mb${i === now ? " now" : ""}" title="${MONTH_INITIALS[i]}: ${num(v)} kWh">
        <div class="bar" style="height:${Math.max(4, (v / max) * 100)}%"></div><span>${MONTH_INITIALS[i]}</span></div>`,
    )
    .join("")}</div>`;
}

function energyCard(c) {
  const e = c.energy;
  if (!e) return "";
  const f = e.forecast;
  if (!e.expected_yearly_cost) {
    return `<div class="card"><div class="card-head"><div><h2>${icon("gauge")} Verbrauch & Abrechnung</h2></div></div>
      <p class="muted" style="margin:0">Trage Grundpreis und Arbeitspreis ein und erfasse Zählerstände (oder deinen Jahresverbrauch) –
        dann sagt Contractly dir, ob dein Abschlag reicht.</p></div>`;
  }
  const s = e.settlement_estimate;
  const range = f && f.low_kwh !== f.high_kwh ? `<div class="small muted">${num(f.low_kwh)} – ${num(f.high_kwh)} kWh</div>` : "";
  const costRange = e.cost_low != null ? `<div class="small muted">${money(e.cost_low)} – ${money(e.cost_high)}</div>` : "";
  let verdict = "";
  if (s != null) {
    const cls = s >= 0 ? "good" : Math.abs(s) < 30 ? "warn" : "bad";
    const fix =
      e.needed_installment && s < -30
        ? ` Mit einem Abschlag von <b>${money(e.needed_installment)}</b> ab jetzt kommst du ohne Nachzahlung durch.`
        : "";
    verdict = `<div class="callout ${cls}" style="margin-top:12px">${icon(s >= 0 ? "piggy" : "alert")}
      <div>Voraussichtlich <b>${s >= 0 ? "Guthaben" : "Nachzahlung"} von ${money(Math.abs(s))}</b>
        bei der Abrechnung${e.billing_year_end ? ` zum ${fmtDate(e.billing_year_end)}` : ""}.${fix}</div></div>`;
  }
  const tip =
    !f || f.coverage < 0.8
      ? `<p class="small muted" style="margin:10px 0 0">${icon("info", "inline")} Tipp: Trag einmal im Monat deinen Zählerstand ein – je mehr Werte über das Jahr, desto genauer die Prognose.</p>`
      : "";
  return `<div class="card">
    <div class="card-head"><div><h2>${icon("gauge")} Verbrauch & Abrechnung</h2><p>${forecastText(e)}</p></div></div>
    <div class="facts">
      <div class="fact"><div class="k">Verbrauch / Jahr</div><div class="v">${num(e.consumption_used)} kWh</div>${range}</div>
      <div class="fact"><div class="k">Erwartete Kosten / Jahr</div><div class="v">${money(e.expected_yearly_cost)}</div>${costRange}</div>
      ${e.installment ? `<div class="fact"><div class="k">Dein Abschlag</div><div class="v">${money(e.installment)} / Monat</div></div>` : ""}
      <div class="fact"><div class="k">Passender Abschlag</div><div class="v">${money(e.suggested_installment)} / Monat</div></div>
    </div>
    ${f ? monthBars(f) : ""}
    ${verdict}
    ${tip}
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
  // a row opens its dialog (edit, delete) – no pencil and trash can in every line
  const actions = () => `<td class="r row-go">${icon("chevRight")}</td>`;
  el.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><div><h2>Preishistorie</h2><p>Der reguläre Preis – jede Änderung gilt ab ihrem Datum bis zur nächsten.</p></div>
        <button class="btn btn-sm btn-primary" data-add="price">${icon("plus")} Preisänderung</button></div>
      ${
        recurring.length
          ? `<div class="table-wrap"><table class="table"><thead><tr>
              <th>Gültig ab</th><th class="r">Betrag</th><th class="hide-sm">Zahlweise</th><th class="r">pro Monat</th><th class="r hide-sm">Änderung</th><th class="hide-sm">Notiz</th><th></th></tr></thead><tbody>
              ${recurring
                .map((p, i) => {
                  const prev = recurring[i + 1];
                  const diff = prev ? p.monthly_equivalent - prev.monthly_equivalent : null;
                  return `<tr class="row-link" data-edit="${p.id}" tabindex="0">
                    <td class="num">${fmtDate(p.valid_from)}</td>
                    <td class="r num"><b>${money(p.amount)}</b></td>
                    <td class="hide-sm">${intervalLabel(p.interval)}</td>
                    <td class="r num">${money(p.monthly_equivalent)}</td>
                    <td class="r num hide-sm">${diff ? `<span class="${diff > 0 ? "worse" : "better"}">${signedMoney(diff)}</span>` : ""}</td>
                    <td class="muted hide-sm">${esc(p.note || "")}${p.details?.unit_price_ct ? ` <span class="small">(${num(p.details.base_price_month)} €/M + ${num(p.details.unit_price_ct)} ct)</span>` : ""}</td>
                    ${actions(p)}</tr>`;
                })
                .join("")}</tbody></table></div>`
          : `<p class="muted">Noch keine Preise erfasst.</p>`
      }
    </div>
    <div class="card">
      <div class="card-head"><div><h2>Zusatzkosten & Einmalzahlungen</h2>
        <p>Teurere Monate (z. B. Auslandstelefonate), Gebühren, Boni und Gutschriften – ändern den regulären Preis nicht.</p></div>
        <button class="btn btn-sm btn-primary" data-add="choose">${icon("plus")} Erfassen</button></div>
      ${
        c.extras_12m
          ? `<div class="callout" style="margin-bottom:14px">${icon("info")}<div>Letzte 12 Monate: <b>${money(c.extras_12m)}</b> Zusatzkosten in
             ${c.extras_months_12m} Monat${c.extras_months_12m === 1 ? "" : "en"} – im Schnitt <b>${money(c.extras_12m / 12)}</b> pro Monat zusätzlich.</div></div>`
          : ""
      }
      ${
        once.length
          ? `<div class="table-wrap"><table class="table"><thead><tr><th>Monat</th><th class="hide-sm">Art</th><th>Grund</th><th class="r">Betrag</th><th class="r hide-sm">Rechnung gesamt</th><th></th></tr></thead><tbody>
              ${once
                .map((p) => {
                  const extra = isExtra(p);
                  const ym = p.valid_from.slice(0, 7);
                  const kind = extra
                    ? `<span class="badge warn">Zusatzkosten</span>`
                    : `<span class="badge ${p.amount < 0 ? "good" : ""}">${p.amount < 0 ? "Gutschrift" : "einmalig"}</span>`;
                  return `<tr class="row-link" data-edit="${p.id}" tabindex="0">
                    <td class="num">${extra ? esc(monthLabel(ym)) : fmtDate(p.valid_from)}</td>
                    <td class="hide-sm">${kind}</td>
                    <td class="muted">${esc(p.note || "")}</td>
                    <td class="r num"><b class="${p.amount > 0 ? "" : "better"}">${signedMoney(p.amount)}</b></td>
                    <td class="r num muted hide-sm">${extra ? money(basePriceAt(c, ym) + p.amount) : "–"}</td>
                    ${actions(p)}</tr>`;
                })
                .join("")}</tbody></table></div>`
          : `<p class="muted" style="margin:0">Noch nichts erfasst. War eine Rechnung mal höher als sonst, gab es eine Gebühr oder einen Bonus? Oben auf „Erfassen“.</p>`
      }
    </div>`;
  const done = () => reload("prices");
  const open = (row) => {
    const p = c.prices.find((x) => x.id === Number(row.dataset.edit));
    if (isExtra(p)) extraModal(c, p, done);
    else priceModal(c, p, done);
  };
  el.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    const row = e.target.closest("[data-edit]");
    if (add?.dataset.add === "choose") onceChooser(c, done);
    else if (add) priceModal(c, null, done);
    if (row) open(row);
  });
  el.addEventListener("keydown", (e) => {
    const row = e.target.closest("[data-edit]");
    if (row && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open(row);
    }
  });
}

/** What happened? A higher bill, a one-off cost or a credit – each with its own simple dialog. */
function onceChooser(c, done) {
  const m = modal({
    title: "Was möchtest du erfassen?",
    body: `<div class="choice-list">
        <button class="choice" data-k="extra">${icon("trendUp")}<span><b>Eine Rechnung war höher</b><small>z. B. Auslandstelefonate, Nachzahlung – nur in diesem Monat</small></span></button>
        <button class="choice" data-k="cost">${icon("euro")}<span><b>Einmalige Kosten</b><small>z. B. Anschlussgebühr, Gerät, Aufnahmegebühr</small></span></button>
        <button class="choice" data-k="credit">${icon("piggy")}<span><b>Gutschrift oder Bonus</b><small>z. B. Wechselbonus, Erstattung</small></span></button>
      </div>`,
  });
  m.addEventListener("click", (e) => {
    const k = e.target.closest("[data-k]")?.dataset.k;
    if (!k) return;
    m.close();
    if (k === "extra") extraModal(c, null, done);
    else priceModal(c, { interval: "once", amount: null, credit: k === "credit" }, done);
  });
}

export function priceModal(c, existing, done) {
  const energy = isEnergy(c.category);
  const cur = c.current_price;
  const p = existing || {};
  const isOnce = p.interval === "once";
  let credit = isOnce && (p.credit || p.amount < 0);
  const m = modal({
    title: isOnce ? (p.id ? "Einmalbetrag bearbeiten" : credit ? "Gutschrift oder Bonus" : "Einmalige Kosten") : p.id ? "Preis bearbeiten" : "Preisänderung erfassen",
    body: `<form class="form-grid" id="pf">
      ${
        isOnce
          ? `<div class="field span-all"><div class="segmented" id="sign">
              <button type="button" data-s="cost" class="${credit ? "" : "active"}">Kosten</button>
              <button type="button" data-s="credit" class="${credit ? "active" : ""}">Gutschrift / Bonus</button></div></div>`
          : ""
      }
      <label class="field"><span>${isOnce ? "Datum" : "Gültig ab"}</span><input type="date" name="valid_from" value="${esc(p.valid_from || today())}" required/></label>
      <label class="field"><span>${isOnce ? "Betrag" : "Neuer Preis"}</span><div class="input-group">
        <input type="number" step="0.01" ${isOnce ? 'min="0"' : ""} name="amount" value="${esc(p.amount == null ? "" : isOnce ? Math.abs(p.amount) : p.amount)}" required inputmode="decimal"/><span class="addon">€</span></div></label>
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
      ${
        c.category === "loan" && !isOnce
          ? `<label class="field"><span>Sollzins ab hier</span><div class="input-group"><input type="number" step="0.01" name="interest_rate" value="${esc(p.details?.interest_rate ?? "")}"/><span class="addon">%</span></div></label>
             <div class="field span-all"><small>Für eine Anschlussfinanzierung: neue Rate und neuen Zins ab dem Ende der Zinsbindung eintragen.</small></div>`
          : ""
      }
      <label class="field span-all"><span>Notiz</span><input name="note" value="${esc(p.note ?? "")}"/></label>
    </form>`,
    foot: `${p.id ? `<button class="btn btn-ghost btn-danger" data-del style="margin-right:auto">${icon("trash")} Löschen</button>` : ""}
      <button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon("check")} Speichern</button>`,
  });
  $("#sign", m)?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    credit = b.dataset.s === "credit";
    m.querySelectorAll("#sign button").forEach((x) => x.classList.toggle("active", x === b));
  });
  bindDelete(m, c, p, done);
  $("[data-save]", m).addEventListener("click", async (e) => {
    const d = formData($("#pf", m));
    if (d.amount == null) return toast("Bitte Betrag angeben", "error");
    if (isOnce) d.amount = credit ? -Math.abs(d.amount) : Math.abs(d.amount);
    const details = {};
    if (d.base_price_month != null) details.base_price_month = d.base_price_month;
    if (d.unit_price_ct != null) details.unit_price_ct = d.unit_price_ct;
    if (d.interest_rate != null) details.interest_rate = d.interest_rate;
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

/** "Löschen" inside an edit dialog (instead of a trash can in every row). */
export function bindDelete(m, c, p, done) {
  $("[data-del]", m)?.addEventListener("click", async () => {
    m.close();
    if (await confirmDialog("Diesen Eintrag löschen?")) {
      await api.deletePrice(c.id, p.id);
      toast("Gelöscht");
      done();
    }
  });
}

// ------------------------------------------------------------------ pause

function pauseModal(c, done) {
  const m = modal({
    title: "Vertrag pausieren",
    body: `<p style="margin-top:0">Für die Zeit der Pause (z. B. Krankheit, Elternzeit, Auslandsaufenthalt) fallen keine Kosten an. Danach gilt wieder der bisherige Preis.</p>
      <div class="form-grid">
        <label class="field"><span>Pause ab</span><input type="date" name="from_date" value="${today()}"/></label>
        <label class="field"><span>Pause bis</span><input type="date" name="until"/><small>Leer = unbestimmt</small></label>
        <label class="check span-all"><input type="checkbox" name="extend_term" ${c.min_term_months ? "checked" : "disabled"}/> Mindestlaufzeit um die Pause verlängern (bei Fitnessstudios üblich)</label>
      </div>`,
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-ok>${icon("clock")} Pausieren</button>`,
  });
  $("[data-ok]", m).addEventListener("click", async (e) => {
    const body = $(".modal-body", m);
    busy(e.currentTarget);
    try {
      await api.pauseContract(c.id, {
        from_date: $("[name=from_date]", body).value,
        until: $("[name=until]", body).value || null,
        extend_term: $("[name=extend_term]", body).checked,
      });
      m.close();
      toast("Pausiert – in dieser Zeit fallen keine Kosten an");
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
                    ${ocrOk ? `<button class="btn btn-sm" data-ocr="${d.id}" title="Inhalt erkennen">${icon("scan")}<span class="label">Erkennen</span></button>` : ""}
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
        <label class="check small" style="margin-top:12px"><input type="checkbox" id="auto-ocr" ${ocrOk ? "checked" : "disabled"}/> Inhalt erkennen und Änderungen vorschlagen</label>
        ${ocrOk ? "" : `<p class="small muted">Texterkennung ist auf diesem Server nicht eingerichtet.</p>`}
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
  const unit = readingUnit(c);
  const rows = [...c.meter_readings].sort((a, b) => b.reading_date.localeCompare(a.reading_date));
  el.innerHTML = `
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head"><div><h2>Zählerstände</h2><p>Ab zwei Ablesungen gibt es eine Prognose. Contractly berücksichtigt, dass im Winter mehr verbraucht wird.</p></div></div>
        ${
          rows.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>Datum</th><th class="r">Stand</th><th class="r">Verbrauch seit vorher</th><th class="r hide-sm">pro Tag</th><th></th></tr></thead><tbody>
              ${rows
                .map((r, i) => {
                  const prev = rows[i + 1];
                  const used = prev ? r.value - prev.value : null;
                  const days = prev ? (new Date(r.reading_date) - new Date(prev.reading_date)) / 86400000 : null;
                  return `<tr><td>${fmtDate(r.reading_date)}</td><td class="r num"><b>${num(r.value)}</b> ${unit}</td>
                    <td class="r num">${used != null ? num(used) + " " + unit : "–"}</td><td class="r num hide-sm">${days ? num(used / days) + " " + unit : "–"}</td>
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
            <label class="field"><span>Zählerstand</span><div class="input-group"><input type="number" step="any" name="value" required inputmode="decimal"/><span class="addon">${unit}</span></div>
              ${c.category === "gas" ? `<small>Wie auf dem Gaszähler (m³). Umgerechnet wird mit ${num(c.attributes?.gas_factor || 10)} kWh/m³ – den genauen Wert findest du auf der Rechnung.</small>` : ""}</label>
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
  bindReminderActions($("#rem-list", el), api, () => {
    refreshBadge();
    reload("reminders");
  });
}


/** Progress towards the agreed total: how much is left, the odd last amount, a warning when more was paid. */
function budgetCard(c) {
  const b = c.budget;
  if (!b) return "";
  const end = c.end_date ? ` (Vertragsende ${fmtDate(c.end_date)})` : "";
  let plan;
  if (b.exceeded) {
    plan = `<div class="callout bad">${icon("alert")}<div><b>Gesamtsumme um ${money(b.over)} überschritten.</b>
      Dauerauftrag beenden und zu viel Gezahltes zurückfordern.</div></div>`;
  } else if (!b.left) {
    plan = `<div class="callout good">${icon("check")}<div><b>Gesamtsumme erreicht.</b> Der Dauerauftrag kann beendet werden.</div></div>`;
  } else if (b.last_date) {
    const odd = b.planned_amount - b.last_amount > 0.005;
    const regular = b.regular_left
      ? `noch <b>${b.regular_left} × ${money(b.regular_amount)}</b> bis ${fmtDate(b.last_regular_date)}, `
      : "";
    plan = `<p style="margin:0">Offen: <b>${money(b.left)}</b> – ${regular}${odd ? "dann als letzte Zahlung" : "die letzte"}
      <b>${money(b.last_amount)}</b> am <b>${fmtDate(b.last_date)}</b>.</p>
      <div class="callout ${odd ? "warn" : ""}" style="margin-top:12px">${icon("info")}<div>${
        odd
          ? `Die letzte Zahlung ist kleiner: <b>${money(b.last_amount)} statt ${money(b.planned_amount)}</b> – sonst zahlst du ${money(b.planned_amount - b.last_amount)} zu viel. Dauerauftrag also bis ${b.regular_left ? fmtDate(b.last_regular_date) : "dahin"} laufen lassen, die ${money(b.last_amount)} einmal überweisen.`
          : `Der Dauerauftrag kann nach dem ${fmtDate(b.last_date)} enden.`
      } Contractly erinnert dich vorher.</div></div>${
        b.projected_over
          ? `<div class="callout bad" style="margin-top:12px">${icon("alert")}<div>Bis zum Vertragsende${end} würden <b>${money(b.projected_over)} zu viel</b> gezahlt.</div></div>`
          : ""
      }`;
  } else {
    plan = `<p style="margin:0">Offen: <b>${money(b.left)}</b>${
      b.short ? ` – bis zum Vertragsende${end} fehlen bei den eingetragenen Preisen noch ${money(b.short)}.` : "."
    }</p>`;
  }
  return `<div class="card budget-card" style="margin-bottom:20px">
    <div class="card-head"><div><h2>Gesamtsumme</h2>
      <p>${money(b.paid)} von ${money(b.total)} bezahlt · ${String(b.percent).replace(".", ",")} %</p></div></div>
    <div class="term-bar ${b.exceeded ? "over" : ""}"><div style="width:${b.percent}%"></div></div>
    ${plan}
  </div>`;
}

/** An ended contract: say right away what replaced it. */
function endedBanner(c, next) {
  if (!next) return `<div class="callout switch-banner">${icon("info")}<div>Beendet am <b>${fmtDate(c.end_date)}</b>.</div></div>`;
  const diff = next.monthly_cost - (c.current_price?.monthly_equivalent ?? 0);
  return `<a class="callout switch-banner" href="#/contracts/${next.id}">${icon("swap")}<div>
      Beendet am <b>${fmtDate(c.end_date)}</b> – abgelöst durch <b>${esc(next.name)}</b>${next.provider ? ` (${esc(next.provider)})` : ""}${
        Math.abs(diff) >= 0.01 ? `, ${money(Math.abs(diff))} ${diff < 0 ? "günstiger" : "teurer"} im Monat` : ""
      }.</div>${icon("chevRight", "switch-go")}</a>`;
}

/** Key figures of an ended contract: what it cost last, how long it ran, what it cost in total. */
function endedKpis(c, next, runtime) {
  const last = c.current_price?.monthly_equivalent ?? 0;
  return `<div class="kpis">
      <div class="card kpi hero">
        <div class="kpi-label">Zuletzt pro Monat</div>
        <div class="kpi-value num">${money(last)}</div>
        <div class="kpi-sub">bis ${fmtDate(c.end_date)}</div>
      </div>
      <div class="card kpi"><div class="kpi-label">Laufzeit</div>
        <div class="kpi-value num kpi-date">${durationText(Math.max(runtime, 0))}</div>
        <div class="kpi-sub">${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}</div></div>
      <div class="card kpi"><div class="kpi-label">Insgesamt bezahlt</div>
        <div class="kpi-value num">${money(c.total_paid, true)}</div>
        <div class="kpi-sub">${c.payments?.count ? `${c.payments.count} Buchungen` : ""}</div></div>
      ${
        next
          ? `<div class="card kpi"><div class="kpi-label">Heute</div>
              <div class="kpi-value num">${money(next.monthly_cost)}</div>
              <div class="kpi-sub">im Monat bei <a href="#/contracts/${next.id}">${esc(next.name)}</a></div></div>`
          : ""
      }
    </div>`;
}

/** Own part of a monthly price (partner's fixed amount or percentage). */
function ownMonthly(c, monthly) {
  if (c.partner_amount) return Math.max(0, monthly - c.partner_amount);
  if (c.share_percent != null) return (monthly * c.share_percent) / 100;
  return monthly;
}

/** A contract that hasn't started yet: what it will cost and when it begins – not 0,00 €. */
function plannedKpis(c) {
  const p = c.current_price;
  const monthly = ownMonthly(c, p?.monthly_equivalent ?? 0);
  const start = fmtDate(c.start_date);
  return `<div class="kpis">
      <div class="card kpi hero">
        <div class="kpi-label">Pro Monat ab ${start}</div>
        <div class="kpi-value num">${money(monthly)}</div>
        <div class="kpi-sub">${p && p.interval !== "monthly" ? `${money(p.amount)} ${intervalLabel(p.interval)}` : "erster Preis"}</div>
      </div>
      <div class="card kpi"><div class="kpi-label">Pro Jahr</div>
        <div class="kpi-value num">${money(monthly * 12)}</div><div class="kpi-sub">ab Beginn</div></div>
      <div class="card kpi"><div class="kpi-label">Beginnt am</div>
        <div class="kpi-value num kpi-date">${start}</div><div class="kpi-sub">${relDays(daysUntil(c.start_date))}</div></div>
      ${
        c.cancellation_deadline
          ? `<div class="card kpi"><div class="kpi-label">Kündbar bis</div>
              <div class="kpi-value num kpi-date">${fmtDate(c.cancellation_deadline)}</div>
              <div class="kpi-sub">${relDays(daysUntil(c.cancellation_deadline))}</div></div>`
          : ""
      }
    </div>`;
}
