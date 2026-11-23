// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Dashboard Page Logic
// ═══════════════════════════════════════════════════════════════
import { requireAuth } from './auth.js';
import { renderShell } from './ui-components.js';
import notify from './notifications.js';
import {
  getStockData, getAllUploadDates, getDailySummary,
  getUploadHistory
} from './firestore-service.js';
import {
  analyzeStockChanges, computeColorHealth, findFastMovers, sumSummaries
} from './stock-analyzer.js';
import {
  renderSalesTrendChart, renderStockHealthChart,
  renderCategoryChart, renderTopSoldChart,
  renderUploadCoverageChart, renderRestockTrendChart
} from './charts.js';
import { CATEGORIES } from './constants.js';
import { loadStockAsOf, loadDayChanges, allItemsOf } from './stock-store.js';
import { formatDateDisplay, formatNumber, today, daysAgo, lowColorEntries, escHtml as esc } from './utils.js';

let allItems = [];
let analysisResult = null;
let currentDate = null;
let allDates = [];

async function init() {
  await requireAuth();
  renderShell('dashboard');
  if (window.lucide) lucide.createIcons();

  renderSkeletons();
  await loadDashboard(today());
  bindFilters();
}

function renderSkeletons() {
  const grid = document.getElementById('kpi-grid');
  if (grid) {
    grid.innerHTML = Array(9).fill(0).map(() =>
      `<div class="animate-pulse bg-white/5 rounded-2xl h-32 border border-white/5"></div>`
    ).join('');
  }
}

async function loadDashboard(date) {
  try {
    allDates = await getAllUploadDates();
    const latest = allDates[0];
    currentDate = (date && allDates.includes(date)) ? date : (latest || date);

    if (!latest) {
      renderEmptyState();
      return;
    }

    // Stock as of the chosen date (each category from its own last upload),
    // and that day's changes against each category's own previous upload.
    // Was: always compared with the second-newest date, whatever was picked.
    allItems = allItemsOf(await loadStockAsOf({ asOf: currentDate }));
    const day = await loadDayChanges(currentDate);
    analysisResult = analyzeStockChanges(day.current, day.previous, { categories: day.categories });

    renderKPIs(allItems, analysisResult, currentDate);
    await renderCharts(allItems, analysisResult);
    renderWidgets(allItems, analysisResult);
    updateDateLabel(currentDate);

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error(err);
    notify.error('Failed to load dashboard data.');
  }
}

/**
 * @param period null for one upload day, or { days, uploads, missing } when
 *   the change tiles show totals over the last N days (stock tiles stay latest)
 */
function renderKPIs(items, analysis, date, period = null) {
  // Health counts individual colours, not product totals
  const health = computeColorHealth(items);
  const { summary } = analysis;
  const zeroNow = formatNumber(items.filter(i => (i.totalQty || 0) === 0).length);
  const over = period
    ? ` over ${period.uploads} upload${period.uploads === 1 ? '' : 's'}${period.missing ? ` (${period.missing} not summarised)` : ''}`
    : '';
  const tag = period ? ` · ${period.days} days` : '';

  const kpis = [
    { label: 'Total SKUs', value: formatNumber(items.length), icon: 'package', color: 'emerald', sub: `As of ${formatDateDisplay(date)}` },
    { label: 'Total Pieces', value: formatNumber(items.reduce((s,i)=>s+(i.totalQty||0),0)), icon: 'layers', color: 'blue', sub: 'All locations combined' },
    { label: period ? `Sold${tag}` : (date === allDates[0] ? 'Sold Today' : `Sold on ${formatDateDisplay(date).slice(0, 5)}`), value: formatNumber(summary.totalSoldPcs || 0), icon: 'trending-down', color: 'red', sub: period ? `${formatNumber(summary.soldCount)} item sales${over}` : `${summary.soldCount} SKUs affected` },
    { label: `Restocked${tag}`, value: formatNumber(summary.totalRestockedPcs || 0), icon: 'refresh-cw', color: 'amber', sub: period ? `${formatNumber(summary.restockedCount)} item restocks${over}` : `${summary.restockedCount} SKUs restocked` },
    { label: `New Arrivals${tag}`, value: formatNumber(summary.newArrivalsCount || 0), icon: 'sparkles', color: 'purple', sub: period ? `New SKUs${over}` : 'New SKUs detected' },
    // Ran out on this upload (or period); the Sold Out page lists every item at 0
    { label: `Sold Out${tag}`, value: formatNumber(summary.soldOutCount || 0), icon: 'x-circle', color: 'red', sub: `Ran out ${period ? `in ${period.days} days` : 'since last upload'} · ${zeroNow} item${zeroNow === '1' ? '' : 's'} at 0` },
    { label: 'Low Stock', value: formatNumber(health.low || 0), icon: 'alert-triangle', color: 'amber', sub: 'Colours running low' },
    { label: 'Medium Stock', value: formatNumber(health.medium || 0), icon: 'minus-circle', color: 'blue', sub: 'Colours at medium level' },
    { label: 'High Stock', value: formatNumber(health.high || 0), icon: 'check-circle', color: 'emerald', sub: 'Colours well stocked' },
  ];

  const colorMap = {
    emerald: { grad: 'from-emerald-500/10 to-emerald-600/5', border: 'border-emerald-500/20', bar: '#10B981', icon: 'text-emerald-400' },
    blue:    { grad: 'from-blue-500/10 to-blue-600/5',    border: 'border-blue-500/20',    bar: '#3B82F6', icon: 'text-blue-400' },
    red:     { grad: 'from-red-500/10 to-red-600/5',      border: 'border-red-500/20',      bar: '#EF4444', icon: 'text-red-400' },
    amber:   { grad: 'from-amber-500/10 to-amber-600/5',  border: 'border-amber-500/20',  bar: '#F59E0B', icon: 'text-amber-400' },
    purple:  { grad: 'from-purple-500/10 to-purple-600/5', border: 'border-purple-500/20', bar: '#8B5CF6', icon: 'text-purple-400' },
  };

  document.getElementById('kpi-grid').innerHTML = kpis.map(k => {
    const c = colorMap[k.color] || colorMap.emerald;
    return `
    <div class="stat-card bg-gradient-to-br ${c.grad} ${c.border} border rounded-2xl overflow-hidden flex flex-col cursor-default">
      <div class="h-0.5 w-full" style="background:${c.bar};opacity:0.6"></div>
      <div class="p-5 flex flex-col gap-3 flex-1">
        <div class="flex items-center justify-between">
          <span class="text-slate-400 text-xs font-semibold uppercase tracking-wider">${k.label}</span>
          <div class="p-2 rounded-xl bg-white/5">
            <i data-lucide="${k.icon}" class="w-4 h-4 ${c.icon}"></i>
          </div>
        </div>
        <span class="text-3xl font-bold text-white">${k.value}</span>
        <span class="text-slate-500 text-xs">${esc(k.sub)}</span>
      </div>
    </div>`;
  }).join('');
}

