// "Post & Mails": a letter (photo/PDF), an e-mail (.eml) or pasted text -> what changes for which contract.

import { api } from "../api.js";
import { contractIcon } from "../store.js";
import { $, busy, esc, fmtDate, icon, toast } from "../ui.js";
import { setupDrop } from "./contract-form.js";

const KIND_ICON = {
  price_increase: "trendUp",
  price_decrease: "trendDown",
  installment: "euro",
  settlement: "file",
  cancellation_confirmation: "check",
  contract_confirmation: "sparkles",
  terms_change: "info",
  other: "mail",
};

/** Text shared from another app (e.g. "Teilen" in the mail app), consumed once. */
let shared = null;
export function setSharedMessage(data) {
  shared = data;
}

export async function renderInbox(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Post & Mails</h1><p>Brief fotografieren oder E-Mail hineinlegen – Contractly erkennt, was sich ändert, und trägt es ein.</p></div>
    </div>
    <div id="inbox-input">
      <div class="grid grid-2" style="align-items:start">
        <div class="card">
          <div class="card-head"><div><h2>${icon("scan")} Brief oder Datei</h2><p>Foto, PDF oder gespeicherte E-Mail (.eml)</p></div></div>
          <label class="btn btn-primary btn-block camera-only" style="margin-bottom:10px">${icon("scan")} Brief fotografieren
            <input type="file" accept="image/*" capture="environment" hidden data-camera /></label>
          <label class="dropzone" id="drop">${icon("upload")}<b>Datei auswählen oder hierher ziehen</b>
            <span class="muted small">JPG, PNG, PDF oder .eml · wird verschlüsselt beim Vertrag abgelegt</span>
            <input type="file" accept=".pdf,.eml,.msg,image/*,message/rfc822" hidden /></label>
        </div>
        <form class="card" id="paste">
          <div class="card-head"><div><h2>${icon("mail")} E-Mail-Text einfügen</h2><p>Inhalt der Mail kopieren und hier einfügen</p></div></div>
          <div class="stack" style="gap:12px">
            <label class="field"><span>Betreff (optional)</span><input name="subject" autocomplete="off"/></label>
            <label class="field"><span>Text</span><textarea name="text" rows="6" required></textarea></label>
            <button class="btn btn-primary btn-block" type="submit">${icon("sparkles")} Auswerten</button>
          </div>
        </form>
      </div>
      <details class="more" style="margin-top:16px"><summary>${icon("info")} So kommen E-Mails am einfachsten hierher${icon("chevDown", "chev")}</summary>
        <div class="body small text-2"><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
          <li><b>Handy:</b> Contractly zum Startbildschirm hinzufügen – dann in der Mail-App <i>Teilen → Contractly</i>.</li>
          <li><b>Gmail im Browser:</b> Mail öffnen → ⋮ → <i>Nachricht herunterladen</i> (.eml) und hier hineinziehen.</li>
          <li><b>Outlook / Thunderbird:</b> Mail auf den Desktop ziehen bzw. <i>Speichern unter</i> (.eml) – oder einfach den Text kopieren.</li>
          <li>Rechnung als <b>PDF-Anhang</b>? Die .eml-Datei enthält ihn – Contractly liest ihn mit und legt ihn ab.</li>
        </ul></div></details>
    </div>
    <div id="inbox-result"></div>`;

  const input = $("#inbox-input", view);
  const out = $("#inbox-result", view);
  const run = async (file, fields = {}) => {
    out.innerHTML = `<div class="callout" style="margin-top:20px"><span class="spinner"></span><div>Lese ${file ? `<b>${esc(file.name)}</b>` : "die Nachricht"} … bei Fotos dauert die Texterkennung ein paar Sekunden.</div></div>`;
    try {
      const res = await api.analyzeMessage(file, fields);
      input.classList.add("hidden");
      showResult(view, out, res);
    } catch (err) {
      out.innerHTML = `<div class="callout bad" style="margin-top:20px">${icon("alert")}<div>${esc(err.message)}</div></div>`;
    }
  };
  setupDrop(input, (file) => run(file));
  $("#paste", view).addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    run(null, { text: f.text.value, subject: f.subject.value });
  });
  if (shared) {
    const { subject, text } = shared;
    shared = null;
    $("#paste", view).subject.value = subject || "";
    $("#paste", view).text.value = text || "";
    run(null, { subject, text });
  }
}

async function showResult(view, out, res) {
  const contracts = await api.contracts({ include_ended: true });
  const options = contracts
    .map((c) => `<option value="${c.id}" ${c.id === res.contract_id ? "selected" : ""}>${esc(contractIcon(c))} ${esc(c.name)}${c.provider ? ` · ${esc(c.provider)}` : ""}</option>`)
    .join("");
  const best = res.candidates.find((c) => c.contract_id === res.contract_id);
  const f = res.facts;
  out.innerHTML = `
    <div class="card inbox-card">
      <div class="inbox-head">
        <span class="kpi-icon">${icon(KIND_ICON[res.kind] || "mail")}</span>
        <div class="grow">
          <div class="small muted">Erkannt</div>
          <h2 style="margin:0">${esc(res.kind_label)}</h2>
          <div class="small muted">${[res.sender || res.provider, res.subject, f.letter_date && `vom ${fmtDate(f.letter_date)}`]
            .filter(Boolean)
            .map(esc)
            .join(" · ")}</div>
        </div>
      </div>
      <label class="field" style="margin-top:16px"><span>Gehört zu</span>
        <select class="input" id="contract"><option value="">➕ Neuer Vertrag (noch nicht erfasst)</option>${options}</select>
        <small id="why">${best ? `Erkannt über ${best.why.join(" und ")}` : res.contract_id ? "" : "Kein passender Vertrag gefunden – bitte auswählen oder neu anlegen."}</small></label>
      <div id="actions" style="margin-top:16px"></div>
      <details class="more" style="margin-top:16px"><summary>${icon("file")} Erkannter Text${icon("chevDown", "chev")}</summary>
        <div class="body"><pre style="white-space:pre-wrap;font-size:12px;max-height:280px;overflow:auto;margin:0">${esc(res.text)}</pre></div></details>
      <div class="form-actions" style="margin-top:16px">
        <button class="btn" id="again">${icon("back")} Andere Nachricht</button>
        <button class="btn btn-primary" id="apply">${icon("check")} Übernehmen</button>
      </div>
    </div>`;
  let current = res;
  const draw = () => drawActions($("#actions", out), current);
  draw();
  $("#contract", out).addEventListener("change", async (e) => {
    const id = e.target.value ? Number(e.target.value) : null;
    current = await api.messageProposal(res.document_id, id);
    $("#why", out).textContent = id ? "" : "Lege den Vertrag an – die erkannten Angaben werden vorausgefüllt.";
    draw();
  });
  $("#again", out).addEventListener("click", () => renderInbox(view));
  $("#apply", out).addEventListener("click", async (e) => {
    const contractId = Number($("#contract", out).value) || null;
    if (!contractId) {
      location.hash = `#/contracts/new?document=${res.document_id}`;
      return;
    }
    const actions = collect($("#actions", out));
    busy(e.currentTarget);
    try {
      const r = await api.applyMessage(res.document_id, { contract_id: contractId, actions });
      toast(r.applied.length ? `Eingetragen: ${r.applied.join(", ")} ✓` : "Beim Vertrag abgelegt ✓");
      location.hash = `#/contracts/${contractId}`;
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

function drawActions(el, res) {
  const items = res.actions.filter((a) => a.type !== "new_contract");
  if (!items.length) {
    el.innerHTML = `<div class="callout">${icon("info")}<div>${
      res.contract_id ? "Nichts zu ändern – das Schreiben wird beim Vertrag abgelegt." : "Mit „Übernehmen“ legst du den neuen Vertrag an; erkannte Angaben werden vorausgefüllt."
    }</div></div>`;
    return;
  }
  el.innerHTML = `<div class="small muted" style="margin-bottom:8px">Das trägt Contractly ein:</div><div class="list">${items
    .map((a, i) => {
      if (a.type === "info") return `<div class="list-item"><span class="kpi-icon" style="background:var(--warn-soft);color:var(--warn)">${icon("bell")}</span><div class="grow small">${esc(a.label)}</div></div>`;
      const editable =
        a.type === "price"
          ? `<div class="inline-edit"><input type="number" step="0.01" class="input" data-amount="${i}" value="${a.amount}" aria-label="Betrag"/><span>€ ab</span>
               <input type="date" class="input" data-from="${i}" value="${a.valid_from}" aria-label="Gültig ab"/></div>`
          : a.type === "extra"
            ? `<div class="inline-edit"><input type="number" step="0.01" class="input" data-amount="${i}" value="${Math.abs(a.amount)}" aria-label="Betrag"/><span>€</span></div>`
            : "";
      return `<label class="list-item" style="cursor:pointer;align-items:flex-start">
        <input type="checkbox" data-i="${i}" ${a.selected ? "checked" : ""} ${a.type === "attach" ? "checked disabled" : ""} style="width:18px;height:18px;margin-top:3px;accent-color:var(--primary)"/>
        <div class="grow"><div style="font-weight:600">${esc(a.label)}</div>${editable}</div></label>`;
    })
    .join("")}</div>`;
  el.dataset.items = JSON.stringify(items);
}

function collect(el) {
  const items = JSON.parse(el.dataset.items || "[]");
  return items
    .map((a, i) => {
      const box = $(`[data-i="${i}"]`, el);
      if (a.type !== "info" && box && !box.checked) return null;
      const out = { ...a };
      const amount = $(`[data-amount="${i}"]`, el);
      if (amount) out.amount = a.type === "extra" && a.amount < 0 ? -Number(amount.value) : Number(amount.value);
      const from = $(`[data-from="${i}"]`, el);
      if (from) out.valid_from = from.value;
      delete out.label;
      delete out.selected;
      return out;
    })
    .filter((a) => a && a.type !== "info");
}
