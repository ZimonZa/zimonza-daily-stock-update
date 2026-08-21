// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Myntra Pricing
// Parses "Myntra Pricing.xlsx" (ZM Code, Kuntal Code, Category,
// Kuntal Selling Price, Myntra MRP, Myntra MU Price, Myntra ISP)
// and renders the Pricing tab.
// ═══════════════════════════════════════════════════════════════

import { findHeaderCell, isBlankRow } from './myntra.js';
import { readExcelFile } from './excel-parser.js';
import { saveMyntraPricing, getAllMyntraPricing } from './firestore-service.js';
import { normZmCode, toNum, formatINR, debounce, toCSV, downloadFile } from './utils.js';
import notify from './notifications.js';

const ZM_HEADER_RE = /zm\s*code/i;
const PRICE_HEADER_RE = /kuntal.*(selling|sell|price)/i;

/**
 * Validate a pricing file — it must at minimum identify products (ZM Code)
 * and carry the rate we bill at (Kuntal Selling Price).
 */
export function validatePricingFile(rows) {
  if (!rows || rows.length < 2) return { valid: false, error: 'File appears empty' };
  if (!findHeaderCell(rows, ZM_HEADER_RE)) {
    return { valid: false, error: 'Invalid pricing file: expected a "ZM Code" column' };
  }
  if (!findHeaderCell(rows, PRICE_HEADER_RE)) {
    return { valid: false, error: 'Invalid pricing file: expected a "Kuntal Selling Price" column' };
  }
  return { valid: true };
}

/**
 * Parse the pricing file into rows keyed by normalised ZM code.
 * Blank numerics stay null (a missing Myntra MRP must not become 0).
 * Duplicate ZM codes: last row wins.
 * Returns { rows, skippedBlank, duplicates, invalidZm }.
 */
export function parsePricingFile(rows) {
  const zmHeader = findHeaderCell(rows, ZM_HEADER_RE);
  const headerRowIdx = zmHeader ? zmHeader.rowIdx : 0;
  const header = rows[headerRowIdx] || [];

  const colIdx = (regex, fallback = -1) => {
    const idx = header.findIndex(c => regex.test(String(c ?? '').trim()));
    return idx >= 0 ? idx : fallback;
  };
  const cols = {
    zmCode:             zmHeader ? zmHeader.colIdx : 0,
    kuntalCode:         colIdx(/kuntal\s*code/i),
    category:           colIdx(/category/i),
    kuntalSellingPrice: colIdx(PRICE_HEADER_RE),
    myntraMrp:          colIdx(/myntra\s*mrp|^mrp$/i),
    myntraMuPrice:      colIdx(/mu\s*price/i),
    myntraIsp:          colIdx(/isp/i)
  };

  const cell = (row, idx) => (idx >= 0 ? row[idx] : null);
  const byZm = new Map();
  let skippedBlank = 0, duplicates = 0;
  const invalidZm = [];

  for (const row of rows.slice(headerRowIdx + 1)) {
    if (isBlankRow(row)) { skippedBlank++; continue; }
    const rawZmCode = String(cell(row, cols.zmCode) ?? '').trim();
    if (!rawZmCode) { skippedBlank++; continue; }

    const zmCode = normZmCode(rawZmCode);
    if (!/^ZM-\d+$/.test(zmCode)) { invalidZm.push(rawZmCode); continue; }
    if (byZm.has(zmCode)) duplicates++;

    byZm.set(zmCode, {
      zmCode,
      rawZmCode,
      kuntalCode:         String(cell(row, cols.kuntalCode) ?? '').trim(),
      category:           String(cell(row, cols.category) ?? '').trim().toLowerCase(),
      kuntalSellingPrice: toNum(cell(row, cols.kuntalSellingPrice)),
      myntraMrp:          toNum(cell(row, cols.myntraMrp)),
      myntraMuPrice:      toNum(cell(row, cols.myntraMuPrice)),
      myntraIsp:          toNum(cell(row, cols.myntraIsp))
    });
  }

  return { rows: [...byZm.values()], skippedBlank, duplicates, invalidZm };
}

