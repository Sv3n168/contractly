// Loan card on the contract page: balance, interest vs. repayment, debt-free date,
// special repayments and a refinancing / follow-up financing check.

import { api } from "../api.js";
import { lines } from "../charts.js";
import { slotColor } from "../store.js";
import { $, busy, esc, fmtDate, formData, icon, money, num, toast, today } from "../ui.js";

export function loanCard(c) {
  const a = c.loan;
  if (!a) return "";
  if (a.missing?.length) {
    return `<div class="card"><div class="card-head"><div><h2>${icon("euro")} Kredit</h2></div></div>
      <p class="muted" style="margin:0">Trag noch ${a.missing.join(", ")} ein (<a href="#/contracts/${c.id}/edit">Bearbeiten</a>) –
        dann rechnet Contractly Restschuld, Zinsen und das Schuldenfrei-Datum aus.</p></div>`;
  }
  if (a.payment_too_low) {
    return `<div class="card"><div class="card-head"><div><h2>${icon("euro")} Kredit</h2></div></div>
      <div class="callout bad">${icon("alert")}<div>Die Rate von ${money(a.payment)} deckt nicht einmal die Zinsen (${money(a.monthly_interest)} im Monat).
        Bitte Rate, Zins oder Kreditbetrag prüfen.</div></div></div>`;
  }
  const repaid = Math.round((a.repaid_share || 0) * 100);
  const repayments = c.attributes?.special_repayments || [];
  return `<div class="card loan-card">
    <div class="card-head"><div><h2>${icon("euro")} Kredit</h2>
      <p>${a.anchored ? "Ab der Restschuld laut Bank berechnet" : `Berechnet aus ${money(a.principal, true)} Kreditbetrag`} · ${num(a.interest_rate)} % Sollzins</p></div></div>
    <div class="loan-balance">
      <div><div class="small muted">Restschuld heute</div><div class="big num">${money(a.balance)}</div></div>
      <div class="grow">
        <div class="bar-track" style="height:10px"><div class="bar-fill" style="width:${repaid}%;background:var(--good)"></div></div>
        <div class="small muted" style="margin-top:6px">${repaid} % getilgt${a.payoff_date ? ` · schuldenfrei im ${new Date(a.payoff_date).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}` : ""}</div>
      </div>
    </div>
    <div class="facts" style="margin-top:14px">
      <div class="fact"><div class="k">Rate</div><div class="v">${money(a.payment)} / Monat</div>
        <div class="small muted">davon ${money(a.current_interest)} Zinsen · ${money(a.current_principal)} Tilgung</div></div>
      <div class="fact"><div class="k">Zinsen bisher</div><div class="v">${money(a.interest_paid)}</div></div>
      <div class="fact"><div class="k">Zinsen bis zum Ende</div><div class="v">${money(a.interest_remaining)}</div></div>
      ${
        a.balance_at_fixed_until != null
          ? `<div class="fact"><div class="k">Restschuld bei Zinsbindungsende</div><div class="v">${money(a.balance_at_fixed_until)}</div>
              <div class="small muted">am ${fmtDate(a.fixed_until)}</div></div>`
          : ""
      }
    </div>
    <div class="chart-box sm" style="margin-top:14px"><canvas id="loan-chart" aria-label="Restschuld im Zeitverlauf"></canvas></div>

    <details class="more" style="margin-top:14px"><summary>${icon("piggy")} Sondertilgungen${repayments.length ? ` (${repayments.length})` : ""}${icon("chevDown", "chev")}</summary>
      <div class="body">
        ${a.special_repayment_allowed ? `<p class="small muted" style="margin-top:0">Erlaubt: bis zu ${money(a.special_repayment_allowed, true)} pro Jahr.</p>` : ""}
        ${
          repayments.length
            ? `<div class="list">${repayments
                .map(
                  (r, i) => `<div class="list-item"><div class="grow">${fmtDate(r.date)}</div><b class="num">${money(r.amount)}</b>
                    <button class="btn btn-ghost btn-sm btn-danger" data-del-repayment="${i}" aria-label="Löschen">${icon("trash")}</button></div>`,
                )
                .join("")}</div>`
            : ""
        }
        <form class="inline-edit" id="repayment-form" style="margin-top:10px">
          <input type="date" class="input" name="on" value="${today()}" required aria-label="Datum"/>
          <input type="number" step="0.01" min="1" class="input" name="amount" placeholder="Betrag" required aria-label="Betrag"/><span>€</span>
          <button class="btn btn-sm" type="submit">${icon("plus")} Eintragen</button>
        </form>
      </div></details>

    <details class="more" style="margin-top:10px"><summary>${icon("scale")} ${a.fixed_until ? "Anschlussfinanzierung oder Umschuldung prüfen" : "Umschuldung prüfen"}${icon("chevDown", "chev")}</summary>
      <div class="body">
        <form class="form-grid" id="loan-compare">
          <label class="field"><span>Neuer Sollzins</span><div class="input-group"><input type="number" step="0.01" min="0" max="30" name="new_rate" required inputmode="decimal"/><span class="addon">%</span></div></label>
          <label class="field"><span>Ab</span><input type="date" name="from_date" value="${a.fixed_until && a.fixed_until > today() ? a.fixed_until : today()}"/></label>
          <label class="field"><span>Kosten des Wechsels</span><div class="input-group"><input type="number" step="0.01" min="0" name="fees" placeholder="automatisch" inputmode="decimal"/><span class="addon">€</span></div>
            <small>Gebühren, Vorfälligkeitsentschädigung. Leer lassen: Contractly schätzt sie bei Ratenkrediten (gesetzlich max. 1 %).</small></label>
          <div class="field" style="align-self:end"><button class="btn btn-primary" type="submit">${icon("scale")} Berechnen</button></div>
        </form>
        <div id="loan-compare-result"></div>
      </div></details>
  </div>`;
}

