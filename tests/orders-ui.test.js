// Drives the real Orders tab handlers through a fake DOM with recorded
// listeners. The rule under test: a genuine return puts stock back, a fake
// return does not.

const store = new Map();
const writes = { dispatches: [], added: [], returns: [], updates: [] };

function mkEl(id) {
  const listeners = {};
  const e = {
    id, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    dataset: {}, style: {}, _listeners: listeners,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {}, appendChild() {}, remove() {}, click() {}, focus() {},
    // Stand-ins the module can find, so DOM writes back into the table are
    // observable instead of silently landing on null.
    _found: new Map(),
    querySelector(sel) {
      if (!this._found.has(sel)) {
        const child = mkEl(sel);
        child.closest = () => mkEl('tr');
        this._found.set(sel, child);
      }
      return this._found.get(sel);
    },
    querySelectorAll() { return []; }, closest() { return null; },
    fire(t, ev) { (listeners[t] || []).forEach(fn => fn(ev)); }
  };
  return e;
}
globalThis.localStorage = { _d: new Map(), getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }, setItem(k, v) { this._d.set(k, String(v)); }, removeItem(k) { this._d.delete(k); } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.CSS = { escape: s => String(s) };
globalThis.document = {
  getElementById: id => { if (!store.has(id)) store.set(id, mkEl(id)); return store.get(id); },
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('tmp'), addEventListener() {}, body: { appendChild() {} },
  documentElement: { classList: { toggle() {}, add() {}, remove() {} } }
};
globalThis.window = globalThis;
globalThis.lucide = { createIcons() {} };
globalThis.confirm = () => true;
globalThis.prompt = () => 'Supplier never sent it';

// Stand in for Firestore, so we can see exactly what would be written.
// The payload builder is the real one the service uses — testing the stub's
// own idea of a payload would prove nothing about what reaches the database.
const { dispatchWritePayload } = await import('./myntra-dispatch.js');

let DISPATCHES = [];
const storage = {
  getAllDispatches: async () => DISPATCHES,
  saveDispatches: async (rs) => { writes.dispatches.push(...rs.map(dispatchWritePayload)); return rs.length; },
  addDispatch: async (r) => { writes.added.push(dispatchWritePayload(r)); return 'new'; },
  updateDispatch: async (id, patch) => {
    writes.updates.push({ id, patch });
    const d = DISPATCHES.find(x => x.id === id);
    if (d) Object.assign(d, patch);
  },
  addMyntraReturns: async (rows) => { writes.returns.push(...rows); },
  deleteDispatch: async () => {},
  markDispatchUnfulfillable: async () => {}
};

const { initOrdersTab } = await import('./myntra-orders.js');
const { RETURN_TYPES, DISPATCH_STATUS } = await import('./constants.js');
const { default: notify } = await import('./notifications.js');

