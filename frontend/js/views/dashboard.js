import { api } from "../api.js";
import { legendHtml, stackedBars } from "../charts.js";
import { GROUPS, groupOf, slotColor, state } from "../store.js";
import { esc, icon, isoDate, money, signedMoney, toast } from "../ui.js";
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
  const currentMonth = isoDate(now).slice(0, 7);

  // Fold category series into the eight fixed groups.
  const grouped = GROUPS.map((g) => ({ ...g, values: series.months.map(() => 0) }));
  for (const s of series.series) {
    const g = grouped.find((x) => x.key === groupOf(s.key));
    s.values.forEach((v, i) => (g.values[i] += v));
  }
  const visible = grouped.filter((g) => g.values.some((v) => v > 0));

  // One number, what to do next, one chart – everything else lives in Auswertung.
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${greeting()}${firstName ? ", " + esc(firstName) : ""} 👋</h1>
        <p>Dein Vertragsüberblick für ${monthName}.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-primary" href="#/contracts/new">${icon("plus")}<span class="label">Neuer Vertrag</span></a>
      </div>
    </div>

    <div class="dash-top">
      <div class="card kpi hero dash-hero">
        <div class="kpi-label"><span class="kpi-icon">${icon("euro")}</span>Fixkosten pro Monat</div>
        <div class="kpi-value num" data-count="${summary.monthly_total}" data-format="money">${money(summary.monthly_total)}</div>
        <div class="kpi-sub">${money(summary.yearly_total, true)} im Jahr · ${summary.active_count} ${summary.active_count === 1 ? "Vertrag" : "Verträge"}</div>
        ${
          summary.fixed_cost_ratio != null
            ? `<div class="kpi-sub"><a href="#/income" style="color:inherit"><b style="color:var(--money)">${Math.round(summary.fixed_cost_ratio * 100)} %</b> deines Nettos · ${money(summary.free_monthly, true)} bleiben</a></div>`
            : ""
        }
        ${
          summary.monthly_year_ago
            ? `<div class="kpi-sub"><span class="delta">${icon(delta > 0 ? "trendUp" : "trendDown")} ${signedMoney(delta)}</span> ggü. Vorjahr</div>`
            : ""
        }
        ${summary.switch_savings > 0 ? `<div class="kpi-sub">${icon("piggy")} ${money(summary.switch_savings, true)} durch Wechsel gespart</div>` : ""}
        ${(summary.other_accounts || [])
          .map((a) => `<div class="kpi-sub">🏦 zzgl. ${money(a.monthly)} über ${esc(a.name)}</div>`)
          .join("")}
      </div>
      <div class="card">
        <div class="card-head">
          <div><h2>Als Nächstes zu tun</h2><p>Fristen, Erinnerungen und Post</p></div>
          <a class="btn btn-sm btn-ghost" href="#/reminders">Alle ${icon("chevRight")}</a>
        </div>
        <div class="list" id="dash-reminders">
          ${
            upcoming.items.length
              ? upcoming.items.slice(0, 3).map((i) => reminderItem(i, { compact: true })).join("")
              : `<div class="callout good">${icon("check")}<div>Alles im Griff – in den nächsten 60 Tagen steht nichts an.</div></div>`
          }
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h2>Kostenverlauf</h2><p>Monatliche Kosten nach Bereich · helle Balken = Vorschau</p></div>
        <a class="btn btn-sm btn-ghost" href="#/costs">Auswertung ${icon("chevRight")}</a>
      </div>
      <div class="chart-box"><canvas id="dash-chart" aria-label="Kostenverlauf nach Bereich"></canvas></div>
      ${legendHtml(visible.map((g) => ({ label: g.label, color: `var(--series-${g.slot})` })))}
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
