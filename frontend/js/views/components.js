// Reusable view fragments.

import { STATE_LABEL, catColorVar, catIcon, catLabel, category, intervalLabel } from "../store.js";
import { daysUntil, esc, fmtDate, icon, money, num, relDays } from "../ui.js";

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

export function contractCard(c) {
  const price = c.current_price;
  const priceLine =
    price && price.interval !== "monthly"
      ? `<span class="muted small">${money(price.amount)} ${intervalLabel(price.interval)}</span>`
      : `<span class="muted small">pro Monat</span>`;
  return `
  <a class="card contract-card ${c.state === "ended" ? "ended" : ""}" href="#/contracts/${c.id}">
    <div class="cc-top">
      <div class="cat-icon" style="--c:${catColorVar(c.category)}">${catIcon(c.category)}</div>
      <div class="cc-title">
        <h3>${esc(c.name)}</h3>
        <div class="provider">${esc(c.provider || catLabel(c.category))}</div>
      </div>
      ${c.state !== "active" ? stateBadge(c) : ""}
    </div>
    <div class="cc-price"><strong class="num">${money(c.monthly_cost)}</strong>${priceLine}</div>
    <div class="cc-meta">${c.current_price?.details?.kind === "pause" ? `<span class="badge warn">${icon("clock")} pausiert</span>` : ""}${
      c.share_percent != null && c.share_percent !== 100 ? `<span class="badge info">Anteil ${c.share_percent} %</span>` : ""
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
  const sub = price && price.interval !== "monthly" ? `${money(price.amount)} ${intervalLabel(price.interval)}` : `${money(c.yearly_cost, true)}/Jahr`;
  const flags = `${c.state !== "active" ? stateBadge(c) : ""}${
    c.current_price?.details?.kind === "pause" ? `<span class="badge warn">${icon("clock")} pausiert</span>` : ""
  }${c.share_percent != null && c.share_percent !== 100 ? `<span class="badge info">Anteil ${c.share_percent} %</span>` : ""}`;
  return `
  <a class="contract-row ${c.state === "ended" ? "ended" : ""}" href="#/contracts/${c.id}">
    <div class="cat-icon sm" style="--c:${catColorVar(c.category)}">${catIcon(c.category)}</div>
    <div class="cr-title"><b>${esc(c.name)}</b><span>${esc(c.provider || catLabel(c.category))}</span></div>
    <div class="cr-meta">${flags}${attrChips(c, 2)}</div>
    <div class="cr-deadline">${deadlineHint(c)}</div>
    <div class="cr-price"><b class="num">${money(c.monthly_cost)}</b><span class="num">${sub}</span></div>
  </a>`;
}

export function datePill(d, urgency = "") {
  const x = new Date(d);
  return `<div class="date-pill ${urgency}"><b>${x.getDate()}</b><span>${x.toLocaleDateString("de-DE", { month: "short" })}</span></div>`;
}

export function reminderItem(item, { actions = true, compact = false } = {}) {
  const urgency = item.days_left < 0 || item.days_left <= 7 ? "urgent" : item.days_left <= 30 ? "soon" : "";
  const kindIcon =
    {
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
    }[item.kind] || "bell";
  const href = item.contract_id ? `#/contracts/${item.contract_id}` : item.kind === "checkup" ? "#/checkup" : "#/reminders";
  return `
  <div class="list-item reminder-item">
    ${datePill(item.date, urgency)}
    <a class="grow" href="${href}" style="color:inherit">
      <div class="title">${esc(item.title)}</div>
      <div class="sub">${icon(kindIcon, "inline")} ${esc(relDays(item.days_left))}${item.detail && !compact ? " · " + esc(item.detail) : ""}</div>
    </a>
    ${actions ? reminderActions(item, compact) : ""}
  </div>`;
}

export function emptyState({ art = "📭", title, text, actions = "" }) {
  return `<div class="card empty"><div class="art">${art}</div><h2>${esc(title)}</h2><p>${text}</p>
    <div class="actions">${actions}</div></div>`;
}

/** Wire "done" / "dismiss" buttons of reminder lists. */
export function bindReminderActions(root, api, onChange) {
  root.addEventListener("click", async (e) => {
    const done = e.target.closest("[data-done]");
    const dismiss = e.target.closest("[data-dismiss]");
    const used = e.target.closest("[data-still-used]");
    const confirmed = e.target.closest("[data-confirmed]");
    if (used) {
      await api.stillUsed(used.dataset.stillUsed);
      onChange("Prima – wir fragen in einem Jahr wieder");
    } else if (confirmed) {
      await api.confirmCancellation(confirmed.dataset.confirmed);
      onChange("Bestätigung vermerkt ✓");
    } else if (done) {
      await api.completeReminder(done.dataset.done);
      onChange("Erledigt ✓");
    } else if (dismiss) {
      await api.dismissReminder(dismiss.dataset.dismiss);
      onChange("Ausgeblendet");
    }
  });
}

function reminderActions(item, compact = false) {
  // In narrow lists (dashboard) buttons show only their icon, so the title keeps its space.
  const label = (text) => (compact ? "" : `<span class="label">${text}</span>`);
  const dismiss = `<button class="btn btn-sm btn-ghost" data-dismiss="${esc(item.key)}" title="Ausblenden">${icon("x")}</button>`;
  switch (item.kind) {
    case "custom":
      return `<button class="btn btn-sm" data-done="${item.reminder_id}" title="Erledigt">${icon("check")}</button>`;
    case "subscription_check":
      return `<div style="display:flex;gap:6px;flex:none"><button class="btn btn-sm" data-still-used="${item.contract_id}" title="Nutze ich noch">${icon("check")}${label("Nutze ich")}</button>
        <a class="btn btn-sm btn-ghost" href="#/contracts/${item.contract_id}" title="Kündigen">${icon("ban")}</a></div>`;
    case "confirmation":
      return `<div style="display:flex;gap:6px;flex:none"><button class="btn btn-sm" data-confirmed="${item.contract_id}" title="Bestätigung erhalten">${icon("check")}</button>${dismiss}</div>`;
    case "checkup":
      return `<div style="display:flex;gap:6px;flex:none"><a class="btn btn-sm btn-primary" href="#/checkup" title="Jahres-Check starten">${icon("chevRight")}${label("Starten")}</a>${dismiss}</div>`;
    case "installment_check":
      return `<div style="display:flex;gap:6px;flex:none"><a class="btn btn-sm" href="#/contracts/${item.contract_id}?tab=prices" title="Abschlag anpassen">${icon("euro")}${label("Anpassen")}</a>${dismiss}</div>`;
    case "price_increase":
    case "price_guarantee":
      return `<div style="display:flex;gap:6px;flex:none"><a class="btn btn-sm" href="#/contracts/${item.contract_id}?tab=compare" title="Vergleichen">${icon("scale")}</a>${dismiss}</div>`;
    default:
      return dismiss;
  }
}
