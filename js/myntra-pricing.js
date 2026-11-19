// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Myntra Pricing
// Parses "Myntra Pricing.xlsx" (ZM Code, Kuntal Code, Category,
// Kuntal Selling Price, Myntra MRP, Myntra MU Price, Myntra ISP)
// and renders the Pricing tab.
// ═══════════════════════════════════════════════════════════════

import { findHeaderCell, isBlankRow } from './myntra.js';
import { readExcelFile } from './excel-parser.js';
import { saveMyntraPricing, getAllMyntraPricing, deleteMyntraPricing } from './firestore-service.js';
import { normZmCode, toNum, formatINR, debounce, toCSV, downloadFile, today } from './utils.js';
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

// ═══════════════════ Editing by hand ═══════════════════

/** Every column the owner can type into. ZM Code is the key, so it is not one. */
export const EDIT_COLUMNS = ['kuntalCode', 'category', 'kuntalSellingPrice', 'myntraMrp', 'myntraMuPrice', 'myntraIsp'];
export const PRICE_COLUMNS = ['kuntalSellingPrice', 'myntraMrp', 'myntraMuPrice', 'myntraIsp'];
const isPriceCol = (c) => PRICE_COLUMNS.includes(c);

/**
 * What a typed cell becomes. A blank price is null — never 0 — the same rule
 * the file upload follows; category is stored lower-case like the upload.
 * @returns {{ value: any, error: string }}
 */
export function validatePriceCell(column, raw) {
  if (isPriceCol(column)) {
    const text = String(raw ?? '').trim();
    if (!text) return { value: null, error: '' };
    const n = toNum(text);
    if (n === null || n < 0) return { value: null, error: 'Enter a number 0 or more' };
    return { value: n, error: '' };
  }
  if (column === 'category') return { value: String(raw ?? '').trim().toLowerCase(), error: '' };
  return { value: String(raw ?? '').trim(), error: '' };
}

/** Whole rupees, except MU Price which keeps its paise. */
const roundFor = (column, n) => column === 'myntraMuPrice'
  ? Math.round(n * 100 + Number.EPSILON) / 100
  : Math.round(n);

/**
 * One change applied to many rows at once. Only rows whose ZM code is in
 * `zmSet` change; the input array and its rows are never modified.
 *
 * Price columns: 'set' | 'pct_up' | 'pct_down' | 'add' | 'sub'. A blank
 * price stays blank under everything but 'set'; nothing goes below 0.
 * Text columns (Kuntal Code, Category): 'set' only.
 */
export function applyBulkEdit(rows, zmSet, column, action, amount) {
  const chosen = new Set([...(zmSet || [])].map(normZmCode));
  const list = rows || [];
  if (!EDIT_COLUMNS.includes(column)) return list.slice();

  let change;
  if (isPriceCol(column)) {
    const n = toNum(amount);
    if (n === null || n < 0) return list.slice();
    change = (v) => {
      if (action === 'set') return roundFor(column, n);
      if (v === null || v === undefined) return v ?? null;
      const next = action === 'pct_up' ? v * (1 + n / 100)
        : action === 'pct_down' ? v * (1 - n / 100)
        : action === 'add' ? v + n
        : action === 'sub' ? v - n
        : v;
      return roundFor(column, Math.max(0, next));
    };
  } else {
    if (action !== 'set') return list.slice();
    const { value } = validatePriceCell(column, amount);
    change = () => value;
  }

  return list.map(r => chosen.has(normZmCode(r.zmCode)) ? { ...r, [column]: change(r[column]) } : r);
}

const sameCell = (column, a, b) => isPriceCol(column)
  ? (a ?? null) === (b ?? null)
  : String(a ?? '') === String(b ?? '');

/**
 * What pressing Save has to write: rows that are new or differ in any edited
 * column, and the ZM codes of rows that were removed.
 * @returns {{ upserts: Array, deletes: string[] }}
 */
export function pendingChanges(saved, edited) {
  const before = new Map((saved || []).map(r => [normZmCode(r.zmCode), r]));
  const keep = new Set();
  const upserts = [];
  for (const r of edited || []) {
    const zm = normZmCode(r.zmCode);
    keep.add(zm);
    const old = before.get(zm);
    if (!old || EDIT_COLUMNS.some(c => !sameCell(c, old[c], r[c]))) upserts.push({ ...r, zmCode: zm });
  }
  const deletes = [...before.keys()].filter(zm => !keep.has(zm));
  return { upserts, deletes };
}

