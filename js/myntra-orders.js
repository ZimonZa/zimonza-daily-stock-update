// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Orders & Returns
// Who received what, what came back, and who keeps sending back
// empty boxes.
// ═══════════════════════════════════════════════════════════════

import { RETURN_TYPES, RETURN_TYPE_LABELS, DISPATCH_STATUS } from './constants.js';
import {
  dispatchesFromLabel, mergeByForwardId, applyReturn, offenderSummary, offenderKey
} from './myntra-dispatch.js';
import {
  saveDispatches, addDispatch, getAllDispatches, updateDispatch, deleteDispatch,
  markDispatchUnfulfillable, addMyntraReturns
} from './firestore-service.js';
import { swatchDot } from './swatches.js';
import { debounce, toCSV, downloadFile, formatDateDisplay, today } from './utils.js';
import notify from './notifications.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stamp = () => new Date().toISOString().slice(0, 10);

const EXPORT_COLUMNS = [
  { key: 'forwardId',     label: 'Forward Tracking ID' },
  { key: 'orderId',       label: 'Order ID' },
  { key: 'customerName',  label: 'Customer' },
  { key: 'customerKey',   label: 'Grouped by' },
  { key: 'sellerSkuCode', label: 'SellerSkuCode' },
  { key: 'colourName',    label: 'Colour' },
  { key: 'qty',           label: 'Qty' },
  { key: 'dispatchDate',  label: 'Dispatched' },
  { key: 'status',        label: 'Status' },
  { key: 'returnType',    label: 'Return Type' },
  { key: 'returnId',      label: 'Return ID' },
  { key: 'foundInside',   label: 'Found Inside' }
];

