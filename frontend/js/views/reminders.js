import { api } from "../api.js";
import { $, busy, confirmDialog, esc, fmtDate, formData, icon, modal, toast, today } from "../ui.js";
import { bindReminderActions, reminderItem } from "./components.js";
import { refreshBadge, router } from "../app.js";

const REPEAT = { none: "einmalig", monthly: "monatlich", quarterly: "vierteljährlich", half_yearly: "halbjährlich", yearly: "jährlich" };

export async function reminderForm(existing = {}, done) {
  const contracts = await api.contracts({ include_ended: false });
  const r = existing;
  const m = modal({
    title: r.id ? "Erinnerung bearbeiten" : "Neue Erinnerung",
    body: `<form id="rf" class="form-grid">
      <label class="field span-all"><span>Woran soll ich dich erinnern?</span>
        <input name="title" value="${esc(r.title ?? "")}" required/></label>
      <div class="chips span-all" id="presets">
        ${["Zählerstand ablesen", "Tarif prüfen & vergleichen", "Bonus prüfen", "Rechnung kontrollieren", "Kündigung bestätigt?"]
          .map((t) => `<button type="button" class="chip" data-t="${esc(t)}">${esc(t)}</button>`)
          .join("")}
      </div>
      <label class="field"><span>Fällig am</span><input type="date" name="due_date" value="${esc(r.due_date ?? today())}" required/></label>
      <label class="field"><span>Wiederholen</span><select name="repeat">${Object.entries(REPEAT)
        .map(([k, v]) => `<option value="${k}" ${(r.repeat || "none") === k ? "selected" : ""}>${v}</option>`)
        .join("")}</select></label>
      <label class="field"><span>Vorlauf</span><div class="input-group"><input type="number" min="0" name="lead_days" value="${esc(r.lead_days ?? 3)}"/><span class="addon">Tage vorher</span></div></label>
      <label class="field"><span>Vertrag (optional)</span><select name="contract_id"><option value="">–</option>
        ${contracts.map((c) => `<option value="${c.id}" ${Number(r.contract_id) === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label class="field span-all"><span>Notiz</span><input name="note" value="${esc(r.note ?? "")}"/></label>
    </form>`,
    foot: `${r.id ? `<button class="btn btn-ghost btn-danger mr-auto" data-del>${icon("trash")} Löschen</button>` : ""}
      <button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon("check")} Speichern</button>`,
  });
  $("#presets", m).addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]");
    if (b) $("[name=title]", m).value = b.dataset.t;
  });
  $("[data-save]", m).addEventListener("click", async (e) => {
    const d = formData($("#rf", m));
    if (!d.title) return toast("Bitte einen Titel angeben", "error");
    d.contract_id = d.contract_id ? Number(d.contract_id) : null;
    d.lead_days = d.lead_days || 0;
    busy(e.currentTarget);
    try {
      if (r.id) await api.updateReminder(r.id, d);
      else await api.createReminder(d);
      m.close();
      toast("Erinnerung gespeichert 🔔");
      refreshBadge();
      done?.();
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
  $("[data-del]", m)?.addEventListener("click", async () => {
    m.close();
    if (await confirmDialog("Erinnerung löschen?")) {
      await api.deleteReminder(r.id);
      toast("Gelöscht");
      done?.();
    }
  });
}

export async function renderReminders(view) {
  const [up, all] = await Promise.all([api.upcoming({ horizon_days: 365 }), api.reminders()]);
  const due = up.items.filter((i) => i.due);
  const later = up.items.filter((i) => !i.due);
  const ch = up.channels;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Erinnerungen</h1><p>Kündigungsfristen kommen automatisch – eigene Erinnerungen legst du hier an.
        <a href="#/settings">${ch.ntfy || ch.email ? "Push & Kalender" : "Als Push oder im Kalender?"}</a></p></div>
      <div class="page-actions"><button class="btn btn-primary" id="add">${icon("plus")}<span class="label">Neue Erinnerung</span></button></div>
    </div>
    <div class="stack reading">
        <div class="card">
          <div class="card-head"><div><h2>Jetzt fällig</h2><p>${due.length ? `${due.length} offene Punkte` : "Nichts zu tun"}</p></div></div>
          <div class="list" id="due">${
            due.length ? due.map((i) => reminderItem(i)).join("") : `<div class="callout good">${icon("check")}<div>Alles erledigt – genieß den Tag! ☀️</div></div>`
          }</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Demnächst</h2><p>Die nächsten 12 Monate</p></div></div>
          <div class="list" id="later">${later.length ? later.map((i) => reminderItem(i)).join("") : `<p class="muted">Nichts geplant.</p>`}</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Eigene Erinnerungen</h2><p>Antippen zum Bearbeiten</p></div></div>
          <div class="list" id="own">${
            all.length
              ? all
                  .map(
                    (r) => `<button class="list-item" data-edit="${r.id}" style="border:0;border-bottom:1px solid var(--border);background:none;text-align:left;width:100%;cursor:pointer">
                    <span class="cat-icon sm" style="--c:var(--series-7)">${icon("bell")}</span>
                    <div class="grow"><div class="title">${esc(r.title)}</div><div class="sub">${fmtDate(r.due_date)} · ${REPEAT[r.repeat]}${r.lead_days ? ` · ${r.lead_days} Tage Vorlauf` : ""}</div></div>
                    ${icon("chevRight")}</button>`,
                  )
                  .join("")
              : `<p class="muted">Noch keine eigenen Erinnerungen.</p>`
          }</div>
        </div>
    </div>`;

  const refresh = (msg) => {
    if (msg) toast(msg);
    router();
  };
  bindReminderActions($("#due", view), api, refresh);
  bindReminderActions($("#later", view), api, refresh);
  $("#add", view).addEventListener("click", () => reminderForm({}, refresh));
  $("#own", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit]");
    if (b) reminderForm(all.find((r) => r.id === Number(b.dataset.edit)), refresh);
  });
}
