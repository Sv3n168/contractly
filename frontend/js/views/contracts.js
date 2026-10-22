import { api } from "../api.js";
import { catIcon, catLabel, state } from "../store.js";
import { $, esc, icon, money, toast } from "../ui.js";
import { contractCard, contractRow, emptyState } from "./components.js";
import { router } from "../app.js";

const prefs = { category: "all", showEnded: false, sort: "category", q: "", layout: storedLayout() };

function storedLayout() {
  try {
    return localStorage.getItem("contracts-layout") === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

export async function renderContracts(view) {
  const all = await api.contracts();
  if (!all.length) {
    view.innerHTML = `<div class="page-head"><div><h1>Verträge</h1></div></div>
      ${emptyState({
        art: "📄",
        title: "Hier ist noch Platz",
        text: "Sobald du Verträge anlegst, findest du sie hier übersichtlich nach Kategorien sortiert.",
        actions: `<a class="btn btn-primary" href="#/contracts/new">${icon("plus")} Vertrag anlegen</a>
                  <button class="btn" id="demo">${icon("sparkles")} Demo-Daten</button>`,
      })}`;
    $("#demo", view).addEventListener("click", async () => {
      await api.demo();
      toast("Demo-Daten geladen");
      router();
    });
    return;
  }

  const running = all.filter((c) => c.state !== "ended");
  const counts = {};
  running.forEach((c) => (counts[c.category] = (counts[c.category] || 0) + 1));
  const usedCats = state.meta.categories.filter((c) => counts[c.key]);
  const monthly = running.reduce((s, c) => s + c.monthly_cost, 0);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Verträge</h1><p>${running.length} laufend · ${money(monthly)} im Monat · ${money(monthly * 12, true)} im Jahr</p></div>
      <div class="page-actions"><a class="btn" href="#/import">${icon("upload")}<span class="label">Importieren</span></a>
        <a class="btn btn-primary" href="#/contracts/new">${icon("plus")}<span class="label">Neuer Vertrag</span></a></div>
    </div>
    <div class="card" style="padding:14px;margin-bottom:20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <div class="field" style="flex:1;min-width:200px">
          <input class="input" id="q" type="search" placeholder="Suchen nach Name, Anbieter, Eckdaten…" value="${esc(prefs.q)}" />
        </div>
        <select class="input" id="sort" style="width:auto">
          <option value="category">Nach Kategorie</option>
          <option value="price">Teuerste zuerst</option>
          <option value="deadline">Nächste Frist zuerst</option>
          <option value="name">Alphabetisch</option>
        </select>
        <div class="segmented" id="layout" role="group" aria-label="Ansicht">
          <button type="button" data-layout="list" class="${prefs.layout === "list" ? "active" : ""}" aria-label="Liste" title="Liste">${icon("list")}</button>
          <button type="button" data-layout="grid" class="${prefs.layout === "grid" ? "active" : ""}" aria-label="Kacheln" title="Kacheln">${icon("grid")}</button>
        </div>
        <label class="check small"><input type="checkbox" id="ended" ${prefs.showEnded ? "checked" : ""}/> Beendete zeigen</label>
      </div>
      <div class="scroll-x"><div class="chips" id="cats">
        <button class="chip ${prefs.category === "all" ? "active" : ""}" data-cat="all">Alle <span class="count">${running.length}</span></button>
        ${usedCats
          .map(
            (c) => `<button class="chip ${prefs.category === c.key ? "active" : ""}" data-cat="${c.key}">${c.icon} ${esc(c.label)} <span class="count">${counts[c.key]}</span></button>`,
          )
          .join("")}
      </div></div>
    </div>
    <div id="list"></div>`;

  $("#sort", view).value = prefs.sort;

  const draw = () => {
    let items = all.filter((c) => prefs.showEnded || c.state !== "ended");
    if (prefs.category !== "all") items = items.filter((c) => c.category === prefs.category);
    const q = prefs.q.trim().toLowerCase();
    if (q)
      items = items.filter((c) =>
        [c.name, c.provider, catLabel(c.category), ...Object.values(c.attributes || {})].join(" ").toLowerCase().includes(q),
      );
    const byDeadline = (c) => c.cancellation_deadline || c.end_date || "9999";
    const sorters = {
      price: (a, b) => b.monthly_cost - a.monthly_cost,
      deadline: (a, b) => byDeadline(a).localeCompare(byDeadline(b)),
      name: (a, b) => a.name.localeCompare(b.name, "de"),
      category: (a, b) => catLabel(a.category).localeCompare(catLabel(b.category), "de") || b.monthly_cost - a.monthly_cost,
    };
    items.sort(sorters[prefs.sort]);
    const list = $("#list", view);
    if (!items.length) {
      list.innerHTML = `<div class="card empty"><div class="art">🔍</div><h2>Keine Treffer</h2><p>Passe Suche oder Filter an.</p></div>`;
      return;
    }
    const groups = [];
    for (const c of items) {
      let g = groups.find((x) => x.key === c.category);
      if (!g) groups.push((g = { key: c.category, items: [] }));
      g.items.push(c);
    }
    const sum = (g) => money(g.items.reduce((s, c) => s + c.monthly_cost, 0));
    if (prefs.layout === "list") {
      list.innerHTML = `<div class="card contract-list">${
        prefs.sort === "category"
          ? groups
              .map(
                (g) => `<div class="cl-group"><span>${catIcon(g.key)} ${esc(catLabel(g.key))}</span><span class="num">${sum(g)}/Monat</span></div>
                  ${g.items.map(contractRow).join("")}`,
              )
              .join("")
          : items.map(contractRow).join("")
      }</div>`;
      return;
    }
    if (prefs.sort !== "category") {
      list.innerHTML = `<div class="contract-grid">${items.map(contractCard).join("")}</div>`;
      return;
    }
    list.innerHTML = groups
      .map(
        (g) => `<div class="group-head"><span style="font-size:20px">${catIcon(g.key)}</span><h2>${esc(catLabel(g.key))}</h2>
          <span class="sum num">${sum(g)}/Monat</span></div>
          <div class="contract-grid">${g.items.map(contractCard).join("")}</div>`,
      )
      .join("");
  };

  $("#q", view).addEventListener("input", (e) => {
    prefs.q = e.target.value;
    draw();
  });
  $("#sort", view).addEventListener("change", (e) => {
    prefs.sort = e.target.value;
    draw();
  });
  $("#layout", view).addEventListener("click", (e) => {
    const b = e.target.closest("[data-layout]");
    if (!b) return;
    prefs.layout = b.dataset.layout;
    try {
      localStorage.setItem("contracts-layout", prefs.layout);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
    view.querySelectorAll("#layout button").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  });
  $("#ended", view).addEventListener("change", (e) => {
    prefs.showEnded = e.target.checked;
    draw();
  });
  $("#cats", view).addEventListener("click", (e) => {
    const chip = e.target.closest("[data-cat]");
    if (!chip) return;
    prefs.category = chip.dataset.cat;
    view.querySelectorAll("#cats .chip").forEach((c) => c.classList.toggle("active", c === chip));
    draw();
  });
  draw();
}
