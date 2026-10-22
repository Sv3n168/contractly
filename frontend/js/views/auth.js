// Login, first-time setup, invitation activation and password recovery screens.

import { api } from "../api.js";
import { $, busy, esc, icon, toast } from "../ui.js";

let root;
let status;
let done;

export function showAuth(st, onDone, mode = null) {
  status = st;
  done = onDone;
  root = document.getElementById("auth-root");
  document.getElementById("app-shell").classList.add("hidden");
  root.classList.remove("hidden");
  render(mode || (st.initialized ? "login" : "setup"));
}

export function hideAuth() {
  document.getElementById("auth-root")?.classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
}

const minLen = () => status?.min_password_length || 10;

function passwordFields(label = "Passwort") {
  return `
    <label class="field"><span>${label}</span>
      <input type="password" name="password" autocomplete="new-password" minlength="${minLen()}" required/>
      <div class="pw-meter"><div></div></div>
      <small>Mindestens ${minLen()} Zeichen. Ein Satz aus mehreren Wörtern ist leicht zu merken und sehr sicher.</small></label>
    <label class="field"><span>${label} wiederholen</span>
      <input type="password" name="password2" autocomplete="new-password" required/></label>`;
}

function strength(pw) {
  let score = Math.min(pw.length / 20, 1) * 60;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 12;
  if (/\d/.test(pw)) score += 12;
  if (/[^A-Za-z0-9]/.test(pw)) score += 16;
  return Math.min(score, 100);
}

const SIDE = `
  <div class="auth-side">
    <div class="brand"><span class="brand-mark">${icon("layers")}</span><span>Contractly</span></div>
    <h2>Deine Verträge.<br/>Nur für dich lesbar.</h2>
    <ul>
      <li>${icon("lock")}<span><b>Verschlüsselt gespeichert</b><br/>Datenbank, PDFs und Backups mit AES-256 – der Schlüssel entsteht aus deinem Passwort.</span></li>
      <li>${icon("logout")}<span><b>Abmelden = wieder verschlossen</b><br/>Nach dem Abmelden kann niemand deine Daten lesen – auch nicht der Server oder ein Admin.</span></li>
      <li>${icon("users")}<span><b>Mehrere Benutzer, getrennte Bereiche</b><br/>Jede Person hat ihren eigenen, separat verschlüsselten Bereich.</span></li>
    </ul>
  </div>`;

function frame(content) {
  root.innerHTML = `<div class="auth-wrap">${SIDE}<div class="auth-main"><div class="auth-card">${content}</div></div></div>`;
}

