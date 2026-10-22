// "Jahres-Check": five minutes once a year, one card per contract that needs a decision.

import { api } from "../api.js";
import { catColorVar, catIcon } from "../store.js";
import { $, esc, fmtDate, icon, money, toast } from "../ui.js";
import { openLetter } from "./letter.js";

const REASON_ICON = {
  promo_ended: "trendUp",
  price_up: "trendUp",
  bonus_gone: "sparkles",
  guarantee: "shield",
  not_compared: "scale",
  unused: "eye",
  backpayment: "gauge",
  deadline: "alert",
};

export async function renderCheckup(view, _m, query = {}) {
  const ov = await api.checkup();
  const open = ov.items.filter((i) => !i.decision);
  if (query.step === "go" && open.length) return card(view, ov, open[0]);
  if (!ov.items.length || (!open.length && ov.summary.reviewed)) return done(view, ov);
  intro(view, ov, open);
}

function intro(view, ov, open) {
  const last = ov.last_completed_on || ov.completed_on;
  view.innerHTML = `
    <div class="checkup">
      <div class="card checkup-hero">
        <span class="checkup-emoji">🧭</span>
        <h1>Dein Jahres-Check ${ov.year}</h1>
        <p class="text-2">Einmal im Jahr, etwa 5 Minuten: Contractly zeigt dir nur die Verträge, bei denen sich ein Blick lohnt –
          und du entscheidest mit einem Klick: <b>passt</b>, <b>vergleichen</b> oder <b>kündigen</b>.</p>
        <div class="checkup-stats">
          <div><b class="num">${open.length}</b><span>${open.length === 1 ? "Vertrag" : "Verträge"} mit Handlungsbedarf</span></div>
          <div><b class="num">${ov.running - ov.items.length}</b><span>ohne Auffälligkeiten</span></div>
        </div>
        <a class="btn btn-primary btn-lg" href="#/checkup?step=go">${icon("chevRight")} Los geht's</a>
        ${last ? `<p class="small muted" style="margin:14px 0 0">Zuletzt abgeschlossen am ${fmtDate(last)}</p>` : ""}
      </div>
    </div>`;
}

function card(view, ov, item) {
  const total = ov.items.length;
  const pos = ov.items.indexOf(item) + 1;
  view.innerHTML = `
    <div class="checkup">
      <div class="checkup-progress" aria-label="Vertrag ${pos} von ${total}">
        ${ov.items.map((i) => `<span class="${i.decision ? "done" : i === item ? "now" : ""}"></span>`).join("")}
      </div>
      <div class="card checkup-card">
        <div class="small muted">${pos} von ${total}</div>
        <div class="checkup-title">
          <span class="cat-icon" style="--c:${catColorVar(item.category)}">${catIcon(item.category)}</span>
          <div><h2>${esc(item.name)}</h2><div class="muted">${esc(item.provider || "")}${item.monthly_cost ? ` · ${money(item.monthly_cost)} / Monat` : ""}</div></div>
        </div>
        <ul class="checkup-reasons">
          ${item.reasons.map((r) => `<li>${icon(REASON_ICON[r.code] || "info")}<span>${esc(r.text)}</span></li>`).join("")}
        </ul>
        ${
          item.cancellation_deadline && !item.flexible
            ? `<p class="small muted" style="margin:0 0 4px">Nächste Kündigung möglich bis ${fmtDate(item.cancellation_deadline)} zum ${fmtDate(item.next_term_end)}.</p>`
            : item.flexible
              ? `<p class="small muted" style="margin:0 0 4px">Monatlich kündbar.</p>`
              : ""
        }
        <div class="checkup-actions">
          <button class="btn btn-lg" data-d="ok">${icon("check")} Passt so</button>
          <button class="btn btn-lg" data-d="compare">${icon("scale")} Vergleichen</button>
          <button class="btn btn-lg btn-danger-soft" data-d="cancel">${icon("ban")} Kündigen</button>
        </div>
        <p class="small muted" style="margin:12px 0 0">Vergleichen und Kündigen merkst du dir jetzt nur vor – am Ende bekommst du die passenden Links.</p>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:12px">
        <a class="btn btn-ghost btn-sm" href="#/checkup">${icon("back")} Übersicht</a>
        <a class="btn btn-ghost btn-sm" href="#/contracts/${item.contract_id}">Vertrag ansehen ${icon("chevRight")}</a>
      </div>
    </div>`;
  view.querySelectorAll("[data-d]").forEach((b) =>
    b.addEventListener("click", async () => {
      const next = await api.checkupDecide(item.contract_id, b.dataset.d);
      const open = next.items.filter((i) => !i.decision);
      if (open.length) card(view, next, open[0]);
      else done(view, next);
    }),
  );
}

