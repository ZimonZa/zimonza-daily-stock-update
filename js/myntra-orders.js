// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Orders & Returns
// Who received what, what came back, and who keeps sending back
// empty boxes.
// ═══════════════════════════════════════════════════════════════

import { RETURN_TYPES, RETURN_TYPE_LABELS, DISPATCH_STATUS } from './constants.js';
import {
  dispatchesFromLabel, mergeByForwardId, applyReturn, offenderSummary, offenderKey,
  classifyAgainstSaved, rekeyDispatch
} from './myntra-dispatch.js';
import { parseLabelPdf } from './myntra-labels.js';
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
  // Same dropzone helpers the Purchase and Returns uploads use, so
  // drag-over and click-to-browse behave identically everywhere.
  state.helpers.bindDrop(el('ord-drop'), el('ord-file'), onLabelFile);
  state.helpers.resetDrop(el('ord-drop'), 'Myntra label.pdf — one page per parcel');

  el('ord-confirm-save').addEventListener('click', commitLabel);
  el('ord-confirm-cancel').addEventListener('click', () => {
    pending = null;
    el('ord-confirm').classList.add('hidden');
  });
  // Delegated once, on the container — the rows are redrawn, the container
  // is not, so this never accumulates duplicate listeners.
  el('ord-confirm-table').addEventListener('input', onReviewEdit);
  el('ord-confirm-table').addEventListener('change', onReviewEdit);

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
   * Read a label dropped on THIS tab. The Purchase tab still calls
   * `ingestLabel` with its own parse, so there is one review either way.
   */
  async function onLabelFile(file) {
    const drop = el('ord-drop');
    const hint = 'Myntra label.pdf — one page per parcel';
    drop.innerHTML = `<p class="text-slate-300 text-sm font-medium">Reading ${esc(file.name)}…</p>
      <p id="ord-drop-progress" class="text-slate-500 text-xs mt-1">page 1</p>`;
    try {
      const force = !!el('ord-force-barcode')?.checked;
      const result = await parseLabelPdf(file, state.mappings, (p, total) => {
        const line = el('ord-drop-progress');
        if (line) {
          line.textContent = force
            ? `reading the barcode on page ${p} of ${total}…`
            : `page ${p} of ${total}`;
        }
      }, { forceBarcode: force });

      // Say which of the ways in actually failed, rather than guessing at
      // the cause on the user's behalf.
      const anyId = (result.pageRecords || []).some(r => r.forwardId);
      if (!result.hasTextLayer && !anyId) {
        notify.error('This PDF has no text layer and no barcode could be decoded — nothing to read.');
        state.helpers.resetDrop(drop, hint);
        return;
      }

      reportBarcodes(result, anyId);
      ingestLabel(result, file.name);
      state.helpers.resetDrop(drop, hint);
    } catch (err) {
      notify.error('Could not read the label PDF: ' + err.message);
      state.helpers.resetDrop(drop, hint);
    }
  }

  /**
   * Say what the barcode reader actually did.
   *
   * A decoder that quietly returns nothing is indistinguishable from a
   * label that carries no barcode, and the difference matters: one is the
   * label, the other is a bug worth reporting.
   */
  function reportBarcodes(result, anyId) {
    const read = result.barcodePages?.length || 0;
    const failed = result.barcodeFailures || [];
    const clash = result.barcodeMismatchPages || [];

    if (!anyId) {
      notify.warning(`No tracking ID found on any of ${result.pages} page(s) — not in the text, not in a barcode. The rows are listed anyway; type the IDs in.`);
    } else if (read) {
      notify.info(`${read} tracking ID(s) confirmed from the barcode.`);
    }

    if (clash.length) {
      notify.error(`Page(s) ${clash.join(', ')}: the printed number and the barcode DISAGREE. Neither was chosen for you — check those rows.`);
    }
    if (failed.length) {
      // One reason is enough; they are almost always all the same.
      const why = failed[0].reason;
      notify.warning(`Barcode unread on ${failed.length} page(s) — ${why}. Those rows use the printed number where there was one.`);
    }
  }

  /**
   * Turn a parse into the editable review.
   *
   * Pages with no tracking ID are listed too — dropping them and mentioning
   * it in a warning loses the parcel, which is worse than showing a row with
   * one blank field.
   */
  function ingestLabel(result, fileName) {
    const records = dispatchesFromLabel(result.pageRecords || [], { sourceFile: fileName });
    if (!records.length) { notify.warning('Nothing readable on any page of that PDF'); return; }

    const { merged, withoutTrackingId } = mergeByForwardId(records);
    const rows = classifyAgainstSaved([...merged, ...withoutTrackingId], dispatches);
    pending = { fileName, rows };
    renderConfirm();
  }

  async function commitLabel() {
    if (!pending) return;
    const keep = pending.rows.filter(r => r._keep && r._dupe !== 'locked');
    if (!keep.length) { notify.warning('Nothing ticked to save'); return; }

    const btn = el('ord-confirm-save');
    btn.disabled = true;
    try {
      const withId = keep.filter(r => r.forwardId.trim());
      const withoutId = keep.filter(r => !r.forwardId.trim());

      let saved = 0;
      if (withId.length) saved += await store.saveDispatches(withId);
      // No tracking ID means no parcel to match a return against later, so
      // these are saved under a generated id and called out as incomplete.
      for (const row of withoutId) { await store.addDispatch(row); saved++; }

      notify.success(`${saved} order(s) saved from ${pending.fileName}`);
      if (withoutId.length) {
        notify.warning(`${withoutId.length} saved with no tracking ID — a return cannot find them until you add one.`);
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
          <th class="text-left px-4 py-2.5">Return ID</th>
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
            <td class="px-4 py-2 whitespace-nowrap zm-mono text-slate-300">${
              d.return?.returnId ? esc(d.return.returnId)
                : d.return?.type ? '<span class="ord-flag">no return ID</span>'
                : '<span class="zm-muted">—</span>'}</td>
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

  // Which row property each editable cell writes to. `customer.*` are
  // nested, and changing either of them re-keys the record.
  const EDIT_FIELDS = {
    forwardId: { path: 'forwardId', upper: true },
    orderId: { path: 'orderId', upper: true },
    sku: { path: 'sellerSkuCode' },
    qty: { path: 'qty', number: true },
    customer: { path: 'customer.name', rekey: true },
    address: { path: 'customer.address', rekey: true },
    date: { path: 'dispatchDate' }
  };

  const SOURCE_BADGE = {
    text: '<span class="ord-src" title="printed on the label">text</span>',
    barcode: '<span class="ord-src ord-src-bar" title="decoded from the barcode image">barcode</span>',
    'text+barcode': '<span class="ord-src ord-src-ok" title="the printed number and the barcode agree">text ✓ barcode</span>',
    'text-barcode-mismatch': '<span class="ord-src ord-src-clash" title="the printed number and the barcode do not match — check this one">text ≠ barcode</span>',
    guess: '<span class="ord-src ord-src-clash" title="no MY… number was printed on this page — this is the closest courier-shaped token found. Check it.">guess — check</span>',
    manual: '<span class="ord-src ord-src-man" title="you typed this">typed</span>'
  };

  function dupeFlag(r) {
    if (r._dupe === 'locked') {
      return `<span class="ord-lock" title="a return is already recorded against this parcel">🔒 ${esc(RETURN_TYPE_LABELS[r._existingReturn] || 'returned')} — locked</span>`;
    }
    if (r._dupe === 'exists') return '<span class="ord-dupe">already saved — tick to update</span>';
    return '';
  }

  function noteCell(r) {
    const dupe = dupeFlag(r);
    const missing = r.missing?.length ? `<span class="ord-flag">${esc(r.missing.join(', '))}</span>` : '';
    // No tracking ID means the page did not print one where we looked. Show
    // what it DID say, so the reason is visible rather than left to guesswork.
    const why = (!r.forwardId && r.pageTextSample)
      ? `<details class="ord-why"><summary>what the page said</summary><code>${esc(r.pageTextSample)}</code></details>`
      : '';
    return ((dupe + ' ' + missing).trim() || '<span class="zm-muted">—</span>') + why;
  }

  function renderConfirm() {
    const p = pending;
    const box = el('ord-confirm');
    box.classList.remove('hidden');

    const noId = p.rows.filter(r => !r.forwardId).length;
    const locked = p.rows.filter(r => r._dupe === 'locked').length;
    const dupes = p.rows.filter(r => r._dupe === 'exists').length;
    el('ord-confirm-note').textContent =
      `${p.rows.length} parcel(s) from ${p.fileName}` +
      (noId ? ` · ${noId} with no tracking ID` : '') +
      (dupes ? ` · ${dupes} already saved` : '') +
      (locked ? ` · ${locked} locked (already returned)` : '') +
      ' · edit anything below before saving';

    el('ord-sku-list').innerHTML = state.mappings
      .map(m => `<option value="${esc(m.sellerSkuCode)}"></option>`).join('');

    // One class attribute only — a second one is ignored by the parser, so
    // the per-column width has to be merged in here rather than appended.
    const cell = (i, field, value, cls = '', attrs = '') =>
      `<input data-ord-edit="${field}" data-ord-i="${i}" value="${esc(value)}" ${attrs}
        class="ord-cell ${cls}${value ? '' : ' ord-cell-empty'}">`;

    el('ord-confirm-table').innerHTML = `
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-slate-900"><tr class="text-slate-500 text-[10px] uppercase tracking-wide border-b border-white/5">
          <th class="px-2 py-2 text-left">Keep</th>
          <th class="px-2 py-2 text-left">Forward tracking ID</th>
          <th class="px-2 py-2 text-left">Order ID</th>
          <th class="px-2 py-2 text-left">SellerSkuCode</th>
          <th class="px-2 py-2 text-left">Qty</th>
          <th class="px-2 py-2 text-left">Customer</th>
          <th class="px-2 py-2 text-left">Delivery address</th>
          <th class="px-2 py-2 text-left">Dispatched</th>
          <th class="px-2 py-2 text-left">Notes</th>
        </tr></thead>
        <tbody>${p.rows.map((r, i) => `
          <tr class="border-b border-white/5${r._dupe === 'locked' ? ' ord-row-locked' : ''}">
            <td class="px-2 py-1.5">
              <input type="checkbox" data-ord-keep="${i}" ${r._keep ? 'checked' : ''}
                ${r._dupe === 'locked' ? 'disabled' : ''} class="accent-emerald-500">
            </td>
            <td class="px-2 py-1.5 whitespace-nowrap">
              ${cell(i, 'forwardId', r.forwardId, 'zm-mono w-44', 'placeholder="type the number"')}
              ${SOURCE_BADGE[r.forwardIdSource] || ''}
            </td>
            <td class="px-2 py-1.5">${cell(i, 'orderId', r.orderId, 'w-32')}</td>
            <td class="px-2 py-1.5">${cell(i, 'sku', r.sellerSkuCode, 'w-40', 'list="ord-sku-list" autocomplete="off"')}</td>
            <td class="px-2 py-1.5">${cell(i, 'qty', r.qty, 'w-16', 'type="number" min="1"')}</td>
            <td class="px-2 py-1.5">${cell(i, 'customer', r.customer?.name || '', 'w-36', 'placeholder="masked on label"')}</td>
            <td class="px-2 py-1.5">${cell(i, 'address', r.customer?.address || '', 'w-48')}</td>
            <td class="px-2 py-1.5">${cell(i, 'date', r.dispatchDate, 'w-36', 'type="date"')}</td>
            <td class="px-2 py-1.5" data-ord-note="${i}">${noteCell(r)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

  }

  /** Every edit lands on the pending row and nowhere else until Save. */
  function onReviewEdit(e) {
    const cb = e.target.closest('input[data-ord-keep]');
    if (cb) { pending.rows[+cb.dataset.ordKeep]._keep = cb.checked; return; }

    const input = e.target.closest('input[data-ord-edit]');
    if (!input) return;
    const row = pending.rows[+input.dataset.ordI];
    if (!row) return;
    const spec = EDIT_FIELDS[input.dataset.ordEdit];
    if (!spec) return;

    let value = input.value.trim();
    if (spec.upper) value = value.toUpperCase();

    if (spec.number) {
      row.qty = Math.max(1, Math.floor(Number(value) || 1));
    } else if (spec.path.startsWith('customer.')) {
      row.customer = { ...(row.customer || {}), [spec.path.slice(9)]: value };
    } else {
      row[spec.path] = value;
      if (spec.path === 'sellerSkuCode') {
        // A corrected SKU has to bring its ZM code and colour with it, or the
        // record points at a style that does not exist.
        const known = state.mappings.find(m =>
          String(m.sellerSkuCode).toLowerCase() === value.toLowerCase());
        row.zmCode = known?.zmCode || '';
        row.colourName = known?.colourName || '';
      }
      if (spec.path === 'forwardId') {
        row.forwardIdSource = value ? 'manual' : '';
        // A typed ID can collide with something already saved, so the
        // duplicate state is re-tested rather than left at what the file said.
        const before = row._dupe;
        Object.assign(row, classifyAgainstSaved([{ ...row, _keep: row._keep }], dispatches)[0]);
        // Re-classifying can untick the row. The checkbox has to follow, or
        // the screen says "will save" while the state says otherwise.
        if (row._dupe !== before) refreshRowState(+input.dataset.ordI, row);
      }
    }

    // Re-key on a name or address change, then clear the flags for whatever
    // is now filled in.
    if (spec.rekey || spec.path === 'orderId') Object.assign(row, rekeyDispatch(row));
    row.missing = (row.missing || []).filter(f => {
      if (f === 'forwardId') return !row.forwardId;
      if (f === 'orderId') return !row.orderId;
      if (f === 'customerName') return !row.customer?.name;
      if (f === 'address') return !row.customer?.address;
      return true;
    });

    const note = el('ord-confirm-table').querySelector?.(`[data-ord-note="${input.dataset.ordI}"]`);
    if (note) note.innerHTML = noteCell(row);
    renderConfirmMeta();
  }

  /**
   * Bring one row's tick box and warning back in line with its state, without
   * redrawing the table — you may be mid-word in one of its inputs.
   */
  function refreshRowState(i, row) {
    const table = el('ord-confirm-table');
    const cb = table.querySelector?.(`input[data-ord-keep="${i}"]`);
    if (cb) {
      cb.checked = !!row._keep;
      cb.disabled = row._dupe === 'locked';
    }
    const tr = cb?.closest?.('tr');
    if (tr) tr.classList.toggle('ord-row-locked', row._dupe === 'locked');
  }

  /** Redraw only the parts that change as you type — never the inputs. */
  function renderConfirmMeta() {
    const p = pending;
    if (!p) return;
    const noId = p.rows.filter(r => !r.forwardId).length;
    const dupes = p.rows.filter(r => r._dupe === 'exists').length;
    const locked = p.rows.filter(r => r._dupe === 'locked').length;
    el('ord-confirm-note').textContent =
      `${p.rows.length} parcel(s) from ${p.fileName}` +
      (noId ? ` · ${noId} with no tracking ID` : '') +
      (dupes ? ` · ${dupes} already saved` : '') +
      (locked ? ` · ${locked} locked (already returned)` : '') +
      ` · ${p.rows.filter(r => r._keep && r._dupe !== 'locked').length} ticked to save`;
  }

  return {
    render, refresh, ingestLabel, closeReturnModal,
    getDispatches: () => dispatches,
    getPendingRows: () => pending?.rows || []
  };
}
