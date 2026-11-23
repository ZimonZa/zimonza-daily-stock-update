// Matching stock to Kuntal codes. Found on the owner's real files: saree
// item numbers end in " M" ("9551 M"), so ZM-38 = 9551 never found its saree.
// " M" is the same product (owner); "(UNST)" is a different one (owner).

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { normItemNo } from './utils.js';
import { parseStockFile } from './excel-parser.js';
import { stockKey, mergeStockItems, indexStock, lookupKuntal, latestPerCategory, loadLatestStock } from './stock-store.js';
import { analyzeStockChanges } from './stock-analyzer.js';
import { staleStockIds } from './firestore-service.js';

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

// ════ 3. One stock model: category + code ════
const item = (category, sku, colors) => ({ sku, name: sku, category, colors: colors.map(([name, qty]) => ({ name, qty })),
  totalQty: colors.reduce((t, [, q]) => t + q, 0) });
eq('the key holds category and the clean code', stockKey('saree', '9551 M'), 'saree|9551');
const merged = mergeStockItems([
  item('lehnga', '7002', [['Red', 1]]), item('saree', '7002 M', [['Red', 2]]),
  item('saree', '9551 M', [['Rani', 2]]), item('saree', '9551', [['Rani', 1], ['Pista', 4]])
]);
eq('THE RULE: lehnga and saree are never merged with each other',
  merged.filter(i => i.sku === '7002').map(i => i.category).sort(), ['lehnga', 'saree']);
const s9551 = merged.find(i => i.category === 'saree' && i.sku === '9551');
eq('the same saree twice (old stored data) becomes one, quantities added',
  [s9551?.totalQty, s9551?.colors.map(c => [c.name, c.qty]).sort()], [7, [['Pista', 4], ['Rani', 3]]]);
eq('three items after merging', merged.length, 3);

const idx = indexStock({
  lehnga: [item('lehnga', '3044', [['Mehandi', 1]]), item('lehnga', '4132', [['Rani', 5]])],
  saree: [item('saree', '3044.', [['Pink', 6]]), item('saree', '9551 M', [['Rani', 2]])]
});
const both = lookupKuntal('3044', '', idx);
eq('a code in both files, no category chosen: flagged, saree used', [both.clash, both.stock?.category, !!both.both?.lehnga], [true, 'saree', true]);
eq('category chosen: that file only', [lookupKuntal('3044', 'lehnga', idx).stock?.category, lookupKuntal('3044', 'lehnga', idx).clash], ['lehnga', false]);
eq('in one file only: that one', [lookupKuntal('4132', '', idx).stock?.category, lookupKuntal('4132', '', idx).clash], ['lehnga', false]);
eq('" M" in stock finds the plain code', lookupKuntal('9551', '', idx).stock?.category, 'saree');
eq('not in stock', lookupKuntal('2888', '', idx).stock, null);

eq('each category has its own latest date', latestPerCategory([
  { date: '2026-11-21', lehngaCount: 358, sareeCount: 0 },
  { date: '2026-11-20', lehngaCount: 350, sareeCount: 780 }
]), { lehnga: '2026-11-21', saree: '2026-11-20' });
eq('an old history record with no counts has both', latestPerCategory([{ date: '2026-11-19' }]),
  { lehnga: '2026-11-19', saree: '2026-11-19' });
eq('no history → nothing', latestPerCategory([]), { lehnga: null, saree: null });

const asked = [];
const latest = await loadLatestStock({
  listHistory: async () => [{ date: '2026-11-21', lehngaCount: 2, sareeCount: 0 }, { date: '2026-11-20', lehngaCount: 2, sareeCount: 3 }],
  getStock: async (date, cat) => { asked.push(`${date}/${cat}`); return [item(cat, cat === 'saree' ? '9551 M' : '4132', [['Rani', 1]])]; }
});
eq('loads each category from its own date', asked.sort(), ['2026-11-20/saree', '2026-11-21/lehnga']);
eq('…and returns them merged and dated', [latest.lehnga.date, latest.saree.date, latest.saree.items[0].sku], ['2026-11-21', '2026-11-20', '9551']);

// ════ 4. Comparison is per category ════
const yesterday = [item('lehnga', '4132', [['Rani', 5]]), item('saree', '9551 M', [['Rani', 2]]), item('saree', '1010', [['Pink', 1]])];
const lehngaOnly = analyzeStockChanges([item('lehnga', '4132', [['Rani', 4]])], yesterday);
eq('THE RULE: a lehnga-only day marks no saree sold out', lehngaOnly.soldOutItems.filter(i => i.category === 'saree').length, 0);
eq('…and still sees the lehnga sale', lehngaOnly.soldItems.map(i => i.sku), ['4132']);
const sameSaree = analyzeStockChanges([item('saree', '9551', [['Rani', 2]]), item('saree', '1010', [['Pink', 1]])], yesterday, { categories: ['saree'] });
eq('"9551 M" yesterday and "9551" today is the same, unchanged saree',
  [sameSaree.newArrivals.length, sameSaree.soldOutItems.length, sameSaree.unchangedItems.length], [0, 0, 2]);

// ════ 5. Re-uploading a date replaces it ════
eq('docs no longer in the file are removed (old "9551 M" and a dropped item)',
  staleStockIds(['9551 M', '4132', '1121'], [{ sku: '9551' }, { sku: '4132' }]), ['9551 M', '1121']);
eq('nothing stale → nothing removed', staleStockIds(['4132'], [{ sku: '4132' }]), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
