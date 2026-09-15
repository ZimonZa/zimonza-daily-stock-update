// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Dispatch records & return abuse analytics
//
// Every label page that goes out becomes a dispatch, keyed by its
// forward tracking ID. When a parcel comes back you find it by that ID
// and classify it.
//
// A REPORT, and nothing else. It is not linked to Purchase or to the
// Returns & RTO register: nothing here ever changes stock.
//
// Pure functions only. Nothing here touches Firestore or the DOM.
// ═══════════════════════════════════════════════════════════════

import { DISPATCH_STATUS, RETURN_TYPES } from './constants.js';
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

  // Every product in the parcel. A Myntra combo label prints one line per
  // piece — "ZM-49-Pyazi -" then "ZM-43-Chiku -" — and all of them belong on
  // this one record, not just the first.
  let products = (Array.isArray(fields.skus) ? fields.skus : []).map(s => ({
    sellerSkuCode: s.sellerSkuCode || '',
    zmCode: normZmCode(s.zmCode || ''),
    colourName: s.colourName || '',
    qty: Math.max(1, Number(s.count) || 1),
    mapped: s.mapped !== false
  })).filter(p => p.sellerSkuCode);

  // Older parses carry a single `sku`; the layout reader may also have read a
  // bracketed code the mapping does not know. Either still lands on the record.
  if (!products.length) {
    const code = fields.sku?.sellerSkuCode || fields.sellerSkuCode || '';
    if (code) {
      products = [{
        sellerSkuCode: code,
        zmCode: normZmCode(fields.sku?.zmCode || ''),
        colourName: fields.sku?.colourName || '',
        qty: Math.max(1, Number(fields.pieces) || 1),
        mapped: !!fields.sku
      }];
    }
  }

  const first = products[0] || null;
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
    // Every product in the parcel, each with its own piece count.
    products,
    // The first product, kept at the top level so search, sorting and any
    // older record that predates `products` still have something to read.
    sellerSkuCode: first?.sellerSkuCode || '',
    zmCode: first?.zmCode || '',
    colourName: first?.colourName || '',
    // The parcel's total pieces — the sum of its products, so a combo of one
    // Pyazi and one Chiku is 2, and four Rani lines is 4.
    qty: products.length
      ? products.reduce((n, p) => n + p.qty, 0)
      : Math.max(1, Number(fields.pieces) || 1),
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
 *
 * A page normally IS the whole parcel, and carries its own piece count. Two
 * pages sharing a tracking ID means the parcel was printed across both, so
 * their pieces add up into one shipment.
 */
export function mergeByForwardId(dispatches) {
  const byId = new Map();
  const noId = [];

  for (const d of dispatches || []) {
    if (!d.forwardId) { noId.push(d); continue; }
    const existing = byId.get(d.forwardId);
    if (!existing) {
      byId.set(d.forwardId, {
        ...d,
        products: productsOf(d).map(p => ({ ...p })),
        pages: d.page ? [d.page] : []
      });
      continue;
    }
    // The same parcel continued on another page: fold its products in,
    // adding to a code already listed rather than listing it twice.
    existing.products = mergeProducts(existing.products, productsOf(d));
    existing.qty = existing.products.reduce((n, p) => n + p.qty, 0);
    if (d.page) existing.pages.push(d.page);
  }

  return { merged: [...byId.values()], withoutTrackingId: noId };
}

/**
 * The products in a parcel, for any record — including one saved before
 * records carried a `products` list, which is rebuilt from its single code.
 */
export function productsOf(d) {
  if (Array.isArray(d?.products) && d.products.length) return d.products;
  if (!d?.sellerSkuCode) return [];
  return [{
    sellerSkuCode: d.sellerSkuCode,
    zmCode: d.zmCode || '',
    colourName: d.colourName || '',
    qty: Math.max(1, Number(d.qty) || 1)
  }];
}

