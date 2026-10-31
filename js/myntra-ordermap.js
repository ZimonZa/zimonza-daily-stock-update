// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Order Map tab
//
// Where Myntra orders go, what goes where, and where parcels come back
// from. Reads the orders already recorded in Orders & Fake Returns; the
// only thing it ever writes is a PIN typed by hand for an order that has
// none. Never touches stock.
//
// ECharts and the two data files load the first time the tab is opened,
// so no other tab pays for them.
// ═══════════════════════════════════════════════════════════════

import {
  filterOrders, summarise, productByState, weeklyTrend, validatePinOverride, orderMapSheets
} from './order-geo.js';
import { pricingIndex } from './myntra-pricing.js';
import { updateDispatch } from './firestore-service.js';
import { productsOf } from './myntra-dispatch.js';
import { exportDateStamp, formatINR, formatDateDisplay, formatDate, normZmCode, normColorKey } from './utils.js';
import { swatchDot } from './swatches.js';
import notify from './notifications.js';

const ECHARTS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = r => `${Math.round((Number(r) || 0) * 100)}%`;
const num = n => formatINR(Number(n) || 0, 0);
const rupees = n => `₹${num(n)}`;
/** ₹12.2L / ₹1.4Cr — Indian short form for a tile; the full figure goes in its tooltip. */
const rupeesShort = n => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
  return rupees(v);
};

/**
 * Fetch the PIN directory and the state outline.
 * Rejects with "Could not load map data: <file> (<why>)".
 */
// Resolved from this module, not the page, so it works from any page and
// under GitHub Pages' /<repo>/ prefix alike.
const GEO_BASE = new URL('../assets/geo/', import.meta.url).href;

export async function loadGeo(fetchFn = fetch, base = GEO_BASE) {
  const get = async (file) => {
    let res;
    try { res = await fetchFn(`${base}${file}`); }
    catch (e) { throw new Error(`Could not load map data: ${file} (${e?.message || 'network error'})`); }
    if (!res?.ok) throw new Error(`Could not load map data: ${file} (${res?.status ?? 'no response'})`);
    try { return await res.json(); }
    catch { throw new Error(`Could not load map data: ${file} (not valid JSON)`); }
  };
  const [dir, outline] = await Promise.all([get('pincodes.json'), get('india-states.json')]);
  return { dir, outline };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.echarts) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the map library (check the internet connection)'));
    document.head.appendChild(s);
  });
}

// Midnight Zari ramps: gold for volume, red for trouble
const GOLD = ['#2A2216', '#5E4820', '#9C7630', '#D9A441', '#F3D98B'];
const RED = ['#2A1618', '#5E2226', '#9C3A3F', '#E5565B', '#F4A3A6'];
const METRICS = {
  orders: { label: 'Orders', value: g => g.orders, ramp: GOLD, fmt: v => num(v) },
  pieces: { label: 'Pieces', value: g => g.pieces, ramp: GOLD, fmt: v => num(v) },
  returnRate: { label: 'Return %', value: g => Math.round(g.returnRate * 100), ramp: RED, fmt: v => `${v}%` },
  fake: { label: 'Fake returns', value: g => g.fake, ramp: RED, fmt: v => num(v) }
};

