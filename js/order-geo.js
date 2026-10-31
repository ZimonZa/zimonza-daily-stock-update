// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Order Map: where orders go, and what comes back
//
// Pure functions only: no DOM, no Firestore. The Order Map tab draws what
// these return; the tests drive them directly.
//
// An order is placed by its PIN, found in this order:
//   1. typed  — the owner set it by hand on the map's Unknown list
//   2. label  — the routing code printed at the top of the Myntra label
//   3. address — the last PIN in the delivery address
// and looked up in India Post's directory (assets/geo/pincodes.json).
// ═══════════════════════════════════════════════════════════════

import { productsOf } from './myntra-dispatch.js';
import { DISPATCH_STATUS, RETURN_TYPES } from './constants.js';
import { normZmCode, normColorKey } from './utils.js';

const PIN_RE = /(?<!\d)([1-9]\d{5})(?!\d)/g;
// Everything from the "return to" block onwards is the SELLER's address
const SELLER_BLOCK = /if\s+undelivered|kuntal\s+fashion/i;

/** The buyer's PIN in a delivery address: the last one before any seller block. */
export function extractPin(address) {
  let text = String(address ?? '');
  const cut = text.search(SELLER_BLOCK);
  if (cut >= 0) text = text.slice(0, cut);
  const all = [...text.matchAll(PIN_RE)];
  return all.length ? all[all.length - 1][1] : null;
}

/** The PIN an order belongs to, and how it was found. */
export function orderPin(d) {
  const typed = String(d?.pinOverride ?? '').trim();
  if (/^[1-9]\d{5}$/.test(typed)) return { pin: typed, source: 'typed' };
  const label = String(d?.destPin ?? '').trim();
  if (/^[1-9]\d{5}$/.test(label)) return { pin: label, source: 'label' };
  const fromAddress = extractPin(d?.customer?.address);
  return fromAddress ? { pin: fromAddress, source: 'address' } : null;
}

/** Where a PIN is, from the directory. */
export function lookupPin(pin, dir) {
  const hit = dir?.pins?.[pin];
  if (!hit) return null;
  const district = dir.districts[hit[0]];
  if (!district) return null;
  return { pin, state: dir.states[district[1]], district: district[0], area: hit[1], lat: district[2], lng: district[3] };
}

/** '' when a typed PIN is usable, otherwise what is wrong with it. */
export function validatePinOverride(pin, dir) {
  const p = String(pin ?? '').trim();
  if (!/^[1-9]\d{5}$/.test(p)) return 'Enter a 6-digit PIN';
  if (!dir?.pins?.[p]) return 'PIN not found in the India Post list';
  return '';
}

/**
 * The orders the map counts, each placed and trimmed to the filters.
 *
 * - An unfulfillable order never shipped, so it is never an order here.
 * - A bounded date range drops records with no dispatch date; "all" keeps them.
 * - Under a ZM or colour filter, only matching products are kept — a combo
 *   parcel counts once, with the pieces of the products asked about.
 *
 * @returns {Array<{ d, loc, products, pieces }>}
 */
export function filterOrders(dispatches, { from = '', to = '', zm = '', colour = '', state = '' } = {}, dir) {
  const wantZm = zm ? normZmCode(zm) : '';
  const wantColour = colour ? normColorKey(colour) : '';
  const out = [];
  for (const d of dispatches || []) {
    if (d?.status === DISPATCH_STATUS.UNFULFILLABLE) continue;
    if (from || to) {
      const date = String(d.dispatchDate || '');
      if (!date) continue;
      if (from && date < from) continue;
      if (to && date > to) continue;
    }
    let products = productsOf(d);
    if (wantZm) products = products.filter(p => normZmCode(p.zmCode) === wantZm);
    if (wantColour) products = products.filter(p => normColorKey(p.colourName) === wantColour);
    if ((wantZm || wantColour) && !products.length) continue;

    const found = orderPin(d);
    const place = found ? lookupPin(found.pin, dir) : null;
    const loc = place ? { ...place, pinSource: found.source } : null;
    if (state && loc?.state !== state) continue;

    const pieces = products.length
      ? products.reduce((n, p) => n + (Number(p.qty) || 0), 0)
      : (Number(d.qty) || 0);
    out.push({ d, loc, products, pieces });
  }
  return out;
}

const blankGroup = (key, label, extra = {}) => ({
  key, label, ...extra,
  orders: 0, pieces: 0, returned: 0, rto: 0, customerReturn: 0, fake: 0, returnRate: 0,
  estValue: 0, cod: 0, prepaid: 0, codAmount: 0, unrecordedPayment: 0
});

