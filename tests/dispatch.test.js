globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { extractDispatchFields } from './myntra-labels.js';
import {
  offenderKey, dispatchFromPageRecord, dispatchesFromLabel, mergeByForwardId,
  applyReturn, offenderSummary, findByForwardId
} from './myntra-dispatch.js';
import { generateInventoryUpdate } from './myntra.js';
import { availableReturnStock } from './myntra-returns.js';
import { RETURN_TYPES, DISPATCH_STATUS } from './constants.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ════ 1. Label field extraction ════
const full = 'Shipping Label AWB: SF1234567890123 Order ID: 1234567-8901234 ' +
  'Ship To: Priya Sharma Address: 12 MG Road, Andheri, Mumbai 400053 ZM-11-Purple Qty 1';
const f = extractDispatchFields(full);
eq('tracking id, labelled', f.forwardId, 'SF1234567890123');
eq('order id', f.orderId, '1234567-8901234');
eq('customer name', f.customerName, 'Priya Sharma');
ok('address captured around the PIN', /400053/.test(f.address), f.address);
eq('nothing missing', f.missing, []);

// The name must stop where the next label field starts
eq('name stops at Address',
  extractDispatchFields('Ship To: Priya Sharma Address: 12 MG Road 400053').customerName, 'Priya Sharma');
eq('name stops at Phone',
  extractDispatchFields('Deliver To: Ravi Kumar Phone 9876543210').customerName, 'Ravi Kumar');

// Bare tracking id, no label word
const bare = extractDispatchFields('ZM-11-Purple 78451236985210 Delhivery');
eq('bare tracking id found', bare.forwardId, '78451236985210');
ok('order id absent is flagged', bare.missing.includes('orderId'));
ok('customer absent is flagged', bare.missing.includes('customerName'));

// Each field independently optional — the record survives either way
const noTrack = extractDispatchFields('Ship To: Anita Rao Order ID: 555-666 Mumbai 400001');
eq('no tracking id', noTrack.forwardId, '');
ok('missing tracking flagged', noTrack.missing.includes('forwardId'));
eq('but the rest is still read', [noTrack.customerName, noTrack.orderId], ['Anita Rao', '555-666']);

const nothing = extractDispatchFields('ZM-11-Purple');
eq('a label with no dispatch fields flags them all', nothing.missing.length, 4);
eq('empty page', extractDispatchFields('').missing.length, 4);
eq('null page', extractDispatchFields(null).forwardId, '');

// An "Order" capture must not simply repeat the tracking id
const same = extractDispatchFields('AWB SF999888777666 Order No SF999888777666');
ok('order id not duplicated from tracking', same.orderId !== same.forwardId);

// ════ 2. Offender key — best available, and it says which ════
eq('name wins', offenderKey({ customerName: 'Priya Sharma', address: 'x 400053', orderId: '1' }).keyType, 'name');
eq('address when no name', offenderKey({ address: '12 MG Road 400053', orderId: '1' }).keyType, 'address');
eq('order id last', offenderKey({ orderId: '1234' }).keyType, 'order');
eq('nothing at all', offenderKey({}).keyType, 'none');

eq('same name groups regardless of case/spacing',
  offenderKey({ customerName: 'Priya  Sharma' }).key, offenderKey({ customerName: 'priya sharma' }).key);
eq('same address groups through formatting drift',
  offenderKey({ address: '12 MG Road, Mumbai 400053' }).key,
  offenderKey({ address: '12  MG  Road Mumbai  400053' }).key);
ok('different addresses do NOT group',
  offenderKey({ address: '12 MG Road 400053' }).key !== offenderKey({ address: '99 Link Road 400054' }).key);