function render(mode) {
  if (mode === "setup") {
    frame(`
      <h1>Willkommen 👋</h1>
      <p class="muted">Lege dein Administrator-Konto an. Aus deinem Passwort wird der Schlüssel abgeleitet, der deine Daten verschlüsselt.</p>
      ${
        status.legacy_data
          ? `<div class="callout warn">${icon("info")}<div>Es wurden vorhandene, noch <b>unverschlüsselte</b> Daten gefunden. Sie werden in dein Konto übernommen und dabei verschlüsselt.</div></div>`
          : ""
      }
      <form class="stack" id="f" style="gap:14px;margin-top:18px">
        ${
          status.setup_code_required
            ? `<label class="field"><span>${icon("shield", "inline")} Einrichtungscode</span>
                <input name="setup_code" class="mono" autocomplete="off" required placeholder="XXXXX-XXXXX-XXXXX-X"/>
                <small>Du rufst Contractly von außerhalb deines Heimnetzes auf. Zum Schutz vor Fremden steht der Code im Container-Log: <code>docker logs contractly</code></small></label>`
            : ""
        }
        <label class="field"><span>Benutzername</span><input name="username" autocomplete="username" required value="admin"/></label>
        ${passwordFields()}
        <button class="btn btn-primary btn-block" type="submit">${icon("lock")} Konto anlegen & verschlüsseln</button>
      </form>`);
    bind("setup", (d) => api.setup({ username: d.username, password: d.password, setup_code: d.setup_code || null }), true);
  } else if (mode === "login") {
    frame(`
      <h1>Anmelden</h1>
      <p class="muted">Mit der Anmeldung werden deine Daten entschlüsselt.</p>
      <form class="stack" id="f" style="gap:14px;margin-top:18px">
        <label class="field"><span>Benutzername</span><input name="username" autocomplete="username" required autofocus/></label>
        <label class="field"><span>Passwort</span><input type="password" name="password" autocomplete="current-password" required/></label>
        <label class="field hidden" id="totp-field"><span>${icon("shield", "inline")} Code aus der Authenticator-App</span>
          <input name="totp" class="mono" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456"/></label>
        <label class="check small"><input type="checkbox" name="remember"/> Angemeldet bleiben (30 Tage, nur auf eigenen Geräten)</label>
        <button class="btn btn-primary btn-block" type="submit">${icon("lock")} Anmelden & entschlüsseln</button>
      </form>
      <div class="auth-links">
        <a href="#" data-mode="activate">${icon("key", "inline")} Einladungscode einlösen</a>
        <a href="#" data-mode="recover">Passwort vergessen?</a>
      </div>`);
    bind("login", (d) =>
      api.login({ username: d.username, password: d.password, remember: d.remember, totp: d.totp || null }),
    );
  } else if (mode === "activate") {
    frame(`
      <h1>Einladung annehmen</h1>
      <p class="muted">Du hast vom Admin einen Benutzernamen und einen Einladungscode bekommen. Lege jetzt dein eigenes Passwort fest – nur du kennst es, niemand sonst kann deine Daten lesen.</p>
      <form class="stack" id="f" style="gap:14px;margin-top:18px">
        <label class="field"><span>Benutzername</span><input name="username" autocomplete="username" required/></label>
        <label class="field"><span>Einladungscode</span><input name="code" class="mono" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" required/></label>
        ${passwordFields("Neues Passwort")}
        <button class="btn btn-primary btn-block" type="submit">${icon("check")} Konto aktivieren</button>
      </form>
      <div class="auth-links"><a href="#" data-mode="login">${icon("back", "inline")} Zur Anmeldung</a></div>`);
    bind("activate", (d) => api.activate({ username: d.username, code: d.code, password: d.password }), true);
  } else if (mode === "recover") {
    frame(`
      <h1>Passwort vergessen</h1>
      <p class="muted">Mit deinem <b>Wiederherstellungsschlüssel</b> (bei der Einrichtung angezeigt) kannst du ein neues Passwort setzen.
        Ohne ihn lassen sich verschlüsselte Daten nicht wiederherstellen – auch nicht vom Admin.</p>
      <form class="stack" id="f" style="gap:14px;margin-top:18px">
        <label class="field"><span>Benutzername</span><input name="username" autocomplete="username" required/></label>
        <label class="field"><span>Wiederherstellungsschlüssel</span><textarea name="recovery_key" class="mono" rows="2" required placeholder="XXXXX-XXXXX-…"></textarea></label>
        ${passwordFields("Neues Passwort")}
        <button class="btn btn-primary btn-block" type="submit">${icon("key")} Neues Passwort setzen</button>
      </form>
      <div class="auth-links"><a href="#" data-mode="login">${icon("back", "inline")} Zur Anmeldung</a></div>`);
    bind(
      "recover",
      (d) => api.recover({ username: d.username, recovery_key: d.recovery_key, new_password: d.password }),
      true,
    );
  }
  root.querySelectorAll("[data-mode]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      render(a.dataset.mode);
    }),
  );
  root.querySelector("input:not([type=checkbox])")?.focus();
}