async function renderCharts(items, analysis) {
  const lehnga = items.filter(i=>i.category===CATEGORIES.LEHNGA);
  const saree  = items.filter(i=>i.category===CATEGORIES.SAREE);
  const health = computeColorHealth(items);
  const fastMovers = findFastMovers(analysis.soldItems, 8);

  // Build real 7-day trend from Firestore daily summaries
  const trendDates = allDates.slice(0, 7).reverse(); // oldest → newest
  const summaries = await Promise.all(trendDates.map(d => getDailySummary(d).catch(() => null)));
  const soldTrend    = summaries.map(s => s?.totalSoldPcs    ?? 0);
  const restockTrend = summaries.map(s => s?.totalRestockedPcs ?? 0);

  renderSalesTrendChart('sales-trend-chart', trendDates.map(d=>d.slice(5)), soldTrend, restockTrend);
  renderStockHealthChart('health-donut-chart', health);
  renderCategoryChart('category-chart', lehnga.length, saree.length);
  renderTopSoldChart('top-sold-chart', fastMovers);

  // Upload coverage last 14 days
  const last14 = Array.from({length:14},(_,i)=>daysAgo(13-i));
  const uploaded = new Set(allDates);
  renderUploadCoverageChart('coverage-chart', last14.map(d=>d.slice(5)), last14.map(d=>uploaded.has(d)));
  renderRestockTrendChart('restock-chart', trendDates.map(d=>d.slice(5)), restockTrend);
}

function renderWidgets(items, analysis) {
  renderMissingAlerts();
  renderActivityFeed(analysis);
  renderLowStockList(items);
  renderNewArrivalsSummary(analysis.newArrivals);
}

function renderMissingAlerts() {
  const el = document.getElementById('missing-alerts');
  if (!el) return;
  const todayStr = today();
  const missing = [];
  for (let i=1; i<=7; i++) {
    const d = daysAgo(i);
    if (!allDates.includes(d)) missing.push(d);
  }
  if (!missing.length) {
    el.innerHTML = `<div class="flex items-center gap-2 text-emerald-400 text-sm">
      <i data-lucide="check-circle" class="w-4 h-4"></i> All recent dates uploaded!
    </div>`;
  } else {
    el.innerHTML = missing.slice(0,5).map(d=>`
      <div class="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-red-400"></div>
          <span class="text-slate-300 text-sm">${formatDateDisplay(d)}</span>
        </div>
        <a href="upload.html?date=${d}" class="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition">Upload →</a>
      </div>`).join('');
  }
}

