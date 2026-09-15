// Purchase money and stock logic that had no tests at all:
//   buildPlan    — decides what is pulled from RTO stock and what is BOUGHT
//   shortfallOf  — what a supplier has not yet sent against a bill
// Both decide real money and real pieces, so both are pinned here.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { buildPlan } from './myntra-fulfilment.js';
import { shortfallOf, computeLine, computeTotals } from './myntra-purchase.js';
import { skuKey } from './myntra-labels.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ════ buildPlan — RTO first, then buy the shortfall ════
const pricing = [
  { zmCode: 'ZM-11', kuntalCode: '4132', category: 'lehnga', kuntalSellingPrice: 8990 },
  { zmCode: 'ZM-43', kuntalCode: '3095', category: 'saree', kuntalSellingPrice: 2450 }
];
const reg = (id, sku, zm, colour, qty, condition, type = 'rto') =>
  ({ id, type, sellerSkuCode: sku, zmCode: zm, colourName: colour, qty, condition, date: '2026-09-01' });
const item = (zm, colour, qty) =>
  ({ key: skuKey(zm, colour), sellerSkuCode: `${zm}-${colour}`, zmCode: zm, colourName: colour, qty, pages: [1], mapped: true });

const returns = [
  reg('r1', 'ZM-11-Purple', 'ZM-11', 'Purple', 2, 'good'),
  reg('r2', 'ZM-11-Purple', 'ZM-11', 'Purple', 1, 'damaged', 'customer_return'),
  reg('r3', 'ZM-11-Purple', 'ZM-11', 'Purple', 4, 'missing')
];

const [p1] = buildPlan([item('ZM-11', 'Purple', 5)], { pricing, ctx: null, returns });
eq('need follows the label', p1.need, 5);
eq('THE RULE: damaged and missing pieces are never pulled for a label', p1.available, 2);
eq('pull what is usable', p1.fromRto, 2);
eq('so 3 are left to buy', p1.need - p1.fromRto, 3);
eq('the rate is the Kuntal selling price', p1.rate, 8990);
eq('and the Kuntal code comes from pricing', p1.kuntalCode, '4132');
eq('included by default', p1.include, true);

const [p2] = buildPlan([item('ZM-11', 'Purple', 1)], { pricing, ctx: null, returns });
eq('never pull more than the label needs', p2.fromRto, 1);

const [p3] = buildPlan([item('ZM-43', 'Chiku', 3)], { pricing, ctx: null, returns });
eq('nothing in the register means buy it all', [p3.available, p3.fromRto], [0, 0]);
eq('priced by its own style', p3.rate, 2450);

const [p4] = buildPlan([item('ZM-99', 'Red', 2)], { pricing, ctx: null, returns: [] });
eq('an unpriced style has no rate, not a zero rate', p4.rate, null);

// A different colour of the same style is a different SKU
const [p5] = buildPlan([item('ZM-11', 'Pink', 2)], { pricing, ctx: null, returns });
eq('Purple stock is never pulled for a Pink label', p5.available, 0);

// Padding and spacing drift must not hide stock
const [p6] = buildPlan([item('ZM-011', 'purple', 1)], { pricing, ctx: null, returns });
eq('ZM-011 finds the ZM-11 register rows', p6.available, 2);

// The combo parcel: two products, each planned on its own
const combo = buildPlan([item('ZM-11', 'Purple', 1), item('ZM-43', 'Chiku', 1)], { pricing, ctx: null, returns });
eq('a combo plans each product separately', combo.map(r => [r.sellerSkuCode, r.fromRto]), [['ZM-11-Purple', 1], ['ZM-43-Chiku', 0]]);

// ════ shortfallOf — what has not arrived ════
const bill = {
  lines: [
    { sellerSkuCode: 'ZM-11-Purple', qty: 5, rate: 8990 },
    { sellerSkuCode: 'ZM-43-Chiku', qty: 3, rate: 2450 }
  ]
};
eq('no receipts recorded: nothing is short yet', shortfallOf(bill), { pcs: 0, value: 0, lines: [] });

const partial = { ...bill, receipts: [
  { sellerSkuCode: 'ZM-11-Purple', ordered: 5, received: 3 },
  { sellerSkuCode: 'ZM-43-Chiku', ordered: 3, received: 3 }
] };
const sp = shortfallOf(partial);
eq('pieces short', sp.pcs, 2);
eq('value short is the TAXABLE value of the missing pieces', sp.value, 17980);
eq('only the short line is listed', sp.lines.map(l => [l.sellerSkuCode, l.received, l.short]), [['ZM-11-Purple', 3, 2]]);
eq('THE RULE: the bill\'s own figures are never altered', partial.lines[0].qty, 5);

const missingLine = { ...bill, receipts: [{ sellerSkuCode: 'ZM-11-Purple', ordered: 5, received: 5 }] };
eq('a line absent from recorded receipts counts as not arrived', shortfallOf(missingLine).pcs, 3);

const nothing = { ...bill, receipts: [
  { sellerSkuCode: 'ZM-11-Purple', ordered: 5, received: 0 },
  { sellerSkuCode: 'ZM-43-Chiku', ordered: 3, received: 0 }
] };
eq('nothing arrived: the whole bill is short', shortfallOf(nothing).pcs, 8);

eq('an over-receipt never goes negative', shortfallOf({ ...bill, receipts: [
  { sellerSkuCode: 'ZM-11-Purple', ordered: 5, received: 9 },
  { sellerSkuCode: 'ZM-43-Chiku', ordered: 3, received: 3 }
] }).pcs, 0);

eq('a Goods Return is never "short"', shortfallOf({ ...nothing, isReturn: true }).pcs, 0);
eq('no bill at all is safe', shortfallOf(null).pcs, 0);

// Paise must not drift across many lines
const cents = { lines: Array.from({ length: 7 }, (_, i) => ({ sellerSkuCode: `S${i}`, qty: 1, rate: 0.1 })), receipts: [] };
eq('seven lines at Rs 0.10 short are exactly Rs 0.70', shortfallOf(cents).value, 0.7);

// ════ GST on a combo bill — the lehnga and saree rates side by side ════
const rates = { lehnga: 18, saree: 5 };
const l1 = computeLine({ qty: 1, rate: 8990, category: 'lehnga' }, rates, 1);
const l2 = computeLine({ qty: 1, rate: 2450, category: 'saree' }, rates, 2);
eq('lehnga at 18%: 9% CGST', l1.cgst, 809.1);
eq('saree at 5%: 2.5% SGST', l2.sgst, 61.25);
const { totals, rateSummary } = computeTotals([l1, l2]);
eq('subtotal is taxable value, ex-GST', totals.subTotal, 11440);
eq('grand total adds both halves of both rates', totals.grand, 11440 + 809.1 * 2 + 61.25 * 2);
eq('rounded to a whole rupee', totals.grandRounded, Math.round(totals.grand));
ok('and the round-off closes it exactly',
  Math.abs(totals.grand + totals.roundOff - totals.grandRounded) < 0.005, JSON.stringify(totals));
eq('one summary row per GST rate', rateSummary.map(r => r.gstRate), [5, 18]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
