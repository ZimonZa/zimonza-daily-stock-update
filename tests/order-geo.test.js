// The numbers behind the Order Map: which PIN an order belongs to, where
// that is, and what came back from there. Pure functions — the map tab only
// draws what these return.

import { readFileSync } from 'node:fs';
import {
  extractPin, orderPin, lookupPin, validatePinOverride, filterOrders, summarise,
  riskyAreas, productByState, weeklyTrend, ZONES, zoneOf, orderMapSheets
} from './order-geo.js';
import { pricingIndex } from './myntra-pricing.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ── A small directory in the real file's shape ──
const dir = {
  v: 1, source: 'test',
  states: ['Bihar', 'Uttar Pradesh', 'Maharashtra', 'Gujarat', 'Karnataka'],
  districts: [
    ['Patna', 0, 25.45, 85.17], ['Kanpur Nagar', 1, 26.43, 80.27], ['Rae Bareli', 1, 26.2, 81.15],
    ['Gautam Buddha Nagar', 1, 28.29, 77.64], ['Mumbai', 2, 18.97, 72.83], ['Surat', 3, 21.2, 72.97],
    ['Bengaluru Urban', 4, 12.96, 77.58]
  ],
  pins: {
    '801105': [0, 'Khagaul Bazar'], '208017': [1, 'Avas Vikas'], '229001': [2, 'Raebarely'],
    '201301': [3, 'Noida'], '400053': [4, 'Andheri'], '395010': [5, 'Bombay Market'], '560001': [6, 'Bengaluru']
  }
};

// ════ 1. Which PIN ════
eq('a PIN at the end of the address', extractPin('railway hospital  Khagaul Patna 801105 India'), '801105');
eq('the old reader\'s address with the routing code still finds the buyer PIN',
  extractPin('AMOUNT TO BE PAID EK_E2E Rs.5846.0 PAT/PNP (801105'), '801105');
eq('THE RULE: the seller\'s 395010 is never taken from the return-to block',
  extractPin('12 MG Road 400053 If undelivered, Please return to KUNTAL FASHION PRIVATE Surat, Gujarat, 395010'), '400053');
eq('an address with no PIN', extractPin('397/21 OPPOSITE MAHATAMA GANDHI INTER COLLEGE AMARNAGAR'), null);
eq('seven digits are not a PIN', extractPin('Flat 1234567'), null);
eq('empty', extractPin(''), null);

eq('a typed PIN wins', orderPin({ pinOverride: '201301', destPin: '801105', customer: { address: 'x 400053' } }),
  { pin: '201301', source: 'typed' });
eq('then the label\'s PIN', orderPin({ destPin: '801105', customer: { address: 'x 400053' } }), { pin: '801105', source: 'label' });
eq('then the address', orderPin({ customer: { address: 'x 400053' } }), { pin: '400053', source: 'address' });
eq('none at all', orderPin({ customer: { address: 'no pin here' } }), null);

eq('lookup', lookupPin('201301', dir),
  { pin: '201301', state: 'Uttar Pradesh', district: 'Gautam Buddha Nagar', area: 'Noida', lat: 28.29, lng: 77.64 });
eq('lookup miss', lookupPin('999999', dir), null);
eq('typed PIN: too short', validatePinOverride('2013', dir), 'Enter a 6-digit PIN');
eq('typed PIN: unknown', validatePinOverride('999999', dir), 'PIN not found in the India Post list');
eq('typed PIN: fine', validatePinOverride(' 201301 ', dir), '');

