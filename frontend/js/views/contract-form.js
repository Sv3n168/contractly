// Create / edit a contract. Designed for minimal typing: category tile → name, price, start.
// Everything else has sensible defaults and lives behind "Weitere Details".

import { api } from "../api.js";
import { catColorVar, category, catIcon, isEnergy, state } from "../store.js";
import { $, $$, busy, esc, formData, icon, today, toast } from "../ui.js";
import { bindIconPicker, iconPicker } from "./components.js";
import { applySuggestionsToForm } from "./ocr.js";

const form_q = (root, sel) => root.querySelector(sel);

export function attributeInputs(cat, values = {}, prefix = "attr_", fields = null) {
  return (fields || category(cat).fields || [])
    .map((f) => {
      const v = values?.[f.key];
      const name = prefix + f.key;
      if (f.type === "bool")
        return `<label class="check" style="align-self:end;min-height:42px"><input type="checkbox" name="${name}" ${v ? "checked" : ""}/> ${esc(f.label)}</label>`;
      if (f.type === "select")
        return `<label class="field"><span>${esc(f.label)}</span><select name="${name}"><option value="">–</option>
          ${f.options.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
      const type = f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
      const input = `<input type="${type}" name="${name}" ${type === "number" ? 'step="any" inputmode="decimal"' : ""}
        value="${esc(v ?? "")}" placeholder="${esc(f.placeholder || "")}" />`;
      return `<label class="field"><span>${esc(f.label)}</span>${
        f.unit ? `<div class="input-group">${input}<span class="addon">${esc(f.unit)}</span></div>` : input
      }</label>`;
    })
    .join("");
}

export function collectAttributes(data, prefix = "attr_") {
  const attrs = {};
  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith(prefix)) continue;
    if (v === null || v === "" || v === false) continue;
    attrs[k.slice(prefix.length)] = v;
  }
  return attrs;
}

export async function renderContractForm(view, id, query = {}) {
  const editing = id ? await api.contract(id) : null;
  const predecessor = query.predecessor ? await api.contract(Number(query.predecessor)) : null;
  let cat = editing?.category || query.category || predecessor?.category || null;
  const attachments = []; // documents analyzed before the contract exists

  const header = editing
    ? `<a class="back-link" href="#/contracts/${id}">${icon("back")} Zurück</a><h1>Vertrag bearbeiten</h1>`
    : `<a class="back-link" href="${predecessor ? `#/contracts/${predecessor.id}` : "#/contracts"}">${icon("back")} Zurück</a>
       <h1>${predecessor ? "Nachfolgevertrag anlegen" : "Neuer Vertrag"}</h1>
       <p>${
         predecessor
           ? `Ersetzt <b>${esc(predecessor.name)}</b> – der Kostenverlauf läuft nahtlos weiter.`
           : "Nur drei Angaben sind Pflicht. Den Rest kannst du jederzeit ergänzen."
       }</p>`;

  const drawCategoryStep = () => {
    view.innerHTML = `
      <div class="page-head"><div>${header}</div></div>
      <div class="wizard-steps"><div class="step active"><span class="n">1</span>Kategorie</div><div class="line"></div>
        <div class="step"><span class="n">2</span>Eckdaten</div></div>
      <div class="card" style="margin-bottom:20px">
        <div class="card-head"><div><h2>Was für ein Vertrag?</h2><p>Wähle eine Kategorie – passende Felder und Fristen werden vorbelegt.</p></div></div>
        <div class="cat-picker">
          ${state.meta.categories
            .map((c) => `<button class="cat-tile" data-cat="${c.key}"><span class="emoji">${c.icon}</span>${esc(c.label)}</button>`)
            .join("")}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>${icon("sparkles")} Schneller: Vertrag hochladen</h2>
          <p>PDF oder Foto vom Vertrag – Kundennummer, Anbieter, Preise & Co. werden automatisch erkannt.</p></div></div>
        <label class="dropzone" id="drop">${icon("scan")}<b>Datei auswählen oder hierher ziehen</b>
          <span class="muted small">PDF, JPG, PNG · wird dem Vertrag angehängt</span>
          <input type="file" accept=".pdf,image/*" hidden /></label>
        <label class="btn btn-block camera-only" style="margin-top:10px">${icon("scan")} Vertrag mit der Kamera fotografieren
          <input type="file" accept="image/*" capture="environment" hidden data-camera /></label>
        <div id="ocr-status" style="margin-top:12px"></div>
      </div>`;
    $$(".cat-tile", view).forEach((b) =>
      b.addEventListener("click", () => {
        cat = b.dataset.cat;
        drawForm();
      }),
    );
    setupDrop(view, async (file) => {
      const status = $("#ocr-status", view);
      status.innerHTML = `<div class="callout"><span class="spinner"></span><div>Analysiere <b>${esc(file.name)}</b> … das kann bei Scans ein paar Sekunden dauern.</div></div>`;
      try {
        const res = await api.analyzeDocument(file);
        attachments.push({ id: res.document_id, name: res.original_name });
        if (res.error) {
          status.innerHTML = `<div class="callout warn">${icon("alert")}<div>Text konnte nicht gelesen werden (${esc(res.error)}). Die Datei wird trotzdem angehängt – wähle jetzt eine Kategorie.</div></div>`;
          return;
        }
        const guessed = guessCategory(res.text);
        status.innerHTML = `<div class="callout good">${icon("check")}<div>${res.suggestions.length} Angaben erkannt${
          guessed ? ` – sieht nach <b>${esc(category(guessed).label)}</b> aus` : ""
        }. ${guessed ? "" : "Wähle oben die Kategorie."}</div></div>`;
        pendingSuggestions = res.suggestions;
        if (guessed) {
          cat = guessed;
          drawForm();
        }
      } catch (err) {
        status.innerHTML = `<div class="callout bad">${icon("alert")}<div>${esc(err.message)}</div></div>`;
      }
    });
  };

  let pendingSuggestions = null;

  const drawForm = () => {
    const c = category(cat);
    const d = c.defaults || {};
    const src = editing || {};
    const pred = predecessor || {};
    const priceInterval = cat === "car_insurance" || cat === "legal_protection" || cat === "liability" || cat === "household" ? "yearly" : "monthly";
    view.innerHTML = `
      <div class="page-head"><div>${header}</div></div>
      ${
        editing
          ? ""
          : `<div class="wizard-steps"><div class="step done"><span class="n">${icon("check")}</span>Kategorie</div><div class="line"></div>
             <div class="step active"><span class="n">2</span>Eckdaten</div></div>`
      }
      <form id="form" class="stack" novalidate>
        <div class="card">
          <div class="card-head">
            <div style="display:flex;gap:14px;align-items:center">
              ${iconPicker(src.icon || "", catIcon(cat), catColorVar(cat))}
              <div><h2>${esc(c.label)}</h2><p>Das Wichtigste · Symbol antippen zum Ändern</p></div>
            </div>
            ${editing ? "" : `<button type="button" class="btn btn-sm btn-ghost" id="change-cat">Kategorie ändern</button>`}
          </div>
          <div class="form-grid">
            <label class="field span-2"><span>Anbieter</span>
              <input name="provider" value="${esc(src.provider ?? "")}" placeholder="z. B. Telekom, FitX, HUK" list="providers" autocomplete="off" /></label>
            <label class="field span-2"><span>Bezeichnung / Tarif</span>
              <input name="name" value="${esc(src.name ?? "")}" placeholder="${esc(c.label)}${c.key === "mobile" ? " – z. B. MagentaMobil M" : ""}" /></label>
            ${
              editing
                ? ""
                : `<label class="field input-big"><span>Preis</span><div class="input-group">
                    <input name="price_amount" type="number" step="0.01" inputmode="decimal" placeholder="0,00" required />
                    <span class="addon">€</span></div></label>
                  <label class="field"><span>Zahlweise</span><select name="price_interval">
                    ${Object.entries(state.meta.intervals)
                      .filter(([k]) => k !== "once")
                      .map(([k, v]) => `<option value="${k}" ${k === priceInterval ? "selected" : ""}>${v.label}</option>`)
                      .join("")}</select></label>`
            }
            <label class="field"><span>Vertragsbeginn</span>
              <input name="start_date" type="date" value="${esc(src.start_date || query.start || today())}" required /></label>
          </div>
          <div id="dup-hint"></div>
          ${
            editing
              ? ""
              : `<label class="check small" style="margin-top:14px"><input type="checkbox" name="withdrawal" checked/>
                  Gerade erst abgeschlossen? An die 14-tägige Widerrufsfrist erinnern</label>
                <label class="check small" style="margin-top:8px"><input type="checkbox" name="already_cancelled" id="already-cancelled"/>
                  Schon gekündigt – der Vertrag endet zu einem festen Datum</label>
                <div class="form-grid" id="cancel-fields" hidden style="margin-top:10px">
                  <label class="field"><span>Gekündigt zum</span><input type="date" name="cancel_end"/>
                    <small>Letzter Vertragstag – danach entstehen keine Kosten und keine Verlängerung mehr.</small></label>
                </div>`
          }
          ${
            isEnergy(cat) && !editing
              ? `<div class="callout" style="margin-top:16px">${icon("info")}<div>Bei Strom & Gas trägst du als Preis am einfachsten den <b>monatlichen Abschlag</b> ein. Grund- und Arbeitspreis für den Vergleich findest du unten bei den Eckdaten.</div></div>`
              : ""
          }
        </div>

        ${
          (c.fields || []).length
            ? `<details class="more" ${editing || cat === "loan" ? "open" : ""}>
                <summary>${icon("list")} Leistungen & Eckdaten <span class="muted small" style="font-weight:500">– optional, hilft beim Vergleichen</span>${icon("chevDown", "chev")}</summary>
                <div class="body"><div class="form-grid">${attributeInputs(cat, src.attributes || pred.attributes || {})}</div></div></details>`
            : ""
        }

        <details class="more" ${editing ? "open" : ""}>
          <summary>${icon("clock")} Laufzeit, Kündigung & Erinnerung <span class="muted small" style="font-weight:500">– vorbelegt</span>${icon("chevDown", "chev")}</summary>
          <div class="body"><div class="form-grid">
            <label class="field"><span>Mindestlaufzeit</span><div class="input-group">
              <input name="min_term_months" type="number" min="0" value="${esc(src.min_term_months ?? d.min_term_months ?? "")}" /><span class="addon">Monate</span></div></label>
            <label class="field"><span>Verlängerung danach um</span><div class="input-group">
              <input name="renewal_months" type="number" min="0" value="${esc(src.renewal_months ?? d.renewal_months ?? 1)}" /><span class="addon">Monate</span></div></label>
            <label class="field"><span>Kündigungsfrist</span><div class="input-group">
              <input name="notice_value" type="number" min="0" value="${esc(src.notice_value ?? d.notice_value ?? 1)}" style="border-radius:var(--radius-sm) 0 0 var(--radius-sm)" />
              <select name="notice_unit" style="width:auto;border-radius:0 var(--radius-sm) var(--radius-sm) 0;border-left:0">
                ${[["days", "Tage"], ["weeks", "Wochen"], ["months", "Monate"]]
                  .map(([k, l]) => `<option value="${k}" ${(src.notice_unit || d.notice_unit || "months") === k ? "selected" : ""}>${l}</option>`)
                  .join("")}
              </select></div></label>
            <label class="field"><span>Erinnern vor Frist</span><div class="input-group">
              <input name="reminder_days" type="number" min="0" value="${esc(editing ? src.reminder_days ?? "" : 30)}" placeholder="aus" /><span class="addon">Tage</span></div>
              <small>Leer lassen = keine Erinnerung</small></label>
            ${
              editing
                ? `<label class="field"><span>Vertragsende</span><input name="end_date" type="date" value="${esc(src.end_date ?? "")}" />
                   <small>Nur bei Kündigung/Ende</small></label>`
                : ""
            }
          </div></div>
        </details>

        <details class="more" ${editing ? "open" : ""}>
          <summary>${icon("file")} Nummern, Kostenanteil & Notizen${icon("chevDown", "chev")}</summary>
          <div class="body"><div class="form-grid">
            <div class="field share-field">
              <span>Mein Anteil</span>
              <div class="segmented" id="share-mode" role="group" aria-label="Anteil als">
                <button type="button" data-mode="percent" class="${src.partner_amount ? "" : "active"}">Prozent</button>
                <button type="button" data-mode="amount" class="${src.partner_amount ? "active" : ""}">Fester Betrag</button>
              </div>
              <div class="input-group" data-share="percent" ${src.partner_amount ? "hidden" : ""}>
                <input name="share_percent" type="number" min="0" max="100" value="${esc(src.share_percent ?? 100)}" ${src.partner_amount ? "disabled" : ""}/><span class="addon">%</span></div>
              <div class="input-group" data-share="amount" ${src.partner_amount ? "" : "hidden"}>
                <input name="partner_amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="z. B. 20" value="${esc(src.partner_amount ?? "")}" ${src.partner_amount ? "" : "disabled"}/><span class="addon">€ / Monat</span></div>
              <small data-share="percent" ${src.partner_amount ? "hidden" : ""}>z. B. 50, wenn Partner:in die Hälfte zahlt</small>
              <small data-share="amount" ${src.partner_amount ? "" : "hidden"}>So viel übernimmt Partner:in jeden Monat – der Rest zählt als deine Kosten, auch wenn der Preis steigt.</small>
            </div>
            <label class="check" style="align-self:center"><input type="checkbox" name="tax_relevant" ${
              (src.tax_relevant ?? category(cat).tax_default) ? "checked" : ""
            }/> Steuerlich relevant</label>
            <label class="field"><span>Kundennummer</span><input name="customer_number" value="${esc(src.customer_number ?? pred.customer_number ?? "")}" /></label>
            <label class="field"><span>Vertragsnummer</span><input name="contract_number" value="${esc(src.contract_number ?? "")}" /></label>
            <label class="field span-2"><span>Anschrift des Anbieters <span class="muted">(für Kündigungsschreiben)</span></span>
              <textarea name="provider_address" rows="3" placeholder="Firma&#10;Straße Nr.&#10;PLZ Ort">${esc(src.provider_address ?? "")}</textarea></label>
            <label class="field span-all"><span>Notizen</span><textarea name="notes" rows="3">${esc(src.notes ?? "")}</textarea></label>
          </div></div>
        </details>

        ${
          attachments.length
            ? `<div class="callout">${icon("paperclip")}<div>Wird angehängt: ${attachments.map((a) => `<b>${esc(a.name)}</b>`).join(", ")}</div></div>`
            : ""
        }

        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
          <a class="btn" href="${editing ? `#/contracts/${id}` : "#/contracts"}">Abbrechen</a>
          <button class="btn btn-primary" type="submit" id="save">${icon("check")} ${editing ? "Speichern" : "Vertrag anlegen"}</button>
        </div>
      </form>
      <datalist id="providers"></datalist>`;

    $("#change-cat", view)?.addEventListener("click", drawCategoryStep);
    fillProviderList();
    if (!editing && !predecessor) {
      // Gentle hint when the same contract seems to exist already.
      const providerInput = form_q(view, "[name=provider]");
      providerInput.addEventListener("change", async () => {
        const p = providerInput.value.trim().toLowerCase();
        const hint = $("#dup-hint", view);
        if (!p) return (hint.innerHTML = "");
        const list = await api.contracts({ include_ended: false });
        const dup = list.find((c) => c.category === cat && (c.provider || "").toLowerCase() === p);
        hint.innerHTML = dup
          ? `<div class="callout warn" style="margin-top:14px">${icon("info")}<div>Du hast schon <a href="#/contracts/${dup.id}">${esc(dup.name)}</a> bei ${esc(dup.provider)}.
              Neuer Tarif beim selben Anbieter? Dann besser dort „Durch neuen Vertrag ersetzen“ – so bleibt der Kostenverlauf durchgehend.</div></div>`
          : "";
      });
    }
    const form = $("#form", view);
    bindIconPicker(form);
    bindAlreadyCancelled(form);
    bindShareMode(form);
    if (pendingSuggestions?.length) {
      applySuggestionsToForm(form, pendingSuggestions);
      toast("Erkannte Daten übernommen – bitte kurz prüfen");
      pendingSuggestions = null;
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = formData(form);
      const payload = {
        // without an own name the contract is called like its provider; the category shows anyway
        name: data.name || data.provider || category(cat).label,
        category: cat,
        icon: data.icon || null,
        provider: data.provider,
        provider_address: data.provider_address,
        customer_number: data.customer_number,
        contract_number: data.contract_number,
        start_date: data.start_date || today(),
        min_term_months: data.min_term_months,
        renewal_months: data.renewal_months,
        notice_value: data.notice_value,
        notice_unit: data.notice_unit || "months",
        reminder_days: data.reminder_days,
        notes: data.notes,
        attributes: { ...(editing?.attributes || {}), ...collectAttributes(data) },
        share_percent: data.share_percent == null || data.share_percent === 100 ? null : data.share_percent,
        partner_amount: data.partner_amount || null,
        tax_relevant: data.tax_relevant === category(cat).tax_default ? null : data.tax_relevant,
        // keep values that this form doesn't edit
        cancellation_confirmed_on: editing?.cancellation_confirmed_on ?? null,
        last_checked_on: editing?.last_checked_on ?? null,
        withdrawal_until: editing
          ? editing.withdrawal_until
          : // only for contracts signed just now (an old contract has no withdrawal period left)
            data.withdrawal && (data.start_date || today()) >= new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
            ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
            : null,
      };
      // Unchecked/emptied attributes must be removable when editing.
      if (editing) {
        for (const f of category(cat).fields || []) if (!(f.key in collectAttributes(data))) delete payload.attributes[f.key];
      }
      const btn = $("#save", view);
      busy(btn);
      try {
        let result;
        if (editing) {
          payload.end_date = data.end_date;
          payload.cancelled_on = data.end_date ? editing.cancelled_on || today() : null;
          payload.predecessor_id = editing.predecessor_id;
          result = await api.updateContract(id, payload);
          toast("Gespeichert");
        } else {
          if (data.price_amount === null || isNaN(data.price_amount)) {
            busy(btn, false);
            form.querySelector("[name=price_amount]").focus();
            toast("Bitte einen Preis angeben", "error");
            return;
          }
          payload.initial_price = {
            valid_from: payload.start_date,
            amount: data.price_amount,
            interval: data.price_interval || "monthly",
            details: energyDetails(payload.attributes),
          };
          if (data.already_cancelled) {
            if (!data.cancel_end || data.cancel_end < payload.start_date) {
              busy(btn, false);
              form.querySelector("[name=cancel_end]").focus();
              toast("Bitte das Vertragsende angeben (nicht vor dem Beginn)", "error");
              return;
            }
            payload.end_date = data.cancel_end;
            payload.cancelled_on = data.cancel_end < today() ? data.cancel_end : today();
          }
          if (predecessor) payload.predecessor_id = predecessor.id;
          payload.document_ids = attachments.map((a) => a.id);
          result = await api.createContract(payload);
          toast(predecessor ? "Nachfolger angelegt – Verlauf läuft weiter 📈" : "Vertrag angelegt 🎉");
        }
        location.hash = `#/contracts/${result.id}`;
      } catch (err) {
        busy(btn, false);
        toast(err.message, "error");
      }
    });
  };

  if (query.document) {
    // From "Post & Mails": an already stored letter/e-mail for a contract that isn't recorded yet.
    try {
      const res = await api.extractDocument(Number(query.document));
      attachments.push({ id: res.document_id, name: "Schreiben" });
      pendingSuggestions = res.suggestions;
      cat ||= guessCategory(res.text);
    } catch {
      /* continue without prefill */
    }
  }
  if (cat) drawForm();
  else drawCategoryStep();
}

