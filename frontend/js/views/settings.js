import { api } from "../api.js";
import { state } from "../store.js";
import { $, busy, confirmDialog, esc, fileSize, formData, icon, modal, toast } from "../ui.js";
import { router, start, watchIdle } from "../app.js";
import { bindRecoveryKey, recoveryKeyHtml } from "./auth.js";

const isAdmin = () => state.user?.role === "admin";

export async function renderSettings(view) {
  const [profile, me, backups, users, cal] = await Promise.all([
    api.profile(),
    api.me(),
    isAdmin() ? api.backups() : Promise.resolve(null),
    isAdmin() ? api.users() : Promise.resolve(null),
    api.calendarToken(),
  ]);
  const calUrl = `${location.origin}/api/calendar/${cal.token}.ics`;
  state.profile = profile;
  state.user = me;
  const cfg = me.settings || {};

  view.innerHTML = `
    <div class="page-head"><div><h1>Einstellungen</h1><p>Profil, Sicherheit, Benachrichtigungen${isAdmin() ? ", Benutzer und Datensicherung" : ""}.</p></div></div>
    <div class="grid grid-2 mb-4">
      ${[
        ["#/emergency", "shield", "Notfall-Mappe", "Alles Wichtige für Angehörige – drucken oder als verschlüsselte Datei"],
        ["#/import", "upload", "Verträge importieren", "Vertragsliste aus Excel oder CSV übernehmen"],
      ]
        .map(
          ([href, ic, t, sub]) => `<a class="card list-item settings-link" href="${href}">
            <span class="kpi-icon">${icon(ic)}</span><div class="grow"><div class="title">${t}</div><div class="sub">${sub}</div></div>${icon("chevRight")}</a>`,
        )
        .join("")}
    </div>
    <div class="grid grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h2>${icon("lock")} Konto & Sicherheit</h2><p>Angemeldet als <b>${esc(me.username)}</b> · ${me.role === "admin" ? "Administrator" : "Mitglied"}</p></div></div>
          <div class="callout good">${icon("shield")}<div>Deine Verträge, Dokumente und PDFs sind <b>verschlüsselt gespeichert</b> (AES-256).
            Beim Abmelden wird dein Schlüssel aus dem Speicher gelöscht – danach kann niemand die Daten lesen, auch kein Admin.</div></div>
          <div class="list-item" style="margin-top:12px;border-top:1px solid var(--border)">
            <span class="kpi-icon">${icon("shield")}</span>
            <div class="grow"><div class="title">Zwei-Faktor-Anmeldung</div>
              <div class="sub">${me.totp_enabled ? "Aktiv – beim Anmelden wird zusätzlich ein Code aus der Authenticator-App abgefragt." : "Zusätzlicher Code aus einer Authenticator-App (z. B. Aegis, Google Authenticator)."}</div></div>
            <button class="btn btn-sm ${me.totp_enabled ? "btn-ghost" : "btn-primary"}" id="totp">${me.totp_enabled ? "Ausschalten" : "Einrichten"}</button>
          </div>
          <label class="field mt-3"><span>Automatisch abmelden</span>
            <select id="idle">${[
              [0, "Nie – nur über „Abmelden“"],
              [5, "nach 5 Minuten ohne Aktivität"],
              [15, "nach 15 Minuten ohne Aktivität"],
              [30, "nach 30 Minuten ohne Aktivität"],
              [60, "nach 1 Stunde ohne Aktivität"],
              [240, "nach 4 Stunden ohne Aktivität"],
            ]
              .map(([v, l]) => `<option value="${v}" ${Number(cfg.idle_minutes || 0) === v ? "selected" : ""}>${l}</option>`)
              .join("")}</select>
            <small>Danach bist du abgemeldet und deine Daten sind wieder verschlüsselt – auch wenn du den Tab einfach schließt. Gilt auch für „Angemeldet bleiben“.</small></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
            <button class="btn" id="pw">${icon("key")} Passwort ändern</button>
            <button class="btn" id="rk">${icon("refresh")} Neuer Wiederherstellungsschlüssel</button>
            <button class="btn btn-ghost" data-action="logout">${icon("logout")} Abmelden</button>
          </div>
        </div>

        <form class="card" id="profile">
          <div class="card-head"><div><h2>${icon("user")} Dein Profil</h2><p>Für die Begrüßung und als Absender im Kündigungsschreiben.</p></div></div>
          <div class="form-grid">
            <label class="field span-2"><span>Name</span><input name="name" value="${esc(profile.name ?? "")}"/></label>
            <label class="field"><span>Straße & Nr.</span><input name="street" value="${esc(profile.street ?? "")}"/></label>
            <label class="field"><span>PLZ & Ort</span><input name="zip_city" value="${esc(profile.zip_city ?? "")}"/></label>
            <label class="field"><span>E-Mail</span><input type="email" name="email" value="${esc(profile.email ?? "")}"/></label>
            <label class="field"><span>Telefon</span><input name="phone" value="${esc(profile.phone ?? "")}"/></label>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" type="submit">${icon("check")} Speichern</button></div>
        </form>

        <form class="card" id="notify">
          <div class="card-head"><div><h2>${icon("bell")} Benachrichtigungen</h2><p>Erinnerungen an Fristen – kommen auch, wenn du abgemeldet bist.</p></div></div>
          <div class="form-grid">
            <label class="field span-2"><span>E-Mail-Adresse</span><input type="email" name="notify_email" value="${esc(cfg.notify_email ?? "")}" placeholder="${
              state.meta.smtp ? "" : "E-Mail-Versand ist auf dem Server nicht eingerichtet"
            }"/></label>
            <label class="field span-2"><span>ntfy-Adresse (Push aufs Handy)</span><input name="ntfy_url" value="${esc(cfg.ntfy_url ?? "")}"/>
              <small>In der ntfy-App ein Thema abonnieren und dessen Adresse hier eintragen.</small></label>
            <label class="check span-all"><input type="checkbox" name="reveal_names" ${cfg.reveal_names ? "checked" : ""}/>
              <span>Vertragsnamen in Erinnerungen & Kalender zeigen<br/><small class="muted">Aus: neutral wie „Kündigungsfrist Mobilfunk-Vertrag“. Diese Angaben bleiben für den Versand auch nach dem Abmelden lesbar.</small></span></label>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap">
            <button class="btn" type="button" id="test">${icon("sparkles")} Test senden</button>
            <button class="btn btn-primary" type="submit">${icon("check")} Speichern</button>
          </div>
        </form>

        <div class="card">
          <div class="card-head"><div><h2>${icon("calendar")} Kalender-Abo</h2>
            <p>Fristen & Erinnerungen im Handy- oder Outlook-Kalender. Der Link ist geheim und persönlich.</p></div></div>
          <div class="input-group"><input class="input" readonly value="${esc(calUrl)}" id="cal"/><button class="btn" id="copy-cal" title="Link kopieren" style="border-radius:0 var(--radius-sm) var(--radius-sm) 0">${icon("copy")}</button></div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <a class="btn" href="${calUrl.replace(/^https?/, "webcal")}">${icon("link")} Im Kalender öffnen</a>
            <button class="btn btn-ghost" id="new-cal" title="Alten Link ungültig machen">${icon("refresh")} Neuer Link</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h2>${icon("home")} Home Assistant</h2><p>Monatskosten, nächste Frist & offene Erinnerungen als Sensor – nur lesend.</p></div></div>
          ${
            me.api_token
              ? `<div class="callout good">${icon("check")}<div>Ein API-Token ist aktiv. Contractly hält dafür einige Kennzahlen (Summen, nächster Termin mit neutraler Bezeichnung) auch im abgemeldeten Zustand bereit.</div></div>
                 <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" id="ha-new">${icon("refresh")} Neuer Token</button><button class="btn btn-ghost btn-danger" id="ha-off">${icon("x")} Abschalten</button></div>`
              : `<button class="btn" id="ha-new">${icon("plus")} API-Token erzeugen</button>`
          }
        </div>

        <div class="card">
          <div class="card-head"><div><h2>${icon("download")} Export</h2><p>Deine Vertragsdaten als JSON (ohne Dateien) – Achtung: unverschlüsselt.</p></div></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a class="btn" href="/api/export">${icon("download")} JSON exportieren</a>
            <a class="btn btn-ghost" href="/api/calendar.ics">${icon("calendar")} Kalender (.ics)</a>
          </div>
        </div>
      </div>

      <div class="stack">
        ${isAdmin() ? usersCard(users, me) + backupCard(backups) : memberInfo()}
        <div class="card">
          <div class="card-head"><div><h2>${icon("info")} Über Contractly</h2></div></div>
          <p class="small text-2 m-0">Selbst gehostete Vertragsverwaltung. Deine Daten bleiben auf deinem Server – kein Vergleichsportal, keine Werbung, kein Tracking.
          Texterkennung (OCR): ${state.meta.ocr?.tesseract ? "verfügbar ✓" : "nicht verfügbar"}</p>
          <p class="small muted mt-2 mb-1">Version ${esc(state.meta.version || "")}${
            state.meta.build && state.meta.build !== "dev" ? ` · Build ${esc(state.meta.build)}` : ""
          }</p>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>${icon("trash")} Neu anfangen</h2>
            <p>Löscht alle Verträge, Dokumente, Einnahmen, Erinnerungen und die Notfall-Hinweise – z. B. die Demo-Daten.
              Konto, Passwort, Zwei-Faktor-Anmeldung, Benachrichtigungen und dein Profil bleiben.</p></div></div>
          <button class="btn btn-danger" id="reset">${icon("trash")} Alle Daten löschen</button>
        </div>
      </div>
    </div>`;

  $("#profile", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    state.profile = await api.saveProfile(formData(e.target));
    toast("Profil gespeichert");
  });
  $("#notify", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    try {
      state.user = await api.saveAccountSettings({
        notify_email: d.notify_email || "",
        ntfy_url: d.ntfy_url || "",
        reveal_names: !!d.reveal_names,
        idle_minutes: Number(state.user?.settings?.idle_minutes || 0),
      });
      toast("Benachrichtigungen gespeichert");
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("#test", view).addEventListener("click", async (e) => {
    busy(e.currentTarget);
    try {
      const r = await api.testNotification();
      toast(`Gesendet über ${r.sent.join(" & ")}`);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      busy(e.currentTarget, false);
    }
  });
  $("#copy-cal", view).addEventListener("click", async () => {
    await navigator.clipboard.writeText(calUrl);
    toast("Link kopiert");
  });
  $("#new-cal", view).addEventListener("click", async () => {
    if (await confirmDialog("Der bisherige Kalender-Link funktioniert dann nicht mehr. Neuen Link erzeugen?", { okLabel: "Neuer Link", danger: false })) {
      await api.newCalendarToken();
      toast("Neuer Kalender-Link erstellt");
      router();
    }
  });
  $("#idle", view).addEventListener("change", async (e) => {
    const s = state.user?.settings || {};
    try {
      state.user = await api.saveAccountSettings({
        notify_email: s.notify_email || "",
        ntfy_url: s.ntfy_url || "",
        reveal_names: !!s.reveal_names,
        idle_minutes: Number(e.target.value),
      });
      watchIdle();
      toast(Number(e.target.value) ? "Automatische Abmeldung eingestellt" : "Automatische Abmeldung aus");
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("#pw", view).addEventListener("click", changePasswordModal);
  $("#totp", view).addEventListener("click", () => (me.totp_enabled ? disableTotpModal() : enableTotpModal()));
  $("#ha-new", view).addEventListener("click", haTokenModal);
  $("#ha-off", view)?.addEventListener("click", async () => {
    if (await confirmDialog("API-Token löschen? Home Assistant erhält dann keine Werte mehr.", { okLabel: "Abschalten" })) {
      await api.revokeApiToken();
      router();
    }
  });
  $("#rk", view).addEventListener("click", recoveryKeyModal);
  $("#reset", view).addEventListener("click", resetModal);
  if (isAdmin()) {
    bindUsers(view);
    bindBackups(view);
  }
}

function memberInfo() {
  return `<div class="card"><div class="card-head"><div><h2>${icon("users")} Mehrere Benutzer</h2></div></div>
    <p class="small text-2 m-0">Du hast einen eigenen, getrennt verschlüsselten Bereich. Benutzerverwaltung und Datensicherung übernimmt der Administrator.
    Die Sicherungen enthalten deinen Bereich nur verschlüsselt – lesbar nur mit deinem Passwort.</p></div>`;
}

// ------------------------------------------------------------------ password & recovery key

function resetModal() {
  const m = modal({
    title: "Alle Daten löschen?",
    body: `<p class="mt-0">Alle Verträge mit Preisen, Dokumenten und Zählerständen, alle Einnahmen, Erinnerungen und die Notfall-Hinweise
      werden <b>endgültig</b> gelöscht. Das lässt sich nicht rückgängig machen – höchstens über ein vorher erstelltes Backup.</p>
      <label class="field"><span>Zur Bestätigung <b>LÖSCHEN</b> eingeben</span>
        <input name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false"/></label>`,
    foot: `<button class="btn" data-close>Abbrechen</button>
      <button class="btn" data-ok disabled style="background:var(--bad);border-color:var(--bad);color:#fff">${icon("trash")} Endgültig löschen</button>`,
  });
  const input = $("[name=confirm]", m);
  const ok = $("[data-ok]", m);
  input.addEventListener("input", () => (ok.disabled = input.value.trim().toUpperCase() !== "LÖSCHEN"));
  input.focus();
  ok.addEventListener("click", async () => {
    busy(ok);
    try {
      const r = await api.resetData({ confirm: input.value });
      m.close();
      toast(`Gelöscht: ${r.contracts} Verträge, ${r.income_sources} Einnahmen, ${r.documents} Dokumente`);
      location.hash = "#/";
    } catch (err) {
      busy(ok, false);
      toast(err.message, "error");
    }
  });
}

