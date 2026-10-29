// Create / edit a contract. Designed for minimal typing: category tile → name, price, start.
// Everything else has sensible defaults and lives behind "Weitere Details".

import { api } from "../api.js";
import { catColorVar, category, catIcon, isEnergy, state } from "../store.js";
import { $, $$, busy, esc, formData, icon, modal, money, today, toast } from "../ui.js";
import { plausibilityIssues } from "../plausibility.js";
import { PERIOD_FIELDS, bindIconPicker, iconPicker, periodPriceInput, readPeriodPrice } from "./components.js";
import { applySuggestionsToForm } from "./ocr.js";

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
      if (f.key in PERIOD_FIELDS)
        return `<label class="field"><span>${esc(f.label)}</span>${periodPriceInput(name, v, values?.[PERIOD_FIELDS[f.key]])}</label>`;
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
  data = { ...data };
  for (const [key, periodKey] of Object.entries(PERIOD_FIELDS)) {
    if (!(`${prefix}${key}__period` in data)) continue;
    const { monthly, period } = readPeriodPrice(data, `${prefix}${key}`);
    data[`${prefix}${key}`] = monthly;
    if (monthly != null) attrs[periodKey] = period;
  }
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
           : "Pflicht sind nur Kategorie, Preis und Beginn (mit <b class=\"req\">*</b>). Den Rest kannst du jederzeit ergänzen."
       }</p>`;

  const drawCategoryStep = () => {
    view.innerHTML = `
      <div class="page-head"><div>${header}</div></div>
      <div class="wizard-steps"><div class="step active"><span class="n">1</span>Kategorie</div><div class="line"></div>
        <div class="step"><span class="n">2</span>Eckdaten</div></div>
      <div class="card mb-4">
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
        <label class="btn btn-block camera-only mt-2">${icon("scan")} Vertrag mit der Kamera fotografieren
          <input type="file" accept="image/*" capture="environment" hidden data-camera /></label>
        <div id="ocr-status" class="mt-2"></div>
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
  let known = []; // the other contracts: providers, accounts, prices to compare with
  let carry = null; // typed values kept when the category changes

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
              <input name="provider" value="${esc(src.provider ?? "")}" list="providers" autocomplete="off" /></label>
            <label class="field span-2"><span>Bezeichnung / Tarif</span>
              <input name="name" value="${esc(src.name ?? "")}" /></label>
            ${
              editing
                ? ""
                : `<label class="field input-big"><span>${isEnergy(cat) ? "Abschlag" : "Preis"} <b class="req" title="Pflichtfeld">*</b></span><div class="input-group">
                    <input name="price_amount" type="number" step="0.01" inputmode="decimal" required />
                    <span class="addon">€</span></div></label>
                  <label class="field"><span>Zahlweise</span><select name="price_interval">
                    ${Object.entries(state.meta.intervals)
                      .map(([k, v]) => `<option value="${k}" ${k === priceInterval ? "selected" : ""}>${v.label}</option>`)
                      .join("")}</select></label>`
            }
            <label class="field"><span>Vertragsbeginn <b class="req" title="Pflichtfeld">*</b></span>
              <input name="start_date" type="date" value="${esc(src.start_date || query.start || today())}" required /></label>
          </div>
          <div class="total-field">
            <button type="button" class="btn btn-sm btn-ghost" id="total-toggle" ${src.max_total ? "hidden" : ""}>${icon("plus")} Gesamtsumme festlegen <span class="muted">– z. B. Ratenzahlung, Studiengebühren</span></button>
            <label class="field" id="total-box" ${src.max_total ? "" : "hidden"}><span>Gesamtsumme</span><div class="input-group">
              <input name="max_total" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(src.max_total ?? "")}"/><span class="addon">€</span></div>
              <small>Contractly sagt dir, wann sie erreicht ist, wie hoch die letzte Zahlung sein muss – und warnt, wenn mehr bezahlt wurde.</small></label>
          </div>
          <div id="dup-hint"></div>
          ${
            editing
              ? ""
              : `<label class="check small mt-3"><input type="checkbox" name="withdrawal" checked/>
                  Gerade erst abgeschlossen? An die 14-tägige Widerrufsfrist erinnern</label>
                <label class="check small" style="margin-top:8px"><input type="checkbox" name="already_cancelled" id="already-cancelled"/>
                  Schon gekündigt – der Vertrag endet zu einem festen Datum</label>
                <div class="form-grid mt-2" id="cancel-fields" hidden>
                  <label class="field"><span>Gekündigt zum</span><input type="date" name="cancel_end"/>
                    <small>Letzter Vertragstag – danach entstehen keine Kosten und keine Verlängerung mehr.</small></label>
                </div>`
          }
          ${
            isEnergy(cat) && !editing
              ? `<div class="callout mt-3">${icon("info")}<div>Bei Strom & Gas trägst du als Preis am einfachsten den <b>monatlichen Abschlag</b> ein. Grund- und Arbeitspreis für den Vergleich findest du unten bei den Eckdaten.</div></div>`
              : ""
          }
        </div>

        ${
          (c.fields || []).length
            ? `<details class="more" ${editing || cat === "loan" ? "open" : ""}>
                <summary>${icon("list")} Leistungen & Eckdaten <span class="muted small fw-500">– optional, hilft beim Vergleichen</span>${icon("chevDown", "chev")}</summary>
                <div class="body"><div class="form-grid">${
                  isEnergy(cat)
                    ? energyFactInputs(cat, src, pred, editing)
                    : attributeInputs(cat, src.attributes || pred.attributes || {})
                }</div></div></details>`
            : ""
        }

        <details class="more" ${editing ? "open" : ""}>
          <summary>${icon("clock")} Laufzeit, Kündigung & Erinnerung <span class="muted small fw-500">– Mindestlaufzeit, Frist, Erinnerung · vorbelegt</span>${icon("chevDown", "chev")}</summary>
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
            <label class="field"><span>Verlängert sich am <span class="muted">(optional)</span></span>
              <input type="date" id="renews-on"/>
              <small>Steht auf dem Vertrag? Eintragen – die Mindestlaufzeit wird daraus berechnet.</small></label>
            <div class="span-all term-preview" id="term-preview" aria-live="polite"></div>
            ${
              editing
                ? `<label class="field"><span>Vertragsende</span><input name="end_date" type="date" value="${esc(src.end_date ?? "")}" />
                   <small>Nur bei Kündigung/Ende</small></label>`
                : ""
            }
          </div></div>
        </details>

        <details class="more" ${editing ? "open" : ""}>
          <summary>${icon("file")} Anteil, Konto & Nummern <span class="muted small fw-500">– Partneranteil, Bezahlt über, Verwaltet von, Kunden- & Vertragsnummer, Notizen</span>${icon("chevDown", "chev")}</summary>
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
                <input name="partner_amount" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(src.partner_amount ?? "")}" ${src.partner_amount ? "" : "disabled"}/><span class="addon">€ / Monat</span></div>
              <small data-share="percent" ${src.partner_amount ? "hidden" : ""}>z. B. 50, wenn Partner:in die Hälfte zahlt</small>
              <small data-share="amount" ${src.partner_amount ? "" : "hidden"}>So viel übernimmt Partner:in jeden Monat – der Rest zählt als deine Kosten, auch wenn der Preis steigt.</small>
            </div>
            <label class="field"><span>Bezahlt über</span>
              <input name="account" list="accounts" maxlength="60" autocomplete="off" placeholder="Mein Konto" value="${esc(src.account ?? pred.account ?? "")}"/>
              <small>z. B. Gemeinschaftskonto – zählt dann nicht zu deinen eigenen Kosten</small></label>
            <label class="check" style="align-self:center"><input type="checkbox" name="tax_relevant" ${
              (src.tax_relevant ?? category(cat).tax_default) ? "checked" : ""
            }/> Steuerlich relevant</label>
            ${ownFieldsHtml(src, pred)}
            <label class="field span-2"><span>Anschrift des Anbieters <span class="muted">(für Kündigungsschreiben)</span></span>
              <textarea name="provider_address" rows="3">${esc(src.provider_address ?? "")}</textarea></label>
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
      <datalist id="providers"></datalist>
      <datalist id="accounts"></datalist>`;

    $("#change-cat", view)?.addEventListener("click", drawCategoryStep);
    fillProviderList().then((list) => (known = list));
    const form = $("#form", view);
    if (carry) {
      for (const [k, v] of Object.entries(carry)) if (form.elements[k] && v != null) form.elements[k].value = v;
      carry = null;
    }
    if (!editing && !predecessor) bindProviderSmarts(form);
    bindIconPicker(form);
    bindAlreadyCancelled(form);
    bindShareMode(form);
    bindOwnFields(form);
    bindTermPreview(form);
    bindInstallment(form, editing);
    $("#total-toggle", form)?.addEventListener("click", (e) => {
      e.currentTarget.hidden = true;
      $("#total-box", form).hidden = false;
      $("[name=max_total]", form).focus();
    });
    if (pendingSuggestions?.length) {
      applySuggestionsToForm(form, pendingSuggestions);
      toast("Erkannte Daten übernommen – bitte kurz prüfen");
      pendingSuggestions = null;
    }
    if (query.focus) focusField(form, query.focus);
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
        attributes: { ...(editing?.attributes || {}), ...collectAttributes(data), ...collectOwnFields(form) },
        share_percent: data.share_percent == null || data.share_percent === 100 ? null : data.share_percent,
        partner_amount: data.partner_amount || null,
        account: data.account || null,
        max_total: data.max_total || null,
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
      const issues = checkPlausibility(data, payload);
      if (issues.length && !(await reviewIssues(form, issues))) return;
      const btn = $("#save", view);
      busy(btn);
      try {
        let result;
        if (editing) {
          payload.end_date = data.end_date;
          payload.cancelled_on = data.end_date ? editing.cancelled_on || today() : null;
          payload.predecessor_id = editing.predecessor_id;
          result = await api.updateContract(id, payload);
          await saveInstallmentAsPrice(editing, data, payload.attributes.installment);
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
          // electricity/gas: the price is the Abschlag
          if (isEnergy(cat)) {
            const months = state.meta.intervals[payload.initial_price.interval]?.months || 1;
            payload.attributes.installment = Math.round((data.price_amount / months) * 100) / 100;
          }
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

  /** Thinking along while typing: a known provider brings its data, the name may suggest the category. */
  const bindProviderSmarts = (form) => {
    const hint = $("#dup-hint", view);
    const provider = form.elements.provider;
    const update = () => {
      const p = provider.value.trim().toLowerCase();
      const same = p ? known.filter((c) => (c.provider || "").trim().toLowerCase() === p) : [];
      const parts = [];
      // 1. the same contract again? Then a switch keeps the cost history in one line.
      const dup = same.find((c) => c.category === cat && ["active", "cancelled"].includes(c.state));
      if (dup)
        parts.push(`Du hast schon <a href="#/contracts/${dup.id}">${esc(dup.name)}</a> bei ${esc(dup.provider)}.
          Neuer Tarif beim selben Anbieter? Dann besser dort „Anbieter oder Tarif wechseln“ – so bleibt der Kostenverlauf durchgehend.`);
      // 2. provider or name point to a different category (e.g. "Netflix" under "Sonstiges")
      const guess = guessCategory(`${provider.value} ${form.elements.name.value}`);
      if (guess && guess !== cat)
        parts.push(`Sieht nach <b>${esc(category(guess).label)}</b> aus. <button type="button" class="btn btn-sm" data-switch="${guess}">Zu ${esc(category(guess).label)} wechseln</button>`);
      hint.innerHTML = parts.length
        ? `<div class="callout warn smart-hint mt-3">${icon("info")}<div>${parts.join("<br/>")}</div></div>`
        : "";
    };
    // a known provider: take over address, customer number and account (only into empty fields)
    const takeOver = async () => {
      if (!known.length) known = await fillProviderList();
      const p = provider.value.trim().toLowerCase();
      const same = known.filter((c) => (c.provider || "").trim().toLowerCase() === p);
      if (!same.length) return update();
      const pick = same.find((c) => c.category === cat) || same[0];
      const source = await api.contract(pick.id);
      const taken = [];
      const fill = (name, value, label) => {
        const el = form.elements[name];
        if (el && !el.value && value) {
          el.value = value;
          taken.push(label);
        }
      };
      fill("provider_address", source.provider_address, "Anschrift");
      fill("customer_number", source.customer_number, "Kundennummer");
      fill("account", source.account, "Konto");
      fill("managed_by", source.attributes?.managed_by, "Verwaltet von");
      update();
      if (taken.length) toast(`Von „${source.name}“ übernommen: ${taken.join(", ")}`);
    };
    provider.addEventListener("change", takeOver);
    form.elements.name.addEventListener("change", update);
    hint.addEventListener("click", (e) => {
      const next = e.target.closest("[data-switch]")?.dataset.switch;
      if (!next) return;
      const d = formData(form);
      carry = { provider: d.provider, name: d.name, price_amount: d.price_amount, start_date: d.start_date };
      cat = next;
      drawForm();
    });
  };

  const monthsOf = (interval) => state.meta.intervals[interval]?.months || 1;
  /** Likely typos and contradictions; when editing only the ones this edit brings in. */
  const checkPlausibility = (data, payload) => {
    const base = { category: cat, label: category(cat).label, editing: Boolean(editing) };
    const others = known.filter((k) => k.id !== editing?.id);
    const current = editing?.current_price;
    const previousMonthly = current && current.interval !== "once" ? current.monthly_equivalent : null;
    const issues = plausibilityIssues(
      {
        ...base,
        price: editing ? current?.amount ?? null : data.price_amount,
        months: monthsOf(editing ? current?.interval : data.price_interval),
        start: payload.start_date,
        minTerm: Number(payload.min_term_months) || 0,
        renewal: Number(payload.renewal_months) || 0,
        noticeValue: Number(payload.notice_value) || 0,
        noticeUnit: payload.notice_unit,
        endDate: editing ? data.end_date : data.already_cancelled ? data.cancel_end : null,
        maxTotal: payload.max_total,
        attrs: payload.attributes,
        previousMonthly,
        newMonthly: editing && isEnergy(cat) ? payload.attributes.installment ?? null : null,
      },
      others,
    );
    if (!editing) return issues;
    const before = plausibilityIssues(
      {
        ...base,
        price: current?.amount ?? null,
        months: monthsOf(current?.interval),
        start: editing.start_date,
        minTerm: editing.min_term_months || 0,
        renewal: editing.renewal_months || 0,
        noticeValue: editing.notice_value || 0,
        noticeUnit: editing.notice_unit,
        endDate: editing.end_date,
        maxTotal: editing.max_total,
        attrs: editing.attributes,
        previousMonthly,
        newMonthly: isEnergy(cat) ? previousMonthly : null,
      },
      others,
    );
    const already = new Set(before.map((i) => i.text));
    return issues.filter((i) => !already.has(i.text));
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

/** Jump to one field (e.g. from "Noch offen" on the contract): open its section and highlight it. */
function focusField(form, name) {
  const el = form.elements[name];
  if (!el?.focus) return;
  el.closest("details")?.setAttribute("open", "");
  const box = el.closest(".field, .own-field") || el;
  box.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
  box.classList.add("flash");
  setTimeout(() => box.classList.remove("flash"), 2000);
}

function energyDetails(attrs) {
  const d = {};
  if (attrs.base_price_month != null) d.base_price_month = attrs.base_price_month;
  if (attrs.unit_price_ct != null) d.unit_price_ct = attrs.unit_price_ct;
  return d;
}

/** Ask before saving values that look wrong. Resolves true to save anyway. */
function reviewIssues(form, issues) {
  return new Promise((resolve) => {
    let save = false;
    const m = modal({
      title: "Bitte kurz prüfen",
      body: `<ul class="issue-list">${issues.map((i) => `<li>${icon("alert")}<span>${esc(i.text)}</span></li>`).join("")}</ul>`,
      foot: `<button class="btn" data-save>Trotzdem speichern</button>
             <button class="btn btn-primary" data-close data-fix>Korrigieren</button>`,
    });
    $("[data-save]", m).addEventListener("click", () => {
      save = true;
      m.close();
    });
    $("[data-fix]", m).addEventListener("click", () => setTimeout(() => focusField(form, issues[0].field), 280));
    new MutationObserver((_, obs) => {
      if (!document.body.contains(m)) {
        obs.disconnect();
        resolve(save);
      }
    }).observe(document.body, { childList: true });
  });
}

async function fillProviderList() {
  try {
    const list = await api.contracts();
    const names = [...new Set(list.map((c) => c.provider).filter(Boolean))];
    const dl = document.getElementById("providers");
    if (dl) dl.innerHTML = names.map((n) => `<option value="${esc(n)}">`).join("");
    const accounts = ["Gemeinschaftskonto", ...list.map((c) => c.account).filter(Boolean)];
    const al = document.getElementById("accounts");
    if (al) al.innerHTML = [...new Set(accounts)].map((n) => `<option value="${esc(n)}">`).join("");
    return list;
  } catch {
    return []; // optional
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
  ["education", /hochschule|universit|studium|studiengeb|semesterbeitrag|fernstudium|akademie|weiterbildung|volkshochschule|nachhilfe|sprachkurs/i],
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

// ------------------------------------------------------------------ own fields
// Customer and contract number can be renamed (✎), and any number of own fields added (+):
// "Mitgliedsnummer", "Zählernummer", "Ansprechpartner" … Kept in attributes.field_labels and
// attributes.custom_fields.

const NUMBER_FIELDS = [
  ["managed_by", "Verwaltet von"], // e.g. an insurance broker; kept in attributes.managed_by
  ["customer_number", "Kundennummer"],
  ["contract_number", "Vertragsnummer"],
];

function ownFieldRow({ key = "", label, value = "", custom = false, editLabel = false }) {
  return `<div class="own-field ${custom ? "custom" : ""}" ${key ? `data-key="${key}"` : ""}>
      <div class="own-label">
        <span class="lbl" ${editLabel ? "hidden" : ""}>${esc(label)}</span>
        <input class="lbl-input" maxlength="40" placeholder="Bezeichnung" value="${esc(label)}" ${editLabel ? "" : "hidden"} aria-label="Bezeichnung"/>
        <button type="button" class="icon-btn" data-rename title="Bezeichnung ändern" aria-label="Bezeichnung ändern">${icon("edit")}</button>
        ${custom ? `<button type="button" class="icon-btn" data-remove title="Feld entfernen" aria-label="Feld entfernen">${icon("trash")}</button>` : ""}
      </div>
      <input ${key ? `name="${key}"` : `class="cf-value"`} maxlength="200" value="${esc(value)}" aria-label="${esc(label || "Wert")}"/>
    </div>`;
}

function ownFieldsHtml(src, pred) {
  const labels = src.attributes?.field_labels || {};
  const values = {
    managed_by: src.attributes?.managed_by ?? pred.attributes?.managed_by ?? "",
    customer_number: src.customer_number ?? pred.customer_number ?? "",
    contract_number: src.contract_number ?? "",
  };
  return `<div class="field span-all own-fields" id="own-fields">
      <span>Verwaltung, Nummern & eigene Felder</span>
      <div class="own-grid">
        ${NUMBER_FIELDS.map(([key, def]) => ownFieldRow({ key, label: labels[key] || def, value: values[key] })).join("")}
        ${(src.attributes?.custom_fields || []).map((f) => ownFieldRow({ label: f.label, value: f.value, custom: true })).join("")}
      </div>
      <button type="button" class="btn btn-sm btn-ghost own-add" id="own-add">${icon("plus")} Feld hinzufügen</button>
    </div>`;
}

function bindOwnFields(form) {
  const box = $("#own-fields", form);
  if (!box) return;
  const grid = $(".own-grid", box);
  const finishRename = (row) => {
    const input = $(".lbl-input", row);
    if (input.hidden) return;
    const text = input.value.trim();
    if (!text && !row.classList.contains("custom")) input.value = $(".lbl", row).textContent;
    $(".lbl", row).textContent = input.value.trim() || "Eigenes Feld";
    input.hidden = true;
    $(".lbl", row).hidden = false;
  };
  box.addEventListener("click", (e) => {
    const row = e.target.closest(".own-field");
    if (e.target.closest("[data-rename]")) {
      const input = $(".lbl-input", row);
      if (input.hidden) {
        input.hidden = false;
        $(".lbl", row).hidden = true;
        input.focus();
        input.select();
      } else finishRename(row);
    }
    if (e.target.closest("[data-remove]")) row.remove();
  });
  box.addEventListener("keydown", (e) => {
    if (e.target.matches(".lbl-input") && e.key === "Enter") {
      e.preventDefault();
      finishRename(e.target.closest(".own-field"));
      e.target.closest(".own-field").querySelector("input:not(.lbl-input)").focus();
    }
  });
  box.addEventListener("focusout", (e) => {
    if (e.target.matches(".lbl-input") && !e.target.closest(".own-field").contains(e.relatedTarget)) finishRename(e.target.closest(".own-field"));
  });
  $("#own-add", box).addEventListener("click", () => {
    grid.insertAdjacentHTML("beforeend", ownFieldRow({ label: "", custom: true, editLabel: true }));
    $(".own-field:last-child .lbl-input", grid).focus();
  });
}

function collectOwnFields(form) {
  const box = $("#own-fields", form);
  if (!box) return {};
  const labelOf = (row) => {
    const input = $(".lbl-input", row);
    return (input.hidden ? $(".lbl", row).textContent : input.value).trim();
  };
  const field_labels = {};
  for (const [key, def] of NUMBER_FIELDS) {
    const row = $(`.own-field[data-key="${key}"]`, box);
    const label = row && labelOf(row);
    if (label && label !== def) field_labels[key] = label;
  }
  const custom_fields = $$(".own-field.custom", box)
    .map((row) => ({ label: labelOf(row), value: $(".cf-value", row).value.trim() }))
    .filter((f) => f.label || f.value)
    .map((f) => ({ label: f.label || "Eigenes Feld", value: f.value }));
  const managed = $("[name=managed_by]", box)?.value.trim();
  return { field_labels, custom_fields, managed_by: managed || undefined };
}

// ------------------------------------------------------------------ renewal & deadline preview
// Same rules as the server (calc.term_info): the term ends after the minimum term, then after
// every renewal; the cancellation must arrive by the term end minus the notice period.

const isoAddMonths = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
};
const isoAddDays = (iso, n) => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const deDate = (iso) => iso.split("-").reverse().join(".");

function noticeDeadline(termEnd, value, unit) {
  if (!value) return termEnd;
  if (unit === "days") return isoAddDays(termEnd, -value);
  if (unit === "weeks") return isoAddDays(termEnd, -7 * value);
  return isoAddDays(isoAddMonths(isoAddDays(termEnd, 1), -value), -1);
}

/** Next term end and cancellation deadline from today on (null when not computable). */
export function nextTerm({ start, minTerm, renewal, noticeValue, noticeUnit }, ref = today()) {
  if (!start) return null;
  renewal = renewal || 1;
  for (let k = 0; k < 2000; k++) {
    const months = minTerm ? minTerm + k * renewal : renewal * (k + 1);
    const termEnd = isoAddDays(isoAddMonths(start, months), -1);
    const deadline = noticeDeadline(termEnd, noticeValue, noticeUnit);
    if (deadline >= ref) {
      const minEnd = isoAddDays(isoAddMonths(start, minTerm || 0), -1);
      const flexible = renewal <= 1 && (!minTerm || termEnd > minEnd);
      return { termEnd, renewsOn: isoAddDays(termEnd, 1), deadline, flexible };
    }
  }
  return null;
}

function bindTermPreview(form) {
  const box = $("#term-preview", form);
  const renewsOn = $("#renews-on", form);
  if (!box) return;
  const num = (name) => {
    const v = form.elements[name]?.value;
    return v === "" || v == null ? 0 : Number(v);
  };
  const values = () => ({
    start: form.elements.start_date?.value,
    minTerm: num("min_term_months"),
    renewal: num("renewal_months") || 1,
    noticeValue: num("notice_value"),
    noticeUnit: form.elements.notice_unit?.value || "months",
  });
  const draw = () => {
    if (form.elements.end_date?.value) {
      box.innerHTML = `<div class="callout">${icon("clock")}<div>Vertrag endet am <b>${deDate(form.elements.end_date.value)}</b> – keine Verlängerung mehr.</div></div>`;
      return;
    }
    const t = nextTerm(values());
    if (!t) {
      box.innerHTML = "";
      return;
    }
    if (document.activeElement !== renewsOn) renewsOn.value = t.renewsOn;
    const remind = form.elements.reminder_days?.value;
    const reminderOn = remind !== "" && remind != null ? isoAddDays(t.deadline, -Number(remind)) : null;
    const renewal = values().renewal;
    box.innerHTML = t.flexible
      ? `<div class="callout good">${icon("check")}<div><b>Monatlich kündbar.</b> Nächstes mögliches Ende: ${deDate(t.termEnd)} – dafür kündigen bis <b>${deDate(t.deadline)}</b>.</div></div>`
      : `<div class="callout warn">${icon("alert")}<div>Verlängert sich am <b>${deDate(t.renewsOn)}</b> um ${renewal} ${renewal === 1 ? "Monat" : "Monate"} –
          wer das nicht will, muss <b>bis ${deDate(t.deadline)}</b> kündigen.${reminderOn ? ` Contractly erinnert dich am ${deDate(reminderOn)}.` : ""}</div></div>`;
  };
  // A renewal date from the contract paper sets the minimum term (keeping the renewal rhythm).
  renewsOn.addEventListener("change", () => {
    const v = values();
    const target = renewsOn.value;
    if (!target || !v.start || target <= v.start) return draw();
    let months = 0;
    while (isoAddMonths(v.start, months) < target && months < 1200) months++;
    if (isoAddMonths(v.start, months) !== target) {
      box.innerHTML = `<div class="callout bad">${icon("alert")}<div>Das Datum passt nicht zum Vertragsbeginn (${deDate(v.start)}) – bitte den Beginn prüfen: Verträge verlängern sich meist zum gleichen Tag im Monat.</div></div>`;
      return;
    }
    // keep the minimum term when it already leads to this date; otherwise the shortest term in
    // the renewal rhythm (e.g. 12 months for a yearly contract) – or exactly up to the date
    const r = v.renewal;
    if (nextTerm(v)?.renewsOn !== target) {
      const field = form.elements.min_term_months;
      field.value = r > 1 ? ((months - 1) % r) + 1 : months;
      if (nextTerm(values())?.renewsOn !== target) field.value = months;
    }
    draw();
  });
  form.addEventListener("input", (e) => {
    if (e.target !== renewsOn) draw();
  });
  form.addEventListener("change", (e) => {
    if (e.target !== renewsOn) draw();
  });
  draw();
}

// ------------------------------------------------------------------ electricity/gas: Abschlag = price
// There is one Abschlag: the price. Creating a contract asks for it as "Abschlag"; editing shows the
// current price in the facts and turns a change into a price change from a chosen date.

function energyFactInputs(cat, src, pred, editing) {
  const attrs = { ...(src.attributes || pred.attributes || {}) };
  const fields = (category(cat).fields || []).filter((f) => editing || f.key !== "installment");
  if (!editing) return attributeInputs(cat, attrs, "attr_", fields);
  const price = editing.current_price;
  const priced = price && price.interval !== "once" ? price.monthly_equivalent : null;
  // an Abschlag entered in the facts that differs from the price is kept and offered as a change
  const typed = Number(attrs.installment);
  const differs = priced != null && typed && Math.abs(typed - priced) >= 0.005;
  if (priced != null && !differs) {
    attrs.installment = priced;
    attrs.installment_period = "month";
  }
  const single = editing.prices.filter((p) => p.interval !== "once").length === 1;
  return `${attributeInputs(cat, attrs, "attr_", fields)}
    <div class="span-all inst-from" id="inst-from" data-price="${priced ?? ""}" ${differs ? "" : "hidden"}>
      ${differs ? `<p class="small muted" style="margin:0 0 8px">Gerechnet wird bisher mit ${money(priced)} – ab wann gilt dein Abschlag?</p>` : ""}
      <div class="form-grid">
        <label class="field"><span>Neuer Abschlag gilt ab</span><input type="date" name="inst_from" value="${today()}"/></label>
        ${
          single
            ? `<label class="check" style="align-self:end;min-height:42px"><input type="checkbox" name="inst_always"/> Galt schon immer – bisherigen Preis korrigieren</label>`
            : ""
        }
      </div>
    </div>`;
}

function bindInstallment(form, editing) {
  const input = form.elements.attr_installment;
  const box = $("#inst-from", form);
  if (!editing || !input || !box) return;
  // shown whenever the entered Abschlag (per month) differs from the price
  const price = Number(box.dataset.price);
  const show = () => {
    const v = Number(input.value);
    const monthly = form.elements.attr_installment__period?.value === "year" ? v / 12 : v;
    box.hidden = !input.value || !box.dataset.price || Math.abs(monthly - price) < 0.005;
  };
  input.addEventListener("input", show);
  form.elements.attr_installment__period?.addEventListener("change", show);
}

/** A changed Abschlag becomes a price change (or corrects the only price when it always applied). */
async function saveInstallmentAsPrice(editing, data, monthly) {
  if (!isEnergy(editing.category) || monthly == null) return;
  const current = editing.current_price;
  if (current && Math.abs(current.monthly_equivalent - monthly) < 0.005) return;
  const row = editing.prices.find((p) => p.id === current?.id);
  if (data.inst_always && row) {
    await api.updatePrice(editing.id, row.id, { ...row, amount: monthly, interval: "monthly" });
  } else {
    const from = data.inst_from && data.inst_from > editing.start_date ? data.inst_from : today();
    await api.addPrice(editing.id, { valid_from: from, amount: monthly, interval: "monthly", note: "Neuer Abschlag", details: {} });
  }
}