function energyDetails(attrs) {
  const d = {};
  if (attrs.base_price_month != null) d.base_price_month = attrs.base_price_month;
  if (attrs.unit_price_ct != null) d.unit_price_ct = attrs.unit_price_ct;
  return d;
}

async function fillProviderList() {
  try {
    const list = await api.contracts();
    const names = [...new Set(list.map((c) => c.provider).filter(Boolean))];
    const dl = document.getElementById("providers");
    if (dl) dl.innerHTML = names.map((n) => `<option value="${esc(n)}">`).join("");
  } catch {
    /* optional */
  }
}

export function setupDrop(root, onFile) {
  const drop = $("#drop", root) || $(".dropzone", root);
  const input = $("input[type=file]", drop);
  input.addEventListener("change", () => input.files[0] && onFile(input.files[0]));
  const camera = root.querySelector("[data-camera]");
  camera?.addEventListener("change", () => camera.files[0] && onFile(camera.files[0]));
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
    }),
  );
  drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]));
}

const CATEGORY_HINTS = [
  ["electricity", /strom|kwh.*strom|stromliefer|ökostrom/i],
  ["gas", /erdgas|gasliefer|\bgas\b/i],
  ["mobile", /mobilfunk|datenvolumen|sim-karte|\bLTE\b|5G|handy/i],
  ["internet", /dsl|glasfaser|internet|kabelanschluss|festnetz|mbit/i],
  ["car_insurance", /kfz|kraftfahrzeug|teilkasko|vollkasko|schadenfreiheit/i],
  ["legal_protection", /rechtsschutz/i],
  ["liability", /haftpflicht/i],
  ["household", /hausrat/i],
  ["fitness", /fitness|studio|mitgliedschaft|urban sports|sportnavi|wellpass/i],
  ["streaming", /netflix|spotify|disney|streaming|prime video|dazn|sky/i],
];
function guessCategory(text) {
  const hit = CATEGORY_HINTS.find(([, re]) => re.test(text || ""));
  return hit ? hit[0] : null;
}

function addMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** End of the term a contract signed on `start` is in today: minimum term, then renewals. */
export function suggestedEnd(start, minTerm, renewal) {
  const min = Number(minTerm) || 0;
  const step = Number(renewal) || 1;
  if (!start) return null;
  let months = min || step;
  let end = addDays(addMonths(start, months), -1);
  while (end < today() && months < 1200) {
    months += step;
    end = addDays(addMonths(start, months), -1);
  }
  return end;
}

/** "Schon gekündigt": show the end date, prefilled with the end of the current term. */
function bindAlreadyCancelled(form) {
  const box = form.querySelector("#already-cancelled");
  if (!box) return;
  const fields = form.querySelector("#cancel-fields");
  const end = form.querySelector("[name=cancel_end]");
  box.addEventListener("change", () => {
    fields.hidden = !box.checked;
    if (box.checked && !end.value) {
      const v = (name) => form.querySelector(`[name=${name}]`)?.value;
      end.value = suggestedEnd(v("start_date"), v("min_term_months"), v("renewal_months")) || "";
    }
  });
}

/** "Mein Anteil" as a percentage or as the fixed amount the partner pays. */
function bindShareMode(form) {
  const group = form.querySelector("#share-mode");
  if (!group) return;
  group.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    group.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    form.querySelectorAll("[data-share]").forEach((el) => {
      const on = el.dataset.share === b.dataset.mode;
      el.hidden = !on;
      el.querySelectorAll("input").forEach((i) => (i.disabled = !on));
    });
    form.querySelector(`[data-share="${b.dataset.mode}"] input`)?.focus();
  });
}

