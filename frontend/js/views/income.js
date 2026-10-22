// "Einnahmen": salary history (net, gross optional), raises, bonuses and other income.

import { api } from "../api.js";
import { incomeChart, legendHtml } from "../charts.js";
import { cssVar } from "../store.js";
import { $, busy, confirmDialog, esc, fmtDate, formData, icon, modal, money, signedMoney, toast, today } from "../ui.js";

const pct = (v) => `${(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} %`;

export async function renderIncome(view) {
  const d = await api.income();
  if (!d.sources.length) return empty(view, d);
  const ratio = d.fixed_cost_ratio;
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Einnahmen</h1><p>Gehalt, Boni und alles, was reinkommt – und wie viel davon deine Fixkosten brauchen.</p></div>
      <div class="page-actions"><button class="btn btn-primary" id="add">${icon("plus")}<span class="label">Einnahme hinzufügen</span></button></div>
    </div>

    <div class="kpis">
      <div class="card kpi"><div class="kpi-label"><span class="kpi-icon" style="background:var(--good-soft);color:var(--good)">${icon("euro")}</span>Netto pro Monat</div>
        <div class="kpi-value num money" data-count="${d.monthly_net}" data-format="money">${money(d.monthly_net)}</div>
        <div class="kpi-sub">${d.monthly_gross ? `${money(d.monthly_gross)} brutto` : "regelmäßige Einnahmen"}</div></div>
      <div class="card kpi"><div class="kpi-label"><span class="kpi-icon" style="background:var(--good-soft);color:var(--good)">${icon("sparkles")}</span>Boni & Sonderzahlungen</div>
        <div class="kpi-value num" data-count="${d.bonus_12m}" data-format="money0">${money(d.bonus_12m, true)}</div>
        <div class="kpi-sub">in den letzten 12 Monaten</div></div>
      <div class="card kpi"><div class="kpi-label"><span class="kpi-icon">${icon("calendar")}</span>Netto in 12 Monaten</div>
        <div class="kpi-value num" data-count="${d.net_12m}" data-format="money0">${money(d.net_12m, true)}</div>
        <div class="kpi-sub">Ø ${money(d.net_12m / 12)} pro Monat inkl. Boni</div></div>
      <div class="card kpi hero"><div class="kpi-label"><span class="kpi-icon">${icon("chart")}</span>Für Fixkosten</div>
        <div class="kpi-value num">${ratio != null ? pct(ratio) : "–"}</div>
        <div class="kpi-sub">${d.free_monthly != null ? `${money(d.free_monthly)} bleiben im Schnitt pro Monat` : ""}</div></div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><div><h2>Einnahmen & Fixkosten</h2><p>Netto pro Monat · die Linie zeigt deine Fixkosten</p></div></div>
      <div class="chart-box"><canvas id="income-chart" aria-label="Einnahmen und Fixkosten pro Monat"></canvas></div>
      ${legendHtml([
        { label: "Regelmäßig", color: cssVar("--good") },
        { label: "Boni & Sonderzahlungen", color: cssVar("--good") + "70" },
        { label: "Fixkosten", color: cssVar("--text") },
      ])}
    </div>

    <div class="grid grid-main" style="align-items:start">
      <div class="stack">${d.sources.map(sourceCard).join("")}</div>
      <div class="stack">
        ${
          d.raises.length
            ? `<div class="card"><div class="card-head"><div><h2>${icon("trendUp")} Gehaltsentwicklung</h2></div></div>
                <div class="list">${d.raises
                  .map(
                    (r) => `<div class="list-item"><div class="grow"><div class="title">${esc(r.source)} · ${fmtDate(r.date)}</div>
                      <div class="sub">netto ${money(r.old_net)} → ${money(r.new_net)}${r.new_gross ? ` · brutto ${money(r.old_gross)} → ${money(r.new_gross)}` : ""}</div></div>
                      <span class="badge ${r.new_net >= r.old_net ? "good" : "bad"}">${r.pct_net != null ? `${r.pct_net > 0 ? "+" : ""}${r.pct_net.toLocaleString("de-DE")} %` : ""}</span></div>`,
                  )
                  .join("")}</div></div>`
            : ""
        }
        <div class="card"><div class="card-head"><div><h2>${icon("calendar")} Pro Jahr</h2></div></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Jahr</th><th class="r">Netto</th><th class="r">Brutto</th></tr></thead><tbody>
          ${d.years
            .slice()
            .reverse()
            .map(
              (y, i, all) => `<tr><td>${y.year}${y.year === new Date().getFullYear() ? ' <span class="small muted">bisher</span>' : y.complete ? "" : ' <span class="small muted">Teiljahr</span>'}</td>
                <td class="r num"><b>${money(y.net, true)}</b>${
                  y.complete && all[i + 1]?.complete && all[i + 1].net ? `<div class="small ${y.net >= all[i + 1].net ? "money" : "worse"}">${signedMoney(Math.round(y.net - all[i + 1].net))}</div>` : ""
                }</td><td class="r num">${y.gross ? money(y.gross, true) : "–"}</td></tr>`,
            )
            .join("")}</tbody></table></div></div>
      </div>
    </div>`;

  incomeChart($("#income-chart", view), d.months, { regular: d.regular, oneOff: d.one_off, costs: d.costs });
  $("#add", view).addEventListener("click", () => sourceModal(d.kinds));
  view.querySelectorAll("[data-raise]").forEach((b) => b.addEventListener("click", () => entryModal(Number(b.dataset.raise), "raise")));
  view.querySelectorAll("[data-bonus]").forEach((b) => b.addEventListener("click", () => entryModal(Number(b.dataset.bonus), "bonus")));
  view.querySelectorAll("[data-edit-source]").forEach((b) =>
    b.addEventListener("click", () => sourceModal(d.kinds, d.sources.find((s) => s.id === Number(b.dataset.editSource)))),
  );
  view.querySelectorAll("[data-del-entry]").forEach((b) =>
    b.addEventListener("click", async () => {
      const [sid, eid] = b.dataset.delEntry.split(":");
      if (!(await confirmDialog("Eintrag löschen?"))) return;
      try {
        await api.deleteIncomeEntry(sid, eid);
        renderIncome(view);
      } catch (err) {
        toast(err.message, "error");
      }
    }),
  );
}

function sourceCard(s) {
  return `<div class="card income-card ${s.active ? "" : "ended"}">
    <div class="card-head">
      <div class="income-title"><span class="cat-icon" style="--c:var(--good)">${s.icon}</span>
        <div><h2>${esc(s.name)}</h2><p>${esc([s.kind_label, s.payer].filter(Boolean).join(" · "))}${s.active ? "" : ` · beendet ${fmtDate(s.end_date)}`}</p></div></div>
      <button class="btn btn-ghost btn-sm" data-edit-source="${s.id}" aria-label="Bearbeiten">${icon("edit")}</button>
    </div>
    <div class="income-now">
      <div><div class="small muted">Netto</div><div class="big num money">${money(s.current_net)}</div></div>
      ${s.current_gross ? `<div><div class="small muted">Brutto</div><div class="big num">${money(s.current_gross)}</div></div>` : ""}
      <div class="small muted" style="align-self:end">pro Monat</div>
    </div>
    <div class="list" style="margin-top:12px">${s.entries
      .map(
        (e) => `<div class="list-item">
          <span class="kpi-icon" ${e.interval === "once" ? 'style="background:var(--good-soft);color:var(--good)"' : ""}>${icon(e.interval === "once" ? "sparkles" : "trendUp")}</span>
          <div class="grow"><div class="title">${e.interval === "once" ? esc(e.note || "Sonderzahlung") : `ab ${fmtDate(e.valid_from)}`}</div>
            <div class="sub">${e.interval === "once" ? fmtDate(e.valid_from) : esc(e.note || "")}</div></div>
          <div class="r num"><b>${money(e.net)}</b>${e.gross ? `<div class="small muted">${money(e.gross)} brutto</div>` : ""}</div>
          <button class="btn btn-ghost btn-sm btn-danger" data-del-entry="${s.id}:${e.id}" aria-label="Löschen">${icon("trash")}</button></div>`,
      )
      .join("")}</div>
    <div class="form-actions" style="margin-top:12px">
      <button class="btn btn-sm" data-bonus="${s.id}">${icon("sparkles")} Bonus / Sonderzahlung</button>
      <button class="btn btn-sm btn-primary" data-raise="${s.id}">${icon("trendUp")} Neuer Betrag</button>
    </div>
  </div>`;
}

function empty(view, d) {
  view.innerHTML = `
    <div class="page-head"><div><h1>Einnahmen</h1><p>Gehalt, Boni und alles, was reinkommt.</p></div></div>
    <div class="card empty"><div class="art">💶</div><h2>Was kommt rein?</h2>
      <p>Trag dein Gehalt ein – <b>netto reicht</b>, brutto ist optional. Dann siehst du, wie viel deine Fixkosten davon brauchen,
        wie sich dein Gehalt entwickelt und was Boni ausmachen.</p>
      <div class="actions"><button class="btn btn-primary" id="add">${icon("plus")} Gehalt eintragen</button></div></div>`;
  $("#add", view).addEventListener("click", () => sourceModal(d.kinds));
}

function sourceModal(kinds, s = null) {
  const m = modal({
    title: s ? "Einnahme bearbeiten" : "Einnahme hinzufügen",
    body: `<form class="form-grid" id="sf">
      <label class="field"><span>Art</span><select name="kind">${kinds
        .map((k) => `<option value="${k.key}" ${(s?.kind || "salary") === k.key ? "selected" : ""}>${k.icon} ${esc(k.label)}</option>`)
        .join("")}</select></label>
      <label class="field"><span>Bezeichnung</span><input name="name" value="${esc(s?.name || "Gehalt")}" required/></label>
      <label class="field"><span>Von (optional)</span><input name="payer" value="${esc(s?.payer || "")}" placeholder="z. B. Arbeitgeber"/></label>
      <label class="field"><span>Seit</span><input type="date" name="start_date" value="${esc(s?.start_date || today())}" required/></label>
      ${
        s
          ? `<label class="field"><span>Endet / endete am</span><input type="date" name="end_date" value="${esc(s.end_date || "")}"/></label>`
          : `<label class="field"><span>Netto</span><div class="input-group"><input type="number" step="0.01" min="0" name="net" required inputmode="decimal"/><span class="addon">€</span></div>
               <small>Was auf dem Konto ankommt.</small></label>
             <label class="field"><span>Brutto (optional)</span><div class="input-group"><input type="number" step="0.01" min="0" name="gross" inputmode="decimal"/><span class="addon">€</span></div></label>
             <label class="field"><span>Zahlweise</span><select name="interval"><option value="monthly">monatlich</option><option value="yearly">jährlich</option></select></label>`
      }
    </form>`,
    foot: `${s ? `<button class="btn btn-ghost btn-danger" data-delete>${icon("trash")} Löschen</button>` : ""}
      <button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon("check")} Speichern</button>`,
  });
  $("[data-save]", m).addEventListener("click", async (e) => {
    const f = formData($("#sf", m));
    const payload = { name: f.name, kind: f.kind, payer: f.payer || null, start_date: f.start_date, end_date: f.end_date || null };
    if (!s) {
      if (f.net == null) return toast("Bitte den Netto-Betrag angeben", "error");
      payload.first = { valid_from: f.start_date, net: f.net, gross: f.gross ?? null, interval: f.interval || "monthly" };
    }
    busy(e.currentTarget);
    try {
      if (s) await api.updateIncomeSource(s.id, payload);
      else await api.createIncomeSource(payload);
      m.close();
      toast("Gespeichert");
      renderIncome($("#view"));
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
  $("[data-delete]", m)?.addEventListener("click", async () => {
    if (!(await confirmDialog(`„${s.name}“ mit allen Einträgen löschen?`))) return;
    await api.deleteIncomeSource(s.id);
    m.close();
    renderIncome($("#view"));
  });
}

function entryModal(sourceId, mode) {
  const bonus = mode === "bonus";
  const m = modal({
    title: bonus ? "Bonus / Sonderzahlung" : "Neuer Betrag (z. B. Gehaltserhöhung)",
    body: `<form class="form-grid" id="ef">
      <label class="field"><span>${bonus ? "Ausgezahlt am" : "Gültig ab"}</span><input type="date" name="valid_from" value="${today()}" required/></label>
      <label class="field"><span>Netto</span><div class="input-group"><input type="number" step="0.01" min="0" name="net" required inputmode="decimal"/><span class="addon">€</span></div></label>
      <label class="field"><span>Brutto (optional)</span><div class="input-group"><input type="number" step="0.01" min="0" name="gross" inputmode="decimal"/><span class="addon">€</span></div></label>
      ${bonus ? "" : `<label class="field"><span>Zahlweise</span><select name="interval"><option value="monthly">monatlich</option><option value="yearly">jährlich</option></select></label>`}
      <label class="field span-all"><span>Notiz</span><input name="note" placeholder="${bonus ? "z. B. Bonus, Urlaubsgeld, Weihnachtsgeld" : "z. B. Gehaltserhöhung, Tariferhöhung, Jobwechsel"}"/></label>
    </form>`,
    foot: `<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon("check")} Speichern</button>`,
  });
  $("[data-save]", m).addEventListener("click", async (e) => {
    const f = formData($("#ef", m));
    if (f.net == null) return toast("Bitte den Netto-Betrag angeben", "error");
    busy(e.currentTarget);
    try {
      await api.addIncomeEntry(sourceId, {
        valid_from: f.valid_from,
        net: f.net,
        gross: f.gross ?? null,
        interval: bonus ? "once" : f.interval || "monthly",
        note: f.note || null,
      });
      m.close();
      toast(bonus ? "Sonderzahlung eingetragen 🎉" : "Neuer Betrag eingetragen");
      renderIncome($("#view"));
    } catch (err) {
      busy(e.currentTarget, false);
      toast(err.message, "error");
    }
  });
}
