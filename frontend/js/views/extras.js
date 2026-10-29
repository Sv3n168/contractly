// Additional charges for a single month (calls abroad, roaming, extra data …).
// Stored as one-time price entries with details.kind = "extra"; the base price stays untouched,
// so the following month automatically falls back to the regular price.

import { api } from "../api.js";
import { bindDelete } from "./contract-detail.js";
import { $, busy, esc, icon, modal, money, signedMoney, toast, today } from "../ui.js";

const PRESETS = {
  mobile: ["Auslandstelefonate", "Roaming", "Zusatz-Datenvolumen", "Sonderrufnummern", "Drittanbieter"],
  internet: ["Auslandstelefonate", "Sonderrufnummern", "Technikereinsatz", "Pay-TV / Abruf"],
  electricity: ["Nachzahlung Jahresabrechnung", "Mahngebühr"],
  gas: ["Nachzahlung Jahresabrechnung", "Mahngebühr"],
  streaming: ["Leihfilm / Kauf", "Zusatzmitglied"],
  fitness: ["Getränke / Shop", "Kurs", "Personal Training"],
  education: ["Prüfungsgebühr", "Lernmaterial", "Semesterbeitrag", "Exkursion"],
};
const DEFAULT_PRESETS = ["Zusatzleistung", "Mahngebühr", "Nachzahlung"];

export const isExtra = (p) => p.interval === "once" && p.details?.kind === "extra";

/** Monthly equivalent of the regular price that applies in month "YYYY-MM". */
export function basePriceAt(c, ym) {
  const day = `${ym}-15`;
  const recurring = c.prices.filter((p) => p.interval !== "once").sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  let cur = null;
  for (const p of recurring) if (p.valid_from <= day) cur = p;
  return (cur || recurring[0])?.monthly_equivalent ?? 0;
}

export function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

export function extraModal(c, existing, done) {
  const p = existing || {};
  const thisMonth = today().slice(0, 7);
  const ym = (p.valid_from || thisMonth).slice(0, 7);
  const presets = PRESETS[c.category] || DEFAULT_PRESETS;
  let mode = "extra"; // "extra" = Mehrbetrag, "total" = Rechnungsbetrag gesamt

  const m = modal({
    title: p.id ? "Zusatzkosten bearbeiten" : "Zusatzkosten erfassen",
    body: `
      <p class="muted mt-0">Für Monate, in denen die Rechnung höher war als üblich. Der Grundpreis bleibt unverändert,
        im Folgemonat gilt automatisch wieder der normale Preis.</p>
      <form id="xf" class="form-grid">
        <label class="field"><span>Monat</span><input type="month" name="month" value="${ym}" max="${thisMonth}" placeholder="JJJJ-MM" pattern="\\d{4}-\\d{2}" required/></label>
        <div class="field"><span class="field-label">Eingabe als</span>
          <div class="segmented" id="mode"><button type="button" data-m="extra" class="active">Mehrbetrag</button><button type="button" data-m="total">Rechnungsbetrag</button></div></div>
        <label class="field span-all"><span id="amount-label">Mehrbetrag</span><div class="input-group input-big">
          <input type="number" step="0.01" name="amount" value="${esc(p.amount ?? "")}" inputmode="decimal" required/><span class="addon">€</span></div>
          <small id="preview"></small></label>
        <label class="field span-all"><span>Grund</span><input name="note" value="${esc(p.note ?? "")}"/></label>
        <div class="chips span-all" id="presets">${presets.map((t) => `<button type="button" class="chip" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      </form>`,
    foot: `${p.id ? `<button class="btn btn-ghost btn-danger mr-auto" data-del>${icon("trash")} Löschen</button>` : ""}
      <button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon("check")} Speichern</button>`,
  });
  bindDelete(m, c, p, () => done?.());

  const form = $("#xf", m);
  const amountInput = $("[name=amount]", form);
  const compute = () => {
    const month = form.month.value || thisMonth;
    const base = basePriceAt(c, month);
    const value = Number(amountInput.value);
    if (amountInput.value === "" || isNaN(value)) {
      $("#preview", m).textContent = `Regulärer Preis im ${monthLabel(month)}: ${money(base)}`;
      return null;
    }
    const extra = mode === "total" ? Math.round((value - base) * 100) / 100 : value;
    $("#preview", m).innerHTML =
      mode === "total"
        ? `Regulär ${money(base)} → <b>${signedMoney(extra)}</b> ${extra >= 0 ? "Zusatzkosten" : "Gutschrift"}`
        : `Rechnung im ${monthLabel(month)}: <b>${money(base + extra)}</b> (regulär ${money(base)})`;
    return extra;
  };
  $("#mode", m).addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b || b.dataset.m === mode) return;
    const prev = compute();
    mode = b.dataset.m;
    $$mode(m, mode);
    $("#amount-label", m).textContent = mode === "total" ? "Rechnungsbetrag gesamt" : "Mehrbetrag";
    // Convert the entered value so switching modes keeps the meaning.
    if (prev !== null) {
      const base = basePriceAt(c, form.month.value || thisMonth);
      amountInput.value = (mode === "total" ? base + prev : prev).toFixed(2);
    }
    compute();
  });
  form.addEventListener("input", compute);
  $("#presets", m).addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]");
    if (b) form.note.value = b.dataset.t;
  });
  compute();

  $("[data-save]", m).addEventListener("click", async (e) => {
    const extra = compute();
    if (extra === null) return toast("Bitte einen Betrag angeben", "error");
    if (extra === 0) return toast("Kein Unterschied zum regulären Preis", "error");
    const month = form.month.value || thisMonth;
    const keepDay = p.valid_from && p.valid_from.startsWith(month) ? p.valid_from : `${month}-01`;
    const startDay = c.start_date.startsWith(month) ? c.start_date : keepDay;
    const payload = {
      valid_from: startDay > keepDay ? startDay : keepDay,
      amount: extra,
      interval: "once",
      note: form.note.value || "Zusatzkosten",
      details: { kind: "extra" },
    };
    busy(e.currentTarget);
    try {
      if (p.id) await api.updatePrice(c.id, p.id, payload);
      else await api.addPrice(c.id, payload);
      m.close();
      toast(`${signedMoney(extra)} für ${monthLabel(month)} gespeichert`);
      done?.();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

function $$mode(root, mode) {
  root.querySelectorAll("#mode button").forEach((x) => x.classList.toggle("active", x.dataset.m === mode));
}
