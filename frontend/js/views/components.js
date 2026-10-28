// Reusable view fragments.

import { STATE_LABEL, catColorVar, contractIcon, catLabel, category, intervalLabel } from "../store.js";
import { daysUntil, esc, fmtDate, icon, modal, money, num, relDays, toast } from "../ui.js";

export function attrValue(field, value) {
  if (value === null || value === undefined || value === "") return null;
  if (field.type === "bool") return value ? "Ja" : "Nein";
  if (field.type === "date") return fmtDate(value);
  if (field.type === "number") return `${num(value)}${field.unit ? " " + field.unit : ""}`;
  return String(value);
}

/** Short chips with the most telling attributes, e.g. "40 GB · 5G · Telekom". */
export function attrChips(c, max = 3) {
  const fields = category(c.category).fields || [];
  const chips = [];
  for (const f of fields) {
    const v = c.attributes?.[f.key];
    if (v === null || v === undefined || v === "" || v === false) continue;
    if (["meter_number", "market_location", "phone_number", "iban", "license_plate"].includes(f.key)) continue;
    chips.push(f.type === "bool" ? f.label : attrValue(f, v));
    if (chips.length >= max) break;
  }
  return chips.map((t) => `<span class="badge">${esc(t)}</span>`).join("");
}

export function stateBadge(c) {
  const s = STATE_LABEL[c.state] || STATE_LABEL.active;
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

export function deadlineHint(c) {
  if (c.state === "cancelled" && c.end_date) {
    return `<span>${icon("clock")} endet ${fmtDate(c.end_date)}</span>`;
  }
  if (c.monthly_cancellable) return `<span>${icon("check")} monatlich kündbar</span>`;
  if (c.cancellation_deadline) {
    const d = daysUntil(c.cancellation_deadline);
    const cls = d <= 14 ? "bad" : d <= 45 ? "warn" : "";
    return cls
      ? `<span class="badge ${cls}">${icon("alert")} Kündigen bis ${fmtDate(c.cancellation_deadline)}</span>`
      : `<span>Kündbar bis ${fmtDate(c.cancellation_deadline)}</span>`;
  }
  return "";
}

/** In the list only what needs attention: a contract ending, a deadline coming up. */
function rowHint(c) {
  if (c.state === "cancelled" && c.end_date) return `<span>${icon("clock")} endet ${fmtDate(c.end_date)}</span>`;
  if (c.cancellation_deadline && !c.monthly_cancellable) {
    const d = daysUntil(c.cancellation_deadline);
    if (d <= 45) return `<span class="badge ${d <= 14 ? "bad" : "warn"}">${icon("alert")} Kündigen bis ${fmtDate(c.cancellation_deadline)}</span>`;
  }
  return "";
}

/** Under the name: the provider – or the category when the contract is just named after the provider. */
function subtitle(c) {
  return c.provider && c.provider.trim() !== c.name.trim() ? c.provider : catLabel(c.category);
}

/** Own share: a percentage, or the partner's fixed monthly amount. */
export function shareText(c) {
  if (c.partner_amount) return `Partner:in zahlt ${money(c.partner_amount)}`;
  if (c.share_percent != null && c.share_percent !== 100) return `Anteil ${c.share_percent} %`;
  return "";
}

function shareBadge(c) {
  const t = shareText(c);
  return `${t ? `<span class="badge info">${esc(t)}</span>` : ""}${
    c.account ? `<span class="badge" title="Bezahlt über ${esc(c.account)}">🏦 ${esc(c.account)}</span>` : ""
  }`;
}

/** Accounts other than the own one that contracts are paid from. */
export function otherAccounts(contracts) {
  return [...new Set(contracts.map((c) => c.account).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
}

/** "Mein Konto | Gemeinschaftskonto | Alle" – only when some contract runs over another account. */
export function accountSwitch(accounts, current) {
  if (!accounts.length) return "";
  const options = [["own", "Mein Konto"], ...accounts.map((a) => [a, a]), ["all", "Alle"]];
  return `<div class="segmented account-switch" role="group" aria-label="Konto">${options
    .map(([v, l]) => `<button type="button" data-account="${esc(v)}" class="${v === current ? "active" : ""}">${esc(l)}</button>`)
    .join("")}</div>`;
}

export function contractCard(c) {
  const price = c.current_price;
  const priceLine =
    price && price.interval !== "monthly"
      ? `<span class="muted small">${money(price.amount)} ${intervalLabel(price.interval)}</span>`
      : `<span class="muted small">pro Monat</span>`;
  return `
  <a class="card contract-card ${c.state === "ended" ? "ended" : ""}" href="#/contracts/${c.id}">
    <div class="cc-top">
      <div class="cat-icon" style="--c:${catColorVar(c.category)}">${esc(contractIcon(c))}</div>
      <div class="cc-title">
        <h3>${esc(c.name)}</h3>
        <div class="provider">${esc(subtitle(c))}</div>
      </div>
      ${c.state !== "active" ? stateBadge(c) : ""}
    </div>
    <div class="cc-price"><strong class="num">${money(c.monthly_cost)}</strong>${priceLine}</div>
    <div class="cc-meta">${c.current_price?.details?.kind === "pause" ? `<span class="badge warn">${icon("clock")} pausiert</span>` : ""}${
      shareBadge(c)
    }${attrChips(c)}${c.predecessor_id ? `<span class="badge info">${icon("swap")} gewechselt</span>` : ""}</div>
    <div class="cc-foot">
      ${deadlineHint(c) || `<span>seit ${fmtDate(c.start_date)}</span>`}
      <span class="num">${money(c.yearly_cost, true)}/Jahr</span>
    </div>
  </a>`;
}

/** One compact line per contract: the default contract list. */
export function contractRow(c) {
  const price = c.current_price;
  // a contract that starts later shows what it will cost, not 0,00 €
  const planned = c.state === "planned" && price;
  const oneOff = !price && c.one_off_total;
  const monthly = planned ? price.monthly_equivalent : oneOff ? c.one_off_total : c.monthly_cost;
  const sub = oneOff
    ? "einmalig"
    : planned
    ? `ab ${fmtDate(c.start_date)}`
    : price && price.interval !== "monthly"
      ? `${money(price.amount)} ${intervalLabel(price.interval)}`
      : `${money(c.yearly_cost, true)}/Jahr`;
  const flags = `${c.state !== "active" ? stateBadge(c) : ""}${
    c.current_price?.details?.kind === "pause" ? `<span class="badge warn">${icon("clock")} pausiert</span>` : ""
  }${shareBadge(c)}`;
  return `
  <a class="contract-row ${c.state === "ended" ? "ended" : ""}" href="#/contracts/${c.id}">
    <div class="cat-icon sm" style="--c:${catColorVar(c.category)}">${esc(contractIcon(c))}</div>
    <div class="cr-title"><b>${esc(c.name)}</b><span>${esc(subtitle(c))}</span></div>
    <div class="cr-meta">${flags}</div>
    <div class="cr-deadline">${rowHint(c)}</div>
    <div class="cr-price"><b class="num">${money(monthly)}</b><span class="num">${sub}</span></div>
  </a>`;
}

export function datePill(d, urgency = "") {
  const x = new Date(d);
  return `<div class="date-pill ${urgency}"><b>${x.getDate()}</b><span>${x.toLocaleDateString("de-DE", { month: "short" })}</span></div>`;
}

export function reminderItem(item, { actions = true } = {}) {
  const urgency = item.days_left < 0 || item.days_left <= 7 ? "urgent" : item.days_left <= 30 ? "soon" : "";
  // Read first: the row shows what and when; tapping it opens the details and every option.
  // Next to it only one quiet check mark – "done" in whatever sense fits the reminder.
  return `
  <div class="list-item reminder-item" data-item="${esc(JSON.stringify(item))}">
    ${datePill(item.date, urgency)}
    <button type="button" class="grow reminder-open" data-open>
      <span class="title">${esc(item.title)}</span>
      <span class="sub">${icon(KIND_ICON[item.kind] || "bell", "inline")} ${esc(relDays(item.days_left))}</span>
    </button>
    ${actions ? quickAction(item) : ""}
  </div>`;
}

const KIND_ICON = {
  deadline: "alert",
  contract_end: "clock",
  custom: "bell",
  price_increase: "trendUp",
  price_guarantee: "shield",
  withdrawal: "refresh",
  confirmation: "mail",
  subscription_check: "sparkles",
  installment_check: "gauge",
  checkup: "refresh",
  total_reached: "check",
  total_exceeded: "alert",
};

/** The one action next to a reminder: mark it done (or answer it) right away. */
function quickAction(item) {
  const btn = (attr, title) =>
    `<button class="btn btn-sm btn-icon quick-done" ${attr} title="${title}" aria-label="${title}">${icon("check")}</button>`;
  if (item.kind === "custom") return btn(`data-done="${item.reminder_id}"`, "Erledigt");
  if (item.kind === "subscription_check") return btn(`data-still-used="${item.contract_id}"`, "Nutze ich noch");
  if (item.kind === "confirmation") return btn(`data-confirmed="${item.contract_id}"`, "Bestätigung erhalten");
  return btn(`data-dismiss="${esc(item.key)}"`, "Erledigt – ausblenden");
}

/** Everything one can do with a reminder, in a small sheet. */
function reminderSheet(item, api, onChange) {
  const contract = item.contract_id ? `#/contracts/${item.contract_id}` : null;
  const primary = {
    checkup: `<a class="btn btn-primary" href="#/checkup">${icon("chevRight")} Jahres-Check starten</a>`,
    installment_check: `<a class="btn btn-primary" href="${contract}?tab=prices">${icon("euro")} Abschlag anpassen</a>`,
    price_increase: `<a class="btn btn-primary" href="${contract}?tab=compare">${icon("scale")} Angebote vergleichen</a>`,
    price_guarantee: `<a class="btn btn-primary" href="${contract}?tab=compare">${icon("scale")} Angebote vergleichen</a>`,
    subscription_check: `<button class="btn btn-primary" data-still-used="${item.contract_id}">${icon("check")} Nutze ich noch</button>
      <a class="btn" href="${contract}">${icon("ban")} Kündigen …</a>`,
    confirmation: `<button class="btn btn-primary" data-confirmed="${item.contract_id}">${icon("check")} Bestätigung erhalten</button>`,
    custom: `<button class="btn btn-primary" data-done="${item.reminder_id}">${icon("check")} Erledigt</button>`,
  }[item.kind];
  const m = modal({
    title: item.title,
    className: "reminder-sheet",
    body: `<p class="sheet-when">${icon(KIND_ICON[item.kind] || "bell", "inline")} ${esc(relDays(item.days_left))} · ${fmtDate(item.date)}</p>
      ${item.detail ? `<p class="sheet-detail">${esc(item.detail)}</p>` : ""}
      <div class="sheet-actions">
        ${primary || (contract ? `<a class="btn btn-primary" href="${contract}">${icon("file")} Zum Vertrag</a>` : "")}
        ${primary && contract ? `<a class="btn" href="${contract}">${icon("file")} Zum Vertrag</a>` : ""}
        ${item.kind === "custom" ? "" : `<button class="btn btn-ghost" data-dismiss="${esc(item.key)}">${icon("x")} Ausblenden</button>`}
      </div>`,
  });
  m.addEventListener("click", async (e) => {
    if (e.target.closest("a[href]")) return m.close();
    if (await runAction(e.target, api, onChange, item)) m.close();
  });
}

async function runAction(target, api, onChange, sheetItem = null) {
  const done = target.closest("[data-done]");
  const dismiss = target.closest("[data-dismiss]");
  const used = target.closest("[data-still-used]");
  const confirmed = target.closest("[data-confirmed]");
  const row = target.closest("[data-item]");
  const item = sheetItem ?? (row ? JSON.parse(row.dataset.item) : null);
  let msg;
  let undo;
  if (used) {
    const id = used.dataset.stillUsed;
    const before = (await api.contract(id)).last_checked_on;
    await api.stillUsed(id);
    msg = "Prima – wir fragen in einem Jahr wieder";
    undo = () => api.stillUsed(id, { last_checked_on: before });
  } else if (confirmed) {
    const id = confirmed.dataset.confirmed;
    await api.confirmCancellation(id);
    msg = "Bestätigung vermerkt";
    undo = () => api.unconfirmCancellation(id);
  } else if (done) {
    const id = done.dataset.done;
    await api.completeReminder(id);
    msg = "Erledigt";
    if (item?.date) undo = () => api.reopenReminder(id, item.date);
  } else if (dismiss) {
    const key = dismiss.dataset.dismiss;
    await api.dismissReminder(key);
    msg = "Ausgeblendet";
    undo = () => api.undismissReminder(key);
  } else return false;
  // a mis-tap is never final: the message offers to undo it
  toast(msg, "ok", null, undo && {
    label: "Rückgängig",
    run: async () => {
      await undo();
      onChange();
    },
  });
  onChange();
  return true;
}

/** Wire reminder lists: the check mark acts at once, the row opens the sheet. */
export function bindReminderActions(root, api, onChange) {
  root.addEventListener("click", async (e) => {
    if (e.target.closest("[data-open]")) {
      const row = e.target.closest("[data-item]");
      return reminderSheet(JSON.parse(row.dataset.item), api, onChange);
    }
    await runAction(e.target, api, onChange);
  });
}

export function emptyState({ art = "📭", title, text, actions = "" }) {
  return `<div class="card empty"><div class="art">${art}</div><h2>${esc(title)}</h2><p>${text}</p>
    <div class="actions">${actions}</div></div>`;
}

// ------------------------------------------------------------------ own emoji

const EMOJIS = [
  "📱", "🌐", "📶", "☎️", "⚡", "🔥", "💧", "☀️", "🚗", "🏍️", "🚲", "🚆",
  "🏠", "🔑", "🛡️", "⚖️", "🩺", "🦷", "👓", "💊", "🏋️", "🧘", "⚽", "🎾",
  "🎬", "🎵", "🎮", "📺", "📰", "📚", "☁️", "💻", "🐶", "🐱", "👶", "🎓",
  "🏦", "💳", "💶", "🐷", "📈", "🧾", "🛒", "🍽️", "☕", "✈️", "🎁", "⭐",
];

/** Button showing the own emoji (or the default) that opens a small picker below it. */
export function iconPicker(value, fallback, colorVar = "var(--primary)") {
  return `<div class="icon-picker">
    <button type="button" class="cat-icon icon-pick" style="--c:${colorVar}" data-fallback="${esc(fallback)}"
      title="Symbol ändern" aria-label="Symbol ändern" aria-expanded="false">${esc(value || fallback)}</button>
    <input type="hidden" name="icon" value="${esc(value || "")}"/>
    <div class="icon-pop" hidden>
      <div class="icon-grid">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}</div>
      <div class="icon-own">
        <input class="input" maxlength="16" placeholder="Eigenes Emoji" aria-label="Eigenes Emoji" autocomplete="off"/>
        <button type="button" class="btn btn-sm" data-default>${esc(fallback)} Standard</button>
      </div>
    </div>
  </div>`;
}

export function bindIconPicker(root) {
  const box = root.querySelector(".icon-picker");
  if (!box) return;
  const pick = box.querySelector(".icon-pick");
  const field = box.querySelector("input[name=icon]");
  const pop = box.querySelector(".icon-pop");
  const own = box.querySelector(".icon-own input");
  const set = (value) => {
    field.value = value;
    pick.textContent = value || pick.dataset.fallback;
  };
  const toggle = (open) => {
    pop.hidden = !open;
    pick.setAttribute("aria-expanded", String(open));
  };
  pick.addEventListener("click", () => toggle(pop.hidden));
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-emoji]");
    if (b) {
      set(b.dataset.emoji);
      toggle(false);
    }
    if (e.target.closest("[data-default]")) {
      set("");
      toggle(false);
    }
  });
  own.addEventListener("input", () => {
    const v = own.value.trim();
    // only symbols – letters and digits would just be text
    if (v && !/[A-Za-z0-9<>&"']/.test(v)) set(v);
  });
  own.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      toggle(false);
    }
  });
}