/** Add products together by code, keeping the order they were first seen. */
export function mergeProducts(a, b) {
  const out = (a || []).map(p => ({ ...p }));
  for (const p of b || []) {
    const hit = out.find(x => String(x.sellerSkuCode).toUpperCase() === String(p.sellerSkuCode).toUpperCase());
    if (hit) hit.qty += Math.max(1, Number(p.qty) || 1);
    else out.push({ ...p, qty: Math.max(1, Number(p.qty) || 1) });
  }
  return out;
}

/** "ZM-49-Pyazi ×1, ZM-43-Chiku ×1" — for exports, search and one-line summaries. */
export function productsLabel(d, sep = ', ') {
  return productsOf(d).map(p => `${p.sellerSkuCode} ×${p.qty}`).join(sep);
}

/**
 * Record a return against a dispatch. PURE — returns what should be
 * written, and writes nothing itself.
 *
 * REPORT ONLY. Orders & Fake Returns is a record of what went out and what
 * came back, and it is deliberately not linked to the Returns & RTO register
 * or to Purchase: recording a return here never creates, moves or removes a
 * single piece of stock. Stock comes back through the Returns & RTO tab.
 *
 * @returns {{ dispatchPatch:object|null, error:string|null }}
 */
export function applyReturn(dispatch, { returnId, type, foundInside, date, condition } = {}) {
  if (!dispatch) {
    return { dispatchPatch: null, error: 'No dispatch to return against' };
  }
  if (!type || !Object.values(RETURN_TYPES).includes(type)) {
    return { dispatchPatch: null, error: 'Pick a return type' };
  }

  const fake = type === RETURN_TYPES.FAKE_RETURN;
  const dispatchPatch = {
    status: DISPATCH_STATUS.RETURNED,
    return: {
      returnId: String(returnId ?? '').trim(),
      type,
      // What was actually inside a fake return; how a genuine one came back.
      // Both are part of the report and nothing else.
      foundInside: fake ? String(foundInside ?? '').trim() : '',
      condition: fake ? '' : String(condition ?? '').trim(),
      date: date || today()
    }
  };

  return { dispatchPatch, error: null };
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

/**
 * Is this a date an order can have been dispatched on?
 *
 * The date is chosen BEFORE a label PDF is read and stamped on every order in
 * it, so a wrong one mislabels a whole day at once. It must be a real calendar
 * date (2026-02-30 is not), in YYYY-MM-DD as a date input gives it, and not in
 * the future — a parcel cannot have shipped tomorrow.
 *
 * @param {string} value     YYYY-MM-DD
 * @param {string} todayIso  YYYY-MM-DD, passed in so the rule is testable
 * @returns {string} an error message, or '' when the date is fine
 */
export function dispatchDateError(value, todayIso) {
  const s = String(value ?? '').trim();
  if (!s) return 'Pick the dispatch date first';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return 'That is not a valid date';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Round-trip through a real calendar, so 2026-02-30 and 2026-13-01 fail
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return 'That is not a real date';
  }
  if (todayIso && s > todayIso) return 'The dispatch date cannot be in the future';
  return '';
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
    if (!hit) {
      // Clear EVERY duplicate marker, not just _dupe. A row re-classified after
      // its tracking ID was corrected carries the old `_update: true` in
      // `...row`; left in place, dispatchWritePayload strips `status` and
      // `return`, and a brand-new parcel is saved with no status at all —
      // missing from "Still out" and showing a blank status chip.
      return {
        ...row,
        _dupe: 'new',
        _update: false,
        _existingId: '',
        _existingReturn: '',
        _keep: row._keep !== false
      };
    }

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
 * Tracking IDs that appear on more than one row of the same save.
 *
 * The tracking ID is the document id, so two rows sharing one are written to
 * the SAME document and the second silently replaces the first — one parcel's
 * products and customer simply vanish. Pages read from a file are already
 * merged, but an ID typed into the review is not, so this is checked at save.
 *
 * @returns {string[]} the repeated IDs, normalised
 */
export function repeatedIds(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const k = normForwardId(r.forwardId);
    if (k) seen.set(k, (seen.get(k) || 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
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
