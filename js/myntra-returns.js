// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Myntra Customer Returns & RTO
//
// A standalone register. Pieces leave it only through a pick slip or a
// Goods Return.
//
// The inventory update may now ADD these pieces to the quantity it
// declares to Myntra, when the "include returns" box is ticked — they
// are on the shelf and can ship today. Declaring is not consuming:
// generating a file never decrements this register.
// ═══════════════════════════════════════════════════════════════

import { RETURN_TYPES, RETURN_TYPE_LABELS, RETURN_CONDITIONS } from './constants.js';
import { findHeaderCell, isBlankRow, parseSellerSku, resolveStock } from './myntra.js';
import { readExcelFile } from './excel-parser.js';
import {
  addMyntraReturns, getAllMyntraReturns, updateMyntraReturn,
  deleteMyntraReturn, deleteMyntraReturns
} from './firestore-service.js';
import { pricingIndex } from './myntra-pricing.js';
import { skuKey, keyFromSellerSku } from './myntra-labels.js';
import { swatchChip } from './swatches.js';
import {
  normZmCode, normItemNo, normColorKey, debounce, toCSV, downloadFile,
  formatDate, formatDateDisplay, today, titleCase,
  getEffectiveColours, findColourSuggestion
} from './utils.js';
import notify from './notifications.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stamp = () => new Date().toISOString().slice(0, 10);

const SKU_HEADER_RE = /seller\s*sku|sku\s*code|vendor\s*sku|^sku$/i;

/** RTO vs customer return, from whatever the report calls it. */
export function classifyReturnType(raw) {
  return /rto|undeliver|refus|not\s*deliver/i.test(String(raw ?? ''))
    ? RETURN_TYPES.RTO
    : RETURN_TYPES.CUSTOMER_RETURN;
}

/**
 * Normalise a spreadsheet date cell to YYYY-MM-DD, or '' if unreadable.
 *
 * Dates in these files are DAY FIRST (20-08-2026 = 20 August). JavaScript's
 * own Date parser reads "01/02/2026" as 2 January, so it is deliberately not
 * used as a fallback for separator dates — day-first parsing is explicit.
 */
