import { api } from "../api.js";
import { legendHtml, stackedBars } from "../charts.js";
import { GROUPS, catColorVar, catIcon, catLabel, groupOf, slotColor, state } from "../store.js";
import { esc, fmtDate, icon, isoDate, money, signedMoney, toast } from "../ui.js";
import { bindReminderActions, emptyState, reminderItem } from "./components.js";
import { router } from "../app.js";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 18) return "Hallo";
  return "Guten Abend";
}

export async function renderDashboard(view) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 6, 1);
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const [summary, upcoming, series, profile] = await Promise.all([
    api.summary(),
    api.upcoming({ horizon_days: 60 }),
    api.timeseries({ start: isoDate(start).slice(0, 7), end: isoDate(end).slice(0, 7), group: "category" }),
    state.profile ? Promise.resolve(state.profile) : api.profile(),
  ]);
  state.profile = profile;
  const firstName = (profile.name || "").trim().split(/\s+/)[0];
  const monthName = now.toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  if (!summary.total_count) {
    view.innerHTML = `
      <div class="page-head"><div><h1>${greeting()}${firstName ? ", " + esc(firstName) : ""} 👋</h1>
      <p>Willkommen bei Contractly – deinem persönlichen Vertragsordner.</p></div></div>
      ${emptyState({
        art: "🗂️",
        title: "Noch keine Verträge",
        text: "Leg deinen ersten Vertrag an – Handy, Strom, Versicherung oder Fitnessstudio. Dauert keine Minute. Oder schau dich erst mit Beispieldaten um.",
        actions: `<a class="btn btn-primary" href="#/contracts/new">${icon("plus")} Ersten Vertrag anlegen</a>
                  <button class="btn" id="demo">${icon("sparkles")} Demo-Daten laden</button>`,
      })}`;
    view.querySelector("#demo").addEventListener("click", async () => {
      await api.demo();
      toast("Demo-Daten geladen");
      router();
    });
    return;
  }

  const delta = summary.monthly_total - summary.monthly_year_ago;
  const urgent = summary.deadlines.filter((d) => d.type === "deadline" && d.days_left <= 14);
  const currentMonth = isoDate(now).slice(0, 7);

  // Fold category series into the eight fixed groups.
  const grouped = GROUPS.map((g) => ({ ...g, values: series.months.map(() => 0) }));
  for (const s of series.series) {
    const g = grouped.find((x) => x.key === groupOf(s.key));
    s.values.forEach((v, i) => (g.values[i] += v));
  }
  const visible = grouped.filter((g) => g.values.some((v) => v > 0));

  const groupTotals = GROUPS.map((g) => ({
    ...g,
    monthly: summary.by_category.filter((c) => groupOf(c.category) === g.key).reduce((s, c) => s + c.monthly, 0),
    count: summary.by_category.filter((c) => groupOf(c.category) === g.key).reduce((s, c) => s + c.count, 0),
  }))
    .filter((g) => g.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);
  const maxGroup = Math.max(...groupTotals.map((g) => g.monthly), 1);

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${greeting()}${firstName ? ", " + esc(firstName) : ""} 👋</h1>
        <p>Dein Vertragsüberblick für ${monthName}.</p>
      </div>
      <div class="page-actions">
        <a class="btn" href="#/costs">${icon("chart")}<span class="label">Prognose</span></a>
        <a class="btn btn-primary" href="#/contracts/new">${icon("plus")}<span class="label">Neuer Vertrag</span></a>
      </div>
    </div>

    ${
      urgent.length
        ? `<div class="callout warn" style="margin-bottom:20px">${icon("alert")}
            <div><b>${urgent.length === 1 ? "Eine Kündigungsfrist läuft" : `${urgent.length} Kündigungsfristen laufen`} bald ab.</b>
            ${urgent.map((d) => `<a href="#/contracts/${d.contract_id}">${esc(d.name)}</a> (bis ${fmtDate(d.date)})`).join(", ")}.
            Kündigen oder bewusst weiterlaufen lassen?</div></div>`
        : ""
    }

    <div class="kpis">
      <div class="card kpi hero">
        <div class="kpi-label"><span class="kpi-icon">${icon("euro")}</span>Fixkosten pro Monat</div>
        <div class="kpi-value num">${money(summary.monthly_total)}</div>
        <div class="kpi-sub">${
          summary.monthly_year_ago
            ? `<span class="delta">${icon(delta > 0 ? "trendUp" : "trendDown")} ${signedMoney(delta)}</span> ggü. Vorjahr`
            : "aktuelle Monatsbelastung"
        }</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label"><span class="kpi-icon">${icon("calendar")}</span>Pro Jahr</div>
        <div class="kpi-value num">${money(summary.yearly_total, true)}</div>
        <div class="kpi-sub">${money(summary.ytd_total, true)} bisher in ${now.getFullYear()}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label"><span class="kpi-icon">${icon("file")}</span>Laufende Verträge</div>
        <div class="kpi-value num">${summary.active_count}</div>
        <div class="kpi-sub">${summary.deadlines.length ? `${summary.deadlines.length} ${summary.deadlines.length === 1 ? "Frist" : "Fristen"} in 60 Tagen` : "keine Fristen in Sicht ✨"}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label"><span class="kpi-icon" style="background:var(--good-soft);color:var(--good)">${icon("piggy")}</span>Durch Wechsel gespart</div>
        <div class="kpi-value num ${summary.switch_savings >= 0 ? "" : "worse"}">${money(summary.switch_savings, true)}</div>
        <div class="kpi-sub">${summary.switch_count ? `aus ${summary.switch_count} Wechsel${summary.switch_count > 1 ? "n" : ""}` : "Vergleich lohnt sich oft!"}</div>
      </div>
    </div>

    <div class="grid grid-main" style="margin-bottom:20px;align-items:start">
      <div class="card">
        <div class="card-head">
          <div><h2>Kostenverlauf</h2><p>Monatliche Kosten nach Kategorie · helle Balken = Vorschau</p></div>
          <a class="btn btn-sm btn-ghost" href="#/costs">Details ${icon("chevRight")}</a>
        </div>
        <div class="chart-box"><canvas id="dash-chart" aria-label="Kostenverlauf nach Kategorie"></canvas></div>
        ${legendHtml(visible.map((g) => ({ label: g.label, color: `var(--series-${g.slot})` })))}
      </div>
      <div class="card">
        <div class="card-head">
          <div><h2>Als Nächstes</h2><p>Fristen & Erinnerungen</p></div>
          <a class="btn btn-sm btn-ghost" href="#/reminders">Alle ${icon("chevRight")}</a>
        </div>
        <div class="list" id="dash-reminders">
          ${
            upcoming.items.length
              ? upcoming.items.slice(0, 5).map((i) => reminderItem(i, { compact: true })).join("")
              : `<div class="callout good">${icon("check")}<div>Alles im Griff – in den nächsten 60 Tagen steht nichts an.</div></div>`
          }
        </div>
      </div>
    </div>

    <div class="grid grid-3">
      <div class="card">
        <div class="card-head"><div><h2>Wofür geht's drauf?</h2><p>Monatlich nach Bereich</p></div></div>
        <div class="bar-list">
          ${groupTotals
            .map(
              (g) => `<div class="bar-row">
                <div class="bar-label"><span><span class="dot" style="background:var(--series-${g.slot})"></span>${esc(g.label)}
                  <span class="muted small">(${g.count})</span></span>
                  <span class="num">${money(g.monthly)} <span class="muted small">${Math.round((g.monthly / summary.monthly_total) * 100)}%</span></span></div>
                <div class="bar-track"><div class="bar-fill" style="width:${(g.monthly / maxGroup) * 100}%;background:var(--series-${g.slot})"></div></div>
              </div>`,
            )
            .join("")}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Größte Posten</h2><p>Die teuersten laufenden Verträge</p></div></div>
        <div class="list">
          ${summary.top_contracts
            .map(
              (c) => `<a class="list-item" href="#/contracts/${c.id}">
                <span class="cat-icon sm" style="--c:${catColorVar(c.category)}">${catIcon(c.category)}</span>
                <div class="grow"><div class="title">${esc(c.name)}</div><div class="sub">${esc(c.provider || catLabel(c.category))}</div></div>
                <div class="end num"><b>${money(c.monthly_cost)}</b><div class="sub">${money(c.yearly_cost, true)}/J</div></div></a>`,
            )
            .join("")}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Preisänderungen</h2><p>Letzte 6 und nächste 3 Monate</p></div></div>
        <div class="list">
          ${
            summary.price_changes.length
              ? summary.price_changes
                  .map(
                    (p) => `<a class="list-item" href="#/contracts/${p.contract_id}">
                <span class="cat-icon sm" style="--c:${catColorVar(p.category)}">${catIcon(p.category)}</span>
                <div class="grow"><div class="title">${esc(p.name)}</div><div class="sub">ab ${fmtDate(p.date)} · ${money(p.old_monthly)} → ${money(p.new_monthly)}</div></div>
                <span class="badge ${p.diff > 0 ? "bad" : "good"}">${icon(p.diff > 0 ? "trendUp" : "trendDown")} ${signedMoney(p.diff)}</span></a>`,
                  )
                  .join("")
              : `<p class="muted">Keine Preisänderungen – stabil! 👌</p>`
          }
        </div>
      </div>
    </div>`;

  stackedBars(
    view.querySelector("#dash-chart"),
    series.months,
    visible.map((g) => ({ label: g.label, color: slotColor(g.slot), values: g.values })),
    { highlightFrom: series.months.find((m) => m > currentMonth) },
  );
  bindReminderActions(view.querySelector("#dash-reminders"), api, (msg) => {
    toast(msg);
    router();
  });
}