// ════ 3. Dispatch records ════
const pageRecords = [
  { page: 1, forwardId: 'SF001', orderId: 'O1', customerName: 'Priya Sharma', address: 'Mumbai 400053',
    missing: [], sku: { sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11', colourName: 'Purple' } },
  { page: 2, forwardId: 'SF001', orderId: 'O1', customerName: 'Priya Sharma', address: 'Mumbai 400053',
    missing: [], sku: { sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11', colourName: 'Purple' } },
  { page: 3, forwardId: 'SF002', orderId: 'O2', customerName: '', address: 'Mumbai 400053',
    missing: ['customerName'], sku: { sellerSkuCode: 'ZM-7-Rani', zmCode: 'ZM-7', colourName: 'Rani' } },
  { page: 4, forwardId: '', orderId: 'O3', customerName: 'Ravi Kumar', address: '',
    missing: ['forwardId', 'address'], sku: { sellerSkuCode: 'ZM-7-Rani', zmCode: 'ZM-7', colourName: 'Rani' } }
];
const ds = dispatchesFromLabel(pageRecords, { sourceFile: 'label.pdf', dispatchDate: '2026-09-01' });
eq('one dispatch per page', ds.length, 4);
eq('status starts shipped', ds[0].status, DISPATCH_STATUS.SHIPPED);
eq('one page is one piece', ds[0].qty, 1);
eq('sku carried', ds[0].sellerSkuCode, 'ZM-11-Purple');
eq('date carried', ds[0].dispatchDate, '2026-09-01');
eq('missing fields carried through', ds[3].missing, ['forwardId', 'address']);
eq('keyType falls back to address', ds[2].customer.keyType, 'address');

const { merged, withoutTrackingId } = mergeByForwardId(ds);
eq('two parcels merged, one has no id', [merged.length, withoutTrackingId.length], [2, 1]);
eq('two pages of one parcel = 2 pcs', merged.find(m => m.forwardId === 'SF001').qty, 2);
eq('pages recorded', merged.find(m => m.forwardId === 'SF001').pages, [1, 2]);
ok('a page with no tracking id is kept, not dropped', withoutTrackingId[0].orderId === 'O3');

eq('find by id, case tolerant', findByForwardId(ds, ' sf001 ')?.forwardId, 'SF001');
eq('find by unknown id', findByForwardId(ds, 'NOPE'), null);

// ════ 4. Return intake — the rule that matters ════
const parcel = { id: 'd1', forwardId: 'SF001', sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11',
  colourName: 'Purple', qty: 2 };

const rto = applyReturn(parcel, { returnId: 'R1', type: RETURN_TYPES.RTO, date: '2026-09-05' });
eq('RTO: no error', rto.error, null);
eq('RTO: dispatch marked returned', rto.dispatchPatch.status, DISPATCH_STATUS.RETURNED);
ok('RTO: a stock row IS created', !!rto.returnRow);
eq('RTO: stock row qty follows the parcel', rto.returnRow.qty, 2);
eq('RTO: linked back to the dispatch', rto.returnRow.dispatchId, 'd1');
eq('RTO: return id recorded', rto.dispatchPatch.return.returnId, 'R1');

const cust = applyReturn(parcel, { returnId: 'R2', type: RETURN_TYPES.CUSTOMER_RETURN });
ok('Customer Return: a stock row IS created', !!cust.returnRow);
eq('Customer Return: type carried', cust.returnRow.type, RETURN_TYPES.CUSTOMER_RETURN);

const fake = applyReturn(parcel, { returnId: 'R3', type: RETURN_TYPES.FAKE_RETURN, foundInside: 'empty box' });
eq('FAKE RETURN: NO stock row', fake.returnRow, null);
eq('FAKE RETURN: still marks the dispatch returned', fake.dispatchPatch.status, DISPATCH_STATUS.RETURNED);
eq('FAKE RETURN: records what was inside', fake.dispatchPatch.return.foundInside, 'empty box');

eq('a return with no type is refused', applyReturn(parcel, { returnId: 'R4' }).error, 'Pick a return type');
eq('a return against nothing is refused', applyReturn(null, { type: RETURN_TYPES.RTO }).error,
  'No dispatch to return against');
ok('refusal writes nothing', applyReturn(parcel, {}).dispatchPatch === null);

// ════ 5. Offender summary ════
const history = [
  { customer: { key: 'name:priya sharma', keyType: 'name', label: 'Priya Sharma' }, qty: 1, return: { type: RETURN_TYPES.FAKE_RETURN } },
  { customer: { key: 'name:priya sharma', keyType: 'name', label: 'Priya Sharma' }, qty: 1, return: { type: RETURN_TYPES.RTO } },
  { customer: { key: 'name:priya sharma', keyType: 'name', label: 'Priya Sharma' }, qty: 1, return: null },
  { customer: { key: 'name:ravi kumar', keyType: 'name', label: 'Ravi Kumar' }, qty: 1, return: null },
  { customer: { key: 'name:ravi kumar', keyType: 'name', label: 'Ravi Kumar' }, qty: 1, return: null },
  { customer: { key: 'addr:delhi 110085', keyType: 'address', label: 'Delhi 110085' }, qty: 1, return: { type: RETURN_TYPES.RTO } },
  { customer: { key: 'addr:delhi 110085', keyType: 'address', label: 'Delhi 110085' }, qty: 1, return: { type: RETURN_TYPES.RTO } },
  { customer: { key: 'addr:delhi 110085', keyType: 'address', label: 'Delhi 110085' }, qty: 1, return: { type: RETURN_TYPES.RTO } },
  { customer: { key: '', keyType: 'none', label: '' }, qty: 1, return: null }
];
const { rows, totals } = offenderSummary(history, { flagAbove: 0.4, minOrders: 3 });
eq('three identifiable customers', rows.length, 3);
eq('unkeyable dispatch excluded', totals.customers, 3);

const priya = rows.find(r => r.label === 'Priya Sharma');
eq('priya orders', priya.orders, 3);
eq('priya fake count', priya.fakeReturn, 1);
eq('priya rto count', priya.rto, 1);
ok('a single fake return flags the customer', priya.flagged);
eq('fake returners sort first', rows[0].label, 'Priya Sharma');

const delhi = rows.find(r => r.label === 'Delhi 110085');
eq('address-keyed group counted', delhi.orders, 3);
eq('address group return rate', delhi.rate, 1);
ok('100% return rate over the threshold is flagged', delhi.flagged);
eq('keyType exposed so a thin count reads thin', delhi.keyType, 'address');

const ravi = rows.find(r => r.label === 'Ravi Kumar');
ok('a clean customer is not flagged', !ravi.flagged);
eq('totals', [totals.orders, totals.rto, totals.fakeReturn, totals.flagged], [9 - 1, 4, 1, 2]);

// ════ 6. Return boost in the inventory update ════
const ctx = {
  zmToKuntal: new Map([['ZM-42', ['3102']], ['ZM-46', ['2998']], ['ZM-50', ['4000']]]),
  stockMap: new Map([
    ['3102', { sku: '3102', name: 'A', colors: [{ name: 'Rani', qty: 20 }] }],
    ['2998', { sku: '2998', name: 'B', colors: [{ name: 'Chiku', qty: 0 }] }],
    ['4000', { sku: '4000', name: 'C', colors: [{ name: 'Pista', qty: 30 }] }]
  ])
};
const skus = ['ZM-42-Rani', 'ZM-46-Chiku', 'ZM-50-Pista'];
const register = [
  { id: 'x', sellerSkuCode: 'ZM-42-Rani',  zmCode: 'ZM-42', colourName: 'Rani',  qty: 4, condition: '' },
  { id: 'y', sellerSkuCode: 'ZM-46-Chiku', zmCode: 'ZM-46', colourName: 'Chiku', qty: 3, condition: 'good' },
  { id: 'z', sellerSkuCode: 'ZM-50-Pista', zmCode: 'ZM-50', colourName: 'Pista', qty: 5, condition: 'damaged' }
];

// Toggle OFF — the headline regression. Output must be exactly as before.
const off = generateInventoryUpdate(skus, ctx, 8, 70);
eq('OFF: warehouse only, 70% of 20', off.rows[0].quantity, 14);
eq('OFF: zero warehouse stays zero', off.rows[1].quantity, 0);
eq('OFF: below-gap status unchanged', off.rows[1].status, 'below_gap');
eq('OFF: 70% of 30', off.rows[2].quantity, 21);
eq('OFF: no boost reported', off.summary.returnBoostPcs, 0);

// Toggle ON
const stockIdx = availableReturnStock(register);
const on = generateInventoryUpdate(skus, ctx, 8, 70, { returnStock: stockIdx });
eq('ON: 70% of 20 plus 4 returns', on.rows[0].quantity, 18);
eq('ON: boost reported on the row', on.rows[0].returnBoost, 4);
eq('ON: zero warehouse plus 3 returns is 3, not 0', on.rows[1].quantity, 3);
eq('ON: that row is marked returns_only', on.rows[1].status, 'returns_only');
eq('ON: damaged returns contribute nothing', on.rows[2].quantity, 21);
eq('ON: damaged boost is zero', on.rows[2].returnBoost, 0);
eq('ON: total boost', on.summary.returnBoostPcs, 7);
eq('ON: returns_only counted', on.summary.returnsOnly, 1);

// The gap rule still governs only the warehouse part
const tinyStock = {
  zmToKuntal: new Map([['ZM-42', ['3102']]]),
  stockMap: new Map([['3102', { sku: '3102', name: 'A', colors: [{ name: 'Rani', qty: 5 }] }]])
};
const belowGap = generateInventoryUpdate(['ZM-42-Rani'], tinyStock, 8, 70, { returnStock: stockIdx });
eq('warehouse below the gap contributes 0, returns still count', belowGap.rows[0].quantity, 4);
eq('and the row says so', belowGap.rows[0].status, 'returns_only');

// Declaring is not consuming
eq('the register is untouched by generating', register.find(r => r.id === 'x').qty, 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
