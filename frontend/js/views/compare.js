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
let withBonus = true;

export const BONUS_TYPES = {
  switch: { label: "Wechselbonus", after: 1 },
  new_customer: { label: "Neukundenbonus", after: 1, energyAfter: 12 },
  instant: { label: "Sofortbonus", after: 0 },
  number_porting: { label: "Rufnummernmitnahme", after: 2 },
  cashback: { label: "Cashback / Prämie", after: 3 },
};
const bonusLabel = (t) => BONUS_TYPES[t]?.label || "Bonus";
const monthsText = (n) => (n ? `nach ${n} Mon.` : "sofort");

export async function renderCompare(el, c, reload) {
  const [evaluation, offers] = await Promise.all([
    api.evaluate(c.id, { horizon_months: horizon, include_bonus: withBonus }),
    api.offers(c.id),
  ]);
  const energy = isEnergy(c.category);
  const byId = Object.fromEntries(offers.map((o) => [o.id, o]));
  const results = evaluation.results;
  const best = results.find((r) => r.verdict === "worth_it");
  const fields = (category(c.category).fields || []).filter(
    (f) => !["meter_number", "market_location", "phone_number", "price_guarantee_until", "installment", "consumption_kwh"].includes(f.key),
  );

  el.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <div class="card-head">
        <div><h2>${icon("scale")} Lohnt sich ein Wechsel?</h2>
          <p>Angebote eintragen, Contractly rechnet Einmalkosten, Boni und Laufzeit gegen deinen aktuellen Vertrag.</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="segmented" id="bonus-toggle" title="Wechselboni einrechnen?">
            <button class="${withBonus ? "active" : ""}" data-b="1">Mit Boni</button><button class="${withBonus ? "" : "active"}" data-b="0">Ohne Boni</button>
          </div>
          <div class="segmented" id="horizon">
            ${[12, 24, 36].map((h) => `<button class="${h === horizon ? "active" : ""}" data-h="${h}">${h} Monate</button>`).join("")}
          </div>
        </div>
      </div>
      ${
        evaluation.earliest_switch
          ? `<div class="callout" style="margin-bottom:16px">${icon("calendar")}<div>Frühester regulärer Wechsel: <b>${fmtDate(evaluation.earliest_switch)}</b>${
              evaluation.cancellation_deadline ? ` – dafür bis <b>${fmtDate(evaluation.cancellation_deadline)}</b> kündigen` : ""
            }.${energy ? " Bei Preiserhöhungen hast du ein Sonderkündigungsrecht." : ""}</div></div>`
          : ""
      }
      ${quickForm(c, energy, null, "offer-form")}
    </div>

    ${
      results.length
        ? `${
            best
              ? `<div class="callout good" style="margin-bottom:20px">${icon("sparkles")}<div>Bestes Angebot: <b>${esc(byId[best.offer_id].name)}</b> spart dir
                 <b>${money(best.savings_year)} pro Jahr</b> (${money(best.savings_total)} in ${horizon} Monaten)${
                   best.bonus_dependent ? " – allerdings nur dank Bonus" : ""
                 }.</div></div>`
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
  $("#bonus-toggle", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-b]");
    if (!b) return;
    withBonus = b.dataset.b === "1";
    renderCompare(el, c, reload);
  });

  bindOfferForm($("#offer-form", el), energy);
  $("#offer-form", el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = readOfferForm(e.target);
    if (!payload) return;
    const btn = $("button[type=submit]", e.target);
    busy(btn);
    try {
      await api.createOffer(c.id, payload);
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
  el.querySelectorAll("[data-edit-offer]").forEach((b) =>
    b.addEventListener("click", () => editOfferModal(c, byId[b.dataset.editOffer], energy, () => renderCompare(el, c, reload))),
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

function readOfferForm(form) {
  const d = formData(form);
  if (d.monthly_price == null && d.base_price_month == null && d.unit_price_ct == null) {
    toast("Bitte einen Preis angeben", "error");
    return null;
  }
  const bonuses = [...form.querySelectorAll(".bonus-row")]
    .map((row) => ({
      type: row.querySelector("[data-f=type]").value,
      amount: Number(row.querySelector("[data-f=amount]").value) || 0,
      paid_after_months: Number(row.querySelector("[data-f=after]").value) || 0,
    }))
    .filter((b) => b.amount > 0);
  const promoOn = !form.querySelector(".promo-row").classList.contains("hidden");
  return {
    name: d.name || d.provider || "Angebot",
    provider: d.provider,
    monthly_price: d.monthly_price,
    base_price_month: d.base_price_month,
    unit_price_ct: d.unit_price_ct,
    one_time_costs: d.one_time_costs || 0,
    bonus: 0,
    bonuses,
    promo_price: promoOn ? d.promo_price : null,
    promo_months: promoOn && d.promo_price != null ? d.promo_months || null : null,
    min_term_months: d.min_term_months,
    attributes: collectAttributes(d, "oattr_"),
    notes: d.notes,
  };
}

function bonusRow(energy, b = {}) {
  const type = b.type || "switch";
  const after = b.paid_after_months ?? (energy ? BONUS_TYPES[type].energyAfter ?? BONUS_TYPES[type].after : BONUS_TYPES[type].after);
  return `<div class="bonus-row">
    <select class="input" data-f="type" aria-label="Art des Bonus">${Object.entries(BONUS_TYPES)
      .map(([k, v]) => `<option value="${k}" ${k === type ? "selected" : ""}>${v.label}</option>`)
      .join("")}</select>
    <div class="input-group"><input class="input" type="number" step="0.01" min="0" data-f="amount" value="${esc(b.amount ?? "")}" placeholder="Betrag" inputmode="decimal" aria-label="Betrag"/><span class="addon">€</span></div>
    <div class="input-group"><span class="addon addon-l">ausgezahlt nach</span><input class="input" type="number" min="0" max="60" data-f="after" value="${after}" aria-label="Auszahlung nach Monaten"/><span class="addon">Mon.</span></div>
    <button type="button" class="btn btn-ghost btn-icon btn-danger" data-rm-bonus aria-label="Bonus entfernen">${icon("x")}</button>
  </div>`;
}

/** Offer form; used inline for new offers and in the edit modal. */
function quickForm(c, energy, o = null, id = "offer-form") {
  const keyFields = (category(c.category).fields || []).filter(
    (f) => !["meter_number", "market_location", "phone_number", "device", "router", "price_guarantee_until", "installment", "license_plate", "vehicle", "base_price_month", "unit_price_ct", "consumption_kwh"].includes(f.key),
  );
  const v = (k) => esc(o?.[k] ?? "");
  const bonuses = o ? o.bonuses?.length ? o.bonuses : o.bonus ? [{ type: "instant", amount: o.bonus, paid_after_months: 0 }] : [] : [];
  const hasPromo = o?.promo_price != null;
  return `
    <form id="${id}">
      <div class="form-grid">
        <label class="field"><span>Anbieter</span><input name="provider" value="${v("provider")}" placeholder="z. B. Freenet" /></label>
        <label class="field"><span>Tarif</span><input name="name" value="${v("name")}" placeholder="z. B. Allnet 50 GB" /></label>
        ${
          energy
            ? `<label class="field"><span>Grundpreis</span><div class="input-group"><input type="number" step="any" name="base_price_month" value="${v("base_price_month")}" inputmode="decimal"/><span class="addon">€/Monat</span></div></label>
               <label class="field"><span>Arbeitspreis</span><div class="input-group"><input type="number" step="any" name="unit_price_ct" value="${v("unit_price_ct")}" inputmode="decimal"/><span class="addon">ct/kWh</span></div></label>`
            : `<label class="field"><span>Preis pro Monat</span><div class="input-group"><input type="number" step="0.01" name="monthly_price" value="${v("monthly_price")}" inputmode="decimal" required/><span class="addon">€</span></div></label>`
        }
        <label class="field"><span>Einmalkosten</span><div class="input-group"><input type="number" step="0.01" name="one_time_costs" value="${o?.one_time_costs || ""}" placeholder="0" inputmode="decimal"/><span class="addon">€</span></div></label>
        <label class="field"><span>Mindestlaufzeit</span><div class="input-group"><input type="number" name="min_term_months" value="${v("min_term_months")}" placeholder="${c.min_term_months ?? 12}"/><span class="addon">Monate</span></div></label>
      </div>

      <div class="bonus-box">
        <div class="bonus-head"><span class="field-label">${icon("piggy", "inline")} Wechselboni & Aktionen</span>
          <span class="small muted">Boni zählen im Monat ihrer Auszahlung – nur innerhalb des Vergleichszeitraums.</span></div>
        <div class="bonus-rows">${bonuses.map((b) => bonusRow(energy, b)).join("")}</div>
        <div class="promo-row ${hasPromo ? "" : "hidden"}">
          <span class="field-label">Aktionspreis</span>
          <div class="input-group"><input class="input" type="number" step="0.01" min="0" name="promo_price" value="${v("promo_price")}" placeholder="z. B. 9,99" inputmode="decimal"/><span class="addon">€/Monat</span></div>
          <div class="input-group"><span class="addon addon-l">für die ersten</span><input class="input" type="number" min="1" max="60" name="promo_months" value="${o?.promo_months ?? 6}"/><span class="addon">Mon.</span></div>
          <button type="button" class="btn btn-ghost btn-icon btn-danger" data-rm-promo aria-label="Aktionspreis entfernen">${icon("x")}</button>
        </div>
        <div class="chips">
          <button type="button" class="chip" data-add-bonus="switch">${icon("plus", "inline")} Wechselbonus</button>
          <button type="button" class="chip" data-add-bonus="${energy ? "new_customer" : "number_porting"}">${icon("plus", "inline")} ${energy ? "Neukundenbonus" : "Rufnummernmitnahme"}</button>
          <button type="button" class="chip" data-add-bonus="cashback">${icon("plus", "inline")} Cashback / Prämie</button>
          <button type="button" class="chip ${hasPromo ? "hidden" : ""}" data-add-promo>${icon("plus", "inline")} Aktionspreis</button>
        </div>
      </div>
      ${
        keyFields.length
          ? `<details class="more" style="margin-top:14px"><summary>${icon("list")} Leistungen des Angebots <span class="muted small" style="font-weight:500">– optional, für den Leistungsvergleich</span>${icon("chevDown", "chev")}</summary>
              <div class="body"><div class="form-grid">${attributeInputs(c.category, o?.attributes || {}, "oattr_", keyFields)}</div></div></details>`
          : ""
      }
      ${energy && !c.attributes?.consumption_kwh ? `<p class="small muted">Hinweis: Hinterlege beim Vertrag deinen Jahresverbrauch, damit Arbeitspreise verglichen werden können.</p>` : ""}
      ${o ? "" : `<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" type="submit">${icon("plus")} Angebot vergleichen</button></div>`}
    </form>`;
}

function bindOfferForm(form, energy) {
  form.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add-bonus]");
    if (add) {
      form.querySelector(".bonus-rows").insertAdjacentHTML("beforeend", bonusRow(energy, { type: add.dataset.addBonus }));
      form.querySelector(".bonus-row:last-child [data-f=amount]").focus();
    }
    e.target.closest("[data-rm-bonus]")?.closest(".bonus-row").remove();
    if (e.target.closest("[data-add-promo]")) {
      form.querySelector(".promo-row").classList.remove("hidden");
      form.querySelector("[data-add-promo]").classList.add("hidden");
      form.querySelector("[name=promo_price]").focus();
    }
    if (e.target.closest("[data-rm-promo]")) {
      form.querySelector(".promo-row").classList.add("hidden");
      form.querySelector("[data-add-promo]").classList.remove("hidden");
    }
  });
  // Changing the bonus type adapts the typical payout month.
  form.addEventListener("change", (e) => {
    if (e.target.dataset.f !== "type") return;
    const t = BONUS_TYPES[e.target.value];
    e.target.closest(".bonus-row").querySelector("[data-f=after]").value = energy ? t.energyAfter ?? t.after : t.after;
  });
}

function editOfferModal(c, o, energy, done) {
  const m = modal({
    title: "Angebot bearbeiten",
    wide: true,
    body: quickForm(c, energy, o, "edit-offer-form"),
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon("check")} Speichern</button>`,
  });
  const form = $("#edit-offer-form", m);
  bindOfferForm(form, energy);
  $("[data-save]", m).addEventListener("click", async (e) => {
    const payload = readOfferForm(form);
    if (!payload) return;
    busy(e.currentTarget);
    try {
      await api.updateOffer(c.id, o.id, payload);
      m.close();
      toast("Angebot aktualisiert");
      done();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
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
    ${c.share_percent != null && c.share_percent !== 100 ? `<p class="small muted" style="margin:0">Verglichen werden die vollen Preise – dein Anteil sind ${c.share_percent} %.</p>` : ""}
    ${c.extras_12m ? `<p class="small muted" style="margin:0">Zusatzkosten (z. B. Ausland) sind im Vergleich nicht eingerechnet – prüfe, ob das neue Angebot sie abdeckt.</p>` : ""}
  </div>`;
}

function offerCard(o, r, isBest) {
  const v = VERDICT[r.verdict];
  const bonuses = o.bonuses?.length ? o.bonuses : o.bonus ? [{ type: "instant", amount: o.bonus, paid_after_months: 0 }] : [];
  const promo = r.promo_price != null && r.promo_months;
  const withoutDiff = r.savings_total_without_bonus;
  return `<div class="card offer-card ${isBest ? "best" : ""}">
    ${isBest ? `<span class="ribbon badge good">${icon("sparkles")} Bestes Angebot</span>` : ""}
    <div style="display:flex;justify-content:space-between;gap:4px">
      <div style="min-width:0"><h3>${esc(o.name)}</h3><div class="small muted">${esc(o.provider || "")}</div></div>
      <div style="display:flex;flex:none">
        <button class="btn btn-ghost btn-sm" data-edit-offer="${o.id}" aria-label="Bearbeiten">${icon("edit")}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-del-offer="${o.id}" aria-label="Entfernen">${icon("trash")}</button>
      </div>
    </div>
    <div>
      ${
        promo
          ? `<span class="big num">${money(r.promo_price)}</span> <span class="muted small">/ Monat für ${r.promo_months} Mon.</span>
             <div class="small muted">danach ${money(r.monthly)} <span class="${r.monthly_diff >= 0 ? "better" : "worse"}" style="font-weight:650">(${r.monthly_diff >= 0 ? "−" : "+"}${money(Math.abs(r.monthly_diff))})</span></div>`
          : `<span class="big num">${money(r.monthly)}</span> <span class="muted small">/ Monat</span>
             <span class="small ${r.monthly_diff >= 0 ? "better" : "worse"}" style="font-weight:650">${r.monthly_diff >= 0 ? "−" : "+"}${money(Math.abs(r.monthly_diff))}</span>`
      }
    </div>
    <dl>
      ${o.one_time_costs ? `<dt>Einmalkosten</dt><dd class="num">${money(o.one_time_costs)}</dd>` : ""}
      ${bonuses
        .map((b) => {
          const outside = b.paid_after_months >= r.horizon_months;
          const counted = r.bonus_counted && !outside;
          return `<dt>${esc(bonusLabel(b.type))} <span class="small">(${monthsText(b.paid_after_months)})</span></dt>
            <dd class="num ${counted ? "better" : "muted"}" ${counted ? "" : 'style="text-decoration:line-through"'} title="${
              outside ? "Wird erst nach dem Vergleichszeitraum ausgezahlt" : counted ? "" : "Nicht eingerechnet"
            }">−${money(b.amount)}</dd>`;
        })
        .join("")}
      <dt>${r.horizon_months} Monate gesamt</dt><dd class="num">${money(r.offer_total)}</dd>
      <dt>Effektiv pro Monat</dt><dd class="num">${money(r.effective_monthly)}</dd>
      ${o.min_term_months != null ? `<dt>Laufzeit</dt><dd>${o.min_term_months ? o.min_term_months + " Monate" : "monatlich kündbar"}</dd>` : ""}
      ${r.break_even_month != null && r.break_even_month > 1 ? `<dt>Rechnet sich ab</dt><dd>Monat ${r.break_even_month}</dd>` : ""}
    </dl>
    ${
      r.bonus_outside_horizon
        ? `<p class="small muted" style="margin:0">${icon("info", "inline")} ${money(r.bonus_outside_horizon)} Bonus werden erst nach ${r.horizon_months} Monaten ausgezahlt und sind nicht eingerechnet.</p>`
        : ""
    }
    <div class="savings ${v.cls}">
      <div class="small" style="font-weight:650">${icon(v.icon)} ${v.label}</div>
      <div class="amount num">${r.savings_total >= 0 ? "" : "−"}${money(Math.abs(r.savings_total))}</div>
      <div class="small">${r.savings_total >= 0 ? "Ersparnis" : "Mehrkosten"} in ${r.horizon_months} Monaten · ${money(Math.abs(r.savings_year))}/Jahr</div>
      ${
        r.bonus_counted && r.bonus_in_horizon
          ? `<div class="small" style="margin-top:4px;opacity:.85">ohne Boni: ${withoutDiff >= 0 ? "" : "−"}${money(Math.abs(withoutDiff))} ${withoutDiff >= 0 ? "Ersparnis" : "Mehrkosten"}</div>`
          : ""
      }
    </div>
    ${
      r.bonus_dependent || (r.bonus_counted && r.advantage_ends_month)
        ? `<div class="callout warn small" style="padding:10px 12px">${icon("alert")}<div>${
            r.bonus_dependent ? "<b>Lohnt sich nur durch Bonus/Aktion.</b> " : ""
          }${
            r.advantage_ends_month
              ? `Der Vorteil ist nach <b>${r.advantage_ends_month} Monaten</b> aufgebraucht – davor wieder vergleichen bzw. kündigen.`
              : "Nach der Bonusphase ist der Tarif teurer als dein aktueller."
          }</div></div>`
        : ""
    }
    ${r.verdict !== "not_worth_it" ? `<button class="btn btn-block" data-switch="${o.id}">${icon("swap")} Zu diesem Angebot wechseln</button>` : ""}
  </div>`;
}

function compareTable(c, fields, offers) {
  const rows = fields
    .map((f) => {
      const cur = c.attributes?.[f.key];
      // Energy tariffs live on the offer itself, not in its attributes.
      const vals = offers.map((o) => o.attributes?.[f.key] ?? (["base_price_month", "unit_price_ct"].includes(f.key) ? o[f.key] : undefined));
      if ([cur, ...vals].every((v) => v === undefined || v === null || v === "")) return "";
      const lowerBetter = /deductible|waiting|price/.test(f.key);
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
      ${
        offer.bonuses?.length || offer.bonus || offer.promo_price != null
          ? `<div class="callout good" style="margin-top:14px">${icon("piggy")}<div>Boni werden im Auszahlungsmonat als Gutschrift eingetragen${
              offer.promo_price != null ? ", der Aktionspreis bis zum Ende der Aktion" : ""
            }. Du bekommst Erinnerungen, um die Auszahlung zu prüfen${offer.promo_price != null ? " und vor Ende des Aktionspreises neu zu vergleichen" : ""}.</div></div>`
          : ""
      }
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
