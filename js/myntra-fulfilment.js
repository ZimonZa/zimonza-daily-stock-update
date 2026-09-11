// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Fulfil from Label
// Drop label.pdf → work out what has to go out → cover it from
// Returns / RTO first, buy only the shortfall.
// Produces TWO separate documents: a pick slip for the returned
// stock, a purchase bill for the part that had to be bought.
// ═══════════════════════════════════════════════════════════════

import { PURCHASE_DOC_TYPES, PURCHASE_ONLY_DOC_TYPES } from './constants.js';
import { parseLabelPdf } from './myntra-labels.js';
import { availableReturnStock, allocateFromReturns } from './myntra-returns.js';
import { computeLine, computeTotals } from './myntra-purchase.js';
import { pricingIndex } from './myntra-pricing.js';
import { resolveStock } from './myntra.js';
import { swatchDot } from './swatches.js';
import { exportBillPDF, exportPickSlipPDF, renderSlipPreviewHTML } from './invoice-pdf.js';
import {
  savePickSlip, getAllPickSlips, deletePickSlip, nextSlipNumber,
  applyReturnConsumption, savePurchaseBill, nextBillNumber
} from './firestore-service.js';
import { normZmCode, normItemNo, formatINR, formatDateDisplay, today } from './utils.js';
import notify from './notifications.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ═══════════════════ Pure planning ═══════════════════

/**
 * Turn parsed label items into review rows, resolving price/category/Kuntal
 * code and how much the returns register can cover.
 * PURE — reads state, writes nothing.
 */
export function buildPlan(labelItems, { pricing, ctx, returns }) {
  const priceIdx = pricingIndex(pricing);
  const stockIdx = availableReturnStock(returns);

  return labelItems.map(item => {
    const zm = normZmCode(item.zmCode);
    const p = priceIdx.get(zm);
    let kuntalCode = p?.kuntalCode || '';
    if (!kuntalCode && ctx) kuntalCode = normItemNo(resolveStock(zm, ctx).kuntalCode || '');

    const available = stockIdx.get(item.key)?.total || 0;
    const need = item.qty;
    const fromRto = Math.min(need, available);

    return {
      key: item.key,
      sellerSkuCode: item.sellerSkuCode,
      zmCode: zm,
      colourName: item.colourName,
      kuntalCode,
      category: p?.category || '',
      rate: p?.kuntalSellingPrice ?? null,
      hsn: '',
      need,
      available,
      fromRto,
      pages: item.pages,
      mapped: item.mapped,
      include: true
    };
  });
}

/** toBuy is always what the returns register could not cover. */
export const toBuy = (row) => Math.max(0, row.need - row.fromRto);

/** Totals across the plan, for the summary bar and the confirm guard. */
export function planSummary(rows) {
  const active = rows.filter(r => r.include);
  const slipPcs = active.reduce((s, r) => s + r.fromRto, 0);
  const buyPcs = active.reduce((s, r) => s + toBuy(r), 0);
  const needPcs = active.reduce((s, r) => s + r.need, 0);
  const unpriced = active.filter(r => toBuy(r) > 0 && !(r.rate > 0));
  return { active, slipPcs, buyPcs, needPcs, unpriced };
}

// ═══════════════════ Panel ═══════════════════

