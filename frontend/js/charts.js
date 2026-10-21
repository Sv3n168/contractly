// Chart.js helpers that follow the app's design tokens (light/dark aware).

import { cssVar } from "./store.js";
import { fmtMonth, money } from "./ui.js";

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
    animation: { duration: 350 },
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
  return chart;
}

const totalFooter = (items) => {
  const sum = items.reduce((s, i) => s + (i.parsed.y || 0), 0);
  return items.length > 1 ? `Summe: ${money(sum)}` : "";
};

/** Stacked monthly bars. series: [{label, color, values}] */
export function stackedBars(canvas, months, series, { highlightFrom = null } = {}) {
  const opts = base();
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
export function chainLine(canvas, months, series, colors, { currentMonth } = {}) {
  const opts = base();
  const todayIdx = months.indexOf(currentMonth);
  const activeAt = (i) => {
    let idx = 0;
    series.forEach((s, k) => {
      if (s.values[i]) idx = k;
    });
    return idx;
  };
  const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0));
  opts.plugins.tooltip.callbacks.title = (items) => fmtMonth(months[items[0].dataIndex]);
  opts.plugins.tooltip.callbacks.label = (ctx) => {
    const i = ctx.dataIndex;
    const parts = series.filter((s) => s.values[i]).map((s) => ` ${s.name}: ${money(s.values[i])}`);
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
          pointRadius: 0,
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
export function lines(canvas, months, datasets) {
  const opts = base();
  // Projections differ by a few percent – a zero baseline would flatten the difference.
  opts.scales.y.beginAtZero = false;
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
