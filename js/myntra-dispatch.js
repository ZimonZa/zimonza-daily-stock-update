// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Dispatch records & return abuse analytics
//
// Every label page that goes out becomes a dispatch, keyed by its
// forward tracking ID. When a parcel comes back you find it by that ID,
// classify it, and — if the product genuinely came back — it becomes
// stock again.
//
// Pure functions only. Nothing here touches Firestore or the DOM.
// ═══════════════════════════════════════════════════════════════

import { DISPATCH_STATUS, RETURN_TYPES, isStockReturn } from './constants.js';
import { normZmCode, today } from './utils.js';

/**
 * Who to count a return against.
 *
 * Myntra masks customer names on many labels, so there is no single
 * reliable key. Best available wins, and `keyType` always says which one
 * was used — a count grouped by address must never read as a confirmed
 * person.
 */
export function offenderKey({ customerName, address, orderId } = {}) {
  const name = String(customerName ?? '').trim();
  if (name) return { key: `name:${name.toLowerCase().replace(/\s+/g, ' ')}`, keyType: 'name', label: name };

  const addr = String(address ?? '').trim();
  if (addr) {
    // Group on the PIN plus the distinctive part of the line, so minor
    // formatting drift in the same address still collapses together.
    const squashed = addr.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { key: `addr:${squashed}`, keyType: 'address', label: addr };
  }

  const order = String(orderId ?? '').trim();
  if (order) return { key: `order:${order.toLowerCase()}`, keyType: 'order', label: order };

  return { key: '', keyType: 'none', label: '' };
}

/**
 * Turn one parsed label page into a dispatch record.
 * A page with no tracking ID is still returned — flagged, so it can be
 * completed by hand rather than lost.
 */
export function dispatchFromPageRecord(rec, { sourceFile = '', dispatchDate = '' } = {}) {
  const fields = rec || {};
  const sku = fields.sku || null;
  // The layout reader also reads the bracketed code, e.g. [ZM-43-Rani - T].
  // It is the fallback for a SKU the mapping does not know yet, so an
  // unmapped style still lands on the record instead of vanishing.
  const sellerSkuCode = sku?.sellerSkuCode || fields.sellerSkuCode || '';
  const { key, keyType, label } = offenderKey({
    customerName: fields.customerName,
    address: fields.address,
    orderId: fields.orderId
  });

  return {
    forwardId: fields.forwardId || '',
    // Where the tracking ID came from: the printed digits, the barcode
    // image, or a person typing it in. Shown in the review so a decoded
    // value is never mistaken for one the label actually printed.
    forwardIdSource: fields.forwardIdSource || (fields.forwardId ? 'text' : ''),
    // What the page actually said, kept only when no ID was confidently
    // read, so a blank field can explain itself instead of just sitting there.
    pageTextSample: fields.pageTextSample || '',
    orderId: fields.orderId || '',
    customer: {
      name: fields.customerName || '',
      address: fields.address || '',
      key,
      keyType,
      label
    },
    sellerSkuCode,
    zmCode: sku ? normZmCode(sku.zmCode) : '',
    colourName: sku?.colourName || '',
    qty: 1,                                    // one label page is one piece
    dispatchDate: dispatchDate || today(),
    sourceFile,
    page: fields.page ?? null,
    status: DISPATCH_STATUS.SHIPPED,
    return: null,
    // What the label did not print, so the UI can ask rather than guess
    missing: Array.isArray(fields.missing) ? [...fields.missing] : []
  };
}

/** Build dispatch records from a whole parsed label file. */
export function dispatchesFromLabel(pageRecords, opts = {}) {
  return (pageRecords || []).map(r => dispatchFromPageRecord(r, opts));
}

/**
 * Merge label pages that are the same physical parcel.
 * Myntra prints one page per piece, so two pages sharing a tracking ID
 * are two pieces in one shipment.
 */
