import { api } from "../api.js";
import { catIcon, catLabel, state } from "../store.js";
import { $, esc, icon, modal, money, toast } from "../ui.js";
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
  // the own costs; contracts on another account (joint account …) are mentioned separately
  const monthly = running.filter((c) => !c.account).reduce((s, c) => s + c.monthly_cost, 0);
  const elsewhere = running.filter((c) => c.account).reduce((s, c) => s + c.monthly_cost, 0);

  const SORTS = { category: "Nach Bereich", price: "Teuerste zuerst", deadline: "Nächste Frist zuerst", name: "Alphabetisch" };

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Verträge</h1><p>${running.length} laufend · ${money(monthly)} im Monat · ${money(monthly * 12, true)} im Jahr${
        elsewhere ? ` · zzgl. ${money(elsewhere)} über andere Konten` : ""
      }</p></div>
    </div>
    <div class="list-toolbar">
      <input class="input" id="q" type="search" placeholder="Suchen …" aria-label="Verträge durchsuchen (Name, Anbieter, Eckdaten)" value="${esc(prefs.q)}" />
      <button class="btn" id="filter-btn">${icon("layers")}<span class="label">Filter</span><span class="count" id="filter-count"></span></button>
    </div>
    <div class="chips active-filters" id="active"></div>
    <div id="list"></div>`;

  // active filters as small chips, each removable – the defaults show nothing
  const drawActive = () => {
    const chips = [];
    if (prefs.category !== "all") {
      const cat = usedCats.find((c) => c.key === prefs.category);
      chips.push(["category", `${cat?.icon ?? ""} ${esc(cat?.label ?? prefs.category)}`]);
    }
    if (prefs.sort !== "category") chips.push(["sort", SORTS[prefs.sort]]);
    if (prefs.showEnded) chips.push(["ended", "mit beendeten"]);
    $("#active", view).innerHTML = chips
      .map(([k, t]) => `<button class="chip active" data-clear="${k}" title="Filter entfernen">${t} ${icon("x")}</button>`)
      .join("");
    $("#filter-count", view).textContent = chips.length ? chips.length : "";
  };
  $("#active", view).addEventListener("click", (e) => {
    const k = e.target.closest("[data-clear]")?.dataset.clear;
    if (!k) return;
    if (k === "category") prefs.category = "all";
    if (k === "sort") prefs.sort = "category";
    if (k === "ended") prefs.showEnded = false;
    update();
  });

  const openFilter = () => {
    const m = modal({
      title: "Filter & Ansicht",
      body: `<div class="filter-sheet">
          <div class="fs-group"><div class="fs-label">Bereich</div><div class="chips" data-set="category">
            <button class="chip ${prefs.category === "all" ? "active" : ""}" data-v="all">Alle <span class="count">${running.length}</span></button>
            ${usedCats
              .map((c) => `<button class="chip ${prefs.category === c.key ? "active" : ""}" data-v="${c.key}">${c.icon} ${esc(c.label)} <span class="count">${counts[c.key]}</span></button>`)
              .join("")}
          </div></div>
          <div class="fs-group"><div class="fs-label">Sortieren</div><div class="chips" data-set="sort">
            ${Object.entries(SORTS).map(([k, l]) => `<button class="chip ${prefs.sort === k ? "active" : ""}" data-v="${k}">${l}</button>`).join("")}
          </div></div>
          <div class="fs-group"><div class="fs-label">Ansicht</div><div class="chips" data-set="layout">
            <button class="chip ${prefs.layout === "list" ? "active" : ""}" data-v="list">${icon("list")} Liste</button>
            <button class="chip ${prefs.layout === "grid" ? "active" : ""}" data-v="grid">${icon("grid")} Kacheln</button>
          </div></div>
          <label class="check"><input type="checkbox" id="ended" ${prefs.showEnded ? "checked" : ""}/> Beendete Verträge zeigen</label>
        </div>`,
      foot: `<button class="btn btn-ghost mr-auto" data-reset>Zurücksetzen</button><button class="btn btn-primary" data-close>Fertig</button>`,
    });
    m.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-set] [data-v]");
      if (chip) {
        const set = chip.closest("[data-set]");
        prefs[set.dataset.set] = chip.dataset.v;
        set.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
        if (set.dataset.set === "layout") rememberLayout();
        update();
      }
      if (e.target.closest("[data-reset]")) {
        Object.assign(prefs, { category: "all", sort: "category", showEnded: false });
        m.close();
        update();
      }
    });
    $("#ended", m).addEventListener("change", (e) => {
      prefs.showEnded = e.target.checked;
      update();
    });
  };
  const rememberLayout = () => {
    try {
      localStorage.setItem("contracts-layout", prefs.layout);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };



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

  const update = () => {
    drawActive();
    draw();
  };
  $("#q", view).addEventListener("input", (e) => {
    prefs.q = e.target.value;
    draw();
  });
  $("#filter-btn", view).addEventListener("click", openFilter);
  update();
}