export function normReturnDate(v) {
  if (v === null || v === undefined || v === '') return '';

  // Real Date cell: use LOCAL getters. toISOString() would shift the day
  // backwards for any timezone ahead of UTC (20 Aug → 19 Aug in IST).
  if (v instanceof Date) return isNaN(v) ? '' : formatDate(v);

  // Excel stores dates as a serial day count when the cell is a true date.
  // Day 0 is 1899-12-30 (accounting for Excel's 1900 leap-year bug).
  // Built and read in UTC so no timezone can shift it.
  const asNum = typeof v === 'number' ? v : (/^\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : NaN);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(asNum) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);           // already ISO

  // dd-mm-yyyy, dd/mm/yyyy, dd.mm.yy — day first
  const m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/.exec(s);
  if (m) {
    const day = Number(m[1]), month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return '';
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3].padStart(4, '0');
    return `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // "20 Aug 2026" and similar named-month forms are unambiguous
  const named = new Date(s);
  return isNaN(named) || !/[a-z]{3}/i.test(s) ? '' : formatDate(named);
}

export function validateReturnsFile(rows) {
  if (!rows || rows.length < 2) return { valid: false, error: 'File appears empty' };
  if (!findHeaderCell(rows, SKU_HEADER_RE)) {
    return { valid: false, error: 'Invalid returns file: expected a SKU column (SellerSkuCode / SKU Code / Vendor SKU)' };
  }
  return { valid: true };
}

// ─── Tolerant header matching ───────────────────────────────────
// Headers are stripped to letters and digits before comparing, so
// "Kuntal Code", "KUNTALCODE" and "kuntal_code" all land on the same field.

const headerKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const COLUMN_ALIASES = {
  type:       ['type', 'returntype', 'ordertype', 'status'],
  sku:        ['sellerskucode', 'sellersku', 'skucode', 'sku', 'vendorsku'],
  zmCode:     ['zmcode', 'zimonzacode', 'zm'],
  kuntalCode: ['kuntalcode', 'kuntal', 'itemno', 'itemnumber'],
  colour:     ['colour', 'color'],
  qty:        ['qty', 'quantity', 'pcs', 'pieces'],
  date:       ['date', 'returndate', 'rtodate'],
  condition:  ['condition', 'quality'],
  reason:     ['reason'],
  notes:      ['notes', 'note', 'remark', 'remarks', 'comment']
};

// Resolved in this order so "remark" cannot steal the reason column.
const ALIAS_ORDER = ['sku', 'zmCode', 'kuntalCode', 'colour', 'qty', 'date', 'condition', 'type', 'reason', 'notes'];

/** Map each known field to its column index in this header row. */
export function resolveColumns(header) {
  const keys = (header || []).map(headerKey);
  const taken = new Set();
  const cols = {};

  const claim = (field, predicate) => {
    if (cols[field] !== undefined) return;
    for (let i = 0; i < keys.length; i++) {
      if (taken.has(i) || !keys[i]) continue;
      if (predicate(keys[i])) { cols[field] = i; taken.add(i); return; }
    }
  };

  // Exact alias match first across every field, then a looser contains-match
  for (const field of ALIAS_ORDER) claim(field, k => COLUMN_ALIASES[field].includes(k));
  for (const field of ALIAS_ORDER) claim(field, k => COLUMN_ALIASES[field].some(a => k.includes(a)));

  return cols;
}

/**
 * Correct a colour's spelling. The mapping wins when the SKU is known,
 * otherwise the known-colour list is consulted via Levenshtein distance.
 * Returns { colourName, corrected: {from,to}|null }.
 */
export function correctColour(rawColour, sellerSkuCode, mappingColours, knownColours) {
  const raw = String(rawColour ?? '').trim();

  // 1. The mapping is authoritative for a SKU we know
  const fromMapping = mappingColours?.get(String(sellerSkuCode ?? '').trim().toUpperCase());
  if (fromMapping) {
    return raw && normColorKey(raw) === normColorKey(fromMapping)
      ? { colourName: fromMapping, corrected: raw === fromMapping ? null : { from: raw, to: fromMapping } }
      : { colourName: fromMapping, corrected: raw ? { from: raw, to: fromMapping } : null };
  }
  if (!raw) return { colourName: '', corrected: null };

  // 2. Spelling already used elsewhere in the mapping
  const byKey = mappingColours?.byColourKey?.get(normColorKey(raw));
  if (byKey && byKey !== raw) return { colourName: byKey, corrected: { from: raw, to: byKey } };
  if (byKey) return { colourName: byKey, corrected: null };

  // 3. Known-colour list, within Levenshtein distance 2
  const suggestion = findColourSuggestion(raw, knownColours || []);
  if (suggestion?.suggestion && normColorKey(suggestion.suggestion) !== normColorKey(raw)) {
    return { colourName: suggestion.suggestion, corrected: { from: raw, to: suggestion.suggestion } };
  }

  // 4. Leave it alone, but tidy the casing
  const cased = titleCase(raw);
  return { colourName: cased, corrected: cased === raw ? null : { from: raw, to: cased } };
}

/** Build the colour lookups correctColour needs from the saved mappings. */
export function buildColourLookup(mappings) {
  const bySku = new Map();
  bySku.byColourKey = new Map();
  for (const m of mappings || []) {
    const sku = String(m.sellerSkuCode ?? '').trim().toUpperCase();
    const colour = String(m.colourName ?? '').trim();
    if (!colour) continue;
    if (sku) bySku.set(sku, colour);
    const ck = normColorKey(colour);
    if (ck && !bySku.byColourKey.has(ck)) bySku.byColourKey.set(ck, colour);
  }
  return bySku;
}

/**
 * Parse a Myntra returns / RTO export.
 * SKUs shaped ZM-<n>-<colour> back-fill zmCode and colourName.
 * Returns { rows, skippedBlank }.
 */
export function parseReturnsFile(rows, mappings = []) {
  const skuHeader = findHeaderCell(rows, SKU_HEADER_RE);
  const headerRowIdx = skuHeader ? skuHeader.rowIdx : 0;
  const header = rows[headerRowIdx] || [];

  const cols = resolveColumns(header);
  if (cols.sku === undefined && skuHeader) cols.sku = skuHeader.colIdx;

  const colourLookup = buildColourLookup(mappings);
  const knownColours = getEffectiveColours();
  const validConditions = new Set(RETURN_CONDITIONS);

  const cell = (row, field) => (cols[field] >= 0 && cols[field] !== undefined ? row[cols[field]] : null);
  const str = (row, field) => String(cell(row, field) ?? '').trim();

  const out = [];
  let skippedBlank = 0;

  for (const row of rows.slice(headerRowIdx + 1)) {
    if (isBlankRow(row)) { skippedBlank++; continue; }
    const sellerSkuCode = str(row, 'sku');
    if (!sellerSkuCode) { skippedBlank++; continue; }

    const parsed = parseSellerSku(sellerSkuCode);
    const qtyRaw = Number(str(row, 'qty').replace(/[^\d.-]/g, ''));

    // File value wins; the SellerSkuCode fills the gap when a column is blank
    const zmCode = normZmCode(str(row, 'zmCode') || parsed?.zmCode || '');
    const { colourName, corrected } = correctColour(
      str(row, 'colour') || parsed?.colourName || '',
      sellerSkuCode, colourLookup, knownColours
    );

    const rawCondition = str(row, 'condition').toLowerCase();
    const rawDate = cell(row, 'date');

    out.push({
      type: classifyReturnType(str(row, 'type')),
      sellerSkuCode,
      zmCode,
      colourName,
      kuntalCode: normItemNo(str(row, 'kuntalCode')),
      qty: Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1,
      date: normReturnDate(rawDate),
      condition: validConditions.has(rawCondition) ? rawCondition : '',
      reason: str(row, 'reason'),
      notes: str(row, 'notes'),
      source: 'upload',
      // Review-only flags, stripped before saving
      colourCorrected: corrected,
      dateUnreadable: !!(rawDate !== null && rawDate !== undefined && String(rawDate).trim() && !normReturnDate(rawDate))
    });
  }

  return { rows: out, skippedBlank };
}

/** Drop the review-only flags before a row is written to Firestore. */
export const stripReviewFlags = ({ colourCorrected, dateUnreadable, _keep, ...row }) => row;

// ═══════════════════ Returned stock as pickable stock ═══════════════════
// Returns and RTO are stock we already own. A label can be fulfilled from
// them before anything is bought. They are still NEVER counted into the
// Myntra inventory update — that isolation is unchanged.

/**
 * Can a label pull from this row?
 * Both Customer Return and RTO qualify. Damaged and missing pieces are held
 * back — they cannot be shipped to a customer again.
 */
export const isPullable = (r) =>
  r.condition !== 'damaged' &&
  r.condition !== 'missing' &&
  (Number(r.qty) || 0) > 0;

/**
 * Index the register by SKU identity.
 * Rows come out oldest-first so allocation is FIFO — the piece that has been
 * sitting longest goes out first.
 *
 * `includeHeldBack` is the difference between the two ways stock leaves here.
 * A label must never ship a damaged piece, so the default excludes them. A
 * Goods Return is the opposite case: damaged stock is the first thing you send
 * back to the supplier. The default is unchanged, so the label path is
 * untouched by this option existing.
 *
 * @returns {Map<string, { total:number, rows:Array }>}
 */
export function availableReturnStock(returns, { includeHeldBack = false } = {}) {
  const index = new Map();
  for (const r of returns || []) {
    const usable = includeHeldBack ? (Number(r.qty) || 0) > 0 : isPullable(r);
    if (!usable) continue;
    const key = keyFromSellerSku(r.sellerSkuCode) || skuKey(r.zmCode, r.colourName);
    if (!key || key === '|') continue;
    if (!index.has(key)) index.set(key, { total: 0, rows: [] });
    const bucket = index.get(key);
    bucket.total += Number(r.qty) || 0;
    bucket.rows.push(r);
  }
  const orderKey = (r) => `${r.date || '9999-99-99'}`;
  for (const bucket of index.values()) {
    bucket.rows.sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
  }
  return index;
}

/**
 * Work out which rows would cover `need` for one SKU. PURE — writes nothing.
 * Callers apply the result only after the user confirms.
 * @returns {{ taken:number, shortfall:number, picks:Array }}
 */
export function allocateFromReturns(key, need, index) {
  const want = Math.max(0, Math.floor(Number(need) || 0));
  const bucket = index.get(key);
  if (!bucket || want === 0) return { taken: 0, shortfall: want, picks: [] };

  let left = want;
  const picks = [];
  for (const row of bucket.rows) {
    if (left <= 0) break;
    const have = Number(row.qty) || 0;
    if (have <= 0) continue;
    const take = Math.min(have, left);
    picks.push({
      id: row.id,
      take,
      remaining: have - take,
      type: row.type,
      date: row.date || '',
      sellerSkuCode: row.sellerSkuCode,
      colourName: row.colourName,
      kuntalCode: row.kuntalCode || '',
      // Carried so a Goods Return can print WHY each piece went back
      condition: row.condition || ''
    });
    left -= take;
  }
  return { taken: want - left, shortfall: left, picks };
}

/**
 * What the register is actually holding, grouped by ZM code.
 * Unlike availableReturnStock this counts held-back (damaged/missing) stock
 * too — the point of the summary is to show the difference.
 * @returns {{ totals:object, codes:Array }}
 */
export function summariseReturnStock(returns) {
  const byCode = new Map();
  const skus = new Set();
  const colours = new Set();
  let totalPcs = 0, usablePcs = 0;

  for (const r of returns || []) {
    const qty = Number(r.qty) || 0;
    if (qty <= 0) continue;
    const usable = isPullable(r) ? qty : 0;
    const zm = normZmCode(r.zmCode) || normZmCode(parseSellerSku(r.sellerSkuCode)?.zmCode || '') || '—';
    const colourKey = normColorKey(r.colourName);

    totalPcs += qty;
    usablePcs += usable;
    if (r.sellerSkuCode) skus.add(String(r.sellerSkuCode).trim().toUpperCase());
    if (colourKey) colours.add(colourKey);

    if (!byCode.has(zm)) {
      byCode.set(zm, { zmCode: zm, kuntalCode: '', colours: new Map(), pcs: 0, usable: 0, skus: new Set() });
    }
    const bucket = byCode.get(zm);
    bucket.pcs += qty;
    bucket.usable += usable;
    if (r.kuntalCode && !bucket.kuntalCode) bucket.kuntalCode = normItemNo(r.kuntalCode);
    if (r.sellerSkuCode) bucket.skus.add(String(r.sellerSkuCode).trim().toUpperCase());

    if (colourKey) {
      const c = bucket.colours.get(colourKey) || { name: r.colourName, pcs: 0, usable: 0 };
      c.pcs += qty;
      c.usable += usable;
      bucket.colours.set(colourKey, c);
    }
  }

  const codes = [...byCode.values()].map(b => ({
    zmCode: b.zmCode,
    kuntalCode: b.kuntalCode,
    skuCount: b.skus.size,
    colourCount: b.colours.size,
    pcs: b.pcs,
    usable: b.usable,
    colours: [...b.colours.values()].sort((a, c) => c.pcs - a.pcs || a.name.localeCompare(c.name))
  })).sort((a, b) => String(a.zmCode).localeCompare(String(b.zmCode), undefined, { numeric: true }));

  return {
    totals: {
      skus: skus.size,
      colours: colours.size,
      pcs: totalPcs,
      usable: usablePcs,
      heldBack: totalPcs - usablePcs,
      codes: codes.length
    },
    codes
  };
}

// ═══════════════════ Returns tab UI ═══════════════════

const RETURN_EXPORT_COLUMNS = [
  { key: 'typeLabel',     label: 'Type' },
  { key: 'sellerSkuCode', label: 'SellerSkuCode' },
  { key: 'zmCode',        label: 'ZM Code' },
  { key: 'kuntalCode',    label: 'Kuntal Code' },
  { key: 'colourName',    label: 'Colour' },
  { key: 'qty',           label: 'Qty' },
  { key: 'date',          label: 'Date' },
  { key: 'condition',     label: 'Condition' },
  { key: 'reason',        label: 'Reason' },
  { key: 'notes',         label: 'Notes' }
];

export function initReturnsTab(state) {
  const el = id => document.getElementById(id);
  const view = { q: '', type: 'all', condition: 'all', from: '', to: '', sortKey: 'date', sortDir: -1 };
  const stockView = { sortKey: 'pcs', sortDir: -1 };

  let returns = [];
  let pendingUpload = null;   // { rows, skippedBlank } awaiting confirmation
  const selection = new Set();
  let editingId = null;       // row being edited, null when adding

  const drop = el('ret-drop');
  state.helpers.bindDrop(drop, el('ret-file'), handleFile);

  el('ret-search').addEventListener('input', debounce(e => { view.q = e.target.value.trim(); render(); }));
  el('ret-type-filter').addEventListener('change', e => { view.type = e.target.value; render(); });
  el('ret-condition-filter').addEventListener('change', e => { view.condition = e.target.value; render(); });
  el('ret-from').addEventListener('change', e => { view.from = e.target.value; render(); });
  el('ret-to').addEventListener('change', e => { view.to = e.target.value; render(); });
  el('ret-summary').addEventListener('click', e => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    view.type = btn.dataset.type;
    el('ret-type-filter').value = view.type;
    render();
  });
  el('ret-table').addEventListener('click', onTableClick);
  el('ret-table').addEventListener('change', onTableChange);

  // Stock summary: sortable columns + its own exports
  el('ret-stock-table').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    state.helpers.toggleSort(stockView, th.dataset.sort);
    render();
  });
  el('ret-stock-csv').addEventListener('click', () => {
    const rows = stockExportRows();
    if (!rows.length) { notify.warning('Nothing to export'); return; }
    downloadFile(toCSV(rows, STOCK_EXPORT_COLUMNS), `myntra_rto_stock_${stamp()}.csv`, 'text/csv;charset=utf-8;');
    notify.success(`Exported ${rows.length} ZM code(s)`);
  });
  el('ret-stock-xlsx').addEventListener('click', () => {
    const rows = stockExportRows();
    if (!rows.length) { notify.warning('Nothing to export'); return; }
    if (!window.XLSX) { notify.error('Excel library not loaded'); return; }
    const aoa = [STOCK_EXPORT_COLUMNS.map(c => c.label), ...rows.map(r => STOCK_EXPORT_COLUMNS.map(c => r[c.key]))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [12, 14, 46, 10, 11, 11].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RTO Stock');
    XLSX.writeFile(wb, `myntra_rto_stock_${stamp()}.xlsx`);
    notify.success(`Exported ${rows.length} ZM code(s)`);
  });

  // Bulk selection
  el('ret-bulk-delete').addEventListener('click', bulkDelete);
  el('ret-bulk-clear').addEventListener('click', () => { selection.clear(); render(); });

  // Manual add
  el('ret-add-btn').addEventListener('click', () => openAddModal());
  el('ret-add-cancel').addEventListener('click', () => el('ret-add-modal').classList.add('hidden'));
  el('ret-add-modal').addEventListener('click', e => {
    if (e.target.id === 'ret-add-modal') el('ret-add-modal').classList.add('hidden');
  });
  el('ret-add-save').addEventListener('click', saveManual);
  el('ret-add-sku').addEventListener('input', () => { manual.sku = true; autofillFromSku(); });
  el('ret-add-kuntal').addEventListener('input', () => { manual.kuntal = true; autofillFromKuntal(); });
  el('ret-add-colour').addEventListener('input', () => { manual.colour = true; });

  // Upload confirm / cancel
  el('ret-confirm-save').addEventListener('click', commitUpload);
  el('ret-confirm-cancel').addEventListener('click', () => {
    pendingUpload = null;
    el('ret-confirm').classList.add('hidden');
    state.helpers.resetDrop(drop, 'Myntra returns / RTO report .csv / .xlsx');
  });

  el('ret-export-csv').addEventListener('click', () => {
    const rows = decorate(returns);
    if (!rows.length) { notify.warning('Nothing to export'); return; }
    downloadFile(toCSV(rows, RETURN_EXPORT_COLUMNS), `myntra_returns_rto_${stamp()}.csv`, 'text/csv;charset=utf-8;');
    notify.success(`Exported ${rows.length} rows (CSV)`);
  });
  el('ret-export-xlsx').addEventListener('click', () => {
    const rows = decorate(returns);
    if (!rows.length) { notify.warning('Nothing to export'); return; }
    if (!window.XLSX) { notify.error('Excel library not loaded'); return; }
    const aoa = [RETURN_EXPORT_COLUMNS.map(c => c.label), ...rows.map(r => RETURN_EXPORT_COLUMNS.map(c => r[c.key]))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [16, 22, 10, 12, 14, 7, 12, 18, 16, 12, 24, 20].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Returns & RTO');
    XLSX.writeFile(wb, `myntra_returns_rto_${stamp()}.xlsx`);
    notify.success(`Exported ${rows.length} rows (Excel)`);
  });

  // ═══════════ Data ═══════════

  /** Fill kuntalCode from pricing/ZM mapping where the file didn't carry one. */
  function enrich(row, priceIdx = pricingIndex(state.pricing)) {
    if (row.kuntalCode) return row;
    const zm = normZmCode(row.zmCode);
    if (!zm) return row;
    const p = priceIdx.get(zm);
    if (p?.kuntalCode) return { ...row, kuntalCode: p.kuntalCode };
    if (state.ctx) {
      const { kuntalCode } = resolveStock(zm, state.ctx);
      if (kuntalCode) return { ...row, kuntalCode: normItemNo(kuntalCode) };
    }
    return row;
  }

  const decorate = rows => rows.map(r => ({ ...r, typeLabel: RETURN_TYPE_LABELS[r.type] || r.type }));

  async function refresh() {
    returns = await getAllMyntraReturns();
    render();
    state.onReturnsChange?.(returns);
    return returns;
  }

  async function handleFile(file) {
    drop.innerHTML = `<div class="flex flex-col items-center gap-2 py-2"><div class="spinner"></div><p class="text-slate-400 text-xs">Parsing ${esc(file.name)}…</p></div>`;
    try {
      const rows = await readExcelFile(file);
      const validation = validateReturnsFile(rows);
      if (!validation.valid) {
        notify.error(validation.error);
        state.helpers.resetDrop(drop, 'Myntra returns / RTO report .csv / .xlsx');
        return;
      }
      const parsed = parseReturnsFile(rows, state.mappings);
      if (!parsed.rows.length) {
        notify.error('No return rows found in file');
        state.helpers.resetDrop(drop, 'Myntra returns / RTO report .csv / .xlsx');
        return;
      }
      const priceIdx = pricingIndex(state.pricing);
      pendingUpload = { fileName: file.name, rows: parsed.rows.map(r => ({ ...enrich(r, priceIdx), _keep: true })), skippedBlank: parsed.skippedBlank };
      renderConfirm();
    } catch (err) {
      notify.error('Failed: ' + err.message);
      state.helpers.resetDrop(drop, 'Myntra returns / RTO report .csv / .xlsx');
    }
  }

  function renderConfirm() {
    const p = pendingUpload;
    const box = el('ret-confirm');
    box.classList.remove('hidden');
    const rto = p.rows.filter(r => r.type === RETURN_TYPES.RTO).length;
    const fixed = p.rows.filter(r => r.colourCorrected).length;
    const badDates = p.rows.filter(r => r.dateUnreadable).length;
    el('ret-confirm-note').textContent =
      `${p.rows.length} row(s) from ${p.fileName} · ${rto} RTO · ${p.rows.length - rto} customer return(s)` +
      (p.skippedBlank ? ` · ${p.skippedBlank} blank skipped` : '') +
      (fixed ? ` · ${fixed} colour spelling(s) corrected` : '') +
      (badDates ? ` · ${badDates} unreadable date(s)` : '');

    el('ret-confirm-table').innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-[10px] uppercase tracking-wide border-b border-white/5">
          <th class="px-3 py-2 text-left">Keep</th>
          <th class="px-3 py-2 text-left">Type</th>
          <th class="px-3 py-2 text-left">SellerSkuCode</th>
          <th class="px-3 py-2 text-left">Colour</th>
          <th class="px-3 py-2 text-right">Qty</th>
          <th class="px-3 py-2 text-left">Kuntal</th>
          <th class="px-3 py-2 text-left">Date</th>
          <th class="px-3 py-2 text-left">Condition</th>
          <th class="px-3 py-2 text-left">Notes</th>
        </tr></thead>
        <tbody>${p.rows.map((r, i) => `
          <tr class="border-b border-white/5">
            <td class="px-3 py-1.5"><input type="checkbox" data-keep="${i}" ${r._keep ? 'checked' : ''} class="accent-emerald-500"></td>
            <td class="px-3 py-1.5"><span class="${r.type === RETURN_TYPES.RTO ? 'level-medium' : 'level-low'} text-xs">${esc(RETURN_TYPE_LABELS[r.type])}</span></td>
            <td class="px-3 py-1.5 text-slate-200">${esc(r.sellerSkuCode)}</td>
            <td class="px-3 py-1.5">${r.colourName ? swatchChip(r.colourName) : '<span class="zm-muted">—</span>'}${
              r.colourCorrected ? ` <span class="ret-fix-chip" title="Spelling corrected">↻ ${esc(r.colourCorrected.from)}</span>` : ''}</td>
            <td class="px-3 py-1.5 text-right text-slate-300">${r.qty}</td>
            <td class="px-3 py-1.5 text-slate-500">${esc(r.kuntalCode) || '—'}</td>
            <td class="px-3 py-1.5 ${r.dateUnreadable ? 'text-red-400' : 'text-slate-500'}">${
              r.dateUnreadable ? 'unreadable' : (esc(formatDateDisplay(r.date)) || '—')}</td>
            <td class="px-3 py-1.5 text-slate-500">${esc(r.condition) || '—'}</td>
            <td class="px-3 py-1.5 text-slate-500 max-w-[160px] truncate">${esc([r.reason, r.notes].filter(Boolean).join(' · ')) || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    el('ret-confirm-table').onchange = e => {
      const cb = e.target.closest('input[data-keep]');
      if (cb) pendingUpload.rows[+cb.dataset.keep]._keep = cb.checked;
    };
  }

  async function commitUpload() {
    if (!pendingUpload) return;
    const keep = pendingUpload.rows.filter(r => r._keep).map(stripReviewFlags);
    if (!keep.length) { notify.warning('No rows selected'); return; }
    const btn = el('ret-confirm-save');
    btn.disabled = true;
    try {
      await addMyntraReturns(keep);
      notify.success(`${keep.length} return/RTO row(s) recorded`);
      pendingUpload = null;
      el('ret-confirm').classList.add('hidden');
      state.helpers.resetDrop(drop, 'Myntra returns / RTO report .csv / .xlsx');
      await refresh();
    } catch (err) {
      notify.error('Save failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════ Manual add ═══════════

  // Which fields the user typed themselves. Auto-fill never overwrites those,
  // so the SKU→Kuntal and Kuntal→SKU handlers can't fight each other.
  const manual = { sku: false, colour: false, kuntal: false };
  const setAuto = (id, value, field) => {
    if (manual[field] && el(id).value.trim()) return;
    el(id).value = value;
  };

  /**
   * Kuntal Code → the SellerSkuCodes it covers.
   * One Kuntal code is one ZM style but many colours, so this is one-to-many.
   * Source is the pricing rows first, then the ZM mapping, so it works for
   * styles that have never been priced.
   */
  function kuntalIndex() {
    const priceIdx = pricingIndex(state.pricing);
    const map = new Map();
    for (const m of state.mappings) {
      const zm = normZmCode(m.zmCode);
      let kc = priceIdx.get(zm)?.kuntalCode || '';
      if (!kc && state.ctx) kc = resolveStock(zm, state.ctx).kuntalCode || '';
      kc = normItemNo(kc);
      if (!kc) continue;
      if (!map.has(kc)) map.set(kc, []);
      map.get(kc).push(m);
    }
    return map;
  }

  /** Opens blank to add, or pre-filled to edit an existing row. */
  function openAddModal(row = null) {
    editingId = row?.id ?? null;
    // Editing starts from saved values, so nothing should be auto-overwritten
    for (const k of Object.keys(manual)) manual[k] = !!row;

    el('ret-modal-title').textContent = row ? 'Edit Return / RTO' : 'Add Return / RTO';
    el('ret-add-save').textContent = row ? 'Save changes' : 'Save';
    el('ret-add-sku').value = row?.sellerSkuCode ?? '';
    el('ret-add-colour').value = row?.colourName ?? '';
    el('ret-add-kuntal').value = row?.kuntalCode ?? '';
    el('ret-add-qty').value = row?.qty ?? 1;
    el('ret-add-type').value = row?.type ?? RETURN_TYPES.CUSTOMER_RETURN;
    el('ret-add-date').value = row?.date || today();
    el('ret-add-condition').value = row?.condition ?? '';
    el('ret-add-notes').value = row?.notes ?? '';
    el('ret-kuntal-hint').textContent = '';
    el('ret-sku-list').innerHTML = state.mappings
      .map(m => `<option value="${esc(m.sellerSkuCode)}"></option>`).join('');
    el('ret-kuntal-list').innerHTML = [...kuntalIndex().keys()]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(k => `<option value="${esc(k)}"></option>`).join('');
    el('ret-add-modal').classList.remove('hidden');
  }

  function autofillFromSku() {
    const sku = el('ret-add-sku').value.trim();
    const parsed = parseSellerSku(sku);
    if (!parsed) return;
    setAuto('ret-add-colour', parsed.colourName, 'colour');
    const enriched = enrich({ zmCode: parsed.zmCode, kuntalCode: '' });
    if (enriched.kuntalCode) setAuto('ret-add-kuntal', enriched.kuntalCode, 'kuntal');
  }

  /** Kuntal Code typed → offer that code's SellerSkuCodes, fill if unambiguous. */
  function autofillFromKuntal() {
    const code = normItemNo(el('ret-add-kuntal').value);
    const hint = el('ret-kuntal-hint');
    if (!code) { hint.textContent = ''; return; }

    const matches = kuntalIndex().get(code) || [];
    if (!matches.length) {
      hint.textContent = 'No SellerSkuCode found for this Kuntal Code';
      hint.className = 'text-amber-400 text-[11px] mt-1';
      return;
    }

    // Narrow the SKU datalist to just this Kuntal Code's colours
    el('ret-sku-list').innerHTML = matches
      .map(m => `<option value="${esc(m.sellerSkuCode)}">${esc(m.colourName)}</option>`).join('');

    if (matches.length === 1) {
      setAuto('ret-add-sku', matches[0].sellerSkuCode, 'sku');
      setAuto('ret-add-colour', matches[0].colourName, 'colour');
      hint.textContent = `→ ${matches[0].sellerSkuCode}`;
      hint.className = 'text-emerald-400 text-[11px] mt-1';
    } else {
      hint.textContent = `${matches.length} colours — pick one in the SellerSkuCode box: ${matches.slice(0, 4).map(m => m.colourName).join(', ')}${matches.length > 4 ? '…' : ''}`;
      hint.className = 'text-slate-400 text-[11px] mt-1';
    }
  }

  async function saveManual() {
    const sku = el('ret-add-sku').value.trim();
    if (!sku) { notify.warning('SellerSkuCode is required'); return; }
    const qty = Math.max(1, Math.floor(Number(el('ret-add-qty').value) || 1));
    const parsed = parseSellerSku(sku);

    const payload = {
      type: el('ret-add-type').value,
      sellerSkuCode: sku,
      zmCode: normZmCode(parsed?.zmCode ?? ''),
      colourName: el('ret-add-colour').value.trim() || parsed?.colourName || '',
      kuntalCode: normItemNo(el('ret-add-kuntal').value),
      qty,
      date: el('ret-add-date').value || today(),
      condition: el('ret-add-condition').value,
      notes: el('ret-add-notes').value.trim()
    };

    const btn = el('ret-add-save');
    btn.disabled = true;
    try {
      if (editingId) {
        await updateMyntraReturn(editingId, payload);
        notify.success(`${sku} updated`);
      } else {
        await addMyntraReturns([{ ...payload, reason: '', source: 'manual' }]);
        notify.success(`${sku} recorded`);
      }
      el('ret-add-modal').classList.add('hidden');
      editingId = null;
      await refresh();
    } catch (err) {
      notify.error('Save failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════ Row actions ═══════════

  function onTableClick(e) {
    const th = e.target.closest('th[data-sort]');
    if (th) { state.helpers.toggleSort(view, th.dataset.sort); render(); return; }

    const edit = e.target.closest('button[data-edit-row]');
    if (edit) {
      const row = returns.find(r => r.id === edit.dataset.editRow);
      if (row) openAddModal(row);
      return;
    }

    const del = e.target.closest('button[data-del]');
    if (del) {
      const row = returns.find(r => r.id === del.dataset.del);
      if (!row) return;
      if (!confirm(`Delete this ${RETURN_TYPE_LABELS[row.type]} row for ${row.sellerSkuCode}?`)) return;
      deleteMyntraReturn(row.id)
        .then(() => { notify.success('Row deleted'); return refresh(); })
        .catch(err => notify.error('Delete failed: ' + err.message));
    }
  }

  function onTableChange(e) {
    // Row selection
    const pick = e.target.closest('input[data-select]');
    if (pick) {
      if (pick.checked) selection.add(pick.dataset.select);
      else selection.delete(pick.dataset.select);
      renderBulkBar();
      return;
    }
    // Select-all across the current filters
    if (e.target.id === 'ret-select-all') {
      const shown = returns.filter(matchesFilters).map(r => r.id);
      if (e.target.checked) shown.forEach(id => selection.add(id));
      else shown.forEach(id => selection.delete(id));
      render();
      return;
    }

    const sel = e.target.closest('select[data-edit]');
    if (!sel) return;
    const patch = { [sel.dataset.field]: sel.value };
    updateMyntraReturn(sel.dataset.edit, patch)
      .then(() => {
        const row = returns.find(r => r.id === sel.dataset.edit);
        if (row) Object.assign(row, patch);
        state.onReturnsChange?.(returns);
        notify.success('Updated');
      })
      .catch(err => { notify.error('Update failed: ' + err.message); render(); });
  }

  // ═══════════ Bulk selection ═══════════

  function renderBulkBar() {
    // Rows can vanish under a selection (deleted, or consumed by a label)
    const live = new Set(returns.map(r => r.id));
    for (const id of [...selection]) if (!live.has(id)) selection.delete(id);

    el('ret-bulkbar').classList.toggle('hidden', selection.size === 0);
    if (!selection.size) return;
    const pcs = returns.filter(r => selection.has(r.id)).reduce((t, r) => t + (Number(r.qty) || 0), 0);
    el('ret-selected-count').textContent = `${selection.size} row(s) selected · ${pcs} pcs`;
  }

  async function bulkDelete() {
    const ids = [...selection];
    if (!ids.length) return;
    const pcs = returns.filter(r => selection.has(r.id)).reduce((t, r) => t + (Number(r.qty) || 0), 0);
    if (!confirm(`Delete ${ids.length} row(s) totalling ${pcs} pcs? This cannot be undone.`)) return;

    const btn = el('ret-bulk-delete');
    btn.disabled = true;
    try {
      await deleteMyntraReturns(ids);
      selection.clear();
      notify.success(`${ids.length} row(s) deleted`);
      await refresh();
    } catch (err) {
      notify.error('Delete failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════ Render ═══════════

  function matchesFilters(r) {
    if (view.type !== 'all' && r.type !== view.type) return false;
    if (view.condition !== 'all' && (r.condition || '') !== view.condition) return false;
    if (view.from && String(r.date || '') < view.from) return false;
    if (view.to && String(r.date || '') > view.to) return false;
    const q = view.q.toLowerCase();
    if (q && !(
      String(r.sellerSkuCode).toLowerCase().includes(q) ||
      String(r.zmCode).toLowerCase().includes(q) ||
      String(r.kuntalCode).toLowerCase().includes(q) ||
      String(r.colourName).toLowerCase().includes(q) ||
      String(r.reason).toLowerCase().includes(q))) return false;
    return true;
  }

  function render() {
    const rto = returns.filter(r => r.type === RETURN_TYPES.RTO);
    const cust = returns.filter(r => r.type === RETURN_TYPES.CUSTOMER_RETURN);
    const pcs = returns.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const damaged = returns.filter(r => r.condition === 'damaged').length;

    const summaryEl = el('ret-summary');
    summaryEl.classList.toggle('hidden', returns.length === 0);
    const chip = (type, label, value, color) => {
      const active = view.type === type;
      return `<button data-type="${type}" class="bg-gradient-to-br ${color} border rounded-2xl p-3 text-center transition ${active ? 'ring-2 ring-emerald-400/60' : 'hover:brightness-125'}">
        <p class="text-xl font-bold text-white">${value}</p>
        <p class="text-slate-500 text-xs mt-0.5">${label}</p>
      </button>`;
    };
    summaryEl.innerHTML =
      chip('all', 'Total Rows', returns.length, 'from-blue-500/10 border-blue-500/20') +
      chip(RETURN_TYPES.CUSTOMER_RETURN, 'Customer Returns', cust.length, 'from-amber-500/10 border-amber-500/20') +
      chip(RETURN_TYPES.RTO, 'RTO', rto.length, 'from-red-500/10 border-red-500/20') +
      `<div class="bg-gradient-to-br from-purple-500/10 border-purple-500/20 border rounded-2xl p-3 text-center">
        <p class="text-xl font-bold text-white">${pcs}</p><p class="text-slate-500 text-xs mt-0.5">Total Pcs</p></div>` +
      `<div class="bg-gradient-to-br from-slate-500/10 border-slate-500/20 border rounded-2xl p-3 text-center">
        <p class="text-xl font-bold text-white">${damaged}</p><p class="text-slate-500 text-xs mt-0.5">Damaged</p></div>`;

    let f = returns.filter(matchesFilters);
    f = state.helpers.applySort(f, view, (r, k) => k === 'qty' ? (Number(r.qty) || 0) : String(r[k] ?? ''));

    el('ret-count').textContent = returns.length ? `${f.length} of ${returns.length} rows` : '';
    renderStockSummary(f);
    renderBulkBar();

    const tableEl = el('ret-table');
    if (!returns.length) {
      tableEl.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">Nothing recorded yet — upload the Myntra returns report or add a row by hand.</p>`;
      return;
    }
    if (!f.length) {
      tableEl.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No rows match the current filters.</p>`;
      return;
    }

    const th = state.helpers.thSort;
    const allShownSelected = f.every(r => selection.has(r.id));
    tableEl.innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-xs uppercase tracking-wide border-b border-white/5">
          <th class="px-3 py-2.5 text-left"><input type="checkbox" id="ret-select-all" ${allShownSelected ? 'checked' : ''} class="accent-emerald-500" title="Select all filtered"></th>
          ${th(view, 'type', 'Type')}
          ${th(view, 'sellerSkuCode', 'SellerSkuCode')}
          ${th(view, 'zmCode', 'ZM Code')}
          ${th(view, 'kuntalCode', 'Kuntal')}
          ${th(view, 'colourName', 'Colour')}
          ${th(view, 'qty', 'Qty', true)}
          ${th(view, 'date', 'Date')}
          <th class="text-left px-4 py-2.5">Condition</th>
          <th class="text-left px-4 py-2.5">Reason / Notes</th>
          <th class="px-4 py-2.5"></th>
        </tr></thead>
        <tbody>${f.map(r => `
          <tr class="border-b border-white/5 hover:bg-white/[0.02] ${isPullable(r) ? '' : 'opacity-60'}">
            <td class="px-3 py-2"><input type="checkbox" data-select="${esc(r.id)}" ${selection.has(r.id) ? 'checked' : ''} class="accent-emerald-500"></td>
            <td class="px-4 py-2"><span class="${r.type === RETURN_TYPES.RTO ? 'level-low' : 'level-medium'} text-xs">${esc(RETURN_TYPE_LABELS[r.type] || r.type)}</span></td>
            <td class="px-4 py-2 text-slate-200 font-medium whitespace-nowrap">${esc(r.sellerSkuCode)}</td>
            <td class="px-4 py-2 text-slate-400 whitespace-nowrap">${esc(normZmCode(r.zmCode)) || '—'}</td>
            <td class="px-4 py-2 text-slate-400">${esc(r.kuntalCode) || '—'}</td>
            <td class="px-4 py-2">${r.colourName ? swatchChip(r.colourName) : '<span class="zm-muted">—</span>'}</td>
            <td class="px-4 py-2 text-right text-slate-200 font-semibold">${r.qty}</td>
            <td class="px-4 py-2 text-slate-500 whitespace-nowrap">${esc(formatDateDisplay(r.date) || r.date) || '—'}</td>
            <td class="px-4 py-2">
              <select data-edit="${esc(r.id)}" data-field="condition" class="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-emerald-500/40">
                <option value="" ${!r.condition ? 'selected' : ''}>—</option>
                ${RETURN_CONDITIONS.map(c => `<option value="${c}" ${r.condition === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </td>
            <td class="px-4 py-2 text-slate-500 max-w-[200px] truncate" title="${esc([r.reason, r.notes].filter(Boolean).join(' · '))}">${esc([r.reason, r.notes].filter(Boolean).join(' · ')) || '—'}</td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button data-edit-row="${esc(r.id)}" class="text-slate-600 hover:text-emerald-400 transition mr-2" title="Edit"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
              <button data-del="${esc(r.id)}" class="text-slate-600 hover:text-red-400 transition" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    if (window.lucide) lucide.createIcons();
  }

  // ═══════════ Stock summary ═══════════

  /** What the register holds, for the rows currently in view. */
  function renderStockSummary(rows) {
    const box = el('ret-stock');
    const tilesEl = el('ret-stock-tiles');
    const tableEl = el('ret-stock-table');
    box.classList.toggle('hidden', rows.length === 0);
    if (!rows.length) return;

    const { totals, codes } = summariseReturnStock(rows);

    const tile = (value, label, color) => `
      <div class="bg-gradient-to-br ${color} border rounded-2xl p-3 text-center">
        <p class="text-xl font-bold text-white">${value}</p>
        <p class="text-slate-500 text-xs mt-0.5">${label}</p>
      </div>`;
    tilesEl.innerHTML =
      tile(totals.skus, 'SKUs', 'from-blue-500/10 border-blue-500/20') +
      tile(totals.colours, 'Colours', 'from-pink-500/10 border-pink-500/20') +
      tile(totals.codes, 'ZM Codes', 'from-purple-500/10 border-purple-500/20') +
      tile(totals.pcs, 'Total Pcs', 'from-slate-500/10 border-slate-500/20') +
      tile(totals.usable, 'Usable Pcs', 'from-emerald-500/10 border-emerald-500/20') +
      tile(totals.heldBack, 'Held Back', totals.heldBack ? 'from-red-500/10 border-red-500/20' : 'from-slate-500/10 border-slate-500/20');

    const sorted = state.helpers.applySort(codes, stockView, (r, k) =>
      ['pcs', 'usable', 'colourCount', 'skuCount'].includes(k)
        ? Number(r[k]) || 0
        : String(r[k] ?? ''));
    const th = state.helpers.thSort;

    tableEl.innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-xs uppercase tracking-wide border-b border-white/5">
          ${th(stockView, 'zmCode', 'ZM Code')}
          ${th(stockView, 'kuntalCode', 'Kuntal')}
          <th class="text-left px-4 py-2.5">Colours in stock</th>
          ${th(stockView, 'colourCount', 'Colours', true)}
          ${th(stockView, 'pcs', 'Pcs', true)}
          ${th(stockView, 'usable', 'Usable', true)}
        </tr></thead>
        <tbody>${sorted.map(c => `
          <tr class="border-b border-white/5 hover:bg-white/[0.02]">
            <td class="px-4 py-2.5 text-slate-200 font-medium whitespace-nowrap">${esc(c.zmCode)}</td>
            <td class="px-4 py-2.5 text-slate-400">${esc(c.kuntalCode) || '—'}</td>
            <td class="px-4 py-2.5">${c.colours.map(col =>
              swatchChip(col.name, col.pcs)).join('')}</td>
            <td class="px-4 py-2.5 text-right text-slate-400">${c.colourCount}</td>
            <td class="px-4 py-2.5 text-right text-slate-200 font-semibold">${c.pcs}</td>
            <td class="px-4 py-2.5 text-right font-semibold ${c.usable < c.pcs ? 'text-amber-300' : 'text-emerald-300'}">${c.usable}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  const STOCK_EXPORT_COLUMNS = [
    { key: 'zmCode',      label: 'ZM Code' },
    { key: 'kuntalCode',  label: 'Kuntal Code' },
    { key: 'colourList',  label: 'Colours in stock' },
    { key: 'colourCount', label: 'Colours' },
    { key: 'pcs',         label: 'Total Pcs' },
    { key: 'usable',      label: 'Usable Pcs' }
  ];
  const stockExportRows = () => summariseReturnStock(returns.filter(matchesFilters)).codes
    .map(c => ({ ...c, colourList: c.colours.map(x => `${x.name} ${x.pcs}`).join(' · ') }));

  return { render, refresh, getReturns: () => returns };
}