export function initOrdersTab(state) {
  const el = id => document.getElementById(id);

  // Storage is reached through here so a test can stand in for Firestore.
  // Production passes nothing and gets the real thing.
  const store = {
    getAllDispatches, saveDispatches, addDispatch, updateDispatch,
    deleteDispatch, markDispatchUnfulfillable, addMyntraReturns,
    ...(state.storage || {})
  };
  const view = { q: '', status: 'all', sortKey: 'dispatchDate', sortDir: -1 };

  let dispatches = [];
  let pending = null;      // parsed label awaiting save
  let openDispatch = null; // the one in the return modal

  // ── Search & filters ───────────────────────────────────────
  el('ord-search').addEventListener('input', debounce(e => { view.q = e.target.value.trim(); render(); }));
  el('ord-status-filter').addEventListener('change', e => { view.status = e.target.value; render(); });
  el('ord-table').addEventListener('click', onTableClick);
  el('ord-summary').addEventListener('click', e => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    view.status = btn.dataset.status;
    el('ord-status-filter').value = view.status;
    render();
  });

  // ── Label intake ───────────────────────────────────────────
  el('ord-confirm-save').addEventListener('click', commitLabel);
  el('ord-confirm-cancel').addEventListener('click', () => {
    pending = null;
    el('ord-confirm').classList.add('hidden');
  });

  // ── Manual add ─────────────────────────────────────────────
  el('ord-add-btn').addEventListener('click', openAddModal);
  el('ord-add-cancel').addEventListener('click', () => el('ord-add-modal').classList.add('hidden'));
  el('ord-add-cancel-2').addEventListener('click', () => el('ord-add-modal').classList.add('hidden'));
  el('ord-add-save').addEventListener('click', saveManual);
  el('ord-add-modal').addEventListener('click', e => {
    if (e.target.id === 'ord-add-modal') el('ord-add-modal').classList.add('hidden');
  });

  // ── Return intake ──────────────────────────────────────────
  // Every close path clears the held dispatch. Esc closes the modal from the
  // page script, so the reference must not outlive the modal it belongs to.
  el('ord-ret-cancel').addEventListener('click', closeReturnModal);
  el('ord-ret-cancel-2').addEventListener('click', closeReturnModal);
  el('ord-ret-save').addEventListener('click', saveReturn);
  el('ord-return-modal').addEventListener('click', e => {
    if (e.target.id === 'ord-return-modal') closeReturnModal();
  });
  el('ord-ret-type').addEventListener('change', syncReturnForm);

  // ── Exports ────────────────────────────────────────────────
  el('ord-export-csv').addEventListener('click', () => {
    const rows = exportRows();
    if (!rows.length) { notify.warning('Nothing to export'); return; }
    downloadFile(toCSV(rows, EXPORT_COLUMNS), `myntra_orders_${stamp()}.csv`, 'text/csv;charset=utf-8;');
    notify.success(`Exported ${rows.length} order(s)`);
  });

  // ═══════════ Data ═══════════

  async function refresh() {
    dispatches = await store.getAllDispatches();
    render();
    state.onOrdersChange?.(dispatches);
    return dispatches;
  }

  /**
   * Called by the fulfilment panel after it reads a label, so one PDF read
   * serves both the purchase plan and dispatch tracking.
   */
  function ingestLabel(result, fileName) {
    const records = dispatchesFromLabel(result.pageRecords || [], { sourceFile: fileName });
    if (!records.length) return;
    const { merged, withoutTrackingId } = mergeByForwardId(records);
    pending = { fileName, merged, withoutTrackingId };
    renderConfirm();
  }

  async function commitLabel() {
    if (!pending) return;
    const btn = el('ord-confirm-save');
    btn.disabled = true;
    try {
      const keep = pending.merged.filter(m => m._keep !== false);
      const saved = await store.saveDispatches(keep);
      notify.success(`${saved} dispatch record(s) saved from ${pending.fileName}`);
      if (pending.withoutTrackingId.length) {
        notify.warning(`${pending.withoutTrackingId.length} page(s) had no tracking ID — add them by hand so nothing is lost.`);
      }
      pending = null;
      el('ord-confirm').classList.add('hidden');
      await refresh();
    } catch (err) {
      notify.error('Could not save: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════ Manual add ═══════════

  function openAddModal() {
    for (const id of ['ord-add-forward', 'ord-add-order', 'ord-add-customer', 'ord-add-address']) el(id).value = '';
    el('ord-add-sku').value = '';
    el('ord-add-qty').value = 1;
    el('ord-add-date').value = today();
    el('ord-sku-list').innerHTML = state.mappings
      .map(m => `<option value="${esc(m.sellerSkuCode)}"></option>`).join('');
    el('ord-add-modal').classList.remove('hidden');
  }

  async function saveManual() {
    const forwardId = el('ord-add-forward').value.trim();
    const sku = el('ord-add-sku').value.trim();
    if (!forwardId) { notify.warning('The forward tracking ID is how a return finds this order'); return; }

    const known = state.mappings.find(m => String(m.sellerSkuCode).toLowerCase() === sku.toLowerCase());
    const customerName = el('ord-add-customer').value.trim();
    const address = el('ord-add-address').value.trim();
    const orderId = el('ord-add-order').value.trim();
    const { key, keyType, label } = offenderKey({ customerName, address, orderId });

    const btn = el('ord-add-save');
    btn.disabled = true;
    try {
      await store.addDispatch({
        forwardId: forwardId.toUpperCase(),
        orderId,
        customer: { name: customerName, address, key, keyType, label },
        sellerSkuCode: known?.sellerSkuCode || sku,
        zmCode: known?.zmCode || '',
        colourName: known?.colourName || '',
        qty: Math.max(1, Math.floor(Number(el('ord-add-qty').value) || 1)),
        dispatchDate: el('ord-add-date').value || today(),
        sourceFile: 'manual',
        status: DISPATCH_STATUS.SHIPPED,
        return: null,
        missing: []
      });
      el('ord-add-modal').classList.add('hidden');
      notify.success(`${forwardId} recorded`);
      await refresh();
    } catch (err) {
      notify.error('Could not save: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════ Return intake ═══════════

  function closeReturnModal() {
    el('ord-return-modal').classList.add('hidden');
    openDispatch = null;
  }

  function openReturnModal(dispatch) {
    openDispatch = dispatch;
    el('ord-ret-title').textContent = `Return against ${dispatch.forwardId || '(no tracking ID)'}`;
    el('ord-ret-sub').innerHTML =
      `${dispatch.colourName ? swatchDot(dispatch.colourName) + ' ' : ''}` +
      `${esc(dispatch.sellerSkuCode) || '—'} · ${dispatch.qty} pc(s) · ` +
      `${esc(dispatch.customer?.name || dispatch.customer?.label || 'customer not printed')}`;
    el('ord-ret-id').value = dispatch.return?.returnId || '';
    el('ord-ret-type').value = dispatch.return?.type || RETURN_TYPES.CUSTOMER_RETURN;
    el('ord-ret-found').value = dispatch.return?.foundInside || '';
    el('ord-ret-condition').value = '';
    el('ord-ret-date').value = dispatch.return?.date || today();
    syncReturnForm();
    el('ord-return-modal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  /** A fake return has no stock, so it asks what was inside instead. */
  function syncReturnForm() {
    const fake = el('ord-ret-type').value === RETURN_TYPES.FAKE_RETURN;
    el('ord-ret-found-wrap').classList.toggle('hidden', !fake);
    el('ord-ret-condition-wrap').classList.toggle('hidden', fake);
    el('ord-ret-effect').textContent = fake
      ? 'No stock is added — the product did not come back.'
      : 'This adds the piece to the Returns & RTO register as usable stock.';
    el('ord-ret-effect').className = fake ? 'ord-effect ord-effect-bad' : 'ord-effect ord-effect-ok';
  }

  async function saveReturn() {
    if (!openDispatch) return;
    const { dispatchPatch, returnRow, error } = applyReturn(openDispatch, {
      returnId: el('ord-ret-id').value,
      type: el('ord-ret-type').value,
      foundInside: el('ord-ret-found').value,
      condition: el('ord-ret-condition').value,
      date: el('ord-ret-date').value
    });
    if (error) { notify.error(error); return; }

    const btn = el('ord-ret-save');
    btn.disabled = true;
    try {
      // The record first, then the stock — the order used everywhere else,
      // so a failure leaves a visible record rather than phantom stock.
      await store.updateDispatch(openDispatch.id, dispatchPatch);
      if (returnRow) {
        await store.addMyntraReturns([returnRow]);
        await state.refreshReturns?.();
        notify.success(`${RETURN_TYPE_LABELS[dispatchPatch.return.type]} recorded — ${returnRow.qty} pc(s) back in the register`);
      } else {
        notify.warning(`Fake return recorded against ${openDispatch.customer?.label || 'this customer'} — no stock added`);
      }
      closeReturnModal();
      await refresh();
    } catch (err) {
      notify.error('Could not save: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ═══════════ Row actions ═══════════

  function onTableClick(e) {
    const th = e.target.closest('th[data-sort]');
    if (th) { state.helpers.toggleSort(view, th.dataset.sort); render(); return; }

    const btn = e.target.closest('button[data-ord-action]');
    if (!btn) return;
    const d = dispatches.find(x => x.id === btn.dataset.ordId);
    if (!d) return;

    switch (btn.dataset.ordAction) {
      case 'open':
        openReturnModal(d);
        break;
      case 'unfulfillable': {
        const reason = prompt(`Why can ${d.forwardId} not be shipped?`, d.unfulfillableReason || 'Supplier did not send it');
        if (reason === null) return;
        store.markDispatchUnfulfillable(d.id, reason)
          .then(() => { notify.success(`${d.forwardId} marked unfulfillable`); return refresh(); })
          .catch(err => notify.error('Failed: ' + err.message));
        break;
      }
      case 'delete':
        if (!confirm(`Delete the record for ${d.forwardId}? Any stock it already added stays in the register.`)) return;
        store.deleteDispatch(d.id)
          .then(() => { notify.success('Record deleted'); return refresh(); })
          .catch(err => notify.error('Delete failed: ' + err.message));
        break;
    }
  }

  // ═══════════ Render ═══════════

  const exportRows = () => filtered().map(d => ({
    forwardId: d.forwardId,
    orderId: d.orderId,
    customerName: d.customer?.name || '',
    customerKey: d.customer?.keyType || '',
    sellerSkuCode: d.sellerSkuCode,
    colourName: d.colourName,
    qty: d.qty,
    dispatchDate: d.dispatchDate,
    status: d.status,
    returnType: d.return?.type ? RETURN_TYPE_LABELS[d.return.type] : '',
    returnId: d.return?.returnId || '',
    foundInside: d.return?.foundInside || ''
  }));

  function matches(d) {
    if (view.status === 'shipped' && d.status !== DISPATCH_STATUS.SHIPPED) return false;
    if (view.status === 'returned' && d.status !== DISPATCH_STATUS.RETURNED) return false;
    if (view.status === 'unfulfillable' && d.status !== DISPATCH_STATUS.UNFULFILLABLE) return false;
    if (view.status === 'fake' && d.return?.type !== RETURN_TYPES.FAKE_RETURN) return false;
    if (view.status === 'incomplete' && !(d.missing?.length)) return false;

    const q = view.q.toLowerCase();
    if (!q) return true;
    return [d.forwardId, d.orderId, d.customer?.name, d.customer?.address,
            d.sellerSkuCode, d.colourName, d.return?.returnId]
      .some(v => String(v ?? '').toLowerCase().includes(q));
  }

  const filtered = () => state.helpers.applySort(
    dispatches.filter(matches), view,
    (d, k) => k === 'qty' ? (Number(d.qty) || 0) : String(d[k] ?? ''));

  function render() {
    const shipped = dispatches.filter(d => d.status === DISPATCH_STATUS.SHIPPED).length;
    const returned = dispatches.filter(d => d.status === DISPATCH_STATUS.RETURNED).length;
    const fake = dispatches.filter(d => d.return?.type === RETURN_TYPES.FAKE_RETURN).length;
    const incomplete = dispatches.filter(d => d.missing?.length).length;

    const box = el('ord-summary');
    box.classList.toggle('hidden', dispatches.length === 0);
    const chip = (status, label, value, color) => {
      const on = view.status === status;
      return `<button data-status="${status}" class="bg-gradient-to-br ${color} border rounded-2xl p-3 text-center transition ${on ? 'ring-2 ring-emerald-400/60' : 'hover:brightness-125'}">
        <p class="text-xl font-bold text-white">${value}</p>
        <p class="text-slate-500 text-xs mt-0.5">${label}</p>
      </button>`;
    };
    box.innerHTML =
      chip('all', 'Orders', dispatches.length, 'from-blue-500/10 border-blue-500/20') +
      chip('shipped', 'Out', shipped, 'from-emerald-500/10 border-emerald-500/20') +
      chip('returned', 'Came Back', returned, 'from-amber-500/10 border-amber-500/20') +
      chip('fake', 'Fake Returns', fake, 'from-red-500/10 border-red-500/20') +
      chip('incomplete', 'Need Details', incomplete, 'from-purple-500/10 border-purple-500/20');

    renderOffenders();

    const rows = filtered();
    el('ord-count').textContent = dispatches.length ? `${rows.length} of ${dispatches.length} orders` : '';

    const tableEl = el('ord-table');
    if (!dispatches.length) {
      tableEl.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">Nothing tracked yet — drop a label in the Purchase tab, or add an order by hand.</p>`;
      return;
    }
    if (!rows.length) {
      tableEl.innerHTML = `<p class="text-slate-500 text-sm text-center py-6">No orders match the current filters.</p>`;
      return;
    }

    const th = state.helpers.thSort;
    tableEl.innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-xs uppercase tracking-wide border-b border-white/5">
          ${th(view, 'forwardId', 'Forward ID')}
          ${th(view, 'sellerSkuCode', 'SellerSkuCode')}
          <th class="text-left px-4 py-2.5">Colour</th>
          ${th(view, 'qty', 'Qty', true)}
          <th class="text-left px-4 py-2.5">Customer</th>
          ${th(view, 'dispatchDate', 'Dispatched')}
          <th class="text-left px-4 py-2.5">Status</th>
          <th class="px-4 py-2.5"></th>
        </tr></thead>
        <tbody>${rows.map(d => `
          <tr class="border-b border-white/5 hover:bg-white/[0.02] ${d.return?.type === RETURN_TYPES.FAKE_RETURN ? 'ord-row-fake' : ''}">
            <td class="px-4 py-2 text-slate-200 font-medium whitespace-nowrap zm-mono">${esc(d.forwardId) || '<span class="ord-flag">no tracking ID</span>'}</td>
            <td class="px-4 py-2 text-slate-300">${esc(d.sellerSkuCode) || '—'}</td>
            <td class="px-4 py-2">${d.colourName ? swatchDot(d.colourName) + ' ' + esc(d.colourName) : '<span class="zm-muted">—</span>'}</td>
            <td class="px-4 py-2 text-right text-slate-200 font-semibold">${d.qty}</td>
            <td class="px-4 py-2 text-slate-400 max-w-[180px] truncate" title="${esc(d.customer?.address || '')}">
              ${esc(d.customer?.name || d.customer?.label || '—')}
              ${d.customer?.keyType && d.customer.keyType !== 'name' ? `<span class="ord-keytype">${esc(d.customer.keyType)}</span>` : ''}
            </td>
            <td class="px-4 py-2 text-slate-500 whitespace-nowrap">${esc(formatDateDisplay(d.dispatchDate) || d.dispatchDate) || '—'}</td>
            <td class="px-4 py-2">${statusChip(d)}</td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button data-ord-action="open" data-ord-id="${esc(d.id)}" class="btn-secondary text-xs py-1.5 px-2.5" title="Record a return">Open</button>
              <button data-ord-action="unfulfillable" data-ord-id="${esc(d.id)}" class="text-slate-600 hover:text-amber-400 transition ml-2" title="Cannot be shipped"><i data-lucide="ban" class="w-3.5 h-3.5"></i></button>
              <button data-ord-action="delete" data-ord-id="${esc(d.id)}" class="text-slate-600 hover:text-red-400 transition ml-1" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    if (window.lucide) lucide.createIcons();
  }

  function statusChip(d) {
    if (d.status === DISPATCH_STATUS.UNFULFILLABLE) {
      return `<span class="level-low text-xs" title="${esc(d.unfulfillableReason || '')}">unfulfillable</span>`;
    }
    if (d.return?.type) {
      const cls = d.return.type === RETURN_TYPES.FAKE_RETURN ? 'level-low'
        : d.return.type === RETURN_TYPES.RTO ? 'level-medium' : 'level-medium';
      return `<span class="${cls} text-xs">${esc(RETURN_TYPE_LABELS[d.return.type])}</span>`;
    }
    if (d.missing?.length) return `<span class="ord-flag">needs ${esc(d.missing.join(', '))}</span>`;
    return `<span class="level-high text-xs">out</span>`;
  }

  function renderOffenders() {
    const { rows, totals } = offenderSummary(dispatches);
    const box = el('ord-offenders');
    const flagged = rows.filter(r => r.flagged);
    box.classList.toggle('hidden', rows.length === 0);
    if (!rows.length) return;

    el('ord-offenders-count').textContent =
      `${totals.customers} customer(s) · ${totals.fakeReturn} fake return(s)` +
      (totals.flagged ? ` · ${totals.flagged} flagged` : '');

    const shown = flagged.length ? flagged : rows.slice(0, 8);
    el('ord-offenders-table').innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-xs uppercase tracking-wide border-b border-white/5">
          <th class="text-left px-4 py-2.5">Customer</th>
          <th class="text-left px-4 py-2.5">Grouped by</th>
          <th class="text-right px-4 py-2.5">Orders</th>
          <th class="text-right px-4 py-2.5">RTO</th>
          <th class="text-right px-4 py-2.5">Returns</th>
          <th class="text-right px-4 py-2.5">Fake</th>
          <th class="text-right px-4 py-2.5">Rate</th>
        </tr></thead>
        <tbody>${shown.map(r => `
          <tr class="border-b border-white/5 hover:bg-white/[0.02] ${r.flagged ? 'ord-row-fake' : ''}">
            <td class="px-4 py-2.5 text-slate-200 font-medium max-w-[240px] truncate" title="${esc(r.label)}">${esc(r.label)}</td>
            <td class="px-4 py-2.5"><span class="ord-keytype">${esc(r.keyType)}</span></td>
            <td class="px-4 py-2.5 text-right text-slate-300">${r.orders}</td>
            <td class="px-4 py-2.5 text-right ${r.rto ? 'text-amber-300' : 'text-slate-600'}">${r.rto}</td>
            <td class="px-4 py-2.5 text-right ${r.customerReturn ? 'text-amber-300' : 'text-slate-600'}">${r.customerReturn}</td>
            <td class="px-4 py-2.5 text-right ${r.fakeReturn ? 'text-red-400 font-bold' : 'text-slate-600'}">${r.fakeReturn}</td>
            <td class="px-4 py-2.5 text-right ${r.rate >= 0.5 ? 'text-red-400' : 'text-slate-400'}">${Math.round(r.rate * 100)}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${!flagged.length ? '<p class="text-slate-600 text-xs px-4 py-2">Nobody is over the threshold — showing the busiest customers.</p>' : ''}`;
  }

  function renderConfirm() {
    const p = pending;
    const box = el('ord-confirm');
    box.classList.remove('hidden');
    const incomplete = p.merged.filter(m => m.missing?.length).length;
    el('ord-confirm-note').textContent =
      `${p.merged.length} parcel(s) from ${p.fileName}` +
      (incomplete ? ` · ${incomplete} missing some details` : '') +
      (p.withoutTrackingId.length ? ` · ${p.withoutTrackingId.length} page(s) with no tracking ID` : '');

    el('ord-confirm-table').innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-[10px] uppercase tracking-wide border-b border-white/5">
          <th class="px-3 py-2 text-left">Keep</th>
          <th class="px-3 py-2 text-left">Forward ID</th>
          <th class="px-3 py-2 text-left">SellerSku</th>
          <th class="px-3 py-2 text-right">Qty</th>
          <th class="px-3 py-2 text-left">Customer</th>
          <th class="px-3 py-2 text-left">Missing</th>
        </tr></thead>
        <tbody>${p.merged.map((m, i) => `
          <tr class="border-b border-white/5">
            <td class="px-3 py-1.5"><input type="checkbox" data-ord-keep="${i}" ${m._keep === false ? '' : 'checked'} class="accent-emerald-500"></td>
            <td class="px-3 py-1.5 text-slate-200 zm-mono">${esc(m.forwardId)}</td>
            <td class="px-3 py-1.5 text-slate-400">${esc(m.sellerSkuCode) || '—'}</td>
            <td class="px-3 py-1.5 text-right text-slate-300">${m.qty}</td>
            <td class="px-3 py-1.5 text-slate-400 max-w-[160px] truncate">${esc(m.customer?.name || m.customer?.label || '—')}</td>
            <td class="px-3 py-1.5">${m.missing?.length ? `<span class="ord-flag">${esc(m.missing.join(', '))}</span>` : '<span class="zm-muted">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    el('ord-confirm-table').onchange = e => {
      const cb = e.target.closest('input[data-ord-keep]');
      if (cb) pending.merged[+cb.dataset.ordKeep]._keep = cb.checked;
    };
  }

  return { render, refresh, ingestLabel, closeReturnModal, getDispatches: () => dispatches };
}
