// Comparison module: quickly enter offers and see whether switching pays off.

import { api } from "../api.js";
import { category, isEnergy } from "../store.js";
import { $, busy, confirmDialog, esc, fmtDate, formData, icon, modal, money, toast, today } from "../ui.js";
import { attrValue } from "./components.js";
import { attributeInputs, collectAttributes } from "./contract-form.js";

const VERDICT = {
  worth_it: { label: "Wechsel lohnt sich", cls: "good", icon: "check" },
  marginal: { label: "Geringe Ersparnis", cls: "warn", icon: "info" },
  not_worth_it: { label: "Lohnt sich nicht", cls: "bad", icon: "x" },
};
let horizon = 24;

export async function renderCompare(el, c, reload) {
  const [evaluation, offers] = await Promise.all([api.evaluate(c.id, { horizon_months: horizon }), api.offers(c.id)]);
  const energy = isEnergy(c.category);
  const byId = Object.fromEntries(offers.map((o) => [o.id, o]));
  const results = evaluation.results;
  const best = results.find((r) => r.verdict === "worth_it");
  const fields = (category(c.category).fields || []).filter((f) => !["meter_number", "market_location", "phone_number", "price_guarantee_until", "installment"].includes(f.key));

  el.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <div class="card-head">
        <div><h2>${icon("scale")} Lohnt sich ein Wechsel?</h2>
          <p>Angebote eintragen, Contractly rechnet Einmalkosten, Boni und Laufzeit gegen deinen aktuellen Vertrag.</p></div>
        <div class="segmented" id="horizon">
          ${[12, 24, 36].map((h) => `<button class="${h === horizon ? "active" : ""}" data-h="${h}">${h} Monate</button>`).join("")}
        </div>
      </div>
      ${
        evaluation.earliest_switch
          ? `<div class="callout" style="margin-bottom:16px">${icon("calendar")}<div>Frühester regulärer Wechsel: <b>${fmtDate(evaluation.earliest_switch)}</b>${
              evaluation.cancellation_deadline ? ` – dafür bis <b>${fmtDate(evaluation.cancellation_deadline)}</b> kündigen` : ""
            }.${energy ? " Bei Preiserhöhungen hast du ein Sonderkündigungsrecht." : ""}</div></div>`
          : ""
      }
      ${quickForm(c, energy)}
    </div>

    ${
      results.length
        ? `${
            best
              ? `<div class="callout good" style="margin-bottom:20px">${icon("sparkles")}<div>Bestes Angebot: <b>${esc(byId[best.offer_id].name)}</b> spart dir
                 <b>${money(best.savings_year)} pro Jahr</b> (${money(best.savings_total)} in ${horizon} Monaten).</div></div>`
              : `<div class="callout warn" style="margin-bottom:20px">${icon("info")}<div>Kein Angebot ist spürbar günstiger – dein aktueller Vertrag ist gut aufgestellt. 👍</div></div>`
          }
          <div class="offer-results" style="margin-bottom:20px">
            ${currentCard(c, evaluation)}
            ${results.map((r, i) => offerCard(byId[r.offer_id], r, i === 0 && r.verdict === "worth_it")).join("")}
          </div>
          ${fields.length ? compareTable(c, fields, results.map((r) => byId[r.offer_id])) : ""}`
        : `<div class="card empty" style="padding:36px 20px"><div class="art">⚖️</div><h2>Noch keine Angebote</h2>
            <p>Trag oben ein Angebot ein, das du gesehen hast – Preis reicht, alles andere ist optional.</p></div>`
    }`;

  $("#horizon", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-h]");
    if (!b) return;
    horizon = Number(b.dataset.h);
    renderCompare(el, c, reload);
  });

  $("#offer-form", el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (d.monthly_price == null && d.base_price_month == null && d.unit_price_ct == null) {
      toast("Bitte einen Preis angeben", "error");
      return;
    }
    const btn = $("button[type=submit]", e.target);
    busy(btn);
    try {
      await api.createOffer(c.id, offerPayload(d));
      toast("Angebot hinzugefügt");
      renderCompare(el, c, reload);
    } catch (err) {
      busy(btn, false);
      toast(err.message, "error");
    }
  });

  el.querySelectorAll("[data-switch]").forEach((b) =>
    b.addEventListener("click", () => switchModal(c, byId[b.dataset.switch], evaluation)),
  );
  el.querySelectorAll("[data-del-offer]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (await confirmDialog("Angebot entfernen?", { okLabel: "Entfernen" })) {
        await api.deleteOffer(c.id, b.dataset.delOffer);
        renderCompare(el, c, reload);
      }
    }),
  );
}

function offerPayload(d) {
  return {
    name: d.name || d.provider || "Angebot",
    provider: d.provider,
    monthly_price: d.monthly_price,
    base_price_month: d.base_price_month,
    unit_price_ct: d.unit_price_ct,
    one_time_costs: d.one_time_costs || 0,
    bonus: d.bonus || 0,
    min_term_months: d.min_term_months,
    attributes: collectAttributes(d, "oattr_"),
    notes: d.notes,
  };
}

function quickForm(c, energy) {
  const keyFields = (category(c.category).fields || []).filter(
    (f) => !["meter_number", "market_location", "phone_number", "device", "router", "price_guarantee_until", "installment", "license_plate", "vehicle", "base_price_month", "unit_price_ct", "consumption_kwh"].includes(f.key),
  );
  return `
    <form id="offer-form">
      <div class="form-grid">
        <label class="field"><span>Anbieter</span><input name="provider" placeholder="z. B. Freenet" /></label>
        <label class="field"><span>Tarif</span><input name="name" placeholder="z. B. Allnet 50 GB" /></label>
        ${
          energy
            ? `<label class="field"><span>Grundpreis</span><div class="input-group"><input type="number" step="any" name="base_price_month" inputmode="decimal"/><span class="addon">€/Monat</span></div></label>
               <label class="field"><span>Arbeitspreis</span><div class="input-group"><input type="number" step="any" name="unit_price_ct" inputmode="decimal"/><span class="addon">ct/kWh</span></div></label>`
            : `<label class="field"><span>Preis pro Monat</span><div class="input-group"><input type="number" step="0.01" name="monthly_price" inputmode="decimal" required/><span class="addon">€</span></div></label>`
        }
        <label class="field"><span>Einmalkosten</span><div class="input-group"><input type="number" step="0.01" name="one_time_costs" placeholder="0" inputmode="decimal"/><span class="addon">€</span></div></label>
        <label class="field"><span>Bonus / Gutschrift</span><div class="input-group"><input type="number" step="0.01" name="bonus" placeholder="0" inputmode="decimal"/><span class="addon">€</span></div></label>
        <label class="field"><span>Mindestlaufzeit</span><div class="input-group"><input type="number" name="min_term_months" placeholder="${c.min_term_months ?? 12}"/><span class="addon">Monate</span></div></label>
      </div>
      ${
        keyFields.length
          ? `<details class="more" style="margin-top:14px"><summary>${icon("list")} Leistungen des Angebots <span class="muted small" style="font-weight:500">– optional, für den Leistungsvergleich</span>${icon("chevDown", "chev")}</summary>
              <div class="body"><div class="form-grid">${attributeInputs(c.category, {}, "oattr_", keyFields)}</div></div></details>`
          : ""
      }
      ${energy && !c.attributes?.consumption_kwh ? `<p class="small muted">Hinweis: Hinterlege beim Vertrag deinen Jahresverbrauch, damit Arbeitspreise verglichen werden können.</p>` : ""}
      <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" type="submit">${icon("plus")} Angebot vergleichen</button></div>
    </form>`;
}

function currentCard(c, ev) {
  return `<div class="card offer-card current">
    <span class="ribbon badge">Aktuell</span>
    <div><h3>${esc(c.name)}</h3><div class="small muted">${esc(c.provider || "")}</div></div>
    <div><span class="big num">${money(ev.current_monthly)}</span> <span class="muted small">/ Monat</span></div>
    <dl>
      <dt>${ev.horizon_months} Monate gesamt</dt><dd class="num">${money(ev.current_monthly * ev.horizon_months)}</dd>
      <dt>Pro Jahr</dt><dd class="num">${money(ev.current_monthly * 12)}</dd>
      ${c.extras_12m ? `<dt>Ø Zusatzkosten</dt><dd class="num">${money(c.extras_12m / 12)}/M</dd>` : ""}
    </dl>
    ${c.extras_12m ? `<p class="small muted" style="margin:0">Zusatzkosten (z. B. Ausland) sind im Vergleich nicht eingerechnet – prüfe, ob das neue Angebot sie abdeckt.</p>` : ""}
  </div>`;
}

function offerCard(o, r, isBest) {
  const v = VERDICT[r.verdict];
  return `<div class="card offer-card ${isBest ? "best" : ""}">
    ${isBest ? `<span class="ribbon badge good">${icon("sparkles")} Bestes Angebot</span>` : ""}
    <div style="display:flex;justify-content:space-between;gap:8px">
      <div style="min-width:0"><h3>${esc(o.name)}</h3><div class="small muted">${esc(o.provider || "")}</div></div>
      <button class="btn btn-ghost btn-sm btn-danger" data-del-offer="${o.id}" aria-label="Entfernen">${icon("trash")}</button>
    </div>
    <div><span class="big num">${money(r.monthly)}</span> <span class="muted small">/ Monat</span>
      <span class="small ${r.monthly_diff >= 0 ? "better" : "worse"}" style="font-weight:650">${r.monthly_diff >= 0 ? "−" : "+"}${money(Math.abs(r.monthly_diff))}</span></div>
    <dl>
      ${o.one_time_costs ? `<dt>Einmalkosten</dt><dd class="num">${money(o.one_time_costs)}</dd>` : ""}
      ${o.bonus ? `<dt>Bonus</dt><dd class="num better">−${money(o.bonus)}</dd>` : ""}
      <dt>${r.horizon_months} Monate gesamt</dt><dd class="num">${money(r.offer_total)}</dd>
      <dt>Effektiv pro Monat</dt><dd class="num">${money(r.effective_monthly)}</dd>
      ${o.min_term_months != null ? `<dt>Laufzeit</dt><dd>${o.min_term_months ? o.min_term_months + " Monate" : "monatlich kündbar"}</dd>` : ""}
      ${r.break_even_month != null && r.break_even_month > 1 ? `<dt>Rechnet sich ab</dt><dd>Monat ${r.break_even_month}</dd>` : ""}
    </dl>
    <div class="savings ${v.cls}">
      <div class="small" style="font-weight:650">${icon(v.icon)} ${v.label}</div>
      <div class="amount num">${r.savings_total >= 0 ? "" : "−"}${money(Math.abs(r.savings_total))}</div>
      <div class="small">${r.savings_total >= 0 ? "Ersparnis" : "Mehrkosten"} in ${r.horizon_months} Monaten · ${money(Math.abs(r.savings_year))}/Jahr</div>
    </div>
    ${r.verdict !== "not_worth_it" ? `<button class="btn btn-block" data-switch="${o.id}">${icon("swap")} Zu diesem Angebot wechseln</button>` : ""}
  </div>`;
}

function compareTable(c, fields, offers) {
  const rows = fields
    .map((f) => {
      const cur = c.attributes?.[f.key];
      const vals = offers.map((o) => o.attributes?.[f.key]);
      if ([cur, ...vals].every((v) => v === undefined || v === null || v === "")) return "";
      const lowerBetter = /deductible|waiting/.test(f.key);
      const cls = (v) => {
        if (f.type !== "number" || v == null || cur == null) return "";
        if (v === cur) return "";
        return (v > cur) !== lowerBetter ? "better" : "worse";
      };
      return `<tr><td class="muted">${esc(f.label)}</td><td><b>${esc(attrValue(f, cur) ?? "–")}</b></td>
        ${vals.map((v) => `<td class="${cls(v)}" style="font-weight:600">${esc(attrValue(f, v) ?? "–")}</td>`).join("")}</tr>`;
    })
    .join("");
  if (!rows) return "";
  return `<div class="card"><div class="card-head"><div><h2>Leistungsvergleich</h2><p>Grün = besser als aktuell, rot = schlechter</p></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Aktuell</th>${offers.map((o) => `<th>${esc(o.name)}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

function switchModal(c, offer, ev) {
  const defaultDate = ev.earliest_switch && ev.earliest_switch > today() ? ev.earliest_switch : today();
  const m = modal({
    title: "Vertrag wechseln",
    body: `
      <p style="margin-top:0">Aus <b>${esc(c.name)}</b> wird <b>${esc(offer.name)}</b>. Der alte Vertrag endet am Vortag, der neue übernimmt
      – im Kostenverlauf siehst du beide nahtlos hintereinander.</p>
      <div class="form-grid">
        <label class="field"><span>Wechsel zum</span><input type="date" name="switch_date" value="${defaultDate}"/>
          ${ev.earliest_switch ? `<small>Regulär frühestens ${fmtDate(ev.earliest_switch)}</small>` : ""}</label>
        <label class="field"><span>Name des neuen Vertrags</span><input name="name" value="${esc(offer.name)}"/></label>
      </div>
      <div class="callout" style="margin-top:14px">${icon("info")}<div>Nicht vergessen: beim alten Anbieter kündigen (oder den neuen Anbieter kündigen lassen).
        Unter „Mehr → Kündigungsschreiben“ erstellst du den Brief mit einem Klick.</div></div>`,
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-ok>${icon("swap")} Wechsel durchführen</button>`,
  });
  $("[data-ok]", m).addEventListener("click", async (e) => {
    const switch_date = $("[name=switch_date]", m).value;
    const name = $("[name=name]", m).value;
    busy(e.currentTarget);
    try {
      const created = await api.switchOffer(c.id, offer.id, { switch_date, name });
      m.close();
      toast("Gewechselt! Der Verlauf geht nahtlos weiter 🎉");
      location.hash = `#/contracts/${created.id}`;
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}
