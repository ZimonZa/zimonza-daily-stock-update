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
  analyzeStockChanges, computeStockHealth, findFastMovers
} from './stock-analyzer.js';
import {
  renderSalesTrendChart, renderStockHealthChart,
  renderCategoryChart, renderTopSoldChart,
  renderUploadCoverageChart, renderRestockTrendChart
} from './charts.js';
import { CATEGORIES } from './constants.js';
import { formatDateDisplay, formatNumber, today, daysAgo } from './utils.js';

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

    const [lehnga, saree] = await Promise.all([
      getStockData(currentDate, CATEGORIES.LEHNGA),
      getStockData(currentDate, CATEGORIES.SAREE)
    ]);
    allItems = [...lehnga, ...saree];

    // Previous date comparison
    const prevDate = allDates[1] || null;
    let prevItems = [];
    if (prevDate) {
      const [pl, ps] = await Promise.all([
        getStockData(prevDate, CATEGORIES.LEHNGA),
        getStockData(prevDate, CATEGORIES.SAREE)
      ]);
      prevItems = [...pl, ...ps];
    }

    analysisResult = analyzeStockChanges(allItems, prevItems);

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

function renderKPIs(items, analysis, date) {
  const health = computeStockHealth(items);
  const { summary } = analysis;

  const kpis = [
    { label: 'Total SKUs', value: formatNumber(items.length), icon: 'package', color: 'emerald', sub: `As of ${formatDateDisplay(date)}` },
    { label: 'Total Pieces', value: formatNumber(items.reduce((s,i)=>s+(i.totalQty||0),0)), icon: 'layers', color: 'blue', sub: 'All locations combined' },
    { label: 'Sold Today', value: formatNumber(summary.totalSoldPcs || 0), icon: 'trending-down', color: 'red', sub: `${summary.soldCount} SKUs affected` },
    { label: 'Restocked', value: formatNumber(summary.totalRestockedPcs || 0), icon: 'refresh-cw', color: 'amber', sub: `${summary.restockedCount} SKUs restocked` },
    { label: 'New Arrivals', value: formatNumber(summary.newArrivalsCount || 0), icon: 'sparkles', color: 'purple', sub: 'New SKUs detected' },
    { label: 'Sold Out', value: formatNumber(summary.soldOutCount || 0), icon: 'x-circle', color: 'red', sub: 'Zero quantity' },
    { label: 'Low Stock', value: formatNumber(health.low || 0), icon: 'alert-triangle', color: 'amber', sub: '1–2 pieces remaining' },
    { label: 'Medium Stock', value: formatNumber(health.medium || 0), icon: 'minus-circle', color: 'blue', sub: '3–5 pieces' },
    { label: 'High Stock', value: formatNumber(health.high || 0), icon: 'check-circle', color: 'emerald', sub: '6+ pieces' },
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
        <span class="text-slate-500 text-xs">${k.sub}</span>
      </div>
    </div>`;
  }).join('');
}

async function renderCharts(items, analysis) {
  const lehnga = items.filter(i=>i.category===CATEGORIES.LEHNGA);
  const saree  = items.filter(i=>i.category===CATEGORIES.SAREE);
  const health = computeStockHealth(items);
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
        <a href="upload.html" class="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition">Upload →</a>
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
        <p class="text-slate-300 text-sm truncate">${e.text}</p>
        <p class="text-slate-500 text-xs">${e.sub}</p>
      </div>
    </div>`).join('');
}

function renderLowStockList(items) {
  const el = document.getElementById('low-stock-list');
  if (!el) return;
  const low = items.filter(i=>i.stockLevel==='low'||i.totalQty===1).slice(0,8);
  if (!low.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm text-center py-4">No low stock items.</p>`;
    return;
  }
  el.innerHTML = low.map(i=>`
    <div class="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"></div>
        <div class="min-w-0">
          <p class="text-slate-200 text-sm font-medium truncate">${i.name}</p>
          <p class="text-slate-500 text-xs">${i.sku} · ${i.category}</p>
        </div>
      </div>
      <span class="level-low ml-2 flex-shrink-0">${i.totalQty} pcs</span>
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
        <p class="text-slate-200 text-sm font-medium truncate">${i.name}</p>
        <p class="text-slate-500 text-xs">${i.sku} · ${i.category}</p>
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
      let targetDate;
      if (range === 'today')     targetDate = allDates[0];
      else if (range === 'yesterday') targetDate = allDates[1] || allDates[0];
      else if (range === 'last7')     targetDate = allDates[Math.min(6, allDates.length - 1)];
      else if (range === 'last30')    targetDate = allDates[Math.min(29, allDates.length - 1)];

      if (targetDate) await loadDashboard(targetDate);
    });
  });
}

init();
