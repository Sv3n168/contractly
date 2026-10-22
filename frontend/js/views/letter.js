// Cancellation letter generator ("Kündigungsschreiben").

import { api } from "../api.js";
import { state } from "../store.js";
import { $, esc, fmtDate, formData, icon, modal, toast } from "../ui.js";

const TYPES = {
  regular: "Ordentliche Kündigung",
  price: "Sonderkündigung wegen Preiserhöhung",
  move: "Sonderkündigung wegen Umzug",
};

function compose(c, p, o) {
  const sender = [p.name, p.street, p.zip_city, p.email, p.phone].filter(Boolean).join("\n") || "[Dein Name]\n[Straße Nr.]\n[PLZ Ort]";
  const recipient = (c.provider_address || c.provider || "[Anbieter]\n[Adresse]").trim();
  const place = p.city_for_letters || (p.zip_city || "").replace(/^\d{5}\s*/, "") || "[Ort]";
  const refs = [
    c.customer_number && `Kundennummer: ${c.customer_number}`,
    c.contract_number && `Vertragsnummer: ${c.contract_number}`,
    c.attributes?.phone_number && `Rufnummer: ${c.attributes.phone_number}`,
    c.attributes?.meter_number && `Zählernummer: ${c.attributes.meter_number}`,
    c.attributes?.market_location && `Marktlokation: ${c.attributes.market_location}`,
    c.attributes?.license_plate && `Kennzeichen: ${c.attributes.license_plate}`,
  ].filter(Boolean);
  const endDate = o.end_date ? fmtDate(o.end_date) : null;

  let body;
  if (o.type === "price") {
    body =
      `hiermit kündige ich den oben genannten Vertrag „${c.name}“ außerordentlich unter Berufung auf mein Sonderkündigungsrecht ` +
      `aufgrund der angekündigten Preiserhöhung${endDate ? ` zum ${endDate}` : " zum Zeitpunkt ihres Inkrafttretens"}.`;
  } else if (o.type === "move") {
    body =
      `hiermit kündige ich den oben genannten Vertrag „${c.name}“ aufgrund meines Umzugs` +
      `${o.move_date ? ` zum ${fmtDate(o.move_date)}` : ""}. ` +
      `${o.new_address ? `Meine neue Anschrift lautet: ${o.new_address.replace(/\n/g, ", ")}. ` : ""}` +
      `Eine Meldebescheinigung reiche ich auf Wunsch gerne nach.`;
  } else {
    body =
      `hiermit kündige ich den oben genannten Vertrag „${c.name}“ fristgerecht${endDate ? ` zum ${endDate}` : ""}, ` +
      `hilfsweise zum nächstmöglichen Zeitpunkt.`;
  }
  const extras = [];
  if (o.port_number && c.attributes?.phone_number)
    extras.push(`Ich möchte meine Rufnummer ${c.attributes.phone_number} zu einem neuen Anbieter mitnehmen. Bitte bestätigen Sie mir die Portierung.`);
  if (o.confirm) extras.push("Bitte bestätigen Sie mir den Eingang dieser Kündigung sowie das genaue Vertragsende schriftlich.");
  if (o.sepa) extras.push("Die erteilte Einzugsermächtigung bzw. das SEPA-Lastschriftmandat widerrufe ich zum Vertragsende.");
  if (o.no_ads) extras.push("Der Nutzung meiner Daten zu Werbezwecken sowie Rückgewinnungsanrufen widerspreche ich ausdrücklich.");

  return `${sender}

${recipient}

${place}, ${new Date().toLocaleDateString("de-DE")}

${TYPES[o.type]}: ${c.name}
${refs.join("\n")}

Sehr geehrte Damen und Herren,

${body}

${extras.join("\n\n")}${extras.length ? "\n\n" : ""}Mit freundlichen Grüßen


${p.name || "[Unterschrift]"}`;
}