function addTo(g, o, value) {
  const { d, pieces } = o;
  g.orders++;
  g.pieces += pieces;
  g.estValue += value;
  const type = d.return?.type;
  if (type) {
    g.returned++;
    if (type === RETURN_TYPES.RTO) g.rto++;
    else if (type === RETURN_TYPES.CUSTOMER_RETURN) g.customerReturn++;
    else if (type === RETURN_TYPES.FAKE_RETURN) g.fake++;
  }
  if (d.payment === 'cod') {
    g.cod++;
    if (Number.isFinite(d.codAmount)) g.codAmount += d.codAmount;
  } else if (d.payment === 'prepaid') g.prepaid++;
  else g.unrecordedPayment++;
}

const finish = (groups) => [...groups.values()]
  .map(g => ({ ...g, returnRate: g.orders ? g.returned / g.orders : 0 }))
  .sort((a, b) => b.orders - a.orders || String(a.label).localeCompare(String(b.label)));

/**
 * Everything the map shows, from filterOrders' output.
 * @param {Map} priceIdx  pricingIndex(state.pricing) — Myntra ISP prices the estimate
 */
export function summarise(filtered, priceIdx) {
  const byState = new Map(), byCity = new Map(), byPin = new Map(), zones = new Map();
  const unknown = [];
  const all = blankGroup('all', 'All');
  let unpricedProducts = 0;

  for (const o of filtered || []) {
    let value = 0;
    for (const p of o.products.length ? o.products : productsOf(o.d)) {
      const isp = Number(priceIdx?.get(normZmCode(p.zmCode))?.myntraIsp);
      if (Number.isFinite(isp) && isp > 0) value += isp * (Number(p.qty) || 0);
      else unpricedProducts++;
    }
    addTo(all, o, value);

    const { loc, d } = o;
    if (!loc) {
      const found = orderPin(d);
      unknown.push({
        id: d.id, forwardId: d.forwardId || '',
        customer: d.customer?.name || '', address: d.customer?.address || '',
        reason: found ? 'PIN not in directory' : 'no PIN'
      });
      continue;
    }
    const get = (map, key, label, extra) => {
      if (!map.has(key)) map.set(key, blankGroup(key, label, extra));
      return map.get(key);
    };
    addTo(get(byState, loc.state, loc.state, { zone: zoneOf(loc.state) }), o, value);
    addTo(get(byCity, `${loc.state}|${loc.district}`, loc.district,
      { state: loc.state, lat: loc.lat, lng: loc.lng }), o, value);
    addTo(get(byPin, loc.pin, loc.area, { district: loc.district, state: loc.state, pinSource: loc.pinSource }), o, value);
    const zone = zoneOf(loc.state);
    addTo(get(zones, zone, zone), o, value);
  }

  const states = finish(byState), cities = finish(byCity);
  return {
    kpis: {
      orders: all.orders, pieces: all.pieces, states: states.length, cities: cities.length,
      returnRate: all.orders ? all.returned / all.orders : 0, fake: all.fake,
      estValue: all.estValue, located: all.orders - unknown.length, unknown: unknown.length
    },
    byState: states, byCity: cities, byPin: finish(byPin), zones: finish(zones),
    risky: { cities: riskyAreas(cities), pins: riskyAreas(finish(byPin)) },
    unknown,
    payment: { cod: all.cod, prepaid: all.prepaid, unrecorded: all.unrecordedPayment, codAmount: all.codAmount },
    unpricedProducts
  };
}

/**
 * Places that send back too much. Never on fewer than `minOrders` — one bad
 * parcel must not flag a whole town — and then either a high return rate or
 * any fake return at all. Same thresholds as the repeat-returner list.
 */
export function riskyAreas(groups, { minOrders = 3, flagAbove = 0.4 } = {}) {
  return (groups || [])
    .filter(g => g.orders >= minOrders && (g.returnRate >= flagAbove || g.fake > 0))
    .sort((a, b) => b.returnRate - a.returnRate || b.orders - a.orders || String(a.label).localeCompare(String(b.label)));
}

/**
 * Which products go where, in pieces. Columns are the top states by pieces
 * plus "Other"; orders with no known state are left out (they have no column).
 */
export function productByState(filtered, { by = 'sku', topStates = 8 } = {}) {
  const located = (filtered || []).filter(o => o.loc);
  const stateTotals = new Map();
  for (const o of located) stateTotals.set(o.loc.state, (stateTotals.get(o.loc.state) || 0) + o.pieces);
  const top = [...stateTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topStates).map(([s]) => s);
  const columns = [...top, 'Other'];

  const rows = new Map();
  for (const o of located) {
    const col = top.includes(o.loc.state) ? top.indexOf(o.loc.state) : top.length;
    for (const p of o.products.length ? o.products : productsOf(o.d)) {
      const key = by === 'zm' ? normZmCode(p.zmCode) || p.sellerSkuCode : p.sellerSkuCode;
      if (!rows.has(key)) rows.set(key, { key, total: 0, cells: columns.map(() => 0) });
      const r = rows.get(key);
      const q = Number(p.qty) || 0;
      r.cells[col] += q;
      r.total += q;
    }
  }
  return {
    columns,
    rows: [...rows.values()].sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)))
  };
}

