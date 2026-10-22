// "Notfall-Mappe": everything relatives need, printable or as an encrypted, self-contained file.

import { api } from "../api.js";
import { $, busy, esc, fmtDate, icon, money, toast } from "../ui.js";

export async function renderEmergency(view) {
  const f = await api.emergency();
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Notfall-Mappe</h1><p>Alles, was Angehörige brauchen, wenn du es selbst nicht mehr regeln kannst.</p></div>
      <div class="page-actions no-print">
        <button class="btn" id="print">${icon("printer")}<span class="label">Drucken / PDF</span></button>
      </div>
    </div>

    <div class="grid grid-2 no-print" style="margin-bottom:20px;align-items:start">
      <form class="card" id="note-form">
        <div class="card-head"><div><h2>${icon("edit")} Hinweise für Angehörige</h2>
          <p>Wo liegen Passwörter, Unterlagen, das Testament? Wen sollen sie anrufen?</p></div></div>
        <textarea class="input" name="note" rows="6" maxlength="5000" placeholder="z. B. „Passwort-Manager: Zugang im Umschlag im grünen Ordner. Steuerberaterin: Frau Meier, 0151 …“">${esc(f.note || "")}</textarea>
        <div class="form-actions" style="margin-top:10px"><button class="btn" type="submit">${icon("check")} Speichern</button></div>
      </form>
      <form class="card" id="export-form">
        <div class="card-head"><div><h2>${icon("lock")} Verschlüsselt weitergeben</h2>
          <p>Eine einzelne Datei, die sich in jedem Browser öffnet – offline, ohne Contractly. Nur mit Passwort lesbar.</p></div></div>
        <div class="stack" style="gap:12px">
          <label class="field"><span>Passwort für die Mappe</span><input type="password" name="passphrase" minlength="10" autocomplete="new-password" required/>
            <small>Mindestens 10 Zeichen. Gib es der Vertrauensperson getrennt von der Datei (z. B. auf Papier).</small></label>
          <label class="field"><span>Passwort wiederholen</span><input type="password" name="passphrase2" autocomplete="new-password" required/></label>
          <label class="check"><input type="checkbox" name="include_documents" checked/> Dokumente (PDFs, Fotos) einpacken</label>
          <button class="btn btn-primary btn-block" type="submit">${icon("download")} Notfall-Mappe herunterladen</button>
        </div>
      </form>
    </div>

    <div id="folder">${folderHtml(f)}</div>`;

  $("#print", view).addEventListener("click", () => {
    view.querySelectorAll("#folder details").forEach((d) => (d.open = true));
    window.print();
  });
  $("#note-form", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    await api.emergencyNote(e.target.note.value);
    toast("Hinweise gespeichert");
    $("#folder", view).innerHTML = folderHtml(await api.emergency());
  });
  $("#export-form", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.passphrase.value !== form.passphrase2.value) return toast("Die Passwörter stimmen nicht überein", "error");
    const btn = $("button[type=submit]", form);
    busy(btn);
    try {
      const res = await api.emergencyExport({ passphrase: form.passphrase.value, include_documents: form.include_documents.checked });
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "notfall-mappe.html";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      const skipped = Number(res.headers.get("X-Skipped-Documents") || 0);
      toast(skipped ? `Heruntergeladen – ${skipped} große Dokumente passten nicht mehr hinein` : "Notfall-Mappe heruntergeladen 🔒");
      form.reset();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      busy(btn, false);
    }
  });
}

function folderHtml(f) {
  const o = f.owner || {};
  const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : "");
  return `
    <div class="card emergency-head">
      <h2>Notfall-Mappe${o.name ? ` von ${esc(o.name)}` : ""}</h2>
      <p class="muted" style="margin:0">Stand ${fmtDate(f.generated_on)} · ${f.contracts.length} laufende Verträge · zusammen ${money(f.monthly_total)} pro Monat</p>
      ${o.name ? "" : `<p class="small no-print" style="margin:8px 0 0">${icon("info", "inline")} Tipp: Trag unter <a href="#/settings">Einstellungen → Profil</a> deinen Namen ein – er steht dann auch in den Kündigungsschreiben.</p>`}
    </div>
    ${f.note ? `<div class="card"><h2>Persönliche Hinweise</h2><p style="white-space:pre-wrap;margin:0">${esc(f.note)}</p></div>` : ""}
    <div class="card"><h2>Was jetzt zu tun ist</h2><ol class="emergency-list">${f.checklist.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
    <div class="card"><h2>Alle Verträge auf einen Blick</h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>Vertrag</th><th>Anbieter</th><th>Kunden-/Vertragsnr.</th><th class="r">Kosten</th><th>Frist</th></tr></thead><tbody>
      ${f.contracts
        .map(
          (c) => `<tr><td>${c.icon} <b>${esc(c.name)}</b></td><td>${esc(c.provider || "")}</td>
          <td class="num">${esc(c.customer_number || c.contract_number || "")}</td><td class="r num">${esc(c.price || "")}</td><td>${esc(c.notice)}</td></tr>`,
        )
        .join("")}
      </tbody></table></div></div>
    ${f.contracts
      .map(
        (c) => `<div class="card emergency-contract">
        <h2>${c.icon} ${esc(c.name)}</h2>
        <dl class="emergency-dl">
          ${row("Kategorie", c.category_label)}
          ${row("Anbieter", [c.provider, c.provider_address].filter(Boolean).join("\n"))}
          ${row("Kundennummer", c.customer_number)}${row("Vertragsnummer", c.contract_number)}
          ${c.details.map((d) => row(d.label, d.value)).join("")}
          ${row("Preis", c.price)}${row("Seit", fmtDate(c.start_date))}${row("Kündigungsfrist", c.notice)}
          ${row("Nächstes Vertragsende", c.flexible ? "monatlich kündbar" : c.next_term_end && fmtDate(c.next_term_end))}
          ${row("Bereits gekündigt", c.cancelled_on && `am ${fmtDate(c.cancelled_on)}${c.end_date ? `, endet ${fmtDate(c.end_date)}` : ""}`)}
          ${row("Notizen", c.notes)}
          ${row("Unterlagen", c.documents.map((d) => d.name + (d.description ? ` – ${d.description}` : "")).join("\n"))}
        </dl>
        <div class="callout warn">${icon("info")}<div><b>Im Todesfall:</b> ${esc(c.death_hint)}</div></div>
        <details class="more" style="margin-top:12px"><summary>${icon("mail")} Vorbereitetes Kündigungsschreiben${icon("chevDown", "chev")}</summary>
          <div class="body"><pre class="emergency-letter">${esc(c.letter)}</pre></div></details>
      </div>`,
      )
      .join("")}`;
}
