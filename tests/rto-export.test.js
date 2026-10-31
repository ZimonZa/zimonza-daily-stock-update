// RTO stock with Kuntal price: what the "Excel + Kuntal Price" file holds,
// and file dates taken on the LOCAL calendar — toISOString() is UTC, so an
// export before 05:30 IST used to carry yesterday's date.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { exportDateStamp } from './utils.js';
import { rtoPriceExportRows, rtoPriceSheetAoa } from './myntra-returns.js';
import { pricingIndex } from './myntra-pricing.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ════ 1. File-name date ════
eq('local date, early morning', exportDateStamp(new Date(2026, 9, 31, 2, 15)), '31-10-2026');
eq('zero-padded day and month', exportDateStamp(new Date(2026, 0, 5)), '05-01-2026');

// ════ 2. Rows ════
const codes = [
  { zmCode: 'ZM-42', kuntalCode: '3102', colours: [{ name: 'Rani', pcs: 4 }, { name: 'Black', pcs: 2 }], pcs: 6 },
  { zmCode: 'ZM-43', kuntalCode: '', colours: [{ name: 'Chiku', pcs: 3 }, { name: 'Pyazi', pcs: 2 }], pcs: 5 },
  { zmCode: 'ZM-99', kuntalCode: '', colours: [{ name: 'Red', pcs: 1 }], pcs: 1 }
];
const priceIdx = pricingIndex([
  { zmCode: 'ZM-42', kuntalSellingPrice: 8990 },
  { zmCode: 'ZM-043', kuntalCode: '3095', kuntalSellingPrice: 6450 }
]);
const r = rtoPriceExportRows(codes, priceIdx);

eq('one row per ZM code, colours in one cell, value = pcs × price', r.rows[0],
  { zmCode: 'ZM-42', kuntalCode: '3102', colourList: 'Rani 4 · Black 2', pcs: 6, price: 8990, value: 53940 });
eq('Kuntal code falls back to pricing; zero-padded ZM-043 matches ZM-43', r.rows[1].kuntalCode, '3095');
eq('priced from the padded code', r.rows[1].value, 32250);
eq('no price → blank price', r.rows[2].price, null);
eq('no price → blank value, never 0', r.rows[2].value, null);
eq('grand total pieces counts every code', r.totalPcs, 12);
eq('grand total value covers priced codes only', r.totalValue, 86190);
eq('unpriced codes are counted', r.unpriced, 1);

// ════ 3. Sheet ════
const aoa = rtoPriceSheetAoa(r);
eq('header', aoa[0], ['ZM Code', 'Kuntal Code', 'Colours', 'Total Pcs', 'Kuntal Price', 'Value']);
eq('header + 3 rows + total + note', aoa.length, 6);
eq('grand total row', aoa[4], ['GRAND TOTAL', '', '', 12, '', 86190]);
ok('note says how many codes have no price', String(aoa[5][2]).includes('1 ZM code(s) have no Kuntal price'), aoa[5]);
eq('numbers stay numbers so Excel can add them', typeof aoa[1][4], 'number');
eq('a blank price is an empty cell', aoa[3][4], '');

const allPriced = rtoPriceSheetAoa(rtoPriceExportRows(codes.slice(0, 2), priceIdx));
eq('every code priced → no note row', allPriced.length, 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
