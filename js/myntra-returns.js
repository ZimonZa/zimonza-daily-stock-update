// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Myntra Customer Returns & RTO
// A standalone register. Nothing in the stock pipeline or the
// inventory-update generator reads this collection, so returned
// goods can never leak into stock counts.
// ═══════════════════════════════════════════════════════════════

import { RETURN_TYPES, RETURN_TYPE_LABELS, RETURN_CONDITIONS } from './constants.js';
import { findHeaderCell, isBlankRow, parseSellerSku, resolveStock } from './myntra.js';
import { readExcelFile } from './excel-parser.js';
import {
  addMyntraReturns, getAllMyntraReturns, updateMyntraReturn, deleteMyntraReturn
} from './firestore-service.js';
import { pricingIndex } from './myntra-pricing.js';
import { skuKey, keyFromSellerSku } from './myntra-labels.js';
import {
  normZmCode, normItemNo, debounce, toCSV, downloadFile, formatDateDisplay, today
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

/** Normalise a spreadsheet date cell to YYYY-MM-DD, or '' if unreadable. */
export function normReturnDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd-mm-yyyy or dd/mm/yyyy
  const m = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/.exec(s);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  return isNaN(parsed) ? '' : parsed.toISOString().slice(0, 10);
}

export function validateReturnsFile(rows) {
  if (!rows || rows.length < 2) return { valid: false, error: 'File appears empty' };
  if (!findHeaderCell(rows, SKU_HEADER_RE)) {
    return { valid: false, error: 'Invalid returns file: expected a SKU column (SellerSkuCode / SKU Code / Vendor SKU)' };
  }
  return { valid: true };
}

/**
 * Parse a Myntra returns / RTO export.
 * SKUs shaped ZM-<n>-<colour> back-fill zmCode and colourName.
 * Returns { rows, skippedBlank }.
 */
export function parseReturnsFile(rows) {
  const skuHeader = findHeaderCell(rows, SKU_HEADER_RE);
  const headerRowIdx = skuHeader ? skuHeader.rowIdx : 0;
  const header = rows[headerRowIdx] || [];

  const colIdx = (regex, fallback = -1) => {
    const idx = header.findIndex(c => regex.test(String(c ?? '').trim()));
    return idx >= 0 ? idx : fallback;
  };
  const cols = {
    sku:     skuHeader ? skuHeader.colIdx : 0,
    qty:     colIdx(/qty|quantity|pcs/i),
    type:    colIdx(/return\s*type|order\s*type|^type$|status/i),
    orderId: colIdx(/order\s*(id|no|number)/i),
    awb:     colIdx(/awb|tracking|waybill/i),
    date:    colIdx(/date/i),
    reason:  colIdx(/reason|remark|comment/i)
  };

  const cell = (row, idx) => (idx >= 0 ? row[idx] : null);
  const out = [];
  let skippedBlank = 0;

  for (const row of rows.slice(headerRowIdx + 1)) {
    if (isBlankRow(row)) { skippedBlank++; continue; }
    const sellerSkuCode = String(cell(row, cols.sku) ?? '').trim();
    if (!sellerSkuCode) { skippedBlank++; continue; }

    const parsed = parseSellerSku(sellerSkuCode);
    const qtyRaw = Number(String(cell(row, cols.qty) ?? '').replace(/[^\d.-]/g, ''));

    out.push({
      type: classifyReturnType(cell(row, cols.type)),
      sellerSkuCode,
      zmCode: parsed?.zmCode ?? '',
      colourName: parsed?.colourName ?? '',
      kuntalCode: '',
      qty: Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1,
      orderId: String(cell(row, cols.orderId) ?? '').trim(),
      awb: String(cell(row, cols.awb) ?? '').trim(),
      date: normReturnDate(cell(row, cols.date)),
      condition: '',
      reason: String(cell(row, cols.reason) ?? '').trim(),
      notes: '',
      source: 'upload'
    });
  }

  return { rows: out, skippedBlank };
}

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
 * Index the pullable rows by SKU identity.
 * Rows come out oldest-first so allocation is FIFO — the piece that has been
 * sitting longest goes out first.
 * @returns {Map<string, { total:number, rows:Array }>}
 */
export function availableReturnStock(returns) {
  const index = new Map();
  for (const r of returns || []) {
    if (!isPullable(r)) continue;
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
      kuntalCode: row.kuntalCode || ''
    });
    left -= take;
  }
  return { taken: want - left, shortfall: left, picks };
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
  { key: 'orderId',       label: 'Order ID' },
  { key: 'awb',           label: 'AWB' },
  { key: 'condition',     label: 'Condition' },
  { key: 'reason',        label: 'Reason' },
  { key: 'notes',         label: 'Notes' }
];