function changePasswordModal() {
  const m = modal({
    title: "Passwort ändern",
    body: `<form class="stack" id="cp" style="gap:12px">
      <label class="field"><span>Aktuelles Passwort</span><input type="password" name="old_password" autocomplete="current-password" required/></label>
      <label class="field"><span>Neues Passwort</span><input type="password" name="new_password" autocomplete="new-password" required/>
        <small>Mindestens 10 Zeichen. Deine Daten müssen dafür nicht neu verschlüsselt werden.</small></label>
      <label class="field"><span>Neues Passwort wiederholen</span><input type="password" name="new_password2" autocomplete="new-password" required/></label>
    </form>`,
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-ok>${icon("check")} Ändern</button>`,
  });
  $("[data-ok]", m).addEventListener("click", async (e) => {
    const d = formData($("#cp", m));
    if (d.new_password !== d.new_password2) return toast("Die Passwörter stimmen nicht überein", "error");
    busy(e.currentTarget);
    try {
      await api.changePassword({ old_password: d.old_password, new_password: d.new_password });
      m.close();
      toast("Passwort geändert – andere Geräte wurden abgemeldet");
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

function recoveryKeyModal() {
  const m = modal({
    title: "Neuer Wiederherstellungsschlüssel",
    body: `<p class="mt-0">Der bisherige Schlüssel wird ungültig. Bitte bestätige mit deinem Passwort.</p>
      <label class="field"><span>Passwort</span><input type="password" id="rk-pw" autocomplete="current-password"/></label>
      <div id="rk-out"></div>`,
    foot: `<button class="btn" data-close>Schließen</button><button class="btn btn-primary" data-ok>${icon("key")} Erzeugen</button>`,
  });
  $("[data-ok]", m).addEventListener("click", async (e) => {
    busy(e.currentTarget);
    try {
      const { recovery_key } = await api.newRecoveryKey($("#rk-pw", m).value);
      $("#rk-out", m).innerHTML = `<div class="callout warn mt-3">${icon("alert")}<div>Nur jetzt sichtbar – sicher aufbewahren!</div></div>${recoveryKeyHtml(recovery_key)}`;
      bindRecoveryKey($("#rk-out", m), recovery_key);
      e.currentTarget.remove();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

// ------------------------------------------------------------------ 2FA & Home Assistant

async function enableTotpModal() {
  const setup = await api.totpSetup();
  const m = modal({
    title: "Zwei-Faktor-Anmeldung einrichten",
    body: `<ol class="small text-2" style="margin-top:0;padding-left:18px">
        <li>QR-Code mit einer Authenticator-App scannen (z. B. Aegis, 2FAS, Google oder Microsoft Authenticator).</li>
        <li>Den angezeigten 6-stelligen Code eingeben.</li></ol>
      <div class="qr">${setup.qr_svg}</div>
      <details class="more" style="margin:10px 0"><summary>Code manuell eingeben${icon("chevDown", "chev")}</summary><div class="body mono small" style="word-break:break-all">${esc(setup.secret)}</div></details>
      <label class="field"><span>Code aus der App</span><input class="mono" id="totp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456"/></label>
      <p class="small muted">Handy verloren? Mit deinem Wiederherstellungsschlüssel kommst du trotzdem rein – dabei wird die Zwei-Faktor-Anmeldung zurückgesetzt.</p>`,
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-ok>${icon("check")} Aktivieren</button>`,
  });
  $("[data-ok]", m).addEventListener("click", async (e) => {
    busy(e.currentTarget);
    try {
      await api.totpEnable($("#totp-code", m).value);
      m.close();
      toast("Zwei-Faktor-Anmeldung ist aktiv 🔐");
      router();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

function disableTotpModal() {
  const m = modal({
    title: "Zwei-Faktor-Anmeldung ausschalten",
    body: `<label class="field"><span>Passwort zur Bestätigung</span><input type="password" id="pw-off" autocomplete="current-password"/></label>`,
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-ok>Ausschalten</button>`,
  });
  $("[data-ok]", m).addEventListener("click", async (e) => {
    busy(e.currentTarget);
    try {
      await api.totpDisable($("#pw-off", m).value);
      m.close();
      toast("Zwei-Faktor-Anmeldung ausgeschaltet");
      router();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}

async function haTokenModal() {
  const { token } = await api.createApiToken();
  const url = `${location.origin}/api/ha/summary`;
  const yaml = `rest:
  - resource: ${url}
    headers:
      Authorization: "Bearer ${token}"
    scan_interval: 3600
    sensor:
      - name: "Vertragskosten pro Monat"
        value_template: "{{ value_json.monthly_total }}"
        unit_of_measurement: "€"
      - name: "Nächste Vertragsfrist"
        value_template: "{{ value_json.next_date }}"
        json_attributes: [next_title, due_reminders, active_contracts]`;
  const m = modal({
    title: "Home Assistant verbinden",
    wide: true,
    body: `<p class="mt-0">In die <code>configuration.yaml</code> von Home Assistant einfügen und neu starten. Der Token wird nur jetzt angezeigt.</p>
      <textarea class="input mono small" rows="13" readonly>${esc(yaml)}</textarea>`,
    foot: `<button class="btn" data-copy>${icon("copy")} Kopieren</button><button class="btn btn-primary" data-close>Fertig</button>`,
  });
  $("[data-copy]", m).addEventListener("click", async () => {
    await navigator.clipboard.writeText(yaml);
    toast("Kopiert");
  });
  m.querySelector("[data-close]").addEventListener("click", () => router());
}

// ------------------------------------------------------------------ users (admin)

function usersCard(users, me) {
  const fmt = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString("de-DE") : "–");
  return `<div class="card">
    <div class="card-head"><div><h2>${icon("users")} Benutzer</h2><p>Jeder Benutzer hat einen eigenen, getrennt verschlüsselten Bereich – du siehst keine fremden Verträge.</p></div></div>
    <div class="list" id="users">
      ${users
        .map(
          (u) => `<div class="list-item">
          <span class="avatar">${esc(u.username.slice(0, 1).toUpperCase())}</span>
          <div class="grow"><div class="title">${esc(u.username)}${u.id === me.id ? ` <span class="badge info">Du</span>` : ""}</div>
            <div class="sub">${u.role === "admin" ? "Administrator" : "Mitglied"} · ${
              u.status === "invited" ? `Einladung offen bis ${fmt(u.invite_expires)}` : `zuletzt angemeldet ${fmt(u.last_login)}`
            }</div></div>
          ${
            u.id === me.id
              ? ""
              : `<div class="menu"><button class="btn btn-ghost btn-sm" data-menu aria-label="Aktionen">${icon("more")}</button>
                  <div class="menu-pop">
                    ${u.status === "invited" ? `<button data-renew="${u.id}">${icon("refresh")} Neuen Einladungscode</button>` : ""}
                    <button data-role="${u.id}" data-to="${u.role === "admin" ? "member" : "admin"}">${icon("shield")} ${u.role === "admin" ? "Zum Mitglied machen" : "Zum Admin machen"}</button>
                    <hr/><button class="danger" data-del-user="${u.id}" data-name="${esc(u.username)}">${icon("trash")} Benutzer & Daten löschen</button>
                  </div></div>`
          }
        </div>`,
        )
        .join("")}
    </div>
    <form id="invite" class="form-grid mt-3">
      <label class="field"><span>Neuer Benutzer</span><input name="username" required/></label>
      <label class="field"><span>Rolle</span><select name="role"><option value="member">Mitglied</option><option value="admin">Administrator</option></select></label>
      <div class="field span-all"><button class="btn btn-primary" type="submit">${icon("plus")} Einladen</button></div>
    </form>
  </div>`;
}

function showInviteCode(username, code) {
  const text = `Hallo ${username},\n\ndu wurdest zu Contractly eingeladen.\n1. ${location.origin} öffnen\n2. „Einladungscode einlösen“ wählen\n3. Benutzername: ${username}\n   Einladungscode: ${code}\n4. Eigenes Passwort festlegen.\n\nDer Code ist 7 Tage gültig.`;
  const m = modal({
    title: "Einladung erstellt",
    body: `<p class="mt-0">Gib <b>${esc(username)}</b> diesen Code (7 Tage gültig). Damit legt die Person ihr eigenes Passwort fest – du erfährst es nicht und kannst ihre Daten nicht lesen.</p>
      <div class="recovery-key mono">${esc(code)}</div>
      <textarea class="input mono small" rows="7" readonly id="inv-text">${esc(text)}</textarea>`,
    foot: `<button class="btn" data-copy>${icon("copy")} Nachricht kopieren</button><button class="btn btn-primary" data-close>Fertig</button>`,
  });
  $("[data-copy]", m).addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    toast("Kopiert");
  });
}

function bindUsers(view) {
  $("#invite", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    try {
      const r = await api.inviteUser({ username: d.username, role: d.role || "member" });
      showInviteCode(r.user.username, r.code);
      router();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("#users", view).addEventListener("click", async (e) => {
    const renew = e.target.closest("[data-renew]");
    const role = e.target.closest("[data-role]");
    const del = e.target.closest("[data-del-user]");
    try {
      if (renew) {
        const r = await api.renewInvite(renew.dataset.renew);
        showInviteCode(r.user.username, r.code);
        router();
      }
      if (role) {
        await api.setRole(role.dataset.role, role.dataset.to);
        toast("Rolle geändert");
        router();
      }
      if (del && (await confirmDialog(`„${del.dataset.name}“ und alle Verträge, Dokumente und Erinnerungen dieser Person endgültig löschen?`))) {
        await api.deleteUser(del.dataset.delUser);
        toast("Benutzer gelöscht");
        router();
      }
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ------------------------------------------------------------------ backups (admin)

function backupCard(backups) {
  const cloud = backups.cloud;
  return `
    <div class="card">
      <div class="card-head"><div><h2>${icon("shield")} Datensicherung</h2><p>Alle Benutzer inkl. Dokumente – die Bereiche bleiben mit den Schlüsseln der Benutzer verschlüsselt.</p></div></div>
      <form id="bk" class="stack" style="gap:12px">
        <label class="field"><span>${icon("lock")} Zusätzlich verschlüsseln mit Backup-Schlüssel <span class="muted">(optional, min. 8 Zeichen)</span></span>
          <input type="password" name="passphrase" autocomplete="new-password" placeholder="Leer lassen = nur Benutzer-Verschlüsselung"/>
          <small>Schützt auch die Benutzerliste. Ohne diesen Schlüssel lässt sich das Backup nicht einspielen.</small></label>
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
          backups.schedule !== "off" ? ` · behält ${backups.keep}${backups.auto_encrypted ? " · mit Backup-Schlüssel 🔒" : ""}` : ""
        } – läuft auch, wenn niemand angemeldet ist.</span></div></div>
      <div class="list mt-2" id="bk-list">
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
      <div class="card-head"><div><h2>${icon("refresh")} Wiederherstellen</h2><p>Ersetzt alle Benutzer und Daten durch den Stand des Backups. Danach melden sich alle mit dem damals gültigen Passwort an.</p></div></div>
      <form id="restore" class="stack" style="gap:12px">
        <input type="file" name="file" accept=".zip,.ctly" class="input"/>
        <input type="password" name="passphrase" class="input" placeholder="Backup-Schlüssel (nur bei .ctly-Dateien)" autocomplete="off"/>
        <button class="btn" type="submit">${icon("upload")} Backup einspielen</button>
      </form>
    </div>`;
}

function bindBackups(view) {
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
    if (!(await confirmDialog("Alle aktuellen Benutzer und Daten werden durch das Backup ersetzt. Fortfahren?", { okLabel: "Wiederherstellen" })))
      return;
    const btn = $("button[type=submit]", e.target);
    busy(btn);
    try {
      const res = await api.restoreBackup(file, e.target.passphrase.value);
      toast(`Wiederhergestellt (${res.users} Benutzer, ${res.documents} Dokumente)`);
      state.profile = null;
      if (res.relogin) start();
      else location.hash = "#/";
    } catch (err) {
      toast(err.message, "error");
      busy(btn, false);
    }
  });
}

/** Mobile "Mehr" page: entries that don't fit the bottom bar. */