/** Monday of the week an ISO date falls in, as an ISO date. Calendar arithmetic in UTC, so no time zone can shift it. */
function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/** Orders per week for the busiest states, every week in range, quiet ones as 0. */
export function weeklyTrend(filtered, { topStates = 5 } = {}) {
  const dated = (filtered || []).filter(o => o.loc && /^\d{4}-\d{2}-\d{2}/.test(String(o.d.dispatchDate || '')));
  if (!dated.length) return { weeks: [], series: [] };
  const mondays = dated.map(o => mondayOf(String(o.d.dispatchDate).slice(0, 10))).sort();
  const weeks = [];
  for (let w = mondays[0]; w <= mondays[mondays.length - 1];) {
    weeks.push(w);
    const [y, m, d] = w.split('-').map(Number);
    w = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  }
  const orders = new Map();
  for (const o of dated) orders.set(o.loc.state, (orders.get(o.loc.state) || 0) + 1);
  const top = [...orders.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topStates).map(([s]) => s);
  const series = top.map(state => {
    const counts = weeks.map(() => 0);
    for (const o of dated) if (o.loc.state === state) counts[weeks.indexOf(mondayOf(String(o.d.dispatchDate).slice(0, 10)))]++;
    return { state, counts };
  });
  return { weeks, series };
}

/** The Government's six Zonal Councils, by the directory's state names. */
export const ZONES = {
  'Northern': ['Jammu and Kashmir', 'Ladakh', 'Himachal Pradesh', 'Punjab', 'Chandigarh', 'Haryana', 'Delhi', 'Rajasthan'],
  'Central': ['Uttar Pradesh', 'Uttarakhand', 'Madhya Pradesh', 'Chhattisgarh'],
  'Eastern': ['Bihar', 'Jharkhand', 'Odisha', 'West Bengal'],
  'Western': ['Gujarat', 'Maharashtra', 'Goa', 'Dadra and Nagar Haveli and Daman and Diu'],
  'Southern': ['Andhra Pradesh', 'Telangana', 'Karnataka', 'Kerala', 'Tamil Nadu', 'Puducherry', 'Lakshadweep',
    'Andaman and Nicobar Islands'],
  'North-Eastern': ['Assam', 'Arunachal Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura', 'Sikkim']
};
const ZONE_OF = new Map(Object.entries(ZONES).flatMap(([z, states]) => states.map(s => [s, z])));
export const zoneOf = (state) => ZONE_OF.get(state) || 'Other';

const pct = r => Math.round((Number(r) || 0) * 1000) / 10;

/**
 * The Excel workbook, one sheet per table. Customer names appear only on
 * Unknown Location, where they are needed to find and fix the order.
 */
export function orderMapSheets(summary, pbs) {
  const groupCols = ['Orders', 'Pieces', 'Returned', 'RTO', 'Customer Return', 'Fake', 'Return %', 'COD', 'Prepaid', 'COD Amount', 'Est. Value (ISP)'];
  const groupVals = g => [g.orders, g.pieces, g.returned, g.rto, g.customerReturn, g.fake, pct(g.returnRate),
    g.cod, g.prepaid, g.codAmount, g.estValue];
  const risky = [...(summary.risky?.pins || []).map(g => ['PIN', g.key, g.label, g.district, g.state, ...groupVals(g)]),
    ...(summary.risky?.cities || []).map(g => ['City', '', '', g.label, g.state, ...groupVals(g)])];
  return [
    { name: 'States', aoa: [['State', 'Zone', ...groupCols], ...summary.byState.map(g => [g.label, g.zone, ...groupVals(g)])] },
    { name: 'Cities', aoa: [['City (district)', 'State', ...groupCols], ...summary.byCity.map(g => [g.label, g.state, ...groupVals(g)])] },
    { name: 'PINs', aoa: [['PIN', 'Area', 'City (district)', 'State', 'PIN from', ...groupCols],
      ...summary.byPin.map(g => [g.key, g.label, g.district, g.state, g.pinSource, ...groupVals(g)])] },
    { name: 'Product x State', aoa: [['Product', ...(pbs?.columns || []), 'Total'],
      ...(pbs?.rows || []).map(r => [r.key, ...r.cells, r.total])] },
    { name: 'Risky Areas', aoa: [['Level', 'PIN', 'Area', 'City (district)', 'State', ...groupCols], ...risky] },
    { name: 'Zones', aoa: [['Zone', ...groupCols], ...summary.zones.map(g => [g.label, ...groupVals(g)])] },
    { name: 'Unknown Location', aoa: [['Forward ID', 'Customer', 'Address', 'Why'],
      ...summary.unknown.map(u => [u.forwardId, u.customer, u.address, u.reason])] }
  ];
}