export function mergeByForwardId(dispatches) {
  const byId = new Map();
  const noId = [];

  for (const d of dispatches || []) {
    if (!d.forwardId) { noId.push(d); continue; }
    const existing = byId.get(d.forwardId);
    if (!existing) { byId.set(d.forwardId, { ...d, pages: d.page ? [d.page] : [] }); continue; }
    // Same parcel, another piece
    if (existing.sellerSkuCode === d.sellerSkuCode) {
      existing.qty += d.qty;
    } else {
      // Different SKUs under one tracking ID — keep both visible
      existing.mixedSkus = existing.mixedSkus || [existing.sellerSkuCode];
      if (!existing.mixedSkus.includes(d.sellerSkuCode)) existing.mixedSkus.push(d.sellerSkuCode);
      existing.qty += d.qty;
    }
    if (d.page) existing.pages.push(d.page);
  }

  return { merged: [...byId.values()], withoutTrackingId: noId };
}

/**
 * Record a return against a dispatch. PURE — returns what should be
 * written, and writes nothing itself.
 *
 * @returns {{ dispatchPatch:object, returnRow:object|null, error:string|null }}
 */
export function applyReturn(dispatch, { returnId, type, foundInside, date, condition } = {}) {
  if (!dispatch) {
    return { dispatchPatch: null, returnRow: null, error: 'No dispatch to return against' };
  }
  if (!type || !Object.values(RETURN_TYPES).includes(type)) {
    return { dispatchPatch: null, returnRow: null, error: 'Pick a return type' };
  }

  const when = date || today();
  const dispatchPatch = {
    status: DISPATCH_STATUS.RETURNED,
    return: {
      returnId: String(returnId ?? '').trim(),
      type,
      foundInside: String(foundInside ?? '').trim(),
      date: when
    }
  };

  // A fake return means the product did not come back. There is nothing to
  // put on a shelf, so no stock row is created — that is the whole point of
  // recording it separately.
  if (!isStockReturn(type)) {
    return { dispatchPatch, returnRow: null, error: null };
  }

  const returnRow = {
    type,
    sellerSkuCode: dispatch.sellerSkuCode || '',
    zmCode: normZmCode(dispatch.zmCode || ''),
    colourName: dispatch.colourName || '',
    kuntalCode: dispatch.kuntalCode || '',
    qty: Math.max(1, Number(dispatch.qty) || 1),
    date: when,
    condition: condition || '',
    reason: '',
    notes: `Return ${dispatchPatch.return.returnId || '(no id)'} against ${dispatch.forwardId || 'unknown parcel'}`,
    source: 'dispatch',
    dispatchId: dispatch.id || dispatch.forwardId || ''
  };

  return { dispatchPatch, returnRow, error: null };
}

/**
 * Group dispatches by customer and count what came back.
 * `flagAbove` is the return-rate at which a row is marked for attention.
 */
export function offenderSummary(dispatches, { flagAbove = 0.4, minOrders = 3 } = {}) {
  const groups = new Map();

  for (const d of dispatches || []) {
    const key = d.customer?.key;
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        keyType: d.customer.keyType,
        label: d.customer.label || d.customer.name || d.customer.address || d.orderId,
        orders: 0, pieces: 0,
        rto: 0, customerReturn: 0, fakeReturn: 0,
        dispatches: []
      });
    }
    const g = groups.get(key);
    g.orders += 1;
    g.pieces += Number(d.qty) || 1;
    g.dispatches.push(d);

    const t = d.return?.type;
    if (t === RETURN_TYPES.RTO) g.rto += 1;
    else if (t === RETURN_TYPES.CUSTOMER_RETURN) g.customerReturn += 1;
    else if (t === RETURN_TYPES.FAKE_RETURN) g.fakeReturn += 1;
  }

  const rows = [...groups.values()].map(g => {
    const returned = g.rto + g.customerReturn + g.fakeReturn;
    const rate = g.orders ? returned / g.orders : 0;
    return {
      ...g,
      returned,
      rate,
      // A single fake return is worth surfacing on its own; a high return
      // rate needs enough orders behind it to mean anything.
      flagged: g.fakeReturn > 0 || (g.orders >= minOrders && rate >= flagAbove)
    };
  });

  rows.sort((a, b) =>
    b.fakeReturn - a.fakeReturn ||
    b.returned - a.returned ||
    b.orders - a.orders ||
    String(a.label).localeCompare(String(b.label)));

  const totals = rows.reduce((t, r) => ({
    customers: t.customers + 1,
    orders: t.orders + r.orders,
    rto: t.rto + r.rto,
    customerReturn: t.customerReturn + r.customerReturn,
    fakeReturn: t.fakeReturn + r.fakeReturn,
    flagged: t.flagged + (r.flagged ? 1 : 0)
  }), { customers: 0, orders: 0, rto: 0, customerReturn: 0, fakeReturn: 0, flagged: 0 });

  return { rows, totals };
}

