// Chart.js helpers that follow the app's design tokens (light/dark aware).

import { cssVar } from "./store.js";
import { fmtMonth, icon, money } from "./ui.js";

const registry = new WeakMap();

function base() {
  const muted = cssVar("--muted");
  const grid = cssVar("--grid");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = muted;
  return {
    responsive: true,
    maintainAspectRatio: false,
    // charts build up with the same soft ease-out as the rest of the app
    animation: { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700, easing: "easeOutQuart" },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar("--surface"),
        titleColor: cssVar("--text"),
        bodyColor: cssVar("--text-2"),
        footerColor: cssVar("--text"),
        borderColor: cssVar("--border-strong"),
        borderWidth: 1,
        padding: 12,
        cornerRadius: 10,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          label: (ctx) => (ctx.parsed.y == null ? null : ` ${ctx.dataset.label}: ${money(ctx.parsed.y)}`),
        },
        filter: (item) => item.parsed.y != null && item.parsed.y !== 0,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: cssVar("--axis") },
        ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 14 },
      },
      y: {
        beginAtZero: true,
        grid: { color: grid },
        border: { display: false },
        ticks: { callback: (v) => money(v, true), maxTicksLimit: 6 },
      },
    },
  };
}

function mount(canvas, config) {
  registry.get(canvas)?.destroy();
  const chart = new Chart(canvas, config);
  registry.set(canvas, chart);
  // Pan sideways with a finger, but let vertical swipes scroll the page (and pinch zoom the chart).
  if (config.options?.plugins?.zoom) {
    canvas.style.touchAction = "pan-y";
    canvas.classList.add("explorable");
  }
  return chart;
}

/** How to move through an explorable chart – worded for touch or mouse. */
export function chartHint() {
  return `<p class="chart-hint">${icon("move")}
    <span class="hint-touch">Wischen zum Verschieben · mit zwei Fingern zoomen</span>
    <span class="hint-mouse">Ziehen zum Verschieben · Strg + Mausrad zum Zoomen</span></p>`;
}

/**
 * Make a monthly chart explorable: drag/swipe to move through time, pinch or Ctrl + wheel
 * (trackpad pinch) to zoom. Starts with the last `window` months of all loaded months.
 */
function explorable(opts, count, window) {
  opts.plugins.zoom = {
    pan: { enabled: true, mode: "x", threshold: 6 },
    zoom: { mode: "x", wheel: { enabled: true, modifierKey: "ctrl" }, pinch: { enabled: true } },
    // bounds are the first and last month loaded ("original" would be the initial window)
    limits: { x: { min: 0, max: count - 1, minRange: 2 } },
  };
  if (window && count > window) {
    opts.scales.x.min = count - window;
    opts.scales.x.max = count - 1;
  }
}

/** Show the last `months` months (0 = all) of an explorable chart. */
export function showLast(chart, months) {
  const count = chart.data.labels.length;
  const min = !months || months >= count ? 0 : count - months;
  chart.zoomScale("x", { min, max: count - 1 }, "default");
}

const totalFooter = (items) => {
  const sum = items.reduce((s, i) => s + (i.parsed.y || 0), 0);
  return items.length > 1 ? `Summe: ${money(sum)}` : "";
};

/** Stacked monthly bars. series: [{label, color, values}] */
export function stackedBars(canvas, months, series, { highlightFrom = null, window = 0 } = {}) {
  const opts = base();
  if (window) explorable(opts, months.length, window);
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;
  opts.plugins.tooltip.callbacks.footer = totalFooter;
  opts.plugins.tooltip.callbacks.title = (items) => fmtMonth(months[items[0].dataIndex]);
  return mount(canvas, {
    type: "bar",
    data: {
      labels: months.map(fmtMonth),
      datasets: series.map((s) => ({
        label: s.label,
        data: s.values.map((v) => (v ? v : null)),
        backgroundColor: months.map((m) => (highlightFrom && m >= highlightFrom ? s.color + "80" : s.color)),
        borderColor: cssVar("--surface"),
        borderWidth: { top: 2, left: 0, right: 0, bottom: 0 },
        borderSkipped: false,
        borderRadius: 4,
        maxBarThickness: 26,
        categoryPercentage: 0.78,
      })),
    },
    options: opts,
  });
}

/**
 * Continuous cost history of a contract chain on a shared month axis. One line carries the
 * chain total, so a provider switch continues the curve instead of restarting it; the
 * segment color shows which contract was active.
 */