// ═══════════════════ Pricing tab UI ═══════════════════

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = v => (v === null || v === undefined || v === '') ? '—' : formatINR(v, 0);
const stamp = () => today();   // local date — toISOString() is UTC

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

  // ── Hand editing ──
  // `draft` is the working copy the grid edits; nothing reaches Firestore
  // until Save. `deleted` rows stay visible (struck through) until then.
  const clone = rows => (rows || []).map(r => ({ ...r }));
  let draft = clone(state.pricing);
  const deleted = new Set();          // normalised ZM codes marked for removal
  const selected = new Set();         // normalised ZM codes ticked for bulk edit
  const badCells = new Map();         // "ZM-43|myntraIsp" → message
  const savedRow = zm => state.pricing.find(r => normZmCode(r.zmCode) === zm);
  const keyOf = r => normZmCode(r.zmCode);

  function changes() {
    return pendingChanges(state.pricing, draft.filter(r => !deleted.has(keyOf(r))));
  }
  function changeCount() {
    const c = changes();
    return c.upserts.length + c.deletes.length;
  }
  const hasPendingChanges = () => changeCount() > 0;
  function resetDraft() {
    draft = clone(state.pricing);
    deleted.clear(); selected.clear(); badCells.clear();
  }

  const isDirty = (zm, col) => {
    const before = savedRow(zm);
    const row = draft.find(r => keyOf(r) === zm);
    if (!before) return true;
    const a = before[col], b = row?.[col];
    return PRICE_COLUMNS.includes(col) ? (a ?? null) !== (b ?? null) : String(a ?? '') !== String(b ?? '');
  };

  function renderPendingBar() {
    const n = changeCount();
    el('price-pending').classList.toggle('hidden', n === 0 && badCells.size === 0);
    el('price-pending-count').textContent = `${n} change${n === 1 ? '' : 's'}` +
      (badCells.size ? ` · ${badCells.size} cell${badCells.size === 1 ? '' : 's'} to fix` : '');
  }

  // One cell typed into: validate, keep it in the draft, mark it — without a
  // re-render, so the cursor stays where the owner is typing.
  el('price-table').addEventListener('input', e => {
    const inp = e.target.closest('input[data-pr-col]');
    if (!inp) return;
    const zm = inp.dataset.prZm, col = inp.dataset.prCol;
    const { value, error } = validatePriceCell(col, inp.value);
    const key = `${zm}|${col}`;
    if (error) {
      badCells.set(key, error);
      inp.classList.add('pr-bad');
      inp.title = error;
    } else {
      badCells.delete(key);
      inp.classList.remove('pr-bad');
      inp.title = '';
      const row = draft.find(r => keyOf(r) === zm);
      if (row) row[col] = value;
      inp.classList.toggle('pr-dirty', isDirty(zm, col));
    }
    renderPendingBar();
  });

  el('price-table').addEventListener('change', e => {
    const box = e.target.closest('input[data-pr-sel]');
    if (box) {
      if (box.checked) selected.add(box.dataset.prSel); else selected.delete(box.dataset.prSel);
      renderBulkBar();
      return;
    }
    if (e.target.id === 'price-sel-all') {
      for (const zm of visibleZm()) e.target.checked ? selected.add(zm) : selected.delete(zm);
      render();
    }
  });

  function renderBulkBar() {
    el('price-bulkbar').classList.toggle('hidden', selected.size === 0);
    el('price-sel-count').textContent = `${selected.size} style${selected.size === 1 ? '' : 's'} selected`;
  }

  const ACTIONS = {
    price: [['set', 'Set to ₹'], ['pct_up', 'Increase by %'], ['pct_down', 'Decrease by %'], ['add', 'Add ₹'], ['sub', 'Subtract ₹']],
    text: [['set', 'Set to']]
  };
  function fillBulkActions() {
    const col = el('price-bulk-col').value;
    const list = PRICE_COLUMNS.includes(col) ? ACTIONS.price : ACTIONS.text;
    el('price-bulk-action').innerHTML = list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    el('price-bulk-amount').placeholder = PRICE_COLUMNS.includes(col) ? 'Amount' : (col === 'category' ? 'e.g. saree' : 'Kuntal code');
  }
  fillBulkActions();
  el('price-bulk-col').addEventListener('change', fillBulkActions);

  el('price-bulk-apply').addEventListener('click', () => {
    if (!selected.size) return;
    const col = el('price-bulk-col').value, action = el('price-bulk-action').value;
    const amount = el('price-bulk-amount').value;
    if (PRICE_COLUMNS.includes(col)) {
      const { error } = validatePriceCell(col, amount);
      if (error || String(amount).trim() === '') { notify.warning('Enter an amount of 0 or more'); return; }
    }
    // Only rows still on screen: a filter changed since ticking must not let
    // a hidden row be changed by surprise
    const visible = new Set(visibleZm());
    const target = new Set([...selected].filter(zm => visible.has(zm) && !deleted.has(zm)));
    draft = applyBulkEdit(draft, target, col, action, amount);
    notify.info(`Changed ${target.size} style(s) — press Save changes to keep it`);
    render();
  });
  el('price-bulk-clear').addEventListener('click', () => { selected.clear(); render(); });

  el('price-add-btn').addEventListener('click', () => {
    const raw = el('price-add-zm').value.trim();
    const zm = normZmCode(raw);
    if (!/^ZM-\d+$/.test(zm)) { notify.warning('Type a ZM code like ZM-57'); return; }
    if (draft.some(r => keyOf(r) === zm)) {
      if (deleted.has(zm)) { deleted.delete(zm); render(); notify.info(`${zm} kept`); return; }
      notify.warning(`${zm} is already in the list`);
      return;
    }
    draft.push({ zmCode: zm, rawZmCode: raw, kuntalCode: '', category: '',
      kuntalSellingPrice: null, myntraMrp: null, myntraMuPrice: null, myntraIsp: null });
    el('price-add-zm').value = '';
    view.q = ''; el('price-search').value = '';
    view.category = 'all'; el('price-category-filter').value = 'all';
    render();
    el('price-table').querySelector?.(`input[data-pr-zm="${CSS.escape(zm)}"][data-pr-col="kuntalSellingPrice"]`)?.focus();
    notify.info(`${zm} added — fill in its prices, then Save changes`);
  });

  el('price-discard').addEventListener('click', () => {
    if (!confirm(`Discard ${changeCount()} unsaved pricing change(s)?`)) return;
    resetDraft();
    render();
  });

  el('price-save').addEventListener('click', async () => {
    if (badCells.size) { notify.error('Fix the cells outlined in red first'); return; }
    const { upserts, deletes } = changes();
    if (!upserts.length && !deletes.length) { notify.info('Nothing to save'); return; }
    const btn = el('price-save');
    btn.disabled = true;
    try {
      if (upserts.length) await saveMyntraPricing(upserts);
      if (deletes.length) await deleteMyntraPricing(deletes);
      state.pricing = await getAllMyntraPricing();
      resetDraft();
      state.onPricingChange();
      render();
      notify.success(`${upserts.length + deletes.length} pricing change(s) saved — prices updated everywhere`);
    } catch (err) {
      notify.error('Save failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });
  const drop = el('price-drop');
  const fileInput = el('price-file');

  state.helpers.bindDrop(drop, fileInput, handleFile);

  el('price-search').addEventListener('input', debounce(e => { view.q = e.target.value.trim(); render(); }));
  el('price-category-filter').addEventListener('change', e => { view.category = e.target.value; render(); });
  el('price-table').addEventListener('click', e => {
    const del = e.target.closest('button[data-pr-del]');
    if (del) {
      const zm = del.dataset.prDel;
      if (deleted.has(zm)) deleted.delete(zm); else { deleted.add(zm); selected.delete(zm); }
      render();
      return;
    }
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
    if (hasPendingChanges() && !confirm(`Discard ${changeCount()} unsaved pricing change(s) and upload this file?`)) {
      state.helpers.resetDrop(drop, 'Myntra Pricing .xlsx / .csv');
      return;
    }
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
      resetDraft();
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

    // Add-style suggestions: mapped styles that have no pricing yet
    el('price-add-list').innerHTML = unpriced.map(z => `<option value="${esc(z)}"></option>`).join('');

    const f = filteredDraft();
    // A filter change drops ticks on rows no longer shown
    const shown = new Set(f.map(keyOf));
    for (const zm of [...selected]) if (!shown.has(zm)) selected.delete(zm);
    renderBulkBar();
    renderPendingBar();

    el('price-count').textContent = draft.length ? `${f.length} of ${draft.length} styles` : '';

    const tableEl = el('price-table');
    if (!draft.length) {
      tableEl.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No pricing loaded yet — upload <strong class="text-slate-400">Myntra Pricing.xlsx</strong> above, or add a style.</p>`;
      return;
    }
    if (!f.length) {
      tableEl.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No styles match the current filters.</p>`;
      return;
    }

    badCells.clear();   // every cell is redrawn from valid draft values
    const cats = [...new Set(draft.map(r => r.category).filter(Boolean))].sort();
    const shownVal = (col, v) => (v === null || v === undefined) ? '' : String(v);
    const cell = (r, col, cls = '') => {
      const zm = keyOf(r);
      const price = PRICE_COLUMNS.includes(col);
      return `<input class="pr-cell ${price ? 'pr-num' : ''} ${cls} ${isDirty(zm, col) ? 'pr-dirty' : ''}"
        data-pr-zm="${esc(zm)}" data-pr-col="${col}" value="${esc(shownVal(col, r[col]))}"
        ${price ? 'inputmode="decimal" placeholder="—"' : ''} ${col === 'category' ? 'list="price-cat-list"' : ''}
        ${deleted.has(zm) ? 'disabled' : ''} aria-label="${esc(zm)} ${col}">`;
    };
    const allSelected = f.every(r => selected.has(keyOf(r)));
    const th = state.helpers.thSort;
    tableEl.innerHTML = `
      <datalist id="price-cat-list">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <table class="w-full text-sm pr-grid">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-xs uppercase tracking-wide border-b border-white/5">
          <th class="px-3 py-2.5 text-left"><input type="checkbox" id="price-sel-all" ${allSelected ? 'checked' : ''} class="accent-amber-500" title="Select all shown"></th>
          ${th(view, 'zmCode', 'ZM Code')}
          ${th(view, 'kuntalCode', 'Kuntal Code')}
          ${th(view, 'category', 'Category')}
          ${th(view, 'kuntalSellingPrice', 'Kuntal Selling Price', true)}
          ${th(view, 'myntraMrp', 'Myntra MRP', true)}
          ${th(view, 'myntraMuPrice', 'Myntra MU Price', true)}
          ${th(view, 'myntraIsp', 'Myntra ISP', true)}
          <th class="px-2 py-2.5"></th>
        </tr></thead>
        <tbody>${f.map(r => {
          const zm = keyOf(r);
          const isNew = !savedRow(zm);
          const gone = deleted.has(zm);
          return `
          <tr class="border-b border-white/5 ${gone ? 'pr-del' : ''}">
            <td class="px-3 py-1.5"><input type="checkbox" data-pr-sel="${esc(zm)}" ${selected.has(zm) ? 'checked' : ''} ${gone ? 'disabled' : ''} class="accent-amber-500"></td>
            <td class="px-3 py-1.5 text-slate-200 font-medium whitespace-nowrap">${esc(r.zmCode)}${isNew ? ' <span class="pr-new">new</span>' : ''}</td>
            <td class="px-1 py-1.5">${cell(r, 'kuntalCode')}</td>
            <td class="px-1 py-1.5">${cell(r, 'category', 'capitalize')}</td>
            <td class="px-1 py-1.5">${cell(r, 'kuntalSellingPrice', r.kuntalSellingPrice === null ? 'pr-missing' : '')}</td>
            <td class="px-1 py-1.5">${cell(r, 'myntraMrp')}</td>
            <td class="px-1 py-1.5">${cell(r, 'myntraMuPrice')}</td>
            <td class="px-1 py-1.5">${cell(r, 'myntraIsp')}</td>
            <td class="px-2 py-1.5 text-right whitespace-nowrap">
              <button data-pr-del="${esc(zm)}" class="pr-del-btn" title="${gone ? 'Keep this style' : 'Remove this style (on Save)'}">
                <i data-lucide="${gone ? 'undo-2' : 'trash-2'}" class="w-3.5 h-3.5"></i></button>
            </td>
          </tr>`; }).join('')}
        </tbody>
      </table>`;
    if (window.lucide) lucide.createIcons();
  }

  /** The draft rows the current search, category and sort show. */
  function filteredDraft() {
    let f = draft;
    if (view.category !== 'all') f = f.filter(r => r.category === view.category);
    const q = view.q.toLowerCase();
    if (q) f = f.filter(r =>
      String(r.zmCode).toLowerCase().includes(q) ||
      String(r.kuntalCode).toLowerCase().includes(q) ||
      String(r.category).toLowerCase().includes(q));
    return state.helpers.applySort(f, view, (r, k) => {
      const v = r[k];
      if (k === 'zmCode') return Number(String(v).replace(/\D/g, '')) || 0;
      return typeof v === 'number' ? v : String(v ?? '');
    });
  }
  const visibleZm = () => filteredDraft().map(keyOf);

  return { render, hasPendingChanges };
}
