// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Myntra Purchase System
// Cart → GST bill → PDF, plus saved bill history.
// GST basis is EXCLUSIVE: qty × Kuntal Selling Price is the taxable
// value, CGST and SGST are added on top (each half the total rate).
// ═══════════════════════════════════════════════════════════════

import { PURCHASE_DOC_TYPES, GST_RATE_FALLBACK } from './constants.js';
import {
  getPurchaseSettings, savePurchaseSettings, savePurchaseBill,
  getAllPurchaseBills, deletePurchaseBill, nextBillNumber, financialYearLabel
} from './firestore-service.js';
import { pricingIndex } from './myntra-pricing.js';
import { exportBillPDF, renderBillPreviewHTML } from './invoice-pdf.js';
import {
  normZmCode, round2, formatINR, debounce, today, formatDateDisplay
} from './utils.js';
import { resolveStock, findColourQty } from './myntra.js';
import notify from './notifications.js';

const CART_KEY = 'zm_purchase_cart';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ═══════════════════ Pure GST maths ═══════════════════

/**
 * Resolve the GST rate for a line: explicit override wins, else the category
 * rate table, else the fallback. `auto` says whether it was derived.
 */
export function resolveGstRate(line, rateTable) {
  if (line.gstRateOverride !== null && line.gstRateOverride !== undefined && line.gstRateOverride !== '') {
    return { gstRate: Number(line.gstRateOverride), auto: false, fallback: false };
  }
  const fromTable = rateTable?.[line.category];
  if (fromTable !== undefined && fromTable !== null && fromTable !== '') {
    return { gstRate: Number(fromTable), auto: true, fallback: false };
  }
  return { gstRate: GST_RATE_FALLBACK, auto: true, fallback: true };
}

/** Compute the money fields for one cart line. */
export function computeLine(line, rateTable, srNo) {
  const qty = Math.max(0, Math.floor(Number(line.qty) || 0));
  const rate = Number(line.rate) || 0;
  const { gstRate, auto, fallback } = resolveGstRate(line, rateTable);
  const taxable = round2(qty * rate);
  // Each of CGST/SGST is half the total rate → taxable × rate / 200
  const cgst = round2(taxable * gstRate / 200);
  const sgst = round2(taxable * gstRate / 200);
  return { ...line, srNo, qty, rate, gstRate, gstRateAuto: auto, gstRateFallback: fallback, taxable, cgst, sgst };
}

/**
 * Totals + rate-wise summary for a set of computed lines.
 * Round-off closes the grand total to a whole rupee, the way a paper bill does.
 */
export function computeTotals(lines) {
  const subTotal = round2(lines.reduce((s, l) => s + l.taxable, 0));
  const cgstTotal = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgstTotal = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const grand = round2(subTotal + cgstTotal + sgstTotal);
  const grandRounded = Math.round(grand);
  const roundOff = round2(grandRounded - grand);

  const byRate = new Map();
  for (const l of lines) {
    const cur = byRate.get(l.gstRate) || { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0 };
    cur.taxable = round2(cur.taxable + l.taxable);
    cur.cgst = round2(cur.cgst + l.cgst);
    cur.sgst = round2(cur.sgst + l.sgst);
    byRate.set(l.gstRate, cur);
  }
  const rateSummary = [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate);

  return {
    totals: { subTotal, cgstTotal, sgstTotal, grand, grandRounded, roundOff, totalQty: lines.reduce((s, l) => s + l.qty, 0) },
    rateSummary
  };
}

// ═══════════════════ Purchase tab UI ═══════════════════