/** Index pricing rows by normalised ZM code for fast joins. */
export function pricingIndex(pricingRows) {
  return new Map((pricingRows || []).map(p => [normZmCode(p.zmCode), p]));
}

// ═══════════════════ Pricing tab UI ═══════════════════

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = v => (v === null || v === undefined || v === '') ? '—' : formatINR(v, 0);
const stamp = () => new Date().toISOString().slice(0, 10);

const PRICE_EXPORT_COLUMNS = [
  { key: 'zmCode',             label: 'ZM Code' },
  { key: 'kuntalCode',         label: 'Kuntal Code' },
  { key: 'category',           label: 'Category' },
  { key: 'kuntalSellingPrice', label: 'Kuntal Selling Price' },
  { key: 'myntraMrp',          label: 'Myntra MRP' },
  { key: 'myntraMuPrice',      label: 'Myntra MU Price' },
  { key: 'myntraIsp',          label: 'Myntra ISP' }
];

/**
 * Mount the Pricing tab.
 * @param {object} state  shared page state: { pricing, mappings, onPricingChange, helpers }
 */
export function initPricingTab(state) {
  const view = { q: '', category: 'all', sortKey: 'zmCode', sortDir: 1 };

  const el = id => document.getElementById(id);
  const drop = el('price-drop');
  const fileInput = el('price-file');

  state.helpers.bindDrop(drop, fileInput, handleFile);

  el('price-search').addEventListener('input', debounce(e => { view.q = e.target.value.trim(); render(); }));
  el('price-category-filter').addEventListener('change', e => { view.category = e.target.value; render(); });
  el('price-table').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    state.helpers.toggleSort(view, th.dataset.sort);
    render();
  });
  el('price-summary').addEventListener('click', e => {
    const btn = e.target.closest('button[data-category]');
    if (!btn) return;
    view.category = btn.dataset.category;
    el('price-category-filter').value = view.category;
    render();
  });

  el('price-export-csv').addEventListener('click', () => {
    if (!state.pricing.length) { notify.warning('No pricing rows to export'); return; }
    downloadFile(toCSV(state.pricing, PRICE_EXPORT_COLUMNS), `myntra_pricing_${stamp()}.csv`, 'text/csv;charset=utf-8;');
    notify.success(`Exported ${state.pricing.length} pricing rows (CSV)`);
  });
  el('price-export-xlsx').addEventListener('click', () => {
    if (!state.pricing.length) { notify.warning('No pricing rows to export'); return; }
    if (!window.XLSX) { notify.error('Excel library not loaded'); return; }
    const aoa = [PRICE_EXPORT_COLUMNS.map(c => c.label),
      ...state.pricing.map(r => PRICE_EXPORT_COLUMNS.map(c => r[c.key]))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [12, 14, 12, 20, 14, 18, 14].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Myntra Pricing');
    XLSX.writeFile(wb, `myntra_pricing_${stamp()}.xlsx`);
    notify.success(`Exported ${state.pricing.length} pricing rows (Excel)`);
  });

  async function handleFile(file) {
    drop.innerHTML = `<div class="flex flex-col items-center gap-2 py-2"><div class="spinner"></div><p class="text-slate-400 text-xs">Parsing ${esc(file.name)}…</p></div>`;
    try {
      const rows = await readExcelFile(file);
      const validation = validatePricingFile(rows);
      if (!validation.valid) {
        notify.error(validation.error);
        state.helpers.resetDrop(drop, 'Myntra Pricing .xlsx / .csv');
        return;
      }
      const parsed = parsePricingFile(rows);
      if (!parsed.rows.length) {
        notify.error('No valid pricing rows found in file');
        state.helpers.resetDrop(drop, 'Myntra Pricing .xlsx / .csv');
        return;
      }
      await saveMyntraPricing(parsed.rows);
      state.pricing = await getAllMyntraPricing();
      state.onPricingChange();

      const extras = [
        parsed.duplicates ? `${parsed.duplicates} duplicate ZM code(s) merged` : '',
        parsed.skippedBlank ? `${parsed.skippedBlank} blank rows skipped` : '',
        parsed.invalidZm.length ? `${parsed.invalidZm.length} unreadable ZM code(s) skipped` : ''
      ].filter(Boolean).join(' · ');

      drop.innerHTML = `<div class="flex flex-col items-center gap-2 py-2 text-center">
        <i data-lucide="check-circle" class="w-7 h-7 text-emerald-400 mx-auto"></i>
        <p class="text-emerald-400 text-sm font-semibold">${esc(file.name)}</p>
        <p class="text-slate-400 text-xs">${parsed.rows.length} pricing rows saved${extras ? ' · ' + esc(extras) : ''}</p>
        <button type="button" data-reset-price class="text-xs text-slate-500 hover:text-slate-300 mt-1">Upload another</button>
      </div>`;
      if (window.lucide) lucide.createIcons();
      drop.querySelector('[data-reset-price]')?.addEventListener('click', ev => {
        ev.stopPropagation();
        state.helpers.resetDrop(drop, 'Myntra Pricing .xlsx / .csv');
      });

      notify.success(`${parsed.rows.length} pricing rows saved`);
      if (parsed.invalidZm.length) {
        notify.warning(`Skipped unreadable ZM code(s): ${parsed.invalidZm.slice(0, 3).join(', ')}${parsed.invalidZm.length > 3 ? '…' : ''}`);
      }
      render();
    } catch (err) {
      notify.error('Failed: ' + err.message);
      state.helpers.resetDrop(drop, 'Myntra Pricing .xlsx / .csv');
    }
  }

  function populateCategoryFilter() {
    const sel = el('price-category-filter');
    const current = sel.value || 'all';
    const cats = [...new Set(state.pricing.map(p => p.category).filter(Boolean))].sort();
    sel.innerHTML = `<option value="all">All Categories</option>` +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = cats.includes(current) ? current : 'all';
  }

  function render() {
    const rows = state.pricing;
    populateCategoryFilter();

    // Summary chips
    const noPrice = rows.filter(r => r.kuntalSellingPrice === null).length;
    const noMrp = rows.filter(r => r.myntraMrp === null).length;
    const summaryEl = el('price-summary');
    summaryEl.classList.toggle('hidden', rows.length === 0);
    const chip = (category, label, value, color) => {
      const active = view.category === category;
      return `<button data-category="${esc(category)}" class="bg-gradient-to-br ${color} border rounded-2xl p-3 text-center transition ${active ? 'ring-2 ring-emerald-400/60' : 'hover:brightness-125'}">
        <p class="text-xl font-bold text-white">${value}</p>
        <p class="text-slate-500 text-xs mt-0.5">${label}</p>
      </button>`;
    };
    const info = (label, value, color) => `<div class="bg-gradient-to-br ${color} border rounded-2xl p-3 text-center">
      <p class="text-xl font-bold text-white">${value}</p>
      <p class="text-slate-500 text-xs mt-0.5">${label}</p>
    </div>`;
    summaryEl.innerHTML =
      chip('all', 'Priced Styles', rows.length, 'from-blue-500/10 border-blue-500/20') +
      chip('lehnga', 'Lehnga', rows.filter(r => r.category === 'lehnga').length, 'from-purple-500/10 border-purple-500/20') +
      chip('saree', 'Saree', rows.filter(r => r.category === 'saree').length, 'from-pink-500/10 border-pink-500/20') +
      info('No Selling Price', noPrice, noPrice ? 'from-red-500/10 border-red-500/20' : 'from-emerald-500/10 border-emerald-500/20') +
      info('No Myntra MRP', noMrp, 'from-amber-500/10 border-amber-500/20');

    // Styles in Mapping that have no pricing row — these cannot be billed
    const priceIdx = pricingIndex(rows);
    const unpriced = [...new Set(
      state.mappings.map(m => normZmCode(m.zmCode)).filter(z => !priceIdx.has(z))
    )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const warnEl = el('price-unpriced');
    warnEl.classList.toggle('hidden', unpriced.length === 0);
    if (unpriced.length) {
      warnEl.innerHTML = `<div class="flex items-start gap-2.5">
        <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5"></i>
        <div class="min-w-0">
          <p class="text-amber-300 text-xs font-semibold">${unpriced.length} mapped style${unpriced.length === 1 ? '' : 's'} have no pricing row — they cannot be billed</p>
          <p class="text-slate-400 text-xs mt-0.5 break-words">${esc(unpriced.slice(0, 25).join(', '))}${unpriced.length > 25 ? ` … +${unpriced.length - 25} more` : ''}</p>
        </div>
      </div>`;
      if (window.lucide) lucide.createIcons();
    }

    // Filter + sort
    let f = rows;
    if (view.category !== 'all') f = f.filter(r => r.category === view.category);
    const q = view.q.toLowerCase();
    if (q) f = f.filter(r =>
      String(r.zmCode).toLowerCase().includes(q) ||
      String(r.kuntalCode).toLowerCase().includes(q) ||
      String(r.category).toLowerCase().includes(q));
    f = state.helpers.applySort(f, view, (r, k) => {
      const v = r[k];
      if (k === 'zmCode') return Number(String(v).replace(/\D/g, '')) || 0;
      return typeof v === 'number' ? v : String(v ?? '');
    });

    el('price-count').textContent = rows.length ? `${f.length} of ${rows.length} styles` : '';

    const tableEl = el('price-table');
    if (!rows.length) {
      tableEl.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No pricing loaded yet — upload <strong class="text-slate-400">Myntra Pricing.xlsx</strong> above.</p>`;
      return;
    }
    if (!f.length) {
      tableEl.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No styles match the current filters.</p>`;
      return;
    }

    const th = state.helpers.thSort;
    tableEl.innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-xs uppercase tracking-wide border-b border-white/5">
          ${th(view, 'zmCode', 'ZM Code')}
          ${th(view, 'kuntalCode', 'Kuntal Code')}
          ${th(view, 'category', 'Category')}
          ${th(view, 'kuntalSellingPrice', 'Kuntal Selling Price', true)}
          ${th(view, 'myntraMrp', 'Myntra MRP', true)}
          ${th(view, 'myntraMuPrice', 'Myntra MU Price', true)}
          ${th(view, 'myntraIsp', 'Myntra ISP', true)}
        </tr></thead>
        <tbody>${f.map(r => `
          <tr class="border-b border-white/5 hover:bg-white/[0.02]">
            <td class="px-4 py-2.5 text-slate-200 font-medium whitespace-nowrap">${esc(r.zmCode)}</td>
            <td class="px-4 py-2.5 text-slate-400">${esc(r.kuntalCode) || '—'}</td>
            <td class="px-4 py-2.5 text-slate-400 capitalize">${esc(r.category) || '—'}</td>
            <td class="px-4 py-2.5 text-right ${r.kuntalSellingPrice === null ? 'text-red-400' : 'text-emerald-300 font-semibold'}">${money(r.kuntalSellingPrice)}</td>
            <td class="px-4 py-2.5 text-right text-slate-300">${money(r.myntraMrp)}</td>
            <td class="px-4 py-2.5 text-right text-slate-500">${r.myntraMuPrice === null ? '—' : formatINR(r.myntraMuPrice, 2)}</td>
            <td class="px-4 py-2.5 text-right text-slate-300">${money(r.myntraIsp)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  return { render };
}
