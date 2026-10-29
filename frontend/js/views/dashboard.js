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
  const [summary, upcoming, series, profile, smart] = await Promise.all([
    api.summary(),
    api.upcoming({ horizon_days: 60 }),
    api.timeseries({ start: isoDate(start).slice(0, 7), end: isoDate(end).slice(0, 7), group: "category" }),
    state.profile ? Promise.resolve(state.profile) : api.profile(),
    api.insights().catch(() => ({ insights: [], incomplete: [] })),
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
    </div>

    <div class="dash-top">
      <div class="card kpi hero dash-hero">
        <div class="kpi-label"><span class="kpi-icon">${icon("euro")}</span>Fixkosten pro Monat</div>
        <div class="kpi-value num" data-count="${summary.monthly_total}" data-format="money">${money(summary.monthly_total)}</div>
        <div class="kpi-sub">${money(summary.yearly_total, true)} im Jahr · ${summary.active_count} ${summary.active_count === 1 ? "Vertrag" : "Verträge"}</div>
        ${
          summary.fixed_cost_ratio != null
            ? `<div class="kpi-sub"><a href="#/income" class="c-inherit"><b style="color:var(--money)">${Math.round(summary.fixed_cost_ratio * 100)} %</b> deines Nettos · ${money(summary.free_monthly, true)} bleiben</a></div>`
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
              ? upcoming.items.slice(0, 3).map((i) => reminderItem(i)).join("")
              : `<div class="callout good">${icon("check")}<div>Alles im Griff – in den nächsten 60 Tagen steht nichts an.</div></div>`
          }
        </div>
      </div>
    </div>

    ${smartCard(smart)}

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
  bindReminderActions(view.querySelector("#dash-reminders"), api, () => router());
  view.querySelector("#smart")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-dismiss]");
    if (!btn) return;
    // an insight goes for a year; the open-data note until something new is missing
    const gaps = btn.dataset.dismiss === "gaps";
    const keys = gaps ? smart.incomplete.flatMap((c) => c.gaps.map((g) => g.ack)) : [btn.dataset.dismiss];
    btn.closest(".insight, .gaps-line").remove();
    if (!view.querySelector("#smart .insight, #smart .gaps-line")) view.querySelector("#smart").remove();
    await api.dismissInsights(keys);
    toast(gaps ? "Quittiert – bis wieder etwas Neues fehlt" : "Ausgeblendet – für ein Jahr", "ok", null, {
      label: "Rückgängig",
      run: async () => {
        await api.restoreInsights(keys);
        router();
      },
    });
  });
}

const TONE_ICON = { warn: "trendUp", good: "trendDown", info: "sparkles" };

/** "Gut zu wissen": a few computed insights and the contracts that still lack data. */
function smartCard({ insights, incomplete }) {
  if (!insights.length && !incomplete.length) return "";
  const shown = incomplete.slice(0, 4);
  return `<div class="card smart-card" id="smart">
      <div class="card-head"><div><h2>Gut zu wissen</h2><p>Von Contractly aus deinen Verträgen berechnet</p></div></div>
      <div class="insights">
        ${insights
          .map(
            (i) => `<div class="insight ${i.tone}">
              <span class="insight-icon">${icon(TONE_ICON[i.tone] || "info")}</span>
              <div class="insight-body"><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div>
              <div class="insight-actions">
                <a class="btn btn-sm" href="${esc(i.link)}">${esc(i.action)}</a>
                <button class="icon-btn" data-dismiss="${esc(i.key)}" title="Ausblenden" aria-label="Hinweis ausblenden">${icon("x")}</button>
              </div></div>`,
          )
          .join("")}
        ${
          incomplete.length
            ? `<div class="gaps-line">${icon("info")}<div class="gaps-text"><b>${incomplete.length === 1 ? "1 Vertrag" : `${incomplete.length} Verträge`} mit offenen Angaben:</b>
                ${shown
                  .map((c) => `<a href="#/contracts/${c.contract_id}" title="Fehlt: ${esc(c.gaps.map((g) => g.label).join(", "))}">${esc(c.name)}</a>`)
                  .join(", ")}${incomplete.length > shown.length ? ` und ${incomplete.length - shown.length} weitere` : ""}</div>
                <button class="btn btn-sm" data-dismiss="gaps" title="Ausblenden, bis wieder etwas Neues fehlt">${icon("check")} Zur Kenntnis genommen</button></div>`
            : ""
        }
      </div>
    </div>`;
}