export function initPurchaseTab(state) {
  const el = id => document.getElementById(id);

  let cart = loadCart();
  let bills = [];
  let billsQuery = '';
  let pickerQuery = '';

  // ── Bill header controls ───────────────────────────────────
  const docTypeSel = el('pur-doctype');
  docTypeSel.innerHTML = PURCHASE_DOC_TYPES.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  docTypeSel.value = localStorage.getItem('zm_purchase_doctype') || PURCHASE_DOC_TYPES[0].id;
  docTypeSel.addEventListener('change', () => {
    localStorage.setItem('zm_purchase_doctype', docTypeSel.value);
    updateBillNoPlaceholder();
  });

  el('pur-billdate').value = today();

  function updateBillNoPlaceholder() {
    const type = PURCHASE_DOC_TYPES.find(t => t.id === docTypeSel.value) || PURCHASE_DOC_TYPES[0];
    el('pur-billno').placeholder = `${type.prefix}/${financialYearLabel(new Date())}/…  (auto on save)`;
  }
  updateBillNoPlaceholder();

  // ── Picker ─────────────────────────────────────────────────
  el('pur-search').addEventListener('input', debounce(e => { pickerQuery = e.target.value.trim(); renderPicker(); }));
  el('pur-picker').addEventListener('click', onPickerClick);
  el('pur-picker').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input[data-qty-for]')) {
      e.preventDefault();
      addBySku(e.target.dataset.qtyFor, Number(e.target.value) || 1);
    }
  });
  el('pur-add-all').addEventListener('click', () => {
    const rows = pickerRows();
    if (!rows.length) { notify.warning('Nothing to add — refine the search first'); return; }
    if (rows.length > 60) { notify.warning(`${rows.length} matches is too many to add at once — narrow the search`); return; }
    rows.forEach(r => addLine(r, 1, true));
    persist(); renderCart(); renderPicker();
    notify.success(`Added ${rows.length} line(s) to the bill`);
  });

  // ── Cart ───────────────────────────────────────────────────
  el('pur-cart').addEventListener('input', onCartInput);
  el('pur-cart').addEventListener('click', onCartClick);

  el('pur-clear').addEventListener('click', () => {
    if (!cart.length) return;
    if (!confirm(`Clear all ${cart.length} line(s) from this bill?`)) return;
    cart = []; persist(); renderCart(); renderPicker();
    notify.info('Bill cleared');
  });

  el('pur-preview').addEventListener('click', () => {
    const bill = buildBill({ draft: true });
    if (!bill) return;
    el('bill-preview-body').innerHTML = renderBillPreviewHTML(bill, state.purchaseSettings);
    el('bill-preview-modal').classList.remove('hidden');
  });
  el('bill-preview-close').addEventListener('click', () => el('bill-preview-modal').classList.add('hidden'));
  el('bill-preview-modal').addEventListener('click', e => {
    if (e.target.id === 'bill-preview-modal') el('bill-preview-modal').classList.add('hidden');
  });
  el('bill-preview-pdf').addEventListener('click', () => {
    const bill = buildBill({ draft: true });
    if (bill) downloadPDF(bill);
  });

  el('pur-pdf').addEventListener('click', () => {
    const bill = buildBill({ draft: true });
    if (bill) downloadPDF(bill);
  });

  el('pur-save').addEventListener('click', saveBill);

  // ── Parties / GST settings modal ───────────────────────────
  el('pur-parties-btn').addEventListener('click', openPartiesModal);
  el('parties-cancel').addEventListener('click', () => el('parties-modal').classList.add('hidden'));
  el('parties-modal').addEventListener('click', e => {
    if (e.target.id === 'parties-modal') el('parties-modal').classList.add('hidden');
  });
  el('parties-save').addEventListener('click', savePartiesModal);

  // ── Past bills ─────────────────────────────────────────────
  el('pur-bills-search').addEventListener('input', debounce(e => { billsQuery = e.target.value.trim().toLowerCase(); renderBills(); }));
  el('pur-bills').addEventListener('click', onBillsClick);

  // ═══════════ Cart operations ═══════════

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY));
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  }
  function persist() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
    state.onCartChange?.(cart.length);
  }

  /** Mapping rows joined with pricing + today's stock, for the picker. */
  function catalogue() {
    const priceIdx = pricingIndex(state.pricing);
    return state.mappings.map(m => {
      const zm = normZmCode(m.zmCode);
      const p = priceIdx.get(zm);
      let stockQty = null, productName = '', mappedKuntal = '';
      if (state.ctx) {
        // Same call also yields the Kuntal code, so unpriced styles are still
        // findable by the code the user actually types.
        const { stock, kuntalCode } = resolveStock(zm, state.ctx);
        mappedKuntal = kuntalCode || '';
        if (stock) {
          productName = stock.name || '';
          stockQty = findColourQty(stock, m.colourName);
        }
      }
      return {
        sellerSkuCode: m.sellerSkuCode,
        zmCode: zm,
        colourName: m.colourName,
        kuntalCode: p?.kuntalCode || mappedKuntal || '',
        category: p?.category || '',
        rate: p?.kuntalSellingPrice ?? null,
        productName,
        stockQty
      };
    });
  }

  function pickerRows() {
    const q = pickerQuery.toLowerCase();
    let rows = catalogue();
    if (q) {
      rows = rows.filter(r =>
        String(r.sellerSkuCode).toLowerCase().includes(q) ||
        String(r.zmCode).toLowerCase().includes(q) ||
        String(r.kuntalCode).toLowerCase().includes(q) ||
        String(r.colourName).toLowerCase().includes(q) ||
        String(r.productName).toLowerCase().includes(q));
    }
    return rows.sort((a, b) =>
      String(a.sellerSkuCode).localeCompare(String(b.sellerSkuCode), undefined, { numeric: true }));
  }

  function addLine(row, qty = 1, silent = false) {
    const existing = cart.find(l => l.sellerSkuCode === row.sellerSkuCode);
    if (existing) {
      existing.qty = Math.max(1, (Number(existing.qty) || 0) + qty);
      if (!silent) notify.info(`${row.sellerSkuCode} → qty ${existing.qty}`);
      return;
    }
    cart.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sellerSkuCode: row.sellerSkuCode,
      zmCode: row.zmCode,
      kuntalCode: row.kuntalCode,
      colourName: row.colourName,
      category: row.category,
      qty: Math.max(1, qty),
      rate: row.rate ?? 0,
      gstRateOverride: null,
      hsn: state.purchaseSettings.hsnCodes?.[row.category] || ''
    });
  }

  function addBySku(sku, qty) {
    const row = catalogue().find(r => r.sellerSkuCode === sku);
    if (!row) { notify.error('SKU not found in mapping'); return; }
    addLine(row, Math.max(1, Math.floor(qty) || 1));
    persist(); renderCart(); renderPicker();
  }

  function onPickerClick(e) {
    const btn = e.target.closest('button[data-add]');
    if (!btn) return;
    const qtyInput = el('pur-picker').querySelector(`input[data-qty-for="${CSS.escape(btn.dataset.add)}"]`);
    addBySku(btn.dataset.add, Number(qtyInput?.value) || 1);
  }

  function onCartInput(e) {
    const inp = e.target.closest('[data-line]');
    if (!inp) return;
    const line = cart.find(l => l.id === inp.dataset.line);
    if (!line) return;
    const field = inp.dataset.field;
    if (field === 'qty') line.qty = Math.max(1, Math.floor(Number(inp.value) || 1));
    else if (field === 'rate') line.rate = Math.max(0, Number(inp.value) || 0);
    else if (field === 'gst') line.gstRateOverride = inp.value === '' ? null : Math.max(0, Number(inp.value) || 0);
    else if (field === 'hsn') line.hsn = inp.value.trim();
    persist();

    // Patch this row's Amount in place — a full re-render would steal focus
    // from the input the user is still typing in.
    const rateTable = state.purchaseSettings.gstRates || {};
    const computed = computeLine(line, rateTable, 0);
    const amountCell = el('pur-cart').querySelector(`[data-amount="${CSS.escape(line.id)}"]`);
    if (amountCell) amountCell.textContent = formatINR(computed.taxable);
    if (field === 'rate') inp.classList.toggle('ring-2', computed.rate <= 0);
    renderTotalsOnly();
  }

  function onCartClick(e) {
    const rm = e.target.closest('button[data-remove]');
    if (!rm) return;
    cart = cart.filter(l => l.id !== rm.dataset.remove);
    persist(); renderCart(); renderPicker();
  }

  // ═══════════ Bill assembly ═══════════

  function computedLines() {
    const rateTable = state.purchaseSettings.gstRates || {};
    return cart.map((l, i) => computeLine(l, rateTable, i + 1));
  }

  /**
   * Assemble the bill object. Returns null (with a toast) when it can't be built.
   * `draft: true` means "don't reserve a number yet" — preview and ad-hoc PDF.
   */
  function buildBill({ draft, billNo } = {}) {
    if (!cart.length) { notify.warning('Add at least one product to the bill'); return null; }
    const lines = computedLines();
    const zeroRate = lines.filter(l => l.rate <= 0);
    if (zeroRate.length) {
      notify.error(`${zeroRate.length} line(s) have no rate — set a rate before billing (${zeroRate.slice(0, 2).map(l => l.sellerSkuCode).join(', ')})`);
      return null;
    }
    const { totals, rateSummary } = computeTotals(lines);
    const type = PURCHASE_DOC_TYPES.find(t => t.id === docTypeSel.value) || PURCHASE_DOC_TYPES[0];
    const typed = el('pur-billno').value.trim();

    return {
      docType: docTypeSel.value,
      docTypeLabel: type.label,
      billNo: billNo || typed || `${type.prefix}/${financialYearLabel(new Date())}/DRAFT`,
      billDate: el('pur-billdate').value || today(),
      placeOfSupply: el('pur-place').value.trim(),
      isDraft: !!draft && !billNo && !typed,
      lines,
      totals,
      rateSummary,
      parties: { ...state.purchaseSettings }
    };
  }

  function downloadPDF(bill) {
    try {
      exportBillPDF(bill, state.purchaseSettings);
      notify.success(`${bill.docTypeLabel} exported — ₹${formatINR(bill.totals.grandRounded, 0)}`);
    } catch (err) {
      notify.error('PDF failed: ' + err.message);
    }
  }

  async function saveBill() {
    if (!cart.length) { notify.warning('Add at least one product to the bill'); return; }
    const btn = el('pur-save');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Saving…';
    try {
      const typed = el('pur-billno').value.trim();
      let billNo = typed;
      if (!billNo) {
        const reserved = await nextBillNumber(docTypeSel.value);
        billNo = reserved.billNo;
      }
      const bill = buildBill({ draft: false, billNo });
      if (!bill) return;

      await savePurchaseBill(bill);
      el('pur-billno').value = billNo;
      notify.success(`${bill.docTypeLabel} ${billNo} saved — ₹${formatINR(bill.totals.grandRounded, 0)}`);
      downloadPDF(bill);

      cart = []; persist();
      el('pur-billno').value = '';
      await refreshBills();
      renderCart(); renderPicker();
      state.onBillsChange?.(bills);
    } catch (err) {
      notify.error('Save failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
      if (window.lucide) lucide.createIcons();
    }
  }

  // ═══════════ Parties / GST modal ═══════════

  const PARTY_FIELDS = [
    'sellerName', 'sellerAddress', 'sellerGstin', 'sellerState',
    'buyerName', 'buyerBrand', 'buyerAddress', 'buyerGstin', 'buyerState',
    'bankName', 'bankAccount', 'bankIfsc', 'terms'
  ];

  function openPartiesModal() {
    const s = state.purchaseSettings;
    for (const f of PARTY_FIELDS) {
      const input = el(`party-${f}`);
      if (input) input.value = s[f] ?? '';
    }
    renderRateTable();
    el('parties-modal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function renderRateTable() {
    const rates = state.purchaseSettings.gstRates || {};
    const hsn = state.purchaseSettings.hsnCodes || {};
    const cats = [...new Set([...Object.keys(rates), ...Object.keys(hsn),
      ...state.pricing.map(p => p.category).filter(Boolean)])].sort();
    el('party-rates').innerHTML = cats.map(c => `
      <div class="grid grid-cols-[1fr_5rem_7rem] gap-2 items-center" data-rate-row="${esc(c)}">
        <span class="text-slate-300 text-sm capitalize truncate">${esc(c)}</span>
        <input type="number" min="0" max="100" step="0.5" class="zm-input text-sm" data-rate-cat="${esc(c)}" value="${rates[c] ?? ''}" placeholder="%">
        <input type="text" class="zm-input text-sm" data-hsn-cat="${esc(c)}" value="${esc(hsn[c] ?? '')}" placeholder="HSN">
      </div>`).join('') || `<p class="text-slate-500 text-xs">No categories yet — upload pricing first.</p>`;
  }

  el('party-add-cat').addEventListener('click', () => {
    const name = el('party-new-cat').value.trim().toLowerCase();
    if (!name) { notify.warning('Type a category name first'); return; }
    state.purchaseSettings.gstRates = { ...state.purchaseSettings.gstRates, [name]: GST_RATE_FALLBACK };
    state.purchaseSettings.hsnCodes = { ...state.purchaseSettings.hsnCodes, [name]: '' };
    el('party-new-cat').value = '';
    renderRateTable();
  });

  async function savePartiesModal() {
    const btn = el('parties-save');
    btn.disabled = true;
    try {
      const patch = {};
      for (const f of PARTY_FIELDS) {
        const input = el(`party-${f}`);
        if (input) patch[f] = input.value.trim();
      }
      const gstRates = {}, hsnCodes = {};
      el('party-rates').querySelectorAll('[data-rate-cat]').forEach(inp => {
        if (inp.value !== '') gstRates[inp.dataset.rateCat] = Number(inp.value);
      });
      el('party-rates').querySelectorAll('[data-hsn-cat]').forEach(inp => {
        hsnCodes[inp.dataset.hsnCat] = inp.value.trim();
      });
      patch.gstRates = gstRates;
      patch.hsnCodes = hsnCodes;

      await savePurchaseSettings(patch);
      state.purchaseSettings = await getPurchaseSettings();
      // Refresh HSN on lines that never had one typed in
      for (const l of cart) {
        if (!l.hsn) l.hsn = state.purchaseSettings.hsnCodes?.[l.category] || '';
      }
      persist();
      el('parties-modal').classList.add('hidden');
      renderCart();
      notify.success('Bill details saved');
    } catch (err) {
      notify.error('Save failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════ Past bills ═══════════

  async function refreshBills() {
    bills = await getAllPurchaseBills();
    renderBills();
    return bills;
  }

  function onBillsClick(e) {
    const btn = e.target.closest('button[data-bill-action]');
    if (!btn) return;
    const bill = bills.find(b => b.id === btn.dataset.billId);
    if (!bill) return;

    switch (btn.dataset.billAction) {
      case 'view':
        el('bill-preview-body').innerHTML = renderBillPreviewHTML(bill, bill.parties || state.purchaseSettings);
        el('bill-preview-modal').classList.remove('hidden');
        break;
      case 'pdf':
        try {
          exportBillPDF(bill, bill.parties || state.purchaseSettings);
          notify.success(`${bill.billNo} re-downloaded`);
        } catch (err) { notify.error('PDF failed: ' + err.message); }
        break;
      case 'duplicate':
        cart = (bill.lines || []).map((l, i) => ({
          id: `${Date.now()}-${i}`,
          sellerSkuCode: l.sellerSkuCode,
          zmCode: l.zmCode,
          kuntalCode: l.kuntalCode,
          colourName: l.colourName,
          category: l.category,
          qty: l.qty,
          rate: l.rate,
          gstRateOverride: l.gstRateAuto ? null : l.gstRate,
          hsn: l.hsn || ''
        }));
        persist(); renderCart(); renderPicker();
        el('pur-billno').value = '';
        notify.success(`${bill.lines.length} line(s) copied from ${bill.billNo} into a new bill`);
        break;
      case 'delete':
        if (!confirm(`Delete ${bill.billNo}? This cannot be undone.`)) return;
        deletePurchaseBill(bill.id)
          .then(async () => {
            await refreshBills();
            state.onBillsChange?.(bills);
            notify.success(`${bill.billNo} deleted`);
          })
          .catch(err => notify.error('Delete failed: ' + err.message));
        break;
    }
  }

  function renderBills() {
    const list = el('pur-bills');
    let f = bills;
    if (billsQuery) {
      f = f.filter(b =>
        String(b.billNo).toLowerCase().includes(billsQuery) ||
        String(b.docTypeLabel).toLowerCase().includes(billsQuery) ||
        String(b.billDate).includes(billsQuery));
    }
    el('pur-bills-count').textContent = bills.length ? `${f.length} of ${bills.length} bills` : '';

    if (!bills.length) {
      list.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No bills saved yet.</p>`;
      return;
    }
    if (!f.length) {
      list.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No bills match that search.</p>`;
      return;
    }

    list.innerHTML = f.map(b => `
      <div class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/[0.02]">
        <div class="min-w-0 flex-1">
          <p class="text-slate-200 text-sm font-semibold truncate">${esc(b.billNo)}</p>
          <p class="text-slate-500 text-xs">${esc(b.docTypeLabel || '')} · ${esc(formatDateDisplay(b.billDate) || b.billDate)} · ${(b.lines || []).length} line(s) · ${b.totals?.totalQty ?? 0} pcs</p>
        </div>
        <p class="text-emerald-300 font-bold text-sm whitespace-nowrap">₹ ${formatINR(b.totals?.grandRounded ?? 0, 0)}</p>
        <div class="flex gap-1.5">
          <button data-bill-action="view" data-bill-id="${esc(b.id)}" class="btn-secondary text-xs py-1.5 px-2.5" title="View"><i data-lucide="eye" class="w-3.5 h-3.5"></i></button>
          <button data-bill-action="pdf" data-bill-id="${esc(b.id)}" class="btn-secondary text-xs py-1.5 px-2.5" title="Download PDF"><i data-lucide="download" class="w-3.5 h-3.5"></i></button>
          <button data-bill-action="duplicate" data-bill-id="${esc(b.id)}" class="btn-secondary text-xs py-1.5 px-2.5" title="Copy into a new bill"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>
          <button data-bill-action="delete" data-bill-id="${esc(b.id)}" class="btn-secondary text-xs py-1.5 px-2.5 hover:!text-red-400" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
      </div>`).join('');
    if (window.lucide) lucide.createIcons();
  }

  // ═══════════ Rendering ═══════════

  function renderPicker() {
    const rows = pickerRows();
    const inCart = new Set(cart.map(l => l.sellerSkuCode));
    el('pur-picker-count').textContent = state.mappings.length
      ? `${rows.length} of ${state.mappings.length} SKUs`
      : 'No mappings uploaded yet';

    const box = el('pur-picker');
    if (!state.mappings.length) {
      box.innerHTML = `<p class="text-slate-500 text-sm text-center py-8">Upload the Myntra mapping file first — the Mapping tab feeds this list.</p>`;
      return;
    }
    if (!rows.length) {
      box.innerHTML = `<p class="text-slate-500 text-sm text-center py-8">No SKUs match “${esc(pickerQuery)}”.</p>`;
      return;
    }

    const shown = rows.slice(0, 200);
    box.innerHTML = shown.map(r => {
      const added = inCart.has(r.sellerSkuCode);
      const noRate = r.rate === null;
      return `
      <div class="flex items-center gap-3 px-3 py-2 border-b border-white/5 hover:bg-white/[0.02] ${added ? 'bg-emerald-500/[0.06]' : ''}">
        <div class="min-w-0 flex-1">
          <p class="text-slate-200 text-sm font-medium truncate">${esc(r.sellerSkuCode)}</p>
          <p class="text-slate-500 text-xs truncate">
            ${esc(r.kuntalCode) || '<span class="text-red-400">no Kuntal code</span>'} ·
            ${esc(r.colourName)}${r.category ? ' · ' + esc(r.category) : ''}${r.stockQty !== null && r.stockQty !== undefined ? ` · ${r.stockQty} in stock` : ''}
          </p>
        </div>
        <p class="text-xs whitespace-nowrap ${noRate ? 'text-red-400' : 'text-slate-300'}">${noRate ? 'no rate' : '₹ ' + formatINR(r.rate, 0)}</p>
        <input type="number" min="1" value="1" data-qty-for="${esc(r.sellerSkuCode)}" class="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:border-emerald-500/40">
        <button data-add="${esc(r.sellerSkuCode)}" class="btn-secondary text-xs py-1.5 px-2.5 whitespace-nowrap">
          ${added ? '<i data-lucide="plus" class="w-3.5 h-3.5"></i>' : 'Add'}
        </button>
      </div>`;
    }).join('') + (rows.length > shown.length
      ? `<p class="text-slate-600 text-xs text-center py-3">Showing first ${shown.length} of ${rows.length} — refine the search to see the rest.</p>`
      : '');
    if (window.lucide) lucide.createIcons();
  }

  function renderCart() {
    const box = el('pur-cart');
    el('pur-line-count').textContent = cart.length ? `${cart.length} line(s)` : '';

    if (!cart.length) {
      box.innerHTML = `<div class="text-center py-10 px-4">
        <i data-lucide="shopping-cart" class="w-8 h-8 text-slate-700 mx-auto mb-2"></i>
        <p class="text-slate-500 text-sm">No products added yet</p>
        <p class="text-slate-600 text-xs mt-1">Search on the left and hit Add to start the bill.</p>
      </div>`;
      if (window.lucide) lucide.createIcons();
      renderTotalsOnly();
      return;
    }

    const lines = computedLines();
    box.innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-[10px] uppercase tracking-wide border-b border-white/5">
          <th class="text-left px-2 py-2">Sr</th>
          <th class="text-left px-2 py-2">Kuntal</th>
          <th class="text-left px-2 py-2">Colour</th>
          <th class="text-left px-2 py-2">HSN</th>
          <th class="text-right px-2 py-2">Qty</th>
          <th class="text-right px-2 py-2">Rate</th>
          <th class="text-right px-2 py-2">GST%</th>
          <th class="text-right px-2 py-2">Amount</th>
          <th class="px-2 py-2"></th>
        </tr></thead>
        <tbody>${lines.map(l => `
          <tr class="border-b border-white/5">
            <td class="px-2 py-2 text-slate-500">${l.srNo}</td>
            <td class="px-2 py-2 text-slate-200 font-medium whitespace-nowrap">${esc(l.kuntalCode) || '<span class="text-red-400 text-xs">missing</span>'}</td>
            <td class="px-2 py-2 text-slate-300 max-w-[120px] truncate" title="${esc(l.sellerSkuCode)}">${esc(l.colourName)}</td>
            <td class="px-2 py-2"><input type="text" value="${esc(l.hsn)}" data-line="${l.id}" data-field="hsn" placeholder="—" class="w-16 bg-white/5 border border-white/10 rounded-lg px-1.5 py-1 text-xs focus:outline-none focus:border-emerald-500/40"></td>
            <td class="px-2 py-2 text-right"><input type="number" min="1" value="${l.qty}" data-line="${l.id}" data-field="qty" class="w-14 bg-white/5 border border-white/10 rounded-lg px-1.5 py-1 text-right text-sm font-semibold focus:outline-none focus:border-emerald-500/40"></td>
            <td class="px-2 py-2 text-right"><input type="number" min="0" step="0.01" value="${l.rate}" data-line="${l.id}" data-field="rate" class="w-20 bg-white/5 border border-white/10 rounded-lg px-1.5 py-1 text-right text-sm ${l.rate <= 0 ? 'ring-2 ring-red-400/60 text-red-300' : ''} focus:outline-none focus:border-emerald-500/40"></td>
            <td class="px-2 py-2 text-right"><input type="number" min="0" max="100" step="0.5" value="${l.gstRateAuto ? '' : l.gstRate}" placeholder="${l.gstRate}" data-line="${l.id}" data-field="gst" title="${l.gstRateFallback ? 'No rate configured for this category — using the ' + l.gstRate + '% fallback' : 'Auto from category'}" class="w-14 bg-white/5 border border-white/10 rounded-lg px-1.5 py-1 text-right text-sm ${l.gstRateFallback ? 'ring-2 ring-amber-400/50 text-amber-300' : ''} focus:outline-none focus:border-emerald-500/40"></td>
            <td data-amount="${l.id}" class="px-2 py-2 text-right text-emerald-300 font-semibold whitespace-nowrap">${formatINR(l.taxable)}</td>
            <td class="px-2 py-2 text-right"><button data-remove="${l.id}" class="text-slate-600 hover:text-red-400 transition"><i data-lucide="x" class="w-3.5 h-3.5"></i></button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    if (window.lucide) lucide.createIcons();
    renderTotalsOnly();
  }

  function renderTotalsOnly() {
    const box = el('pur-totals');
    if (!cart.length) {
      box.innerHTML = `<p class="text-slate-600 text-xs text-center py-3">Totals appear once the bill has lines.</p>`;
      return;
    }
    const lines = computedLines();
    const { totals, rateSummary } = computeTotals(lines);
    const row = (label, value, cls = '') =>
      `<div class="flex justify-between py-1 ${cls}"><span class="text-slate-400">${label}</span><span class="text-slate-200 font-medium">${value}</span></div>`;

    box.innerHTML = `
      <div class="text-xs space-y-0.5">
        ${rateSummary.map(r => row(`Taxable @ ${r.gstRate}%`, formatINR(r.taxable), 'text-slate-500')).join('')}
        <div class="border-t border-white/10 my-1.5"></div>
        ${row('Taxable Value', formatINR(totals.subTotal))}
        ${row('CGST', formatINR(totals.cgstTotal))}
        ${row('SGST', formatINR(totals.sgstTotal))}
        ${row('Round Off', totals.roundOff < 0 ? `(${formatINR(Math.abs(totals.roundOff))})` : formatINR(totals.roundOff))}
      </div>
      <div class="flex justify-between items-center mt-2.5 px-3 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/15 to-emerald-500/5 border border-emerald-500/25">
        <div>
          <p class="text-emerald-400 text-[10px] font-bold uppercase tracking-wider">Grand Total</p>
          <p class="text-slate-500 text-[10px]">${totals.totalQty} pcs · ${lines.length} line(s)</p>
        </div>
        <p class="text-white text-lg font-bold">₹ ${formatINR(totals.grandRounded, 0)}</p>
      </div>`;
  }

  function render() {
    renderPicker();
    renderCart();
    renderBills();
  }

  return {
    render,
    refreshBills,
    getBills: () => bills,
    getCartCount: () => cart.length
  };
}