function renderActivityFeed(analysis) {
  const el = document.getElementById('activity-feed');
  if (!el) return;
  const events = [
    ...analysis.newArrivals.slice(0,3).map(i=>({ icon:'sparkles', color:'text-blue-400', text:`New: ${i.name} (${i.sku})`, sub:`+${i.totalQty} pcs` })),
    ...analysis.soldItems.slice(0,3).map(i=>({ icon:'trending-down', color:'text-red-400', text:`Sold: ${i.name} (${i.sku})`, sub:`−${i.totalSold} pcs` })),
    ...analysis.restockedItems.slice(0,3).map(i=>({ icon:'refresh-cw', color:'text-amber-400', text:`Restocked: ${i.name} (${i.sku})`, sub:`+${i.totalRestocked} pcs` })),
    ...analysis.soldOutItems.slice(0,2).map(i=>({ icon:'x-circle', color:'text-slate-400', text:`Sold Out: ${i.name} (${i.sku})`, sub:'0 pcs' })),
  ].slice(0,10);

  if (!events.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm text-center py-4">No activity for this period.</p>`;
    return;
  }
  el.innerHTML = events.map(e=>`
    <div class="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      <div class="mt-0.5 w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
        <i data-lucide="${e.icon}" class="w-3.5 h-3.5 ${e.color}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-slate-300 text-sm truncate">${esc(e.text)}</p>
        <p class="text-slate-500 text-xs">${esc(e.sub)}</p>
      </div>
    </div>`).join('');
}

function renderLowStockList(items) {
  const el = document.getElementById('low-stock-list');
  if (!el) return;
  const low = lowColorEntries(items).slice(0,8);
  if (!low.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm text-center py-4">No low stock colours.</p>`;
    return;
  }
  el.innerHTML = low.map(i=>`
    <div class="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"></div>
        <div class="min-w-0">
          <p class="text-slate-200 text-sm font-medium truncate">${esc(i.name)}</p>
          <p class="text-slate-500 text-xs">${esc(i.sku)} · ${esc(i.colorName)}</p>
        </div>
      </div>
      <span class="level-low ml-2 flex-shrink-0">${i.qty} pcs</span>
    </div>`).join('');
}

function renderNewArrivalsSummary(arrivals) {
  const el = document.getElementById('new-arrivals-summary');
  if (!el) return;
  const list = arrivals.slice(0,6);
  if (!list.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm text-center py-4">No new arrivals today.</p>`;
    return;
  }
  el.innerHTML = list.map(i=>`
    <div class="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
      <div class="min-w-0">
        <p class="text-slate-200 text-sm font-medium truncate">${esc(i.name)}</p>
        <p class="text-slate-500 text-xs">${esc(i.sku)} · ${esc(i.category)}</p>
      </div>
      <span class="change-new ml-2 flex-shrink-0">${i.totalQty} pcs</span>
    </div>`).join('');
}

function renderEmptyState() {
  document.getElementById('kpi-grid').innerHTML = `
    <div class="col-span-full flex flex-col items-center justify-center py-16 text-center">
      <div class="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mb-5">
        <i data-lucide="upload-cloud" class="w-10 h-10 text-slate-600"></i>
      </div>
      <h3 class="text-slate-300 font-bold text-xl mb-2">No Stock Data Yet</h3>
      <p class="text-slate-500 text-sm mb-6">Upload your first stock files to see the dashboard.</p>
      <a href="upload.html" class="btn-primary">Go to Upload Center</a>
    </div>`;
}

function updateDateLabel(date) {
  const el = document.getElementById('dashboard-date-label');
  if (el) el.textContent = formatDateDisplay(date);
}

/** ISO date `days - 1` days before `iso` (so the period includes `iso`). */
function periodStart(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/** Change tiles → totals over the last `days` days, from each upload's saved summary. */
async function showPeriodTotals(days) {
  const latest = allDates[0];
  if (!latest || !analysisResult) return;
  const from = periodStart(latest, days);
  const dates = allDates.filter(d => d >= from && d <= latest);
  const summaries = await Promise.all(dates.map(d => getDailySummary(d).catch(() => null)));
  const totals = sumSummaries(summaries);
  renderKPIs(allItems, { summary: totals }, latest, { days, uploads: dates.length, missing: totals.missing });
  const label = document.getElementById('dashboard-date-label');
  if (label) label.textContent = `${formatDateDisplay(latest)} · totals ${formatDateDisplay(from)} – ${formatDateDisplay(latest)}`;
  if (window.lucide) lucide.createIcons();
}

function bindFilters() {
  document.querySelectorAll('.quick-date-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.quick-date-btn').forEach(b => {
        b.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/30');
        b.classList.add('bg-white/5', 'text-slate-400', 'border-white/5');
      });
      btn.classList.remove('bg-white/5', 'text-slate-400', 'border-white/5');
      btn.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/30');

      const range = btn.dataset.range;
      // Was: Last 7 / Last 30 jumped to ONE older upload day and showed only
      // that day. Now: latest stock + totals of every upload in the period.
      if (range === 'last7' || range === 'last30') {
        await loadDashboard(allDates[0]);
        await showPeriodTotals(range === 'last7' ? 7 : 30);
        return;
      }
      const targetDate = range === 'yesterday' ? (allDates[1] || allDates[0]) : allDates[0];
      if (targetDate) await loadDashboard(targetDate);
    });
  });
}

init();