/** One spelling for a tracking ID, so two ways of writing it compare equal. */
export const normForwardId = (id) =>
  String(id ?? '').trim().toUpperCase().replace(/\s+/g, '');

/**
 * Classify each parsed row against what is already saved.
 *
 *   new    — not seen before; save it
 *   exists — saved already, no return recorded; may be updated
 *   locked — saved already AND a return is recorded
 *
 * `locked` is the important one. A record built from a freshly-read label
 * says `shipped` with no return, so saving it over a parcel that came back
 * would erase the return. Dropping the same PDF twice is an easy accident,
 * so the row is refused rather than trusted to the person clicking.
 */
export function classifyAgainstSaved(rows, saved) {
  const byId = new Map();
  for (const d of saved || []) {
    const k = normForwardId(d.forwardId);
    if (k) byId.set(k, d);
  }

  return (rows || []).map(row => {
    const k = normForwardId(row.forwardId);
    const hit = k ? byId.get(k) : null;
    if (!hit) return { ...row, _dupe: 'new', _keep: row._keep !== false };

    const hasReturn = !!hit.return?.type;
    return {
      ...row,
      _dupe: hasReturn ? 'locked' : 'exists',
      _existingId: hit.id || '',
      _existingReturn: hasReturn ? hit.return.type : '',
      _update: true,
      // Neither is ticked by default: an update is a deliberate act, and a
      // locked row is not an act at all.
      _keep: false
    };
  });
}

/**
 * What actually gets written for one dispatch.
 *
 * Two things are stripped. Fields beginning `_` belong to the review table
 * and have no business in the database. And on an UPDATE, `status` and
 * `return` are dropped entirely: a record built from a freshly-read label
 * always carries `status: 'shipped'` and `return: null`, so writing those
 * over a parcel that has already come back would erase the return — and a
 * fake-return finding is the single most expensive thing in here to lose.
 *
 * Correcting a customer's name must never move a parcel back to shipped.
 */
export function dispatchWritePayload(record) {
  const out = {};
  const isUpdate = record?._update === true;
  for (const [k, v] of Object.entries(record || {})) {
    if (k.startsWith('_')) continue;
    if (isUpdate && (k === 'status' || k === 'return')) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Recompute the offender key after someone edits the review.
 *
 * The key is derived from name → address → order ID at parse time. Typing a
 * customer name into a row that only had an address has to move that record
 * into the name-keyed group, or the repeat-returner counts are grouped on
 * evidence that is no longer what the record says.
 */
export function rekeyDispatch(dispatch) {
  const d = dispatch || {};
  const { key, keyType, label } = offenderKey({
    customerName: d.customer?.name,
    address: d.customer?.address,
    orderId: d.orderId
  });
  return { ...d, customer: { ...(d.customer || {}), key, keyType, label } };
}

/** Find a dispatch by tracking ID, tolerant of case and stray spaces. */
export function findByForwardId(dispatches, id) {
  const want = String(id ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!want) return null;
  return (dispatches || []).find(d =>
    String(d.forwardId ?? '').trim().toUpperCase().replace(/\s+/g, '') === want) || null;
}
