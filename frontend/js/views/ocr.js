// Applying OCR suggestions to forms and existing contracts.

import { api } from "../api.js";
import { category, intervalLabel } from "../store.js";
import { $, $$, busy, esc, fmtDate, icon, modal, money, toast } from "../ui.js";

const CONTRACT_FIELDS = ["customer_number", "contract_number", "provider", "provider_address", "start_date"];

function display(s) {
  if (s.key === "price") return `${money(s.value.amount)} ${intervalLabel(s.value.interval)}`;
  if (s.key === "start_date") return fmtDate(s.value);
  return esc(s.value).replace(/\n/g, "<br>");
}

/** Pre-fill a (new) contract form with suggestions; only empty inputs are filled. */
export function applySuggestionsToForm(form, suggestions) {
  const set = (name, value) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el && (el.value === "" || el.type === "date") && value != null) el.value = value;
  };
  for (const s of suggestions) {
    if (s.key === "price") {
      set("price_amount", s.value.amount);
      const sel = form.querySelector('[name="price_interval"]');
      if (sel) sel.value = s.value.interval;
    } else if (CONTRACT_FIELDS.includes(s.key)) set(s.key, s.value);
    else set(`attr_${s.key}`, s.value);
  }
}

/** Modal to review suggestions extracted from a document and apply them to a contract. */
export function suggestionPicker(contract, result, onApplied) {
  const fields = Object.fromEntries((category(contract.category).fields || []).map((f) => [f.key, f]));
  const current = (s) => {
    if (s.key === "price") return contract.current_price ? `${money(contract.current_price.amount)} ${intervalLabel(contract.current_price.interval)}` : "";
    if (CONTRACT_FIELDS.includes(s.key)) return contract[s.key] ?? "";
    return contract.attributes?.[s.key] ?? "";
  };
  const usable = result.suggestions.filter((s) => s.target !== "attribute" || fields[s.key] || s.key === "iban");
  const body = usable.length
    ? `<p class="muted" style="margin-top:0">Wähle aus, was übernommen werden soll. Bestehende Werte werden überschrieben.</p>
       <div class="list">${usable
         .map((s, i) => {
           const cur = current(s);
           const same = String(cur) === String(s.key === "price" ? "" : s.value);
           return `<label class="list-item" style="cursor:pointer;align-items:flex-start">
             <input type="checkbox" data-i="${i}" ${!cur && !same ? "checked" : ""} style="width:18px;height:18px;margin-top:3px;accent-color:var(--primary)" />
             <div class="grow"><div class="sub">${esc(s.label)}</div><div style="font-weight:650">${display(s)}</div>
               ${cur ? `<div class="sub">bisher: ${esc(String(cur)).replace(/\n/g, ", ")}</div>` : ""}
               ${s.source ? `<div class="sub" style="font-style:italic">„${esc(s.source)}“</div>` : ""}</div></label>`;
         })
         .join("")}</div>`
    : `<div class="callout warn">${icon("info")}<div>Im Dokument wurden keine bekannten Angaben gefunden.</div></div>`;
  const m = modal({
    title: "Erkannte Daten",
    wide: true,
    body: `${body}
      <details class="more" style="margin-top:16px"><summary>${icon("file")} Erkannter Text (${result.characters ?? result.text.length} Zeichen)${icon("chevDown", "chev")}</summary>
        <div class="body"><pre style="white-space:pre-wrap;font-size:12px;max-height:300px;overflow:auto;margin:0">${esc(result.text)}</pre></div></details>`,
    foot: `<button class="btn" data-close>Abbrechen</button>${
      usable.length ? `<button class="btn btn-primary" data-apply>${icon("check")} Übernehmen</button>` : ""
    }`,
  });
  $("[data-apply]", m)?.addEventListener("click", async (e) => {
    const chosen = $$("input[data-i]:checked", m).map((el) => usable[Number(el.dataset.i)]);
    if (!chosen.length) return m.close();
    busy(e.currentTarget);
    try {
      const payload = contractPayload(contract);
      let price = null;
      for (const s of chosen) {
        if (s.key === "price") price = s.value;
        else if (CONTRACT_FIELDS.includes(s.key)) payload[s.key] = s.value;
        else payload.attributes[s.key] = s.value;
      }
      await api.updateContract(contract.id, payload);
      if (price) {
        const cur = contract.current_price;
        if (!cur || cur.amount !== price.amount || cur.interval !== price.interval) {
          await api.addPrice(contract.id, {
            valid_from: cur ? new Date().toISOString().slice(0, 10) : contract.start_date,
            amount: price.amount,
            interval: price.interval,
            note: "aus Dokument erkannt",
          });
        }
      }
      m.close();
      toast(`${chosen.length} Angaben übernommen`);
      onApplied?.();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

/** Full PUT payload from a contract detail object. */
export function contractPayload(c) {
  return {
    name: c.name,
    category: c.category,
    provider: c.provider,
    provider_address: c.provider_address,
    customer_number: c.customer_number,
    contract_number: c.contract_number,
    start_date: c.start_date,
    end_date: c.end_date,
    cancelled_on: c.cancelled_on,
    min_term_months: c.min_term_months,
    renewal_months: c.renewal_months,
    notice_value: c.notice_value,
    notice_unit: c.notice_unit,
    reminder_days: c.reminder_days,
    attributes: { ...(c.attributes || {}) },
    notes: c.notes,
    predecessor_id: c.predecessor_id,
    share_percent: c.share_percent,
    cancellation_confirmed_on: c.cancellation_confirmed_on,
    tax_relevant: c.tax_relevant,
    withdrawal_until: c.withdrawal_until,
    last_checked_on: c.last_checked_on,
  };
}
