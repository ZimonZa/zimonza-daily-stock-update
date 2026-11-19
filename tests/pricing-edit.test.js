// Editing Myntra pricing by hand: what a typed cell becomes, what a bulk
// change does to the rows it is aimed at (and only those), and what has to
// be written when Save is pressed.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import {
  EDIT_COLUMNS, PRICE_COLUMNS, validatePriceCell, applyBulkEdit, pendingChanges
} from './myntra-pricing.js';
import { deleteMyntraPricing } from './firestore-service.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

eq('editable columns — ZM Code is the key and is not one of them', EDIT_COLUMNS,
  ['kuntalCode', 'category', 'kuntalSellingPrice', 'myntraMrp', 'myntraMuPrice', 'myntraIsp']);
eq('price columns', PRICE_COLUMNS, ['kuntalSellingPrice', 'myntraMrp', 'myntraMuPrice', 'myntraIsp']);
ok('deleteMyntraPricing exists', typeof deleteMyntraPricing === 'function');

// ════ 1. A typed cell ════
eq('a price with a thousands comma', validatePriceCell('myntraIsp', '13,849'), { value: 13849, error: '' });
eq('a blank price stays blank, never 0', validatePriceCell('myntraMrp', ''), { value: null, error: '' });
eq('a negative price is refused', validatePriceCell('kuntalSellingPrice', '-5').error, 'Enter a number 0 or more');
eq('text in a price is refused', validatePriceCell('kuntalSellingPrice', 'abc').error, 'Enter a number 0 or more');
eq('category is stored the way the upload stores it', validatePriceCell('category', ' Lehnga '), { value: 'lehnga', error: '' });
eq('kuntal code is trimmed', validatePriceCell('kuntalCode', ' 4144 '), { value: '4144', error: '' });

// ════ 2. Bulk edit hits only the chosen rows ════
const A = { zmCode: 'ZM-43', kuntalCode: '4144', category: 'lehnga', kuntalSellingPrice: 8990, myntraMrp: null, myntraMuPrice: 13830.76923, myntraIsp: 13849 };
const B = { zmCode: 'ZM-49', kuntalCode: '4150', category: 'lehnga', kuntalSellingPrice: 6450, myntraMrp: 17999, myntraMuPrice: null, myntraIsp: 9999 };
const only43 = new Set(['ZM-43']);
const byZm = (rows, zm) => rows.find(r => r.zmCode === zm);

const up = applyBulkEdit([A, B], only43, 'myntraIsp', 'pct_up', 10);
eq('+10% ISP, rounded to the rupee', byZm(up, 'ZM-43').myntraIsp, 15234);
eq('THE RULE: a row that was not chosen is untouched', byZm(up, 'ZM-49'), B);
eq('the input rows are not changed in place', A.myntraIsp, 13849);
eq('−10%', byZm(applyBulkEdit([A], only43, 'kuntalSellingPrice', 'pct_down', 10), 'ZM-43').kuntalSellingPrice, 8091);
eq('− ₹ never goes below 0', byZm(applyBulkEdit([A], only43, 'kuntalSellingPrice', 'sub', 20000), 'ZM-43').kuntalSellingPrice, 0);
eq('+ ₹ on a blank price leaves it blank', byZm(applyBulkEdit([A], only43, 'myntraMrp', 'add', 100), 'ZM-43').myntraMrp, null);
eq('set fills a blank price', byZm(applyBulkEdit([A], only43, 'myntraMrp', 'set', 9999), 'ZM-43').myntraMrp, 9999);
eq('MU price keeps 2 decimals', byZm(applyBulkEdit([A], only43, 'myntraMuPrice', 'pct_up', 10), 'ZM-43').myntraMuPrice, 15213.85);
eq('category set, stored lower-case', byZm(applyBulkEdit([A, B], new Set(['ZM-43', 'ZM-49']), 'category', 'set', 'Saree'), 'ZM-49').category, 'saree');
eq('a % change on a text column does nothing', applyBulkEdit([A], only43, 'category', 'pct_up', 10), [A]);
eq('an invalid amount does nothing', applyBulkEdit([A], only43, 'myntraIsp', 'pct_up', 'abc'), [A]);

// ════ 3. What Save writes ════
const A2 = { ...A, myntraIsp: 15234 };
const C = { zmCode: 'ZM-7', kuntalCode: '', category: '', kuntalSellingPrice: null, myntraMrp: null, myntraMuPrice: null, myntraIsp: null };
const ch = pendingChanges([A, B], [A2, C]);
eq('changed and new rows are written', ch.upserts.map(r => r.zmCode), ['ZM-43', 'ZM-7']);
eq('a removed row is deleted', ch.deletes, ['ZM-49']);
eq('nothing changed → nothing to write', pendingChanges([A, B], [{ ...A }, { ...B }]), { upserts: [], deletes: [] });
eq('zero-padded and plain ZM codes are the same row', pendingChanges([A], [{ ...A, zmCode: 'ZM-043' }]), { upserts: [], deletes: [] });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