export function initFulfilmentPanel(state, tabs) {
  const el = id => document.getElementById(id);

  let plan = null;          // review rows, or null when idle
  let sourceFile = '';
  let slips = [];
  let busy = false;

  const docTypeSel = el('ful-doctype');
  // Only the buying types: a label fulfils an order, it never returns goods
  docTypeSel.innerHTML = PURCHASE_ONLY_DOC_TYPES.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  docTypeSel.value = localStorage.getItem('zm_fulfil_doctype') || 'purchase_order';
  docTypeSel.addEventListener('change', () => localStorage.setItem('zm_fulfil_doctype', docTypeSel.value));

  const drop = el('ful-drop');
  state.helpers.bindDrop(drop, el('ful-file'), handleFile);

  // A slip can start from a label or from nothing at all. Only the input
  // differs — everything downstream is the same code.
  let mode = localStorage.getItem('zm_ful_mode') === 'manual' ? 'manual' : 'label';
  const isManual = () => mode === 'manual';

  function setMode(next) {
    mode = next === 'manual' ? 'manual' : 'label';
    localStorage.setItem('zm_ful_mode', mode);
    el('ful-mode-label').classList.toggle('is-active', !isManual());
    el('ful-mode-manual').classList.toggle('is-active', isManual());
    el('ful-label-input').classList.toggle('hidden', isManual());
    el('ful-manual-input').classList.toggle('hidden', !isManual());
    render();
  }
  el('ful-mode-label').addEventListener('click', () => setMode('label'));
  el('ful-mode-manual').addEventListener('click', () => setMode('manual'));

  // ── Adding a line by hand, in either mode ──
  el('ful-add-line').addEventListener('click', addManualLine);
  el('ful-manual-sku').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addManualLine(); }
  });

  /**
   * Put a SKU on the plan without a label carrying it.
   * It joins as an ordinary row, so the RTO-first split, the caps and the
   * two documents all behave exactly as they do for a scanned page.
   */
  function addManualLine() {
    const sku = el('ful-manual-sku').value.trim();
    const qty = Math.max(1, Math.floor(Number(el('ful-manual-qty').value) || 1));
    if (!sku) { notify.warning('Pick a SellerSkuCode first'); return; }

    const known = state.mappings.find(m =>
      String(m.sellerSkuCode).toLowerCase() === sku.toLowerCase());
    if (!known) { notify.error(`${sku} is not in the Myntra mapping`); return; }

    const item = {
      key: `${normZmCode(known.zmCode)}|${String(known.colourName).toLowerCase().trim().replace(/\s+/g, ' ')}`,
      sellerSkuCode: known.sellerSkuCode,
      zmCode: normZmCode(known.zmCode),
      colourName: known.colourName,
      qty,
      pages: [],
      mapped: true
    };

    const existing = (plan || []).find(r => r.key === item.key);
    if (existing) {
      existing.need += qty;
      // The split must follow the new need, not stay at the old one
      existing.fromRto = Math.min(existing.need, existing.available);
      notify.info(`${sku} → ${existing.need} pc(s)`);
    } else {
      const built = buildPlan([item], {
        pricing: state.pricing, ctx: state.ctx, returns: tabs.returnsTab.getReturns()
      });
      plan = [...(plan || []), ...built];
      if (!sourceFile) sourceFile = isManual() ? 'built by hand' : sourceFile;
      notify.success(`${sku} added — ${qty} pc(s)`);
    }

    el('ful-manual-sku').value = '';
    el('ful-manual-qty').value = 1;
    el('ful-source').textContent = planSourceLine();
    render();
  }

  function planSourceLine() {
    if (!plan?.length) return '';
    const pcs = plan.reduce((t, r) => t + r.need, 0);
    const fromLabel = plan.some(r => r.pages?.length);
    const origin = fromLabel ? (sourceFile || 'label') : 'built by hand';
    return `${origin} · ${plan.length} SKU(s) · ${pcs} pc(s)`;
  }

  /** Fill the SKU datalist once the mapping is known. */
  function fillSkuList() {
    const list = el('ful-sku-list');
    if (!list) return;
    list.innerHTML = state.mappings
      .map(m => `<option value="${esc(m.sellerSkuCode)}"></option>`).join('');
  }

  el('ful-cancel').addEventListener('click', reset);
  el('ful-confirm').addEventListener('click', commit);
  el('ful-table').addEventListener('input', onTableInput);
  el('ful-table').addEventListener('change', onTableChange);
  el('ful-slips').addEventListener('click', onSlipsClick);

  // ── Label upload ────────────────────────────────────────────
  async function handleFile(file) {
    if (!state.mappings.length) {
      notify.error('Upload the Myntra mapping first — labels are matched against it.');
      return;
    }
    drop.innerHTML = `<div class="flex flex-col items-center gap-2 py-2"><div class="spinner"></div><p class="text-slate-400 text-xs" id="ful-progress">Reading ${esc(file.name)}…</p></div>`;
    try {
      const result = await parseLabelPdf(file, state.mappings, (p, total) => {
        const node = el('ful-progress');
        if (node) node.textContent = `Reading ${file.name} — page ${p} of ${total}…`;
      });

      if (!result.hasTextLayer) {
        notify.error('No text found in this PDF. It looks like a scan — labels must be a text PDF.');
        state.helpers.resetDrop(drop, 'Myntra label.pdf — one page per piece');
        return;
      }
      if (!result.items.length) {
        notify.error(`No SellerSkuCodes found across ${result.pages} page(s). Expected codes like ZM-11-Purple.`);
        state.helpers.resetDrop(drop, 'Myntra label.pdf — one page per piece');
        return;
      }

      sourceFile = file.name;
      plan = buildPlan(result.items, {
        pricing: state.pricing,
        ctx: state.ctx,
        returns: tabs.returnsTab.getReturns()
      });

      const found = result.items.reduce((s, i) => s + i.qty, 0);
      el('ful-source').textContent =
        `${file.name} · ${result.pages} page(s) · ${result.items.length} SKU(s) · ${found} pc(s)` +
        (result.unreadablePages.length ? ` · ${result.unreadablePages.length} page(s) with no code` : '');

      // Hand the pages to dispatch tracking, so who received what is recorded
      state.onLabelParsed?.(result, file.name);

      if (result.unreadablePages.length) {
        notify.warning(`No SKU found on page(s) ${result.unreadablePages.slice(0, 8).join(', ')}${result.unreadablePages.length > 8 ? '…' : ''} — those pieces are not counted.`);
      }
      state.helpers.resetDrop(drop, 'Myntra label.pdf — one page per piece');
      render();
    } catch (err) {
      notify.error('Could not read the label PDF: ' + err.message);
      state.helpers.resetDrop(drop, 'Myntra label.pdf — one page per piece');
    }
  }

  function reset() {
    plan = null;
    sourceFile = '';
    el('ful-source').textContent = '';
    render();
  }

  // ── Review edits ────────────────────────────────────────────
  function onTableInput(e) {
    const inp = e.target.closest('input[data-ful-field]');
    if (!inp || !plan) return;
    const row = plan.find(r => r.key === inp.dataset.fulKey);
    if (!row) return;

    if (inp.dataset.fulField === 'need') {
      onNeedInput(inp);
      return;
    }
    if (inp.dataset.fulField === 'fromRto') {
      // Never promise more returned stock than actually exists
      row.fromRto = Math.max(0, Math.min(row.need, row.available, Math.floor(Number(inp.value) || 0)));
      if (Number(inp.value) !== row.fromRto) inp.value = row.fromRto;
    } else if (inp.dataset.fulField === 'rate') {
      row.rate = Math.max(0, Number(inp.value) || 0);
    } else if (inp.dataset.fulField === 'hsn') {
      row.hsn = inp.value.trim();
    }
    renderTotalsRow();
    const buyCell = el('ful-table').querySelector(`[data-buy="${CSS.escape(row.key)}"]`);
    if (buyCell) buyCell.textContent = toBuy(row);
  }

  function onTableChange(e) {
    const cb = e.target.closest('input[data-ful-include]');
    if (!cb || !plan) return;
    const row = plan.find(r => r.key === cb.dataset.fulInclude);
    if (row) { row.include = cb.checked; render(); }
  }

  /** Editing the needed quantity by hand, after the plan exists. */
  function onNeedInput(inp) {
    const row = plan?.find(r => r.key === inp.dataset.fulKey);
    if (!row) return;
    row.need = Math.max(1, Math.floor(Number(inp.value) || 1));
    row.fromRto = Math.min(row.fromRto, row.need, row.available);
    el('ful-source').textContent = planSourceLine();
    render();
  }

  // ── Commit ──────────────────────────────────────────────────
  async function commit() {
    if (!plan || busy) return;
    const { active, slipPcs, buyPcs, unpriced } = planSummary(plan);

    if (!active.length) { notify.warning('No rows selected'); return; }
    if (!slipPcs && !buyPcs) { notify.warning('Nothing to fulfil — every row is zero'); return; }
    if (unpriced.length) {
      notify.error(`${unpriced.length} row(s) have no rate — type a rate before generating the bill (${unpriced.slice(0, 2).map(r => r.sellerSkuCode).join(', ')})`);
      return;
    }

    busy = true;
    const btn = el('ful-confirm');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Working…';

    // Re-read the register at commit time so a stale review can't over-draw
    const stockIdx = availableReturnStock(tabs.returnsTab.getReturns());
    const slipLines = [];
    const consumption = [];
    let overdrawn = null;

    for (const row of active) {
      if (row.fromRto <= 0) continue;
      const alloc = allocateFromReturns(row.key, row.fromRto, stockIdx);
      if (alloc.taken < row.fromRto) { overdrawn = { row, alloc }; break; }
      for (const pick of alloc.picks) {
        slipLines.push({
          srNo: slipLines.length + 1,
          kuntalCode: row.kuntalCode || pick.kuntalCode || '',
          colourName: row.colourName,
          sellerSkuCode: row.sellerSkuCode,
          type: pick.type,
          qty: pick.take
        });
        consumption.push({ id: pick.id, remaining: pick.remaining, take: pick.take });
      }
    }

    if (overdrawn) {
      busy = false; btn.disabled = false; btn.innerHTML = original;
      if (window.lucide) lucide.createIcons();
      notify.error(`Returns stock for ${overdrawn.row.sellerSkuCode} changed — only ${overdrawn.alloc.taken} available now. Re-check the plan.`);
      plan = buildPlan(
        plan.map(r => ({ ...r, qty: r.need })),
        { pricing: state.pricing, ctx: state.ctx, returns: tabs.returnsTab.getReturns() }
      );
      render();
      return;
    }

    const billLines = active.filter(r => toBuy(r) > 0);
    const created = [];
    let alreadyReported = false;

    try {
      // 1 & 2 — reserve numbers and write the documents BEFORE touching stock,
      // so a failure leaves visible paperwork rather than vanished stock.
      let slip = null, bill = null;

      if (slipLines.length) {
        const { slipNo } = await nextSlipNumber();
        slip = {
          slipNo, date: today(), sourceFile,
          lines: slipLines,
          totalPcs: slipLines.reduce((s, l) => s + l.qty, 0),
          picks: consumption
        };
        await savePickSlip(slip);
        created.push(slipNo);
      }

      if (billLines.length) {
        const type = PURCHASE_DOC_TYPES.find(t => t.id === docTypeSel.value) || PURCHASE_DOC_TYPES[0];
        const { billNo } = await nextBillNumber(type.id);
        const rateTable = state.purchaseSettings.gstRates || {};
        const lines = billLines.map((r, i) => computeLine({
          sellerSkuCode: r.sellerSkuCode, zmCode: r.zmCode, kuntalCode: r.kuntalCode,
          colourName: r.colourName, category: r.category,
          qty: toBuy(r), rate: r.rate, gstRateOverride: null,
          hsn: r.hsn || state.purchaseSettings.hsnCodes?.[r.category] || ''
        }, rateTable, i + 1));
        const { totals, rateSummary } = computeTotals(lines);
        bill = {
          docType: type.id, docTypeLabel: type.label, billNo,
          billDate: today(), placeOfSupply: (el('pur-place').value || '').trim(),
          lines, totals, rateSummary,
          parties: { ...state.purchaseSettings },
          sourceFile
        };
        await savePurchaseBill(bill);
        created.push(billNo);
      }

      // 3 — now reduce the returns register
      if (consumption.length) {
        try {
          await applyReturnConsumption(consumption.map(c => ({ id: c.id, remaining: c.remaining })));
        } catch (err) {
          alreadyReported = true;
          notify.error(
            `${created.join(' and ')} were saved, but the returns stock was NOT reduced: ${err.message}. ` +
            `Adjust the returns rows by hand.`
          );
          throw err;
        }
      }

      // 4 — hand over the documents
      if (slip) exportPickSlipPDF(slip, state.purchaseSettings);
      if (bill) exportBillPDF(bill, state.purchaseSettings);

      notify.success(
        [slip ? `Pick slip ${slip.slipNo} — ${slip.totalPcs} pc(s) from Returns/RTO` : '',
         bill ? `${bill.docTypeLabel} ${bill.billNo} — ${bill.totals.totalQty} pc(s), ₹${formatINR(bill.totals.grandRounded, 0)}` : '']
          .filter(Boolean).join(' · ')
      );

      // 5 — refresh everything that moved
      plan = null; sourceFile = '';
      await Promise.all([
        tabs.returnsTab.refresh(),
        tabs.purchaseTab.refreshBills(),
        refreshSlips()
      ]);
      tabs.purchaseTab.render();
      state.onFulfilmentDone?.();
      render();
    } catch (err) {
      if (!alreadyReported) notify.error('Fulfilment failed: ' + err.message);
      render();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.innerHTML = original;
      if (window.lucide) lucide.createIcons();
    }
  }

  // ── Slip history ────────────────────────────────────────────
  async function refreshSlips() {
    slips = await getAllPickSlips();
    renderSlips();
    return slips;
  }

  function onSlipsClick(e) {
    const btn = e.target.closest('button[data-slip-action]');
    if (!btn) return;
    const slip = slips.find(s => s.id === btn.dataset.slipId);
    if (!slip) return;

    switch (btn.dataset.slipAction) {
      case 'view':
        el('bill-preview-body').innerHTML = renderSlipPreviewHTML(slip, state.purchaseSettings);
        el('bill-preview-modal').classList.remove('hidden');
        break;
      case 'pdf':
        try { exportPickSlipPDF(slip, state.purchaseSettings); notify.success(`${slip.slipNo} re-downloaded`); }
        catch (err) { notify.error('PDF failed: ' + err.message); }
        break;
      case 'delete':
        if (!confirm(`Delete ${slip.slipNo}? The stock it consumed is NOT restored.`)) return;
        deletePickSlip(slip.id)
          .then(() => { notify.success(`${slip.slipNo} deleted`); return refreshSlips(); })
          .catch(err => notify.error('Delete failed: ' + err.message));
        break;
    }
  }

  function renderSlips() {
    const box = el('ful-slips');
    el('ful-slips-count').textContent = slips.length ? `${slips.length} slip(s)` : '';
    if (!slips.length) {
      box.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No pick slips yet.</p>`;
      return;
    }
    box.innerHTML = slips.map(s => `
      <div class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/[0.02]">
        <div class="min-w-0 flex-1">
          <p class="text-slate-200 text-sm font-semibold truncate">${esc(s.slipNo)}</p>
          <p class="text-slate-500 text-xs truncate">${esc(formatDateDisplay(s.date) || s.date)} · ${(s.lines || []).length} line(s)${s.sourceFile ? ` · ${esc(s.sourceFile)}` : ''}</p>
        </div>
        <p class="text-amber-300 font-bold text-sm whitespace-nowrap">${s.totalPcs} pcs</p>
        <div class="flex gap-1.5">
          <button data-slip-action="view" data-slip-id="${esc(s.id)}" class="btn-secondary text-xs py-1.5 px-2.5" title="View"><i data-lucide="eye" class="w-3.5 h-3.5"></i></button>
          <button data-slip-action="pdf" data-slip-id="${esc(s.id)}" class="btn-secondary text-xs py-1.5 px-2.5" title="Download PDF"><i data-lucide="download" class="w-3.5 h-3.5"></i></button>
          <button data-slip-action="delete" data-slip-id="${esc(s.id)}" class="btn-secondary text-xs py-1.5 px-2.5 hover:!text-red-400" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
      </div>`).join('');
    if (window.lucide) lucide.createIcons();
  }

  // ── Review rendering ────────────────────────────────────────
  function render() {
    fillSkuList();
    const hasPlan = !!plan && plan.length > 0;
    el('ful-review').classList.toggle('hidden', !hasPlan);
    // In by-hand mode the builder stays visible so lines can keep being added
    el('ful-idle').classList.toggle('hidden', hasPlan && !isManual());
    if (!hasPlan) { renderSlips(); return; }

    el('ful-table').innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-[10px] uppercase tracking-wide border-b border-white/5">
          <th class="px-3 py-2 text-left"></th>
          <th class="px-3 py-2 text-left">SellerSkuCode</th>
          <th class="px-3 py-2 text-left">Colour</th>
          <th class="px-3 py-2 text-left">Kuntal</th>
          <th class="px-3 py-2 text-right">Need</th>
          <th class="px-3 py-2 text-right">Avail.</th>
          <th class="px-3 py-2 text-right">From RTO</th>
          <th class="px-3 py-2 text-right">To Buy</th>
          <th class="px-3 py-2 text-right">Rate</th>
          <th class="px-3 py-2 text-left">Flags</th>
        </tr></thead>
        <tbody>${plan.map(r => {
          const buy = toBuy(r);
          const needsRate = buy > 0 && !(r.rate > 0);
          const flags = [
            !r.mapped ? '<span class="ful-flag ful-flag-warn">not in mapping</span>' : '',
            needsRate ? '<span class="ful-flag ful-flag-bad">no rate</span>' : '',
            r.available > 0 && r.available < r.need ? `<span class="ful-flag ful-flag-info">RTO short by ${r.need - r.available}</span>` : '',
            r.available === 0 ? '<span class="ful-flag ful-flag-info">none in RTO</span>' : ''
          ].filter(Boolean).join(' ');
          return `<tr class="border-b border-white/5 ${r.include ? '' : 'opacity-45'} ${needsRate && r.include ? 'ful-row-bad' : ''}">
            <td class="px-3 py-2"><input type="checkbox" data-ful-include="${esc(r.key)}" ${r.include ? 'checked' : ''} class="accent-emerald-500"></td>
            <td class="px-3 py-2 text-slate-200 font-medium whitespace-nowrap" title="pages ${r.pages.join(', ')}">${esc(r.sellerSkuCode)}</td>
            <td class="px-3 py-2 text-slate-300">${r.colourName ? swatchDot(r.colourName) + ' ' + esc(r.colourName) : '—'}</td>
            <td class="px-3 py-2 text-slate-400">${esc(r.kuntalCode) || '—'}</td>
            <td class="px-3 py-2 text-right">
              <input type="number" min="1" value="${r.need}" data-ful-field="need" data-ful-key="${esc(r.key)}"
                class="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-right text-sm font-semibold focus:outline-none focus:border-emerald-500/40">
            </td>
            <td class="px-3 py-2 text-right ${r.available ? 'text-amber-300' : 'text-slate-600'}">${r.available}</td>
            <td class="px-3 py-2 text-right">
              <input type="number" min="0" max="${Math.min(r.need, r.available)}" value="${r.fromRto}"
                data-ful-field="fromRto" data-ful-key="${esc(r.key)}" ${r.available ? '' : 'disabled'}
                class="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-right text-sm font-semibold ${r.available ? 'text-amber-300' : 'opacity-40'} focus:outline-none focus:border-emerald-500/40">
            </td>
            <td data-buy="${esc(r.key)}" class="px-3 py-2 text-right text-emerald-300 font-semibold">${buy}</td>
            <td class="px-3 py-2 text-right">
              <input type="number" min="0" step="0.01" value="${r.rate ?? ''}" placeholder="—"
                data-ful-field="rate" data-ful-key="${esc(r.key)}"
                class="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-right text-sm ${needsRate ? 'ring-2 ring-red-400/60 text-red-300' : ''} focus:outline-none focus:border-emerald-500/40">
            </td>
            <td class="px-3 py-2">${flags || '<span class="text-slate-700 text-xs">—</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;

    renderTotalsRow();
    if (window.lucide) lucide.createIcons();
    renderSlips();
  }

  function renderTotalsRow() {
    if (!plan) return;
    const { slipPcs, buyPcs, needPcs, unpriced } = planSummary(plan);
    const blocked = unpriced.length > 0;

    el('ful-summary').innerHTML = `
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span class="text-slate-400">Label needs <b class="text-white">${needPcs}</b> pc(s)</span>
        <span class="text-amber-300">Pick slip <b>${slipPcs}</b> pc(s) from Returns/RTO</span>
        <span class="text-emerald-300">Purchase <b>${buyPcs}</b> pc(s)</span>
        ${slipPcs ? `<span class="text-slate-500">Returns stock will be reduced by ${slipPcs} pc(s)</span>` : ''}
        ${blocked ? `<span class="text-red-400 font-semibold">${unpriced.length} row(s) need a rate first</span>` : ''}
      </div>`;

    const btn = el('ful-confirm');
    btn.disabled = blocked || (!slipPcs && !buyPcs);
    const parts = [];
    if (slipPcs) parts.push('pick slip');
    if (buyPcs) parts.push('purchase bill');
    el('ful-confirm-label').textContent = parts.length
      ? `Confirm & generate ${parts.join(' + ')}`
      : 'Nothing to generate';
  }

  return { render, refreshSlips, getSlips: () => slips };
}