const state = {
  storage,
  mappings: [{ sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11', colourName: 'Purple' }],
  pricing: [],
  helpers: {
    toggleSort(v, k) { v.sortKey === k ? v.sortDir *= -1 : (v.sortKey = k, v.sortDir = 1); },
    applySort(rows) { return rows; },
    thSort: (v, k, l) => `<th data-sort="${k}">${l}</th>`,
    bindDrop() {},
    resetDrop() {}
  },
  refreshReturns: async () => {},
  onOrdersChange() {}
};

let fails = 0;
const chk = (name, cond, extra = '') => { if (cond) console.log(`  ok  ${name}`); else { fails++; console.log(`  FAIL ${name} ${extra}`); } };
const el = id => document.getElementById(id);

const tab = initOrdersTab(state);

// ── A label arrives ──
const labelResult = {
  pages: 3,
  pageRecords: [
    { page: 1, forwardId: 'SF001', orderId: 'O1', customerName: 'Priya Sharma', address: 'Mumbai 400053',
      missing: [], sku: { sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11', colourName: 'Purple' } },
    { page: 2, forwardId: 'SF002', orderId: 'O2', customerName: '', address: 'Delhi 110085',
      missing: ['customerName'], sku: { sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11', colourName: 'Purple' } },
    { page: 3, forwardId: '', orderId: 'O3', customerName: 'Ravi Kumar', address: '',
      missing: ['forwardId', 'address'], sku: { sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11', colourName: 'Purple' } }
  ]
};
tab.ingestLabel(labelResult, 'label.pdf');

chk('the review panel opens', !el('ord-confirm').classList.contains('hidden'));
chk('two parcels listed', el('ord-confirm-table').innerHTML.includes('SF001') && el('ord-confirm-table').innerHTML.includes('SF002'));
chk('a missing field is flagged, not hidden', el('ord-confirm-table').innerHTML.includes('customerName'));
chk('the page with no tracking id is reported',
  el('ord-confirm-note').textContent.includes('no tracking ID'), el('ord-confirm-note').textContent);

// THE CHANGE: a page with no tracking ID is listed for you to complete,
// not dropped with a warning. Losing a parcel is worse than a blank cell.
chk('every page reaches the review, including the one with no ID',
  el('ord-confirm-table').innerHTML.split('data-ord-keep').length - 1 === 3,
  String(el('ord-confirm-table').innerHTML.split('data-ord-keep').length - 1));
chk('every field is editable', /data-ord-edit="address"/.test(el('ord-confirm-table').innerHTML));
chk('the tracking ID says where it came from', /ord-src/.test(el('ord-confirm-table').innerHTML));

await el('ord-confirm-save')._listeners.click[0]();
chk('the two keyed parcels save together', writes.dispatches.length === 2, String(writes.dispatches.length));
chk('the page with no tracking ID is still saved, on its own',
  writes.added.length === 1 && !writes.added[0].forwardId, JSON.stringify(writes.added.map(d => d.forwardId)));

// ── Now they exist; record returns against them ──
DISPATCHES = [
  { id: 'd1', forwardId: 'SF001', orderId: 'O1', sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11',
    colourName: 'Purple', qty: 1, dispatchDate: '2026-09-01', status: DISPATCH_STATUS.SHIPPED, return: null,
    customer: { name: 'Priya Sharma', address: 'Mumbai 400053', key: 'name:priya sharma', keyType: 'name', label: 'Priya Sharma' }, missing: [] },
  { id: 'd2', forwardId: 'SF002', orderId: 'O2', sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11',
    colourName: 'Purple', qty: 2, dispatchDate: '2026-09-01', status: DISPATCH_STATUS.SHIPPED, return: null,
    customer: { name: '', address: 'Delhi 110085', key: 'addr:delhi 110085', keyType: 'address', label: 'Delhi 110085' }, missing: ['customerName'] }
];
await tab.refresh();
chk('orders render', el('ord-table').innerHTML.includes('SF001'));
chk('a key type that is not a name is shown', el('ord-table').innerHTML.includes('ord-keytype'));

// ── A FAKE return: no stock may be created ──
writes.returns.length = 0; writes.updates.length = 0;
el('ord-table').fire('click', {
  target: { closest: sel => sel === 'button[data-ord-action]' ? { dataset: { ordAction: 'open', ordId: 'd1' } } : null }
});
chk('the return modal opens', !el('ord-return-modal').classList.contains('hidden'));

el('ord-ret-type').value = RETURN_TYPES.FAKE_RETURN;
el('ord-ret-type').fire('change', {});
chk('a fake return asks what was inside', !el('ord-ret-found-wrap').classList.contains('hidden'));
chk('and stops asking about condition', el('ord-ret-condition-wrap').classList.contains('hidden'));
chk('the consequence is stated before saving',
  /No stock is added/i.test(el('ord-ret-effect').textContent), el('ord-ret-effect').textContent);

el('ord-ret-id').value = 'R-FAKE-1';
el('ord-ret-found').value = 'empty box';
await el('ord-ret-save')._listeners.click[0]();

chk('THE RULE: a fake return creates NO stock row', writes.returns.length === 0, JSON.stringify(writes.returns));
chk('but the dispatch is still marked returned',
  writes.updates.some(u => u.id === 'd1' && u.patch.status === DISPATCH_STATUS.RETURNED));
chk('and what was inside is recorded',
  writes.updates.some(u => u.patch.return?.foundInside === 'empty box'));

// ── A GENUINE return: stock must come back ──
writes.returns.length = 0; writes.updates.length = 0;
el('ord-table').fire('click', {
  target: { closest: sel => sel === 'button[data-ord-action]' ? { dataset: { ordAction: 'open', ordId: 'd2' } } : null }
});
el('ord-ret-type').value = RETURN_TYPES.CUSTOMER_RETURN;
el('ord-ret-type').fire('change', {});
chk('a genuine return asks the condition instead', !el('ord-ret-condition-wrap').classList.contains('hidden'));
chk('and says stock will be added', /usable stock/i.test(el('ord-ret-effect').textContent));

el('ord-ret-id').value = 'R-REAL-1';
el('ord-ret-condition').value = 'good';
await el('ord-ret-save')._listeners.click[0]();

chk('THE RULE: a genuine return DOES create a stock row', writes.returns.length === 1, String(writes.returns.length));
chk('the quantity follows the parcel', writes.returns[0]?.qty === 2, String(writes.returns[0]?.qty));
chk('the row links back to the dispatch', writes.returns[0]?.dispatchId === 'd2');
chk('the condition is carried', writes.returns[0]?.condition === 'good');

// ── Closing the modal must release the parcel it was holding ──
writes.returns.length = 0; writes.updates.length = 0;
el('ord-table').fire('click', {
  target: { closest: sel => sel === 'button[data-ord-action]' ? { dataset: { ordAction: 'open', ordId: 'd2' } } : null }
});
tab.closeReturnModal();                       // what Esc and Cancel both call
chk('closing hides the modal', el('ord-return-modal').classList.contains('hidden'));
el('ord-ret-type').value = RETURN_TYPES.RTO;
el('ord-ret-id').value = 'R-STALE';
await el('ord-ret-save')._listeners.click[0]();
chk('a save after closing writes nothing', writes.updates.length === 0 && writes.returns.length === 0,
  JSON.stringify(writes.updates));

// ── The offender table ──
DISPATCHES[0].return = { type: RETURN_TYPES.FAKE_RETURN, returnId: 'R-FAKE-1' };
DISPATCHES[0].status = DISPATCH_STATUS.RETURNED;
await tab.refresh();
const offenders = el('ord-offenders-table').innerHTML;
chk('the fake returner is listed', offenders.includes('Priya Sharma'));
chk('their fake count shows', /ord-row-fake/.test(offenders));
chk('the grouping basis is visible', offenders.includes('ord-keytype'));

// ══════════════════════════════════════════════════════════════
// THE HEADLINE: dropping the same label file twice must never erase
// a return. d1 now carries a FAKE RETURN — the single most expensive
// record in here to lose, because it is the evidence against a customer.
// ══════════════════════════════════════════════════════════════
writes.dispatches.length = 0; writes.added.length = 0;
// SF001 has a fake return (locked). Leave SF002 out on the road, so both
// duplicate states are exercised: one locked, one merely already-saved.
DISPATCHES[1].return = null;
DISPATCHES[1].status = DISPATCH_STATUS.SHIPPED;
await tab.refresh();
tab.ingestLabel(labelResult, 'label.pdf');           // the very same file

const review = el('ord-confirm-table').innerHTML;
chk('the returned parcel is shown as locked', /ord-lock/.test(review));
chk('and its tick box is disabled', /data-ord-keep="0"[^>]*disabled/.test(review) || /disabled[^>]*data-ord-keep="0"/.test(review), review.slice(0, 400));
chk('the already-saved parcel is flagged too', /ord-dupe/.test(review));
chk('nothing is ticked by default on a re-upload',
  el('ord-confirm-note').textContent.includes('2 already saved') ||
  el('ord-confirm-note').textContent.includes('locked'), el('ord-confirm-note').textContent);

await el('ord-confirm-save')._listeners.click[0]();
chk('THE RULE: a re-upload writes nothing over the returned parcel',
  !writes.dispatches.some(d => String(d.forwardId).toUpperCase() === 'SF001'),
  JSON.stringify(writes.dispatches.map(d => d.forwardId)));

// Now tick the non-returned duplicate and save it as a deliberate update
tab.ingestLabel(labelResult, 'label.pdf');
writes.dispatches.length = 0; writes.added.length = 0;
el('ord-confirm-table').fire('change', {
  target: { closest: sel => sel === 'input[data-ord-keep]' ? { dataset: { ordKeep: '1' }, checked: true } : null }
});
await el('ord-confirm-save')._listeners.click[0]();
const upd = writes.dispatches.find(d => String(d.forwardId).toUpperCase() === 'SF002');
chk('a ticked duplicate does save', !!upd, JSON.stringify(writes.dispatches.map(d => d.forwardId)));
chk('but the update carries no status', upd && !('status' in upd), JSON.stringify(upd && Object.keys(upd)));
chk('and no return field to wipe one with', upd && !('return' in upd));

// ── Editing the review ──
tab.ingestLabel(labelResult, 'label.pdf');
const editRow = (i, field, value) => el('ord-confirm-table').fire('input', {
  target: { closest: sel => sel === 'input[data-ord-edit]' ? { dataset: { ordEdit: field, ordI: String(i) }, value } : null }
});

// Row 2 is the page that had no tracking ID at all
editRow(2, 'customer', 'Asha Devi');
const edited = tab.getPendingRows()[2];
chk('a typed name reaches the row', edited.customer.name === 'Asha Devi');
chk('and re-groups the record', edited.customer.keyType === 'name', edited.customer.keyType);
chk('the filled field stops being flagged as missing',
  !edited.missing.includes('customerName'), JSON.stringify(edited.missing));
chk('a field left blank stays flagged', edited.missing.includes('forwardId'), JSON.stringify(edited.missing));

editRow(2, 'sku', 'ZM-11-Purple');
chk('a corrected SKU brings its ZM code with it', tab.getPendingRows()[2].zmCode === 'ZM-11');
editRow(2, 'qty', '4');
chk('quantity is taken as a number', tab.getPendingRows()[2].qty === 4);
editRow(2, 'qty', '-3');
chk('and never drops below one', tab.getPendingRows()[2].qty === 1);

// Typing an ID that belongs to an already-returned parcel must lock the row
editRow(2, 'forwardId', 'sf001');
const collided = tab.getPendingRows()[2];
chk('a typed ID that collides with a returned parcel locks the row',
  collided._dupe === 'locked', collided._dupe);
chk('and unticks it so it cannot be saved', collided._keep === false);
// The state is only half of it — the box on screen has to agree, or it
// reads as "will save" while nothing will.
const box = el('ord-confirm-table').querySelector('input[data-ord-keep="2"]');
chk('the tick box on screen follows the state', box.checked === false && box.disabled === true,
  `checked=${box.checked} disabled=${box.disabled}`);
chk('and the row says why', /ord-lock/.test(el('ord-confirm-table').querySelector('[data-ord-note="2"]').innerHTML));
chk('a typed ID is marked as typed, not as printed',
  tab.getPendingRows()[1].forwardIdSource !== 'manual' && collided.forwardIdSource === 'manual');

// ── Search finds a parcel by its tracking number ──
el('ord-search').value = 'sf002';
el('ord-search').fire('input', { target: { value: 'sf002' } });
await new Promise(r => setTimeout(r, 350));   // the search is debounced
chk('search by forward id narrows the table',
  el('ord-table').innerHTML.includes('SF002') && !el('ord-table').innerHTML.includes('SF001'),
  el('ord-count').textContent);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nOrders UI test clean.');
process.exit(fails ? 1 : 0);