export function bindLoan(el, c, reload) {
  const a = c.loan;
  if (!a || !a.curve) return;
  const canvas = $("#loan-chart", el);
  if (canvas) {
    lines(canvas, a.curve.map((p) => p.date.slice(0, 7)), [
      { label: "Restschuld", values: a.curve.map((p) => p.balance), color: slotColor(8), fill: true },
    ], { beginAtZero: true });
  }
  $("#repayment-form", el)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    await api.addLoanRepayment(c.id, { on: d.on, amount: d.amount });
    toast("Sondertilgung eingetragen – Restschuld neu berechnet");
    reload();
  });
  el.querySelectorAll("[data-del-repayment]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api.deleteLoanRepayment(c.id, b.dataset.delRepayment);
      reload();
    }),
  );
  $("#loan-compare", el)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const out = $("#loan-compare-result", el);
    const btn = $("button[type=submit]", e.target);
    busy(btn);
    try {
      const r = await api.compareLoan(c.id, { new_rate: d.new_rate, from_date: d.from_date || null, fees: d.fees ?? null });
      out.innerHTML = compareResult(r);
    } catch (err) {
      out.innerHTML = `<div class="callout bad" style="margin-top:12px">${icon("alert")}<div>${esc(err.message)}</div></div>`;
    } finally {
      busy(btn, false);
    }
  });
}

function compareResult(r) {
  const months = r.months_saved;
  return `<div class="callout ${r.worth_it ? "good" : "warn"}" style="margin-top:12px">${icon(r.worth_it ? "piggy" : "info")}
    <div>${
      r.worth_it
        ? `Lohnt sich: <b>${money(r.saving)} weniger Zinsen</b>${r.fees ? ` (nach ${money(r.fees)} Kosten${r.fee_estimated ? ", geschätzt" : ""})` : ""}.`
        : `Lohnt sich nicht: Die Kosten (${money(r.fees)}) sind höher als die gesparten Zinsen.`
    }
    Bei gleicher Rate von ${money(r.payment)} bist du ${months > 0 ? `<b>${months === 1 ? "einen Monat" : `${months} Monate`} früher</b> schuldenfrei (${fmtDate(r.payoff_new)} statt ${fmtDate(r.payoff_current)})` : `am ${fmtDate(r.payoff_new)} schuldenfrei`}.
    <div class="small muted" style="margin-top:4px">Restschuld am ${fmtDate(r.from)}: ${money(r.balance)} · Zinsen bisheriger Kredit ${money(r.interest_current)} · neu ${money(r.interest_new)}</div></div></div>`;
}