export async function openLetter(c) {
  if (!state.profile) state.profile = await api.profile();
  const p = state.profile;
  const missingProfile = !p.name || !p.street || !p.zip_city;
  const defaults = {
    type: "regular",
    end_date: c.end_date || c.next_term_end,
    confirm: true,
    sepa: true,
    no_ads: true,
    port_number: c.category === "mobile",
  };

  const m = modal({
    title: "Kündigungsschreiben",
    wide: true,
    body: `
      <div class="grid" style="grid-template-columns:minmax(0,1fr);gap:16px">
        ${
          missingProfile
            ? `<details class="more" open><summary>${icon("user")} Deine Absenderdaten <span class="muted small" style="font-weight:500">– werden gespeichert</span>${icon("chevDown", "chev")}</summary>
               <div class="body"><form id="lp" class="form-grid">
                 <label class="field"><span>Name</span><input name="name" value="${esc(p.name ?? "")}"/></label>
                 <label class="field"><span>Straße & Nr.</span><input name="street" value="${esc(p.street ?? "")}"/></label>
                 <label class="field"><span>PLZ & Ort</span><input name="zip_city" value="${esc(p.zip_city ?? "")}"/></label>
                 <label class="field"><span>E-Mail (optional)</span><input name="email" value="${esc(p.email ?? "")}"/></label>
               </form></div></details>`
            : ""
        }
        ${
          !c.provider_address
            ? `<div class="callout warn">${icon("info")}<div>Keine Anbieter-Anschrift hinterlegt. Ergänze sie beim Vertrag oder lade ein Schreiben des Anbieters hoch – die Adresse wird per OCR erkannt.</div></div>`
            : ""
        }
        <form id="lo" class="form-grid">
          <label class="field"><span>Art</span><select name="type">${Object.entries(TYPES)
            .map(([k, v]) => `<option value="${k}">${v}</option>`)
            .join("")}</select></label>
          <label class="field"><span>Kündigen zum</span><input type="date" name="end_date" value="${esc(defaults.end_date || "")}"/></label>
          <label class="field move-only hidden"><span>Umzugsdatum</span><input type="date" name="move_date"/></label>
          <label class="field move-only hidden span-2"><span>Neue Anschrift</span><input name="new_address" placeholder="Straße, PLZ Ort"/></label>
          <label class="check span-all"><input type="checkbox" name="confirm" checked/> Schriftliche Bestätigung anfordern</label>
          <label class="check span-all"><input type="checkbox" name="sepa" checked/> SEPA-Lastschriftmandat widerrufen</label>
          <label class="check span-all"><input type="checkbox" name="no_ads" checked/> Werbung & Rückgewinnungsanrufen widersprechen</label>
          ${c.attributes?.phone_number ? `<label class="check span-all"><input type="checkbox" name="port_number" ${defaults.port_number ? "checked" : ""}/> Rufnummernmitnahme ankündigen</label>` : ""}
        </form>
        <div class="letter" id="letter" contenteditable="true" spellcheck="false"></div>
        <p class="small muted" style="margin:0">Der Text ist direkt bearbeitbar. Tipp: Per Einschreiben, Fax oder über das Kündigungsformular des Anbieters (§ 312k BGB „Kündigungsbutton“) versenden.</p>
      </div>`,
    foot: `<button class="btn" data-copy>${icon("copy")} Kopieren</button>
           <button class="btn" data-mail>${icon("mail")} E-Mail</button>
           <button class="btn btn-primary" data-print>${icon("printer")} Drucken / PDF</button>`,
  });

  const letter = $("#letter", m);
  const options = () => {
    const o = formData($("#lo", m));
    m.querySelectorAll(".move-only").forEach((x) => x.classList.toggle("hidden", o.type !== "move"));
    return o;
  };
  const profile = () => ($("#lp", m) ? { ...p, ...formData($("#lp", m)) } : p);
  const draw = () => (letter.textContent = compose(c, profile(), options()));
  m.addEventListener("input", (e) => {
    if (e.target.closest("#lo, #lp")) draw();
  });
  m.addEventListener("change", (e) => {
    if (e.target.closest("#lo")) draw();
  });
  draw();

  const saveProfile = async () => {
    if (!$("#lp", m)) return;
    state.profile = await api.saveProfile(profile());
  };
  $("[data-copy]", m).addEventListener("click", async () => {
    await saveProfile();
    await navigator.clipboard.writeText(letter.innerText);
    toast("In die Zwischenablage kopiert");
  });
  $("[data-mail]", m).addEventListener("click", async () => {
    await saveProfile();
    const subject = `${TYPES[options().type]}: ${c.name}${c.customer_number ? ` (Kd.-Nr. ${c.customer_number})` : ""}`;
    location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(letter.innerText)}`;
  });
  $("[data-print]", m).addEventListener("click", async () => {
    await saveProfile();
    const w = window.open("", "_blank");
    if (!w) return toast("Popup blockiert – bitte erlauben", "error");
    w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kündigung ${esc(c.name)}</title>
      <style>@page{margin:25mm 22mm}body{font:11.5pt/1.55 Georgia,"Times New Roman",serif;color:#000;white-space:pre-wrap;margin:0}</style>
      </head><body>${esc(letter.innerText)}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  });
}