export function chainLine(canvas, months, series, colors, { currentMonth, extras = [], credits = [] } = {}) {
  const opts = base();
  const todayIdx = months.indexOf(currentMonth);
  const activeAt = (i) => {
    let idx = 0;
    series.forEach((s, k) => {
      if (s.values[i]) idx = k;
    });
    return idx;
  };
  // A one-off credit (switching bonus) is a marker, not a drop of the price line.
  const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0) + (credits[i] || 0));
  const marked = (i) => extras[i] || credits[i];
  opts.plugins.tooltip.callbacks.title = (items) => fmtMonth(months[items[0].dataIndex]);
  opts.plugins.tooltip.callbacks.label = (ctx) => {
    const i = ctx.dataIndex;
    const parts = series.filter((s) => s.values[i]).map((s) => ` ${s.name}: ${money(s.values[i])}`);
    if (extras[i]) parts.push(` davon Zusatzkosten: ${money(extras[i])}`);
    if (credits[i]) parts.push(` Bonus: − ${money(credits[i])}`);
    return parts.length ? parts : " –";
  };
  opts.plugins.tooltip.filter = () => true;
  return mount(canvas, {
    type: "line",
    data: {
      labels: months.map(fmtMonth),
      datasets: [
        {
          label: "Kosten",
          data: totals,
          borderColor: colors[activeAt(0)],
          backgroundColor: colors[activeAt(0)] + "1f",
          fill: true,
          stepped: "before",
          borderWidth: 2,
          // Months with additional charges get a visible marker.
          pointRadius: (ctx) => (marked(ctx.dataIndex) ? 4 : 0),
          pointBackgroundColor: (ctx) => (credits[ctx.dataIndex] ? cssVar("--good") : colors[activeAt(ctx.dataIndex)]),
          pointBorderColor: cssVar("--surface"),
          pointBorderWidth: 2,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: cssVar("--surface"),
          pointHoverBackgroundColor: (ctx) => colors[activeAt(ctx.dataIndex)],
          segment: {
            borderColor: (ctx) => colors[activeAt(ctx.p0DataIndex)],
            backgroundColor: (ctx) => colors[activeAt(ctx.p0DataIndex)] + "1f",
            borderDash: (ctx) => (todayIdx >= 0 && ctx.p1DataIndex > todayIdx ? [5, 4] : undefined),
          },
        },
      ],
    },
    options: opts,
    plugins: [todayLine(todayIdx)],
  });
}

/** Single total line with optional comparison line (projection). */
export function lines(canvas, months, datasets, { beginAtZero = false } = {}) {
  const opts = base();
  // Projections differ by a few percent – a zero baseline would flatten the difference.
  opts.scales.y.beginAtZero = beginAtZero;
  opts.plugins.tooltip.callbacks.title = (items) => fmtMonth(months[items[0].dataIndex]);
  return mount(canvas, {
    type: "line",
    data: {
      labels: months.map(fmtMonth),
      datasets: datasets.map((d) => ({
        label: d.label,
        data: d.values,
        borderColor: d.color,
        backgroundColor: d.fill ? d.color + "22" : "transparent",
        fill: d.fill ? "start" : false,
        borderWidth: 2,
        borderDash: d.dash ? [5, 4] : undefined,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.25,
      })),
    },
    options: opts,
  });
}

function todayLine(idx) {
  return {
    id: "todayLine",
    afterDatasetsDraw(chart) {
      if (idx < 0) return;
      const x = chart.scales.x.getPixelForValue(idx);
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = cssVar("--muted");
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--muted");
      ctx.font = "600 11px " + getComputedStyle(document.body).fontFamily;
      ctx.fillText("heute", x + 4, top + 10);
      ctx.restore();
    },
  };
}

export function legendHtml(items) {
  return `<div class="legend">${items
    .map((i) => `<span><span class="sw" style="background:${i.color}"></span>${i.label}</span>`)
    .join("")}</div>`;
}

/**
 * Income per month (regular + one-off payments, stacked) against the fixed costs as a line –
 * one euro axis, so the gap between bar and line is what is left.
 */
export function incomeChart(canvas, months, { regular, oneOff, costs }, { window = 24 } = {}) {
  const opts = base();
  explorable(opts, months.length, window);
  opts.scales.x.stacked = true;
  // bonuses sit on top of the regular income; the cost line is its own stack
  opts.scales.y.stacked = true;
  opts.plugins.tooltip.callbacks.title = (items) => fmtMonth(months[items[0].dataIndex]);
  const good = cssVar("--good");
  const bar = {
    borderColor: cssVar("--surface"),
    borderWidth: { top: 2, left: 0, right: 0, bottom: 0 },
    borderSkipped: false,
    borderRadius: 4,
    maxBarThickness: 22,
    categoryPercentage: 0.78,
    stack: "income",
  };
  return mount(canvas, {
    type: "bar",
    data: {
      labels: months.map(fmtMonth),
      datasets: [
        { type: "line", label: "Fixkosten", data: costs, borderColor: cssVar("--text"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25, order: 0, stack: "costs" },
        { type: "bar", label: "Regelmäßig", data: regular, backgroundColor: good, ...bar, order: 1 },
        { type: "bar", label: "Boni & Sonderzahlungen", data: oneOff.map((v) => v || null), backgroundColor: good + "70", ...bar, order: 1 },
      ],
    },
    options: opts,
  });
}