// ── Orders ──
const rani = { sellerSkuCode: 'ZM-43-Rani', zmCode: 'ZM-43', colourName: 'Rani', qty: 1 };
const mk = (id, o = {}) => ({
  id, forwardId: `F${id}`, status: 'shipped', return: null, dispatchDate: '2026-10-20', qty: 1,
  products: [rani], payment: 'prepaid', paymentGuessed: false,
  customer: { name: '', address: '' }, ...o
});
const back = (type) => ({ status: 'returned', return: { type } });
const orders = [
  mk('a1', { destPin: '801105', payment: 'cod', codAmount: 5846, customer: { name: 'Akanksha', address: 'Khagaul Patna 801105 India' } }),
  mk('a2', { customer: { name: '', address: 'Khagaul Patna 801105 India' }, ...back('rto') }),
  mk('a3', { destPin: '801105', ...back('fake_return') }),
  mk('b1', { destPin: '208017', payment: 'cod', codAmount: null, qty: 2, products: [
    { sellerSkuCode: 'ZM-49-Pyazi', zmCode: 'ZM-49', colourName: 'Pyazi', qty: 1 },
    { sellerSkuCode: 'ZM-43-Chiku', zmCode: 'ZM-43', colourName: 'Chiku', qty: 1 }] }),
  mk('b2', { destPin: '208017', ...back('rto') }),
  mk('b3', { destPin: '208017', ...back('rto') }),
  mk('c1', { destPin: '229001', payment: '' }),
  mk('d1', { pinOverride: '201301', customer: { name: '', address: 'no pin in this one' } }),
  mk('m1', { customer: { name: '', address: 'Andheri Mumbai 400053' }, ...back('rto') }),
  mk('m2', { customer: { name: '', address: 'Andheri Mumbai 400053' } }),
  mk('m3', { customer: { name: '', address: 'Andheri Mumbai 400053' } }),
  mk('m4', { customer: { name: '', address: 'Andheri Mumbai 400053' }, dispatchDate: '2026-10-25' }),
  mk('m5', { customer: { name: '', address: 'Andheri Mumbai 400053' }, dispatchDate: '2026-10-26' }),
  mk('s1', { destPin: '395010', dispatchDate: '2026-10-06', ...back('rto') }),
  mk('s2', { destPin: '395010', ...back('rto') }),
  mk('u1', { customer: { name: 'Secret Person', address: 'House 4, no pin' } }),
  mk('u2', { destPin: '999999' }),
  mk('x1', { destPin: '801105', status: 'unfulfillable' }),
  // An order saved before products, dates and payment were recorded
  { id: 'old1', forwardId: 'Fold1', status: 'shipped', return: null, sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11',
    colourName: 'Purple', qty: 3, destPin: '560001', customer: { name: '', address: '' } }
];
const priceIdx = pricingIndex([{ zmCode: 'ZM-43', myntraIsp: 1000 }, { zmCode: 'ZM-49', myntraIsp: 2000 }]);

// ════ 2. Filtering ════
const all = filterOrders(orders, {}, dir);
eq('THE RULE: an unfulfillable order never shipped, so it is not an order here', all.length, 18);
ok('x1 is gone', !all.some(o => o.d.id === 'x1'));
eq('where an order is, and how its PIN was found', all.find(o => o.d.id === 'd1').loc,
  { pin: '201301', state: 'Uttar Pradesh', district: 'Gautam Buddha Nagar', area: 'Noida', lat: 28.29, lng: 77.64, pinSource: 'typed' });
eq('no PIN → no location', all.find(o => o.d.id === 'u1').loc, null);

const zm43 = filterOrders(orders, { zm: 'ZM-43' }, dir);
const combo = zm43.filter(o => o.d.id === 'b1');
eq('COMBO under a ZM filter: the order counts once', combo.length, 1);
eq('COMBO: only the matching product is kept', combo[0].products.map(p => p.sellerSkuCode), ['ZM-43-Chiku']);
eq('COMBO: pieces count only the matching product', combo[0].pieces, 1);
ok('an order with no matching product is dropped', !zm43.some(o => o.d.id === 'old1'));
eq('colour filter', filterOrders(orders, { colour: 'Chiku' }, dir).map(o => o.d.id), ['b1']);
eq('state filter', filterOrders(orders, { state: 'Uttar Pradesh' }, dir).length, 5);

ok('OLD record: kept when no date range is set', all.some(o => o.d.id === 'old1'));
eq('OLD record: no products list still counts its pieces', all.find(o => o.d.id === 'old1').pieces, 3);
ok('OLD record: dropped from a bounded date range', !filterOrders(orders, { from: '2026-10-01' }, dir).some(o => o.d.id === 'old1'));
eq('date range is inclusive', filterOrders(orders, { from: '2026-10-21', to: '2026-10-26' }, dir).map(o => o.d.id), ['m4', 'm5']);

// ════ 3. Summary ════
const s = summarise(all, priceIdx);
eq('KPIs', s.kpis, {
  orders: 18, pieces: 21, states: 5, cities: 7, returnRate: 7 / 18, fake: 1,
  estValue: 19000, located: 16, unknown: 2
});
const up = s.byState.find(g => g.key === 'Uttar Pradesh');
eq('state totals', [up.orders, up.pieces, up.returned, up.rto, up.customerReturn, up.fake], [5, 6, 2, 2, 0, 0]);
const patna = s.byCity.find(g => g.label === 'Patna');
eq('city: return kinds split', [patna.orders, patna.returned, patna.rto, patna.fake], [3, 2, 1, 1]);
eq('city: return rate', patna.returnRate, 2 / 3);
eq('city keyed by state and district', patna.key, 'Bihar|Patna');
eq('Kanpur estimated value at Myntra ISP', s.byCity.find(g => g.label === 'Kanpur Nagar').estValue, 5000);
eq('unpriced product lines are counted', s.unpricedProducts, 1);
eq('PIN groups are labelled by area', s.byPin.find(g => g.key === '400053').label, 'Andheri');
eq('groups are sorted by orders', s.byCity[0].label, 'Mumbai');
eq('payment overall', s.payment, { cod: 2, prepaid: 14, unrecorded: 2, codAmount: 5846 });
eq('payment per state', [patna.cod, patna.prepaid, patna.codAmount, patna.unrecordedPayment], [1, 2, 5846, 0]);
eq('unknown: why each one has no place', s.unknown.map(u => [u.id, u.reason]),
  [['u1', 'no PIN'], ['u2', 'PIN not in directory']]);
