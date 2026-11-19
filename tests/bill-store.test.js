// The bill store: a new bill can never land on a saved one, a number is
// only handed out if no saved bill has it, and adding to a bill writes only
// what changed — receipts recorded meanwhile on another device survive.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { createPurchaseBill, reserveFreeBillNumber, appendToPurchaseBill } from './firestore-service.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

const bill = { billNo: 'INV/26-27/0042', lines: [], totals: {} };

// 1. Creating
globalThis.__fsExists = (ref) => ref.id === 'INV_26-27_0042';
globalThis.__fsSets = [];
let err = null;
try { await createPurchaseBill(bill); } catch (e) { err = e; }
ok('THE RULE: a saved bill is never overwritten by a new one', err instanceof Error, String(err));
ok('…and the message names it', /INV\/26-27\/0042/.test(err?.message || ''), err?.message);
eq('…and nothing is written', globalThis.__fsSets.length, 0);
globalThis.__fsExists = () => false;
const id = await createPurchaseBill(bill);
eq('a free number is written', [id, globalThis.__fsSets.length, globalThis.__fsSets[0]?.data.billNo], ['INV_26-27_0042', 1, 'INV/26-27/0042']);

// 2. Reserving a number
const handed = ['INV/26-27/0042', 'INV/26-27/0043'];
const got = await reserveFreeBillNumber('tax_invoice', {
  next: async () => ({ billNo: handed.shift() }),
  exists: async (no) => no === 'INV/26-27/0042'
});
eq('a number a saved bill already has is skipped', got, 'INV/26-27/0043');
err = null;
try { await reserveFreeBillNumber('tax_invoice', { next: async () => ({ billNo: 'INV/26-27/0042' }), exists: async () => true, maxTries: 3 }); }
catch (e) { err = e; }
ok('gives up with a clear message rather than loop forever', /free/i.test(err?.message || ''), err?.message);

// 3. Appending
globalThis.__fsUpdates = [];
await appendToPurchaseBill({ id: 'INV_26-27_0042', billNo: 'INV/26-27/0042', lines: [1], totals: { a: 1 }, rateSummary: [], note: 'n',
  receipts: [{ sellerSkuCode: 'X' }], parties: { p: 1 } });
const u = globalThis.__fsUpdates[0];
eq('append writes to the saved bill', u?.ref.id, 'INV_26-27_0042');
eq('THE RULE: append writes only lines, totals, tax summary, note — never receipts or parties',
  Object.keys(u?.data || {}).sort(), ['lines', 'note', 'rateSummary', 'savedAt', 'totals']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