function done(view, ov) {
  const s = ov.summary;
  const compare = ov.items.filter((i) => i.decision === "compare");
  const cancel = ov.items.filter((i) => i.decision === "cancel");
  const row = (i, action) => `<div class="list-item">
      <span class="cat-icon sm" style="--c:${catColorVar(i.category)}">${catIcon(i.category)}</span>
      <div class="grow"><div class="title">${esc(i.name)}</div><div class="sub">${money(i.monthly_cost)} / Monat</div></div>${action}</div>`;
  view.innerHTML = `
    <div class="checkup">
      <div class="card checkup-hero">
        <span class="checkup-emoji">${ov.items.length ? "🎉" : "✨"}</span>
        <h1>${ov.items.length ? "Geschafft!" : "Alles im grünen Bereich"}</h1>
        <p class="text-2">${
          ov.items.length
            ? `${s.reviewed} ${s.reviewed === 1 ? "Vertrag" : "Verträge"} geprüft${s.compare ? ` · ${s.compare} zum Vergleichen` : ""}${s.cancel ? ` · ${s.cancel} zum Kündigen` : ""}.`
            : "Bei keinem deiner Verträge gibt es gerade etwas zu tun."
        }</p>
        ${s.cancel_savings_year ? `<div class="checkup-savings">${icon("piggy")} Bis zu <b>${money(s.cancel_savings_year)}</b> im Jahr weniger, wenn du kündigst</div>` : ""}
      </div>
      ${
        cancel.length
          ? `<div class="card"><div class="card-head"><div><h2>${icon("ban")} Kündigen</h2><p>Das Schreiben ist mit deinen Daten vorausgefüllt.</p></div></div>
              <div class="list">${cancel.map((i) => row(i, `<button class="btn btn-sm" data-letter="${i.contract_id}">${icon("mail")} Kündigungsschreiben</button>`)).join("")}</div></div>`
          : ""
      }
      ${
        compare.length
          ? `<div class="card"><div class="card-head"><div><h2>${icon("scale")} Vergleichen</h2><p>Angebot eintragen – Contractly rechnet Boni und Wechselzeitpunkt mit.</p></div></div>
              <div class="list">${compare.map((i) => row(i, `<a class="btn btn-sm" href="#/contracts/${i.contract_id}?tab=compare">${icon("scale")} Vergleichen</a>`)).join("")}</div></div>`
          : ""
      }
      <div class="card">
        <div class="card-head"><div><h2>${icon("shield")} Notfall-Mappe aktualisieren?</h2>
          <p>Damit Angehörige im Ernstfall wissen, welche Verträge es gibt und wie man sie kündigt.</p></div>
          <a class="btn btn-sm" href="#/emergency">Öffnen ${icon("chevRight")}</a></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">
        ${ov.completed_on ? "" : `<button class="btn btn-primary" id="finish">${icon("check")} Jahres-Check abschließen</button>`}
      </div>
    </div>`;
  view.querySelectorAll("[data-letter]").forEach((b) =>
    b.addEventListener("click", async () => openLetter(await api.contract(Number(b.dataset.letter)))),
  );
  $("#finish", view)?.addEventListener("click", async () => {
    await api.checkupComplete();
    toast("Jahres-Check abgeschlossen – bis nächstes Jahr! 👋");
    location.hash = "#/";
  });
}
