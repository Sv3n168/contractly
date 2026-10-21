import { api } from "../api.js";
import { state } from "../store.js";
import { $, busy, confirmDialog, esc, fileSize, formData, icon, toast } from "../ui.js";
import { router } from "../app.js";

export async function renderSettings(view) {
  const [profile, backups] = await Promise.all([api.profile(), api.backups()]);
  state.profile = profile;
  const cloud = backups.cloud;

  view.innerHTML = `
    <div class="page-head"><div><h1>Einstellungen</h1><p>Profil, Datensicherung und Export.</p></div></div>
    <div class="grid grid-2">
      <div class="stack">
        <form class="card" id="profile">
          <div class="card-head"><div><h2>${icon("user")} Dein Profil</h2><p>Für die Begrüßung und als Absender im Kündigungsschreiben.</p></div></div>
          <div class="form-grid">
            <label class="field span-2"><span>Name</span><input name="name" value="${esc(profile.name ?? "")}" placeholder="Max Mustermann"/></label>
            <label class="field"><span>Straße & Nr.</span><input name="street" value="${esc(profile.street ?? "")}"/></label>
            <label class="field"><span>PLZ & Ort</span><input name="zip_city" value="${esc(profile.zip_city ?? "")}"/></label>
            <label class="field"><span>E-Mail</span><input type="email" name="email" value="${esc(profile.email ?? "")}"/></label>
            <label class="field"><span>Telefon</span><input name="phone" value="${esc(profile.phone ?? "")}"/></label>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" type="submit">${icon("check")} Speichern</button></div>
        </form>

        <div class="card">
          <div class="card-head"><div><h2>${icon("download")} Export</h2><p>Alle Vertragsdaten als JSON (ohne Dateien) – z. B. für Tabellen oder Archiv.</p></div></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a class="btn" href="/api/export">${icon("download")} JSON exportieren</a>
            <a class="btn btn-ghost" href="/api/calendar.ics">${icon("calendar")} Kalender (.ics)</a>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h2>${icon("info")} Über Contractly</h2></div></div>
          <p class="small text-2" style="margin:0">Selbst gehostete Vertragsverwaltung. Deine Daten bleiben auf deinem Server – kein Vergleichsportal, keine Werbung, kein Tracking.
          OCR: ${state.meta.ocr?.tesseract ? "verfügbar ✓" : "nicht verfügbar"} · Zugangsschutz: ${state.meta.auth ? "aktiv ✓" : "aus (CONTRACTLY_PASSWORD setzen)"}</p>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>${icon("shield")} Datensicherung</h2><p>Vollständiges Backup: Datenbank + alle Dokumente.</p></div></div>
          <form id="bk" class="stack" style="gap:12px">
            <label class="field"><span>${icon("lock")} Verschlüsseln mit Schlüssel <span class="muted">(optional, min. 8 Zeichen)</span></span>
              <input type="password" name="passphrase" autocomplete="new-password" placeholder="Leer lassen = unverschlüsselt"/>
              <small>AES-256-GCM. Ohne Schlüssel lässt sich das Backup nicht wiederherstellen – gut aufbewahren!</small></label>
            ${cloud.configured ? `<label class="check"><input type="checkbox" name="upload" checked/> ${icon("cloud")} Danach in die Cloud hochladen (${esc(cloud.remote)})</label>` : ""}
            <button class="btn btn-primary" type="submit">${icon("shield")} Backup jetzt erstellen</button>
          </form>
          <div class="callout ${cloud.configured ? "good" : ""}" style="margin-top:16px">${icon("cloud")}<div>
            ${
              cloud.configured
                ? `Cloud-Ziel: <b>${esc(cloud.remote)}</b>`
                : `Cloud-Backup (OneDrive, Google Drive, Dropbox, Nextcloud …) über <b>rclone</b>: Remote einrichten und <code>CONTRACTLY_BACKUP_REMOTE</code> setzen – siehe README.`
            }
            <br><span class="small">Automatisch: <b>${{ off: "aus", daily: "täglich", weekly: "wöchentlich" }[backups.schedule] || backups.schedule}</b>${
              backups.schedule !== "off" ? ` · behält ${backups.keep} · ${backups.auto_encrypted ? "verschlüsselt 🔒" : "unverschlüsselt"}` : ""
            }</span></div></div>
          <div class="list" style="margin-top:12px" id="bk-list">
            ${
              backups.backups.length
                ? backups.backups
                    .map(
                      (b) => `<div class="list-item">
                    <span class="cat-icon sm" style="--c:var(--series-${b.encrypted ? 7 : 3})">${b.encrypted ? "🔒" : "📦"}</span>
                    <div class="grow"><div class="title small">${esc(b.name)}</div>
                      <div class="sub">${new Date(b.created_at).toLocaleString("de-DE")} · ${fileSize(b.size)}${b.automatic ? " · automatisch" : ""}</div></div>
                    ${cloud.configured ? `<button class="btn btn-ghost btn-sm" data-up="${esc(b.name)}" title="In Cloud hochladen">${icon("cloud")}</button>` : ""}
                    <a class="btn btn-ghost btn-sm" href="/api/backups/${encodeURIComponent(b.name)}" title="Herunterladen">${icon("download")}</a>
                    <button class="btn btn-ghost btn-sm btn-danger" data-del="${esc(b.name)}" title="Löschen">${icon("trash")}</button></div>`,
                    )
                    .join("")
                : `<p class="muted small">Noch keine Backups vorhanden.</p>`
            }
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>${icon("refresh")} Wiederherstellen</h2><p>Ersetzt alle aktuellen Daten. Vorher wird automatisch ein Sicherheits-Backup angelegt.</p></div></div>
          <form id="restore" class="stack" style="gap:12px">
            <input type="file" name="file" accept=".zip,.ctly" class="input"/>
            <input type="password" name="passphrase" class="input" placeholder="Schlüssel (nur bei verschlüsselten Backups)" autocomplete="off"/>
            <button class="btn" type="submit">${icon("upload")} Backup einspielen</button>
          </form>
        </div>
      </div>
    </div>`;

  $("#profile", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    state.profile = await api.saveProfile(formData(e.target));
    toast("Profil gespeichert");
  });
  $("#bk", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const btn = $("button[type=submit]", e.target);
    busy(btn);
    try {
      const res = await api.createBackup({ passphrase: d.passphrase || null, upload: !!d.upload });
      toast(`Backup erstellt${res.uploaded ? " & hochgeladen ☁️" : ""}`);
      router();
    } catch (err) {
      toast(err.message, "error");
      busy(btn, false);
    }
  });
  $("#bk-list", view).addEventListener("click", async (e) => {
    const up = e.target.closest("[data-up]");
    const del = e.target.closest("[data-del]");
    if (up) {
      busy(up);
      try {
        await api.uploadBackup(up.dataset.up);
        toast("In die Cloud hochgeladen ☁️");
      } catch (err) {
        toast(err.message, "error");
      }
      busy(up, false);
    }
    if (del && (await confirmDialog(`Backup ${del.dataset.del} löschen?`))) {
      await api.deleteBackup(del.dataset.del);
      router();
    }
  });
  $("#restore", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = e.target.file.files[0];
    if (!file) return toast("Bitte eine Backup-Datei wählen", "error");
    if (!(await confirmDialog("Alle aktuellen Daten werden durch das Backup ersetzt. Fortfahren?", { okLabel: "Wiederherstellen" }))) return;
    const btn = $("button[type=submit]", e.target);
    busy(btn);
    try {
      const res = await api.restoreBackup(file, e.target.passphrase.value);
      toast(`Wiederhergestellt (${res.documents} Dokumente)`);
      state.profile = null;
      location.hash = "#/";
    } catch (err) {
      toast(err.message, "error");
      busy(btn, false);
    }
  });
}

/** Mobile "Mehr" page: entries that don't fit the bottom bar. */
export async function renderMore(view) {
  view.innerHTML = `
    <div class="page-head"><div><h1>Mehr</h1></div></div>
    <div class="card" style="padding:8px">
      <div class="list">
        ${[
          ["#/timeline", "timeline", "Zeitstrahl", "Abschlüsse, Wechsel & Fristen"],
          ["#/costs", "chart", "Kosten & Prognose", "Verlauf und Hochrechnung"],
          ["#/settings", "settings", "Einstellungen", "Profil, Backup, Export"],
        ]
          .map(
            ([href, ic, t, s]) => `<a class="list-item" href="${href}" style="padding:14px 10px">
              <span class="kpi-icon">${icon(ic)}</span><div class="grow"><div class="title">${t}</div><div class="sub">${s}</div></div>${icon("chevRight")}</a>`,
          )
          .join("")}
      </div>
    </div>`;
}
