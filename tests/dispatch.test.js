globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { extractDispatchFields, parseLabelPdf } from './myntra-labels.js';
import {
  offenderKey, dispatchFromPageRecord, dispatchesFromLabel, mergeByForwardId,
  applyReturn, offenderSummary, findByForwardId,
  classifyAgainstSaved, rekeyDispatch, dispatchWritePayload, normForwardId, repeatedIds, dispatchDateError
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

// ════ 4. Return intake — a REPORT, never stock ════
// Orders & Fake Returns is deliberately not linked to the Returns & RTO
// register or to Purchase. Recording any kind of return here must produce a
// dispatch patch and NOTHING that could be written as stock.
const parcel = { id: 'd1', forwardId: 'SF001', sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11',
  colourName: 'Purple', qty: 2 };

const rto = applyReturn(parcel, { returnId: 'R1', type: RETURN_TYPES.RTO, condition: 'good', date: '2026-09-05' });
eq('RTO: no error', rto.error, null);
eq('RTO: dispatch marked returned', rto.dispatchPatch.status, DISPATCH_STATUS.RETURNED);
eq('RTO: return id recorded', rto.dispatchPatch.return.returnId, 'R1');
eq('RTO: condition recorded in the report', rto.dispatchPatch.return.condition, 'good');
ok('THE RULE: RTO produces NO stock row', !('returnRow' in rto), JSON.stringify(Object.keys(rto)));

const cust = applyReturn(parcel, { returnId: 'R2', type: RETURN_TYPES.CUSTOMER_RETURN });
eq('Customer Return: type carried', cust.dispatchPatch.return.type, RETURN_TYPES.CUSTOMER_RETURN);
ok('THE RULE: a customer return produces NO stock row', !('returnRow' in cust));

const fake = applyReturn(parcel, { returnId: 'R3', type: RETURN_TYPES.FAKE_RETURN, foundInside: 'empty box', condition: 'good' });
ok('FAKE RETURN: no stock row either', !('returnRow' in fake));
eq('FAKE RETURN: still marks the dispatch returned', fake.dispatchPatch.status, DISPATCH_STATUS.RETURNED);
eq('FAKE RETURN: records what was inside', fake.dispatchPatch.return.foundInside, 'empty box');
eq('FAKE RETURN: a condition makes no sense and is not kept', fake.dispatchPatch.return.condition, '');
eq('a genuine return never carries "found inside"',
  applyReturn(parcel, { type: RETURN_TYPES.RTO, foundInside: 'stray text' }).dispatchPatch.return.foundInside, '');

// The patch touches the dispatch and nothing else — no quantity, no SKU,
// nothing a stock writer could pick up.
eq('the patch carries only status and return', Object.keys(rto.dispatchPatch).sort(), ['return', 'status']);

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

// ════ 7. Duplicate guard — the data-loss rule ════
const saved = [
  { id: 'a', forwardId: 'SF001', return: null },
  { id: 'b', forwardId: 'SF002', return: { type: RETURN_TYPES.FAKE_RETURN, returnId: 'R9' } }
];
const classed = classifyAgainstSaved(
  [{ forwardId: 'SF003' }, { forwardId: 'sf001' }, { forwardId: ' SF 002 ' }], saved);

eq('an unseen tracking ID is new', classed[0]._dupe, 'new');
ok('and is ticked to save', classed[0]._keep === true);
eq('a saved ID with no return can be updated', classed[1]._dupe, 'exists');
ok('case does not hide a duplicate', classed[1]._existingId === 'a');
ok('an update is not ticked by default', classed[1]._keep === false);
eq('a saved ID WITH a return is locked', classed[2]._dupe, 'locked');
eq('and says what came back', classed[2]._existingReturn, RETURN_TYPES.FAKE_RETURN);
ok('spacing does not hide a duplicate either', classed[2]._existingId === 'b');

eq('normForwardId collapses spacing and case', normForwardId(' sf 12 34 '), 'SF1234');

// ════ AUDIT A. Correcting a duplicate's ID must not leave it an "update" ════
// A row read as an existing parcel is an update, and an update's payload drops
// status and return. If the user corrects the ID to a NEW parcel and the old
// flag survives, that new parcel is saved with no status at all.
let corrected = classifyAgainstSaved([{ forwardId: 'SF001', status: 'shipped', return: null }], saved)[0];
eq('read as an existing parcel', [corrected._dupe, corrected._update], ['exists', true]);
Object.assign(corrected, { forwardId: 'SF777' });
Object.assign(corrected, classifyAgainstSaved([{ ...corrected }], saved)[0]);
eq('corrected to a new ID it is new', corrected._dupe, 'new');
eq('THE RULE: and no longer an update', corrected._update, false);
eq('with no stale link to the old parcel', [corrected._existingId, corrected._existingReturn], ['', '']);
ok('so it is saved WITH its status', 'status' in dispatchWritePayload(corrected));

// ════ AUDIT C. One tracking ID on two rows of one save ════
eq('no repeats, nothing reported', repeatedIds([{ forwardId: 'A1' }, { forwardId: 'B2' }]), []);
eq('THE RULE: a repeated ID is caught', repeatedIds([{ forwardId: 'A1' }, { forwardId: 'B2' }, { forwardId: 'a1' }]), ['A1']);
eq('spacing does not hide a repeat', repeatedIds([{ forwardId: 'MY EC1' }, { forwardId: 'myec1' }]), ['MYEC1']);
eq('rows with no ID are not a clash', repeatedIds([{ forwardId: '' }, { forwardId: '' }]), []);

// ════ DISPATCH DATE — picked before a label PDF is read ════
// The date is stamped on every order in the file, so a bad one mis-dates a
// whole day at once.
const T = '2026-09-15';
eq('a real past date is fine', dispatchDateError('2026-09-10', T), '');
eq('today is fine', dispatchDateError(T, T), '');
eq('THE RULE: nothing picked is refused', dispatchDateError('', T), 'Pick the dispatch date first');
eq('THE RULE: the future is refused', dispatchDateError('2026-09-16', T), 'The dispatch date cannot be in the future');
eq('February 30th is not a date', dispatchDateError('2026-02-30', T), 'That is not a real date');
eq('month 13 is not a date', dispatchDateError('2026-13-01', T), 'That is not a real date');
eq('29 Feb in a leap year is', dispatchDateError('2024-02-29', T), '');
eq('29 Feb in a common year is not', dispatchDateError('2025-02-29', T), 'That is not a real date');
eq('dd/mm/yyyy is not what the picker gives', dispatchDateError('10/09/2026', T), 'That is not a valid date');
eq('whitespace alone is nothing picked', dispatchDateError('   ', T), 'Pick the dispatch date first');
eq('the year boundary compares correctly', dispatchDateError('2025-12-31', '2026-01-01'), '');

// Every order read from the file carries the chosen date
const dated = dispatchesFromLabel([{ page: 1, forwardId: 'MYEC1' }, { page: 2, forwardId: 'MYEC2' }],
  { sourceFile: 'day.pdf', dispatchDate: '2026-09-10' });
eq('every order in the file gets the picked date', dated.map(d => d.dispatchDate), ['2026-09-10', '2026-09-10']);

// ════ 8. The write payload — what actually reaches Firestore ════
const fresh = { forwardId: 'SF9', status: 'shipped', return: null, qty: 2, _keep: true, _dupe: 'new' };
const asNew = dispatchWritePayload(fresh);
ok('a new record keeps its status', asNew.status === 'shipped');
ok('review-only fields never reach the database', !('_keep' in asNew) && !('_dupe' in asNew));

const asUpdate = dispatchWritePayload({ ...fresh, _update: true });
ok('THE RULE: an update carries no status', !('status' in asUpdate));
ok('THE RULE: an update carries no return', !('return' in asUpdate));
ok('but still carries the details being corrected', asUpdate.qty === 2 && asUpdate.forwardId === 'SF9');

// ════ 9. Re-keying after an edit ════
const addrKeyed = dispatchFromPageRecord({
  page: 1, forwardId: 'SF5', orderId: 'O5', customerName: '', address: 'Delhi 110085', missing: ['customerName']
});
eq('grouped on the address to begin with', addrKeyed.customer.keyType, 'address');
const named = rekeyDispatch({ ...addrKeyed, customer: { ...addrKeyed.customer, name: 'Asha Devi' } });
eq('a typed name re-groups the record', named.customer.keyType, 'name');
eq('and the key follows it', named.customer.key, 'name:asha devi');
eq('the label follows too', named.customer.label, 'Asha Devi');

const noneKeyed = rekeyDispatch({ orderId: 'O7', customer: { name: '', address: '' } });
eq('with nothing but an order ID it falls back to that', noneKeyed.customer.keyType, 'order');

// ════ 10. Where the tracking ID came from ════
eq('a printed ID is marked as text',
  dispatchFromPageRecord({ page: 1, forwardId: 'SF7', forwardIdSource: 'text' }).forwardIdSource, 'text');
eq('a decoded ID is marked as barcode',
  dispatchFromPageRecord({ page: 1, forwardId: 'SF7', forwardIdSource: 'barcode' }).forwardIdSource, 'barcode');
eq('no ID means no claim about its source',
  dispatchFromPageRecord({ page: 1, forwardId: '' }).forwardIdSource, '');

// ════ 11. The barcode fallback in parseLabelPdf ════
// Page 1 prints its tracking ID; page 2 does not, so only page 2 may cost a
// rasterise. Cheap answers first is the whole design.
globalThis.__PDF_PAGES = [
  'AWB: SF1234567890123 Ship To: Priya Sharma Mumbai 400053 ZM-11-Purple',
  'Ship To: Ravi Kumar Delhi 110085 ZM-11-Purple'
];
const fakeFile = { name: 'label.pdf', arrayBuffer: async () => new ArrayBuffer(8) };
const maps = [{ sellerSkuCode: 'ZM-11-Purple', zmCode: 'ZM-11', colourName: 'Purple' }];

const asked = [];
const stubDecoder = async (page) => {
  asked.push(page._page);
  return page._page === 2 ? { value: 'SF9999888877776', format: 'code_128' } : null;
};

const withBarcode = await parseLabelPdf(fakeFile, maps, null,
  { barcodeFallback: true, decodeBarcode: stubDecoder });

eq('the decoder is asked ONLY about the page with no printed ID', asked, [2]);
eq('the printed ID is used as-is', withBarcode.pageRecords[0].forwardId, 'SF1234567890123');
eq('and marked as coming from text', withBarcode.pageRecords[0].forwardIdSource, 'text');
eq('the decoded ID fills the gap', withBarcode.pageRecords[1].forwardId, 'SF9999888877776');
eq('and is marked as coming from the barcode', withBarcode.pageRecords[1].forwardIdSource, 'barcode');
ok('a decoded page no longer reports a missing tracking ID',
  !withBarcode.pageRecords[1].missing.includes('forwardId'), JSON.stringify(withBarcode.pageRecords[1].missing));
eq('and the pages that needed decoding are reported', withBarcode.barcodePages, [2]);

const noBarcode = await parseLabelPdf(fakeFile, maps, null, { barcodeFallback: false });
eq('with the fallback off nothing is decoded', noBarcode.pageRecords[1].forwardId, '');
ok('and the gap is still flagged', noBarcode.pageRecords[1].missing.includes('forwardId'));
eq('the fulfilment aggregate is unchanged either way', noBarcode.items, withBarcode.items);
eq('both pieces still counted', noBarcode.items[0].qty, 2);
delete globalThis.__PDF_PAGES;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
