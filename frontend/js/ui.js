// Small UI toolkit: escaping, formatting, icons, modals, toasts, menus.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export const money = (v, round = false) => (v == null || isNaN(v) ? "–" : (round ? eur0 : eur).format(v));
export const num = (v) => (v == null || v === "" || isNaN(v) ? "–" : numFmt.format(v));
export const signedMoney = (v) => (v > 0 ? "+" : "") + money(v);

export function parseDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day);
}
export const fmtDate = (d) => (d ? parseDate(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
export const fmtDateLong = (d) => (d ? parseDate(d).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "–");
export const fmtMonth = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
};
export const isoDate = (d) => {
  const x = parseDate(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const today = () => isoDate(new Date());
export function daysUntil(d) {
  const a = parseDate(today());
  return Math.round((parseDate(d) - a) / 86400000);
}
export function relDays(n) {
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === -1) return "gestern";
  if (n < 0) return `vor ${-n} Tagen`;
  if (n < 60) return `in ${n} Tagen`;
  return `in ${Math.round(n / 30)} Monaten`;
}
export function monthsBetween(a, b) {
  const x = parseDate(a), y = parseDate(b);
  return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()) + (y.getDate() >= x.getDate() ? 0 : -1);
}
export function durationText(months) {
  if (months < 1) return "< 1 Monat";
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} J.` : "", m ? `${m} Mon.` : ""].filter(Boolean).join(" ");
}
export const fileSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

// ------------------------------------------------------------------ icons (lucide-style strokes)

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  timeline: '<path d="M3 6h7M7 12h10M5 18h8"/><circle cx="13" cy="6" r="1.6"/><circle cx="20" cy="12" r="1.6"/><circle cx="16" cy="18" r="1.6"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  euro: '<path d="M4 10h12M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  swap: '<path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="M19 3v4M17 5h4"/>',
  piggy: '<path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/><path d="M2 9v1c0 1.1.9 2 2 2h1"/><circle cx="16" cy="11" r=".5"/>',
  move: '<path d="M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
};

export const icon = (name, cls = "") =>
  `<svg class="svg-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

// ------------------------------------------------------------------ DOM helpers

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) handler(e, el);
  });
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "radio") {
      if (el.checked) out[el.name] = el.value;
    } else if (el.type === "number") out[el.name] = el.value === "" ? null : Number(el.value);
    else out[el.name] = el.value === "" ? null : el.value;
  }
  return out;
}

// ------------------------------------------------------------------ toast

export function toast(message, type = "ok", duration = null) {
  let root = $(".toasts");
  if (!root) {
    root = document.createElement("div");
    root.className = "toasts";
    document.body.append(root);
  }
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.innerHTML = `${icon(type === "error" ? "alert" : "check")}<span>${esc(message)}</span>`;
  root.append(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 320);
  }, duration ?? (type === "error" ? 5000 : 2600));
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Numbers count up to their value (elements with data-count="<number>" and
 * data-format="money" | "money0" | "int"), like the balance in a banking app.
 */
export function countUp(root) {
  const fmt = {
    money: (v) => money(v),
    money0: (v) => money(v, true),
    int: (v) => String(Math.round(v)),
  };
  root.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    const format = fmt[el.dataset.format] || fmt.int;
    if (!Number.isFinite(target) || reducedMotion()) return;
    const start = performance.now();
    const duration = 900;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = format(target * eased);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = format(target);
    };
    requestAnimationFrame(step);
  });
}

// ------------------------------------------------------------------ modal

export function modal({ title, body, foot = "", wide = false, onOpen, className = "" }) {
  const backdrop = document.createElement("div");
  backdrop.className = `modal-backdrop ${className}`;
  backdrop.innerHTML = `
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title || "")}">
      ${title !== null ? `<div class="modal-head"><h2>${esc(title)}</h2>
        <button class="btn btn-ghost btn-icon" data-close aria-label="Schließen">${icon("x")}</button></div>` : ""}
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ""}
    </div>`;
  const close = () => {
    document.removeEventListener("keydown", onKey);
    if (reducedMotion()) return backdrop.remove();
    // animate out (sheet slides down on phones), then remove
    backdrop.classList.add("closing");
    setTimeout(() => backdrop.remove(), 260);
  };
  const onKey = (e) => e.key === "Escape" && close();
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  on(backdrop, "click", "[data-close]", close);
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  const el = $(".modal", backdrop);
  el.close = close;
  onOpen?.(el, close);
  const first = $("input:not([type=hidden]),select,textarea", el);
  if (first && window.matchMedia("(min-width: 721px)").matches) first.focus();
  return el;
}

export function confirmDialog(text, { okLabel = "Löschen", danger = true, title = "Bist du sicher?" } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({
      title,
      body: `<p style="margin:0">${esc(text)}</p>`,
      foot: `<button class="btn" data-close>Abbrechen</button>
             <button class="btn ${danger ? "btn-primary" : "btn-primary"}" data-ok
               style="${danger ? "background:var(--bad);border-color:var(--bad);color:#fff" : ""}">${esc(okLabel)}</button>`,
    });
    $("[data-ok]", m).addEventListener("click", () => {
      result = true;
      m.close();
    });
    new MutationObserver((_, obs) => {
      if (!document.body.contains(m)) {
        obs.disconnect();
        resolve(result);
      }
    }).observe(document.body, { childList: true });
  });
}

// ------------------------------------------------------------------ dropdown menus

document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-menu]");
  $$(".menu.open").forEach((m) => {
    if (!trigger || m !== trigger.parentElement) m.classList.remove("open");
  });
  if (trigger) trigger.parentElement.classList.toggle("open");
});

export function busy(btn, on = true) {
  if (!btn) return;
  if (on) {
    btn.dataset.html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
  } else if (btn.dataset.html) {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.html;
  }
}