function bind(mode, call, withNewPassword = false) {
  const form = $("#f", root);
  const meter = $(".pw-meter > div", form);
  if (meter) {
    form.password.addEventListener("input", () => {
      const s = strength(form.password.value);
      meter.style.width = s + "%";
      meter.style.background = s < 40 ? "var(--bad)" : s < 70 ? "var(--warn)" : "var(--good)";
    });
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    d.remember = !!form.remember?.checked;
    if (withNewPassword) {
      if ((d.password || "").length < minLen()) return toast(`Das Passwort braucht mindestens ${minLen()} Zeichen`, "error");
      if (d.password !== d.password2) return toast("Die Passwörter stimmen nicht überein", "error");
    }
    const btn = $("button[type=submit]", form);
    busy(btn);
    try {
      const res = await call(d);
      if (res?.failed_logins) warnFailedLogins(res);
      if (res?.recovery_key) showRecoveryKey(res.recovery_key, mode);
      else finish();
    } catch (err) {
      busy(btn, false);
      if (mode === "login" && err.message === "totp_required") {
        // Password was right; 2FA is enabled -> ask for the app code.
        const field = $("#totp-field", form);
        field.classList.remove("hidden");
        field.querySelector("input").focus();
        return;
      }
      toast(err.message === "totp_required" ? "Bitte Code eingeben" : err.message, "error");
      if (mode === "login") (form.totp?.value ? form.totp : form.password).select();
    }
  });
}

export function recoveryKeyHtml(key) {
  return `
    <div class="recovery-key mono" id="rk">${esc(key)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn btn-sm" data-copy-rk>${icon("copy")} Kopieren</button>
      <button type="button" class="btn btn-sm" data-download-rk>${icon("download")} Als Datei speichern</button>
      <button type="button" class="btn btn-sm" data-print-rk>${icon("printer")} Drucken</button>
    </div>`;
}

export function bindRecoveryKey(el, key) {
  el.querySelector("[data-copy-rk]").addEventListener("click", async () => {
    await navigator.clipboard.writeText(key);
    toast("Kopiert");
  });
  el.querySelector("[data-download-rk]").addEventListener("click", () => {
    const blob = new Blob(
      [`Contractly – Wiederherstellungsschlüssel\n\n${key}\n\nErstellt am ${new Date().toLocaleString("de-DE")}\nSicher aufbewahren (z. B. Passwort-Manager oder ausgedruckt im Ordner).\n`],
      { type: "text/plain" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "contractly-wiederherstellungsschluessel.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  el.querySelector("[data-print-rk]").addEventListener("click", () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<pre style="font:16px monospace;padding:40px">Contractly – Wiederherstellungsschlüssel\n\n${esc(key)}\n\n${new Date().toLocaleDateString("de-DE")}</pre>`);
    w.document.close();
    w.print();
  });
}

function showRecoveryKey(key, mode) {
  frame(`
    <h1>${icon("key")} Wiederherstellungsschlüssel</h1>
    <p class="muted">Falls du dein Passwort vergisst, ist dieser Schlüssel der <b>einzige Weg</b> zurück an deine Daten.
      Er wird nur jetzt angezeigt.</p>
    ${recoveryKeyHtml(key)}
    <div class="callout warn" style="margin-top:16px">${icon("alert")}<div>Bewahre ihn getrennt vom Passwort auf – z. B. ausgedruckt im Vertragsordner oder im Passwort-Manager.</div></div>
    <label class="check" style="margin-top:16px"><input type="checkbox" id="ack"/> Ich habe den Schlüssel sicher aufbewahrt</label>
    <button class="btn btn-primary btn-block" id="go" style="margin-top:16px" disabled>${mode === "setup" ? "Los geht's" : "Weiter"} ${icon("chevRight")}</button>`);
  bindRecoveryKey(root, key);
  $("#ack", root).addEventListener("change", (e) => ($("#go", root).disabled = !e.target.checked));
  $("#go", root).addEventListener("click", finish);
}

function warnFailedLogins(res) {
  const when = res.last_failed_login ? `, zuletzt am ${new Date(res.last_failed_login * 1000).toLocaleString("de-DE")}` : "";
  toast(
    `Seit deiner letzten Anmeldung gab es ${res.failed_logins} fehlgeschlagene Anmeldeversuche${when}. Warst du das nicht, ändere dein Passwort und aktiviere die Zwei-Faktor-Anmeldung.`,
    "error",
    12000,
  );
}

function finish() {
  root.classList.add("hidden");
  root.innerHTML = "";
  done?.();
}
