// Matching stock to Kuntal codes. Found on the owner's real files: saree
// item numbers end in " M" ("9551 M"), so ZM-38 = 9551 never found its saree.
// " M" is the same product (owner); "(UNST)" is a different one (owner).

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { normItemNo } from './utils.js';
import { parseStockFile } from './excel-parser.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ════ 1. The item-number rule ════
eq('"9551 M" is 9551', normItemNo('9551 M'), '9551');
eq('"1008 M." is 1008', normItemNo('1008 M.'), '1008');
eq('"9551M" is 9551', normItemNo('9551M'), '9551');
eq('lower-case m too', normItemNo('9551 m'), '9551');
eq('THE RULE: an unstitched blouse stays its own product', normItemNo('3107(UNST)'), '3107(UNST)');
eq('a lone M is left alone', normItemNo('M'), 'M');
eq('the trailing dot rule still works', normItemNo('3121.'), '3121');
eq('words ending in M are left alone', normItemNo('REYMOND M'), 'REYMOND M');

// ════ 2. The same saree twice on one day is one item ════
const HEAD = ['ITEM NO', 'ITEM NAME', 'SUB LOCATION', 'COLOR', 'READY STOCK', 'SALES PCS', 'BAL PCS'];
const parsed = parseStockFile([
  HEAD,
  ['1121', 'A', 'MAIN GODOWN', '(Rani * 2 )', 2, 0, 2],
  ['1121 M', 'A', 'MAIN GODOWN', '(Rani * 1 )( Pista * 3 )', 4, 0, 4]
], 'saree');
eq('one item', parsed.items.length, 1);
eq('stored under the plain code', parsed.items[0].sku, '1121');
eq('colours added together',
  parsed.items[0].colors.map(c => [c.name, c.qty]).sort(), [['Pista', 3], ['Rani', 3]]);
eq('total', parsed.items[0].totalQty, 6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