export function initOrderMapTab(state, { ordersTab }) {
  const el = id => document.getElementById(id);
  const store = { updateDispatch, ...(state.storage || {}) };
  const view = { range: '90', from: '', to: '', zm: '', colour: '', state: '', metric: 'orders', pbsBy: 'sku' };

  let geo = null;
  let loading = null;
  let mapChart = null, trendChart = null;
  let last = null;              // { scoped, summary, pbs } of the last render, for export

  // ── Filters ──
  el('om-range').value = view.range;
  el('om-range').addEventListener('change', e => {
    view.range = e.target.value;
    el('om-custom').classList.toggle('hidden', view.range !== 'custom');
    render();
  });
  el('om-from').addEventListener('change', e => { view.from = e.target.value; render(); });
  el('om-to').addEventListener('change', e => { view.to = e.target.value; render(); });
  el('om-zm').addEventListener('change', e => { view.zm = e.target.value; render(); });
  el('om-colour').addEventListener('change', e => { view.colour = e.target.value; render(); });
  el('om-state-chip').addEventListener('click', () => { view.state = ''; render(); });
  el('om-export').addEventListener('click', exportExcel);
  el('om-body').addEventListener('click', onClick);
  window.addEventListener('resize', () => { mapChart?.resize(); trendChart?.resize(); });

  /** First open: load the library and the data, then draw. Later opens just resize. */
  function onShow() {
    if (geo) {
      requestAnimationFrame(() => { mapChart?.resize(); trendChart?.resize(); });
      return Promise.resolve();
    }
    if (loading) return loading;
    el('om-status').innerHTML = skeleton();
    loading = (async () => {
      try {
        await loadScript(ECHARTS_URL);
        geo = await loadGeo();
        window.echarts.registerMap('india', geo.outline);
        el('om-status').innerHTML = '';
        el('om-body').classList.remove('hidden');
        render();
      } catch (e) {
        console.error(e);
        el('om-status').innerHTML = errorCard(e.message);
        if (window.lucide) window.lucide.createIcons();
        loading = null;   // allow a retry on the next open
      }
    })();
    return loading;
  }

  function dateRange() {
    if (view.range === 'all') return { from: '', to: '' };
    if (view.range === 'custom') return { from: view.from, to: view.to };
    const days = Number(view.range) || 30;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    return { from: formatDate(start), to: '' };
  }

  function render() {
    if (!geo) return;
    const dispatches = ordersTab.getDispatches() || [];
    fillProductFilters(dispatches);

    const { from, to } = dateRange();
    const priceIdx = pricingIndex(state.pricing);
    const base = filterOrders(dispatches, { from, to, zm: view.zm, colour: view.colour }, geo.dir);
    const scoped = view.state ? base.filter(o => o.loc?.state === view.state) : base;
    const india = summarise(base, priceIdx);     // the map always shows every state
    const s = summarise(scoped, priceIdx);       // everything else follows a clicked state
    const pbs = productByState(scoped, { by: view.pbsBy, topStates: 8 });
    last = { scoped, summary: s, pbs };

    el('om-state-chip').classList.toggle('hidden', !view.state);
    el('om-state-chip').innerHTML = view.state ? `${esc(view.state)} <span aria-hidden="true">×</span>` : '';
    el('om-count').textContent = `${num(s.kpis.orders)} order(s)` +
      (s.kpis.unknown ? ` · ${s.kpis.unknown} without a location` : '');

    renderKpis(s);
    renderMap(india, s);
    renderTop(s);
    renderPbs(pbs);
    renderRisky(s);
    renderTrend(scoped);
    renderZones(s);
    renderPayment(s);
    renderUnknown(s, dispatches);
    if (window.lucide) window.lucide.createIcons();
  }

  // ── Filters' options come from the orders themselves ──
  function fillProductFilters(dispatches) {
    const zms = new Set(), colours = new Map();
    for (const d of dispatches) for (const p of productsOf(d)) {
      if (p.zmCode) zms.add(normZmCode(p.zmCode));
      const k = normColorKey(p.colourName);
      if (k && !colours.has(k)) colours.set(k, p.colourName);
    }
    const fill = (sel, items, all, current) => {
      sel.innerHTML = `<option value="">${all}</option>` +
        items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
      sel.value = items.some(([v]) => v === current) ? current : '';
    };
    fill(el('om-zm'), [...zms].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(z => [z, z]),
      'All ZM codes', view.zm);
    fill(el('om-colour'), [...colours.entries()].sort((a, b) => a[1].localeCompare(b[1])), 'All colours', view.colour);
    view.zm = el('om-zm').value;
    view.colour = el('om-colour').value;
  }

  function renderKpis(s) {
    const k = s.kpis;
    const tile = (icon, color, value, label, hint = '') => `
      <div class="kpi-tile" ${hint ? `title="${esc(hint)}"` : ''}>
        <div class="kpi-tile-icon" style="background:${color}1A;border:1px solid ${color}33">
          <i data-lucide="${icon}" class="w-4 h-4" style="color:${color}"></i>
        </div>
        <div class="min-w-0">
          <p class="kpi-tile-value truncate">${value}</p>
          <p class="kpi-tile-label truncate">${label}</p>
        </div>
      </div>`;
    el('om-kpis').innerHTML =
      tile('package', '#D9A441', num(k.orders), 'Orders') +
      tile('layers', '#3B82F6', num(k.pieces), 'Pieces') +
      tile('map', '#10B981', k.states, 'States') +
      tile('building-2', '#8B5CF6', k.cities, 'Cities') +
      tile('undo-2', '#F59E0B', pct(k.returnRate), 'Returned') +
      tile('alert-triangle', '#EF4444', k.fake, 'Fake') +
      tile('indian-rupee', '#EC4899', rupeesShort(k.estValue), 'Value',
        `${rupees(k.estValue)} at Myntra ISP` +
        (s.unpricedProducts ? ` — ${s.unpricedProducts} product line(s) have no ISP and are not counted` : ''));
  }

  // ── The map ──
  function renderMap(india, s) {
    const m = METRICS[view.metric];
    el('om-metric').querySelectorAll?.('[data-om-metric]').forEach(b =>
      b.classList.toggle('is-on', b.dataset.omMetric === view.metric));
    const data = india.byState.map(g => ({ name: g.label, value: m.value(g), g }));
    const max = Math.max(1, ...data.map(d => d.value));
    const cities = s.byCity.filter(c => c.lat !== null && c.lng !== null).slice(0, 25);
    const maxCity = Math.max(1, ...cities.map(c => c.orders));

    if (!mapChart) {
      mapChart = window.echarts.init(el('om-map'), null, { renderer: 'canvas' });
      mapChart.on('click', p => {
        const name = p.seriesType === 'map' || p.componentType === 'geo' ? p.name
          : p.seriesType === 'effectScatter' || p.seriesType === 'scatter' ? p.data?.state : '';
        if (!name) return;
        view.state = view.state === name ? '' : name;
        render();
      });
    }
    mapChart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item', confine: true,
        backgroundColor: '#0E0E14', borderColor: 'rgba(217,164,65,0.35)', textStyle: { color: '#EDE7DA', fontSize: 12 },
        formatter: p => {
          if (p.seriesType === 'scatter') {
            const c = p.data.c;
            return `<b>${esc(c.label)}</b>, ${esc(c.state)}<br>${num(c.orders)} order(s) · ${num(c.pieces)} pcs<br>Returns ${pct(c.returnRate)}${c.fake ? ` · ${c.fake} fake` : ''}`;
          }
          const g = p.data?.g;
          if (!g) return `<b>${esc(p.name)}</b><br>No orders`;
          return `<b>${esc(g.label)}</b> · ${esc(g.zone || '')}<br>${num(g.orders)} order(s) · ${num(g.pieces)} pcs<br>` +
            `Returns ${pct(g.returnRate)} (RTO ${g.rto} · customer ${g.customerReturn} · fake ${g.fake})<br>` +
            `COD ${g.cod} · prepaid ${g.prepaid}${g.codAmount ? ` · ${rupees(g.codAmount)} to collect` : ''}`;
        }
      },
      visualMap: {
        type: 'continuous', min: 0, max, seriesIndex: 0, calculable: false, orient: 'horizontal',
        left: 'left', bottom: 0, itemWidth: 10, itemHeight: 120, text: [m.fmt(max), '0'],
        textStyle: { color: '#8A8477', fontSize: 11 }, inRange: { color: m.ramp }
      },
      geo: {
        map: 'india', roam: true, scaleLimit: { min: 1, max: 8 }, aspectScale: 0.92, layoutCenter: ['50%', '50%'], layoutSize: '100%',
        selectedMode: false,
        itemStyle: { areaColor: '#16161E', borderColor: 'rgba(237,231,218,0.22)', borderWidth: 0.6 },
        emphasis: { label: { show: false }, itemStyle: { areaColor: '#F3D98B' } },
        regions: view.state ? [{ name: view.state, itemStyle: { borderColor: '#F3D98B', borderWidth: 2 } }] : []
      },
      series: [
        { type: 'map', geoIndex: 0, data },
        {
          type: 'scatter', coordinateSystem: 'geo', zlevel: 2,
          data: cities.map(c => ({ value: [c.lng, c.lat, c.orders], c, state: c.state })),
          symbolSize: v => 6 + 18 * Math.sqrt(v[2] / maxCity),
          itemStyle: { color: 'rgba(237,231,218,0.85)', borderColor: '#07070A', borderWidth: 1 },
          emphasis: { scale: 1.3 }
        }
      ]
    }, true);
  }

  // ── Tables ──
  const table = (head, rows, empty) => rows.length ? `
    <table class="w-full text-sm">
      <thead><tr class="text-slate-500 text-[11px] uppercase tracking-wide border-b border-white/5">${head}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>` : `<p class="om-empty">${empty}</p>`;
  const th = (label, right = false) => `<th class="px-3 py-2 ${right ? 'text-right' : 'text-left'} whitespace-nowrap">${label}</th>`;
  const td = (v, cls = '') => `<td class="px-3 py-2 ${cls}">${v}</td>`;
  const n = (v, extra = '') => td(v, `text-right zm-num ${extra}`);
  const rateCell = g => n(pct(g.returnRate), g.orders >= 3 && (g.returnRate >= 0.4 || g.fake) ? 'text-red-300' : 'text-slate-400');
  const SOURCE = { typed: 'typed', label: 'label', address: 'address' };

  function renderTop(s) {
    el('om-top-states').innerHTML = table(
      th('#') + th('State') + th('Orders', true) + th('Pcs', true) + th('Return', true),
      s.byState.slice(0, 10).map((g, i) => `<tr class="om-row" data-om-state="${esc(g.label)}">` +
        td(i + 1, 'text-slate-600 zm-num') + td(esc(g.label), 'text-slate-200') + n(num(g.orders), 'text-slate-200 font-semibold') +
        n(num(g.pieces)) + rateCell(g) + '</tr>'),
      'No orders in this range yet.');
    el('om-top-cities').innerHTML = table(
      th('#') + th('City') + th('Orders', true) + th('Return', true),
      s.byCity.slice(0, 10).map((g, i) => `<tr class="om-row" data-om-state="${esc(g.state)}">` +
        td(i + 1, 'text-slate-600 zm-num') +
        td(`${esc(g.label)}<span class="om-sub">${esc(g.state)}</span>`, 'text-slate-200') +
        n(num(g.orders), 'text-slate-200 font-semibold') + rateCell(g) + '</tr>'),
      'No cities yet.');
    el('om-top-pins').innerHTML = table(
      th('PIN') + th('Area') + th('City') + th('State') + th('From') + th('Orders', true) + th('Pcs', true) + th('Return', true),
      s.byPin.slice(0, 15).map(g => '<tr>' +
        td(esc(g.key), 'zm-num text-slate-200') + td(esc(g.label), 'text-slate-300') + td(esc(g.district), 'text-slate-400') +
        td(esc(g.state), 'text-slate-500') + td(`<span class="om-src om-src-${esc(g.pinSource)}">${esc(SOURCE[g.pinSource] || '')}</span>`) +
        n(num(g.orders), 'text-slate-200 font-semibold') + n(num(g.pieces)) + rateCell(g) + '</tr>'),
      'No PINs yet.');
  }

  function renderPbs(pbs) {
    el('om-pbs-by').querySelectorAll?.('[data-om-pbs]').forEach(b => b.classList.toggle('is-on', b.dataset.omPbs === view.pbsBy));
    const max = Math.max(1, ...pbs.rows.flatMap(r => r.cells));
    const heat = v => v ? `style="background:rgba(217,164,65,${(0.08 + 0.55 * v / max).toFixed(3)})"` : '';
    const rows = pbs.rows.slice(0, 40);
    el('om-pbs').innerHTML = table(
      th(view.pbsBy === 'zm' ? 'ZM code' : 'SellerSkuCode') + pbs.columns.map(c => th(esc(c), true)).join('') + th('Total', true),
      rows.map(r => '<tr>' + td(`${view.pbsBy === 'sku' ? swatchDot(r.key.split('-').slice(2).join('-')) : ''} ${esc(r.key)}`, 'whitespace-nowrap text-slate-200') +
        r.cells.map(v => `<td class="px-3 py-2 text-right zm-num om-heat" ${heat(v)}>${v || '<span class="text-slate-700">·</span>'}</td>`).join('') +
        n(num(r.total), 'text-slate-200 font-semibold') + '</tr>'),
      'No products in this range.') +
      (pbs.rows.length > rows.length ? `<p class="om-note">Showing the top ${rows.length} of ${pbs.rows.length} — the Excel export has them all.</p>` : '');
  }

  function renderRisky(s) {
    const rows = [
      ...s.risky.pins.map(g => ({ level: 'PIN', pin: g.key, area: g.label, city: g.district, g })),
      ...s.risky.cities.map(g => ({ level: 'City', pin: '', area: '', city: g.label, g }))
    ];
    el('om-risky').innerHTML = table(
      th('Level') + th('PIN') + th('Area') + th('City') + th('State') + th('Orders', true) + th('RTO', true) +
      th('Cust. return', true) + th('Fake', true) + th('Return', true),
      rows.map(({ level, pin, area, city, g }) => '<tr class="om-risk">' +
        td(`<span class="om-level">${level}</span>`) + td(esc(pin), 'zm-num text-slate-200') + td(esc(area), 'text-slate-300') +
        td(esc(city), 'text-slate-300') + td(esc(g.state), 'text-slate-500') + n(num(g.orders)) + n(g.rto) +
        n(g.customerReturn) + n(g.fake, g.fake ? 'text-red-300 font-semibold' : '') + rateCell(g) + '</tr>'),
      'Nothing flagged — no PIN or city with 3+ orders has a high return rate or a fake return.');
  }

  function renderTrend(scoped) {
    const { weeks, series } = weeklyTrend(scoped, { topStates: 5 });
    const box = el('om-trend');
    if (!weeks.length) {
      trendChart?.dispose(); trendChart = null;
      box.innerHTML = '<p class="om-empty">No dated orders in this range.</p>';
      return;
    }
    if (!trendChart) { box.innerHTML = ''; trendChart = window.echarts.init(box, null, { renderer: 'canvas' }); }
    const colours = ['#D9A441', '#3DBE8B', '#6FA8FF', '#E5565B', '#B58CFF'];
    trendChart.setOption({
      backgroundColor: 'transparent', color: colours,
      tooltip: { trigger: 'axis', backgroundColor: '#0E0E14', borderColor: 'rgba(217,164,65,0.35)', textStyle: { color: '#EDE7DA', fontSize: 12 } },
      legend: { top: 0, textStyle: { color: '#8A8477', fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 4 },
      grid: { left: 36, right: 12, top: 32, bottom: 28 },
      xAxis: { type: 'category', data: weeks.map(w => formatDateDisplay(w).slice(0, 5)),
        axisLine: { lineStyle: { color: 'rgba(237,231,218,0.15)' } }, axisLabel: { color: '#8A8477', fontSize: 11 } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: 'rgba(237,231,218,0.06)' } },
        axisLabel: { color: '#8A8477', fontSize: 11 } },
      series: series.map(x => ({ name: x.state, type: 'line', smooth: 0.25, smoothMonotone: 'x', symbolSize: 5, data: x.counts }))
    }, true);
  }

  function renderZones(s) {
    el('om-zones').innerHTML = table(
      th('Zone') + th('Orders', true) + th('Pcs', true) + th('Return', true) + th('Est. value', true),
      s.zones.map(g => '<tr>' + td(esc(g.label), 'text-slate-200') + n(num(g.orders), 'text-slate-200 font-semibold') +
        n(num(g.pieces)) + rateCell(g) + n(rupees(g.estValue)) + '</tr>'),
      'No orders in this range.');
  }

  function renderPayment(s) {
    const p = s.payment;
    const known = p.cod + p.prepaid;
    el('om-payment-note').textContent =
      `COD ${p.cod} · Prepaid ${p.prepaid}` + (known ? ` · COD share ${pct(p.cod / known)}` : '') +
      (p.codAmount ? ` · ${rupees(p.codAmount)} to collect` : '') +
      (p.unrecorded ? ` · ${p.unrecorded} order(s) before payment was recorded` : '');
    el('om-payment').innerHTML = table(
      th('State') + th('COD', true) + th('Prepaid', true) + th('Not recorded', true) + th('COD share', true) +
      th('COD amount', true) + th('Return', true),
      s.byState.map(g => {
        const k = g.cod + g.prepaid;
        return '<tr>' + td(esc(g.label), 'text-slate-200') + n(g.cod, 'text-amber-200') + n(g.prepaid) +
          n(g.unrecordedPayment, 'text-slate-600') + n(k ? pct(g.cod / k) : '—') + n(g.codAmount ? rupees(g.codAmount) : '—') +
          rateCell(g) + '</tr>';
      }),
      'No orders in this range.');
  }

  function renderUnknown(s, dispatches) {
    el('om-unknown-count').textContent = s.unknown.length ? `${s.unknown.length} order(s)` : '';
    el('om-unknown').innerHTML = table(
      th('Forward ID') + th('Customer') + th('Address') + th('Why') + th('Set PIN') + th(''),
      s.unknown.map(u => '<tr>' +
        td(esc(u.forwardId) || '<span class="text-slate-600">no ID</span>', 'zm-num text-slate-200 whitespace-nowrap') +
        td(esc(u.customer) || '<span class="text-slate-600">—</span>', 'text-slate-300') +
        td(esc(u.address) || '<span class="text-slate-600">no address</span>', 'text-slate-400 om-addr') +
        td(`<span class="om-why">${esc(u.reason)}</span>`) +
        td(`<span class="om-pin-edit"><input data-om-pin="${esc(u.id)}" inputmode="numeric" maxlength="6" placeholder="6 digits" class="zm-input om-pin-input">` +
          `<button data-om-save="${esc(u.id)}" class="btn-secondary text-xs py-1.5 px-2.5">Save</button></span>`) +
        td(u.forwardId ? `<button data-om-open="${esc(u.forwardId)}" class="text-xs text-amber-300 hover:text-amber-200 whitespace-nowrap">Open in Orders →</button>` : '', 'text-right') +
        '</tr>'),
      'Every order in this range has a location.');

    const typed = dispatches.filter(d => d.pinOverride);
    el('om-typed').innerHTML = typed.length
      ? `<p class="om-note">PINs typed by hand: ` + typed.map(d =>
          `<span class="om-typed-chip"><span class="zm-num">${esc(d.forwardId || d.id)}</span> → <span class="zm-num">${esc(d.pinOverride)}</span>` +
          `<button data-om-clear="${esc(d.id)}" title="Remove the typed PIN" aria-label="Remove the typed PIN">×</button></span>`).join(' ') + '</p>'
      : '';
  }

  // ── Clicks ──
  async function onClick(e) {
    const t = e.target;
    const metric = t.closest('[data-om-metric]');
    if (metric) { view.metric = metric.dataset.omMetric; render(); return; }
    const pbsBtn = t.closest('[data-om-pbs]');
    if (pbsBtn) { view.pbsBy = pbsBtn.dataset.omPbs; render(); return; }
    const open = t.closest('[data-om-open]');
    if (open) { state.setTab?.('orders'); ordersTab.focusForwardId?.(open.dataset.omOpen); return; }
    const save = t.closest('[data-om-save]');
    if (save) { await savePin(save.dataset.omSave, save); return; }
    const clear = t.closest('[data-om-clear]');
    if (clear) { await setOverride(clear.dataset.omClear, null, clear); return; }
    const row = t.closest('[data-om-state]');
    if (row) { view.state = view.state === row.dataset.omState ? '' : row.dataset.omState; render(); }
  }

  async function savePin(id, btn) {
    const input = el('om-unknown').querySelector?.(`input[data-om-pin="${CSS.escape(id)}"]`);
    const pin = String(input?.value ?? '').trim();
    const problem = validatePinOverride(pin, geo.dir);
    if (problem) { notify.warning(problem); input?.focus?.(); return; }
    await setOverride(id, pin, btn);
  }

  async function setOverride(id, pin, btn) {
    if (btn) btn.disabled = true;
    try {
      await store.updateDispatch(id, { pinOverride: pin });
      notify.success(pin ? `PIN ${pin} saved — the order is on the map now` : 'Typed PIN removed');
      await ordersTab.refresh();   // re-renders this tab through onOrdersChange
    } catch (err) {
      notify.error('Could not save the PIN: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Excel ──
  function exportExcel() {
    if (!last || !last.scoped.length) { notify.warning('Nothing to export'); return; }
    if (!window.XLSX) { notify.error('Excel library not loaded'); return; }
    const wb = XLSX.utils.book_new();
    for (const sheet of orderMapSheets(last.summary, last.pbs)) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
      ws['!cols'] = sheet.aoa[0].map((h, i) => ({ wch: Math.max(10, String(h).length + 2, i === 0 ? 18 : 0) }));
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }
    XLSX.writeFile(wb, `Myntra_Order_Map_${exportDateStamp()}.xlsx`);
    notify.success(`Exported ${last.summary.kpis.orders} order(s) across ${last.summary.kpis.states} state(s)`);
  }

  // ── Loading and failure ──
  function skeleton() {
    return `<div class="om-skeleton" aria-busy="true" aria-label="Loading the map">
      <div class="om-sk-row">${'<span></span>'.repeat(6)}</div>
      <div class="om-sk-map"></div>
    </div>`;
  }
  function errorCard(message) {
    return `<div class="om-error">
      <i data-lucide="map-pin-off" class="w-5 h-5"></i>
      <div><p class="text-slate-200 text-sm font-semibold">The map could not load</p>
      <p class="text-slate-400 text-xs mt-0.5">${esc(message)}. The other tabs are not affected — open this tab again to retry.</p></div>
    </div>`;
  }

  return { render, onShow };
}