eq('unknown rows carry what is needed to fix them', Object.keys(s.unknown[0]).sort(),
  ['address', 'customer', 'forwardId', 'id', 'reason']);

// ════ 4. Risky areas ════
eq('2 orders, both back → too few to flag', riskyAreas([{ key: 'a', label: 'a', orders: 2, returned: 2, fake: 0, returnRate: 1 }]).length, 0);
eq('3 orders, 2 back → flagged', riskyAreas([{ key: 'a', label: 'a', orders: 3, returned: 2, fake: 0, returnRate: 2 / 3 }]).length, 1);
eq('3 orders, 1 fake → flagged', riskyAreas([{ key: 'a', label: 'a', orders: 3, returned: 1, fake: 1, returnRate: 1 / 3 }]).length, 1);
eq('5 orders, 1 back → fine', riskyAreas([{ key: 'a', label: 'a', orders: 5, returned: 1, fake: 0, returnRate: 0.2 }]).length, 0);
eq('cities flagged from the real summary, worst first', riskyAreas(s.byCity).map(g => g.label), ['Kanpur Nagar', 'Patna']);

// ════ 5. Product × State ════
const pbs = productByState(all, { topStates: 2 });
eq('columns: the top states by pieces, then Other', pbs.columns, ['Uttar Pradesh', 'Maharashtra', 'Other']);
eq('rows by SKU, biggest first', pbs.rows[0], { key: 'ZM-43-Rani', total: 14, cells: [4, 5, 5] });
ok('cells always add up to the row total', pbs.rows.every(r => r.cells.reduce((a, b) => a + b, 0) === r.total));
eq('by ZM code merges colours', productByState(all, { by: 'zm', topStates: 2 }).rows[0],
  { key: 'ZM-43', total: 15, cells: [5, 5, 5] });

// ════ 6. Weekly trend ════
const wk = weeklyTrend(all, { topStates: 5 });
eq('Monday-start weeks, with the empty week kept', wk.weeks, ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
eq('Sunday 25th falls in the week of the 19th; Monday 26th starts a new one',
  wk.series.find(x => x.state === 'Maharashtra').counts, [0, 0, 4, 1]);
eq('a quiet week is zero, not missing', wk.series.find(x => x.state === 'Gujarat').counts, [1, 0, 1, 0]);

// ════ 7. Zones ════
eq('Uttar Pradesh is Central', zoneOf('Uttar Pradesh'), 'Central');
eq('Bihar is Eastern', zoneOf('Bihar'), 'Eastern');
eq('Karnataka is Southern', zoneOf('Karnataka'), 'Southern');
eq('Ladakh is Northern', zoneOf('Ladakh'), 'Northern');
eq('six zones', Object.keys(ZONES).length, 6);
const realStates = JSON.parse(readFileSync(new URL('./geo/pincodes.json', import.meta.url), 'utf8')).states;
eq('every real state has a zone', realStates.filter(st => zoneOf(st) === 'Other'), []);
eq('zone totals', s.zones.find(z => z.key === 'Central')?.orders, 5);

// ════ 8. Excel ════
const sheets = orderMapSheets(s, pbs);
eq('seven sheets, in order', sheets.map(x => x.name),
  ['States', 'Cities', 'PINs', 'Product x State', 'Risky Areas', 'Zones', 'Unknown Location']);
const named = sheets.filter(x => JSON.stringify(x.aoa).includes('Secret Person') || JSON.stringify(x.aoa).includes('Akanksha')).map(x => x.name);
eq('THE RULE: customer names appear only where they are needed to fix a row', named, ['Unknown Location']);
eq('States sheet header', sheets[0].aoa[0],
  ['State', 'Zone', 'Orders', 'Pieces', 'Returned', 'RTO', 'Customer Return', 'Fake', 'Return %', 'COD', 'Prepaid', 'COD Amount', 'Est. Value (ISP)']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