export function initReturnsTab(state) {
  const el = id => document.getElementById(id);
  const view = { q: '', type: 'all', condition: 'all', from: '', to: '', sortKey: 'date', sortDir: -1 };

  let returns = [];
  let pendingUpload = null;   // { rows, skippedBlank } awaiting confirmation

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

  // Manual add
  el('ret-add-btn').addEventListener('click', openAddModal);
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
      const parsed = parseReturnsFile(rows);
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
    el('ret-confirm-note').textContent =
      `${p.rows.length} row(s) from ${p.fileName} · ${rto} RTO · ${p.rows.length - rto} customer return(s)` +
      (p.skippedBlank ? ` · ${p.skippedBlank} blank skipped` : '');

    el('ret-confirm-table').innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-[10px] uppercase tracking-wide border-b border-white/5">
          <th class="px-3 py-2 text-left">Keep</th>
          <th class="px-3 py-2 text-left">Type</th>
          <th class="px-3 py-2 text-left">SellerSkuCode</th>
          <th class="px-3 py-2 text-left">Colour</th>
          <th class="px-3 py-2 text-right">Qty</th>
          <th class="px-3 py-2 text-left">Date</th>
          <th class="px-3 py-2 text-left">Reason</th>
        </tr></thead>
        <tbody>${p.rows.map((r, i) => `
          <tr class="border-b border-white/5">
            <td class="px-3 py-1.5"><input type="checkbox" data-keep="${i}" ${r._keep ? 'checked' : ''} class="accent-emerald-500"></td>
            <td class="px-3 py-1.5"><span class="${r.type === RETURN_TYPES.RTO ? 'level-medium' : 'level-low'} text-xs">${esc(RETURN_TYPE_LABELS[r.type])}</span></td>
            <td class="px-3 py-1.5 text-slate-200">${esc(r.sellerSkuCode)}</td>
            <td class="px-3 py-1.5 text-slate-400">${esc(r.colourName) || '—'}</td>
            <td class="px-3 py-1.5 text-right text-slate-300">${r.qty}</td>
            <td class="px-3 py-1.5 text-slate-500">${esc(r.date) || '—'}</td>
            <td class="px-3 py-1.5 text-slate-500 max-w-[180px] truncate">${esc(r.reason) || '—'}</td>
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
    const keep = pendingUpload.rows.filter(r => r._keep).map(({ _keep, ...r }) => r);
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

  function openAddModal() {
    for (const k of Object.keys(manual)) manual[k] = false;
    el('ret-add-sku').value = '';
    el('ret-add-colour').value = '';
    el('ret-add-kuntal').value = '';
    el('ret-add-qty').value = 1;
    el('ret-add-type').value = RETURN_TYPES.CUSTOMER_RETURN;
    el('ret-add-date').value = today();
    el('ret-add-condition').value = '';
    el('ret-add-order').value = '';
    el('ret-add-notes').value = '';
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

    const btn = el('ret-add-save');
    btn.disabled = true;
    try {
      await addMyntraReturns([{
        type: el('ret-add-type').value,
        sellerSkuCode: sku,
        zmCode: parsed?.zmCode ?? '',
        colourName: el('ret-add-colour').value.trim() || parsed?.colourName || '',
        kuntalCode: el('ret-add-kuntal').value.trim(),
        qty,
        orderId: el('ret-add-order').value.trim(),
        awb: '',
        date: el('ret-add-date').value || today(),
        condition: el('ret-add-condition').value,
        reason: '',
        notes: el('ret-add-notes').value.trim(),
        source: 'manual'
      }]);
      el('ret-add-modal').classList.add('hidden');
      notify.success(`${sku} recorded`);
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
      String(r.orderId).toLowerCase().includes(q) ||
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
    tableEl.innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-xs uppercase tracking-wide border-b border-white/5">
          ${th(view, 'type', 'Type')}
          ${th(view, 'sellerSkuCode', 'SellerSkuCode')}
          ${th(view, 'kuntalCode', 'Kuntal')}
          ${th(view, 'colourName', 'Colour')}
          ${th(view, 'qty', 'Qty', true)}
          ${th(view, 'date', 'Date')}
          ${th(view, 'orderId', 'Order ID')}
          <th class="text-left px-4 py-2.5">Condition</th>
          <th class="text-left px-4 py-2.5">Reason / Notes</th>
          <th class="px-4 py-2.5"></th>
        </tr></thead>
        <tbody>${f.map(r => `
          <tr class="border-b border-white/5 hover:bg-white/[0.02]">
            <td class="px-4 py-2"><span class="${r.type === RETURN_TYPES.RTO ? 'level-low' : 'level-medium'} text-xs">${esc(RETURN_TYPE_LABELS[r.type] || r.type)}</span></td>
            <td class="px-4 py-2 text-slate-200 font-medium whitespace-nowrap">${esc(r.sellerSkuCode)}</td>
            <td class="px-4 py-2 text-slate-400">${esc(r.kuntalCode) || '—'}</td>
            <td class="px-4 py-2 text-slate-300">${esc(r.colourName) || '—'}</td>
            <td class="px-4 py-2 text-right text-slate-200 font-semibold">${r.qty}</td>
            <td class="px-4 py-2 text-slate-500 whitespace-nowrap">${esc(formatDateDisplay(r.date) || r.date) || '—'}</td>
            <td class="px-4 py-2 text-slate-500 max-w-[140px] truncate">${esc(r.orderId) || '—'}</td>
            <td class="px-4 py-2">
              <select data-edit="${esc(r.id)}" data-field="condition" class="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-emerald-500/40">
                <option value="" ${!r.condition ? 'selected' : ''}>—</option>
                ${RETURN_CONDITIONS.map(c => `<option value="${c}" ${r.condition === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </td>
            <td class="px-4 py-2 text-slate-500 max-w-[200px] truncate" title="${esc([r.reason, r.notes].filter(Boolean).join(' · '))}">${esc([r.reason, r.notes].filter(Boolean).join(' · ')) || '—'}</td>
            <td class="px-4 py-2 text-right"><button data-del="${esc(r.id)}" class="text-slate-600 hover:text-red-400 transition"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    if (window.lucide) lucide.createIcons();
  }

  return { render, refresh, getReturns: () => returns };
}
