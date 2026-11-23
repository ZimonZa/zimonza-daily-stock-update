// Matching stock to Kuntal codes. Found on the owner's real files: saree
// item numbers end in " M" ("9551 M"), so ZM-38 = 9551 never found its saree.
// " M" is the same product (owner); "(UNST)" is a different one (owner).

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { normItemNo } from './utils.js';
import { parseStockFile } from './excel-parser.js';
import { stockKey, mergeStockItems, indexStock, lookupKuntal, latestPerCategory, loadLatestStock, loadStockAsOf, loadDayChanges, changeSinceLast } from './stock-store.js';
import { parseZMFile } from './excel-parser.js';
import { resolveStock } from './myntra.js';
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

// ════ 6. Stock as of a chosen date ════
const hist = async () => [
  { date: '2026-11-21', lehngaCount: 2, sareeCount: 3 },
  { date: '2026-11-20', lehngaCount: 2, sareeCount: 0 },
  { date: '2026-11-19', lehngaCount: 2, sareeCount: 3 }
];
const seen = [];
const getS = async (d, c) => { seen.push(`${d}/${c}`); return [item(c, '1', [['Red', 1]])]; };
await loadStockAsOf({ asOf: '2026-11-20', listHistory: hist, getStock: getS });
eq('as of the 20th: lehnga from the 20th, saree from its last upload before (19th)', seen.sort(), ['2026-11-19/saree', '2026-11-20/lehnga']);
seen.length = 0;
await loadStockAsOf({ before: '2026-11-21', listHistory: hist, getStock: getS });
eq('the day before the 21st, per category', seen.sort(), ['2026-11-19/saree', '2026-11-20/lehnga']);

// ════ 7. ZM codes carry an optional category ════
eq('a 3-column ZM file reads the category',
  parseZMFile([['Zimonza Product Code', 'Kuntal Product Code', 'Category'], ['ZM-38', '9551', 'Saree'], ['ZM-32', '3044', '']]),
  [{ zmCode: 'ZM-38', kuntalCode: '9551', category: 'saree' }, { zmCode: 'ZM-32', kuntalCode: '3044', category: '' }]);
eq('a 2-column ZM file has no category',
  parseZMFile([['Zimonza Product Code', 'Kuntal Product Code'], ['ZM-1', '4132']]), [{ zmCode: 'ZM-1', kuntalCode: '4132', category: '' }]);
eq('an unknown category is left blank, never guessed',
  parseZMFile([['Zimonza Product Code', 'Kuntal Product Code', 'Category'], ['ZM-1', '4132', 'gown']])[0].category, '');

// ════ 8. Myntra finds the saree, and flags a code in both files ════
const ctx = {
  index: indexStock({
    lehnga: [item('lehnga', '3044', [['Mehandi', 1]]), item('lehnga', '4132', [['Rani', 5]])],
    saree: [item('saree', '9551 M', [['Rani', 2]]), item('saree', '3044.', [['Pink', 6]]), item('saree', '3107(UNST)', [['Mustard', 1]])]
  }),
  zmToKuntal: new Map([
    ['ZM-38', [{ kuntalCode: '9551', category: '' }]],
    ['ZM-32', [{ kuntalCode: '3044', category: '' }]],
    ['ZM-33', [{ kuntalCode: '3044', category: 'lehnga' }]],
    ['ZM-40', [{ kuntalCode: '3107', category: '' }, { kuntalCode: '3107(UNST)', category: '' }]]
  ])
};
const r38 = resolveStock('ZM-38', ctx);
eq('ZM-38 = 9551 finds the saree "9551 M"', [r38.stock?.category, r38.kuntalCode, r38.clash], ['saree', '9551', false]);
const r32 = resolveStock('ZM-32', ctx);
eq('ZM-32 = 3044 in both files: saree used, flagged', [r32.stock?.category, r32.clash], ['saree', true]);
eq('category chosen → that file', [resolveStock('ZM-33', ctx).stock?.category, resolveStock('ZM-33', ctx).clash], ['lehnga', false]);
eq('a ZM code listing stitched + UNST finds the one in stock', resolveStock('ZM-40', ctx).kuntalCode, '3107(UNST)');
eq('no mapping', resolveStock('ZM-99', ctx).reason, 'no_zm_mapping');
// The old context shape (tests and saved callers) still works
const oldCtx = { zmToKuntal: new Map([['ZM-1', ['4132']]]), stockMap: new Map([['4132', item('lehnga', '4132', [['Rani', 5]])]]) };
eq('the older context shape still resolves', resolveStock('ZM-1', oldCtx).stock?.sku, '4132');

// ════ 9. The changes made on one day ════
const day = await loadDayChanges('2026-11-20', {
  listHistory: hist,
  getStock: async (d, c) => (d === '2026-11-20' && c === 'saree') ? [] : [item(c, d === '2026-11-20' ? '4132' : '4132', [['Rani', d === '2026-11-20' ? 3 : 5]])]
});
eq('only categories uploaded that day are compared', day.categories, ['lehnga']);
eq("…against each one's own previous upload", [day.current.length, day.previous.length, day.previous[0]?.totalQty], [1, 1, 5]);

// ════ 10. Change since the last upload, per item ════
const ch = changeSinceLast(
  [item('saree', '9551', [['Rani', 6]]), item('lehnga', '4132', [['Rani', 5]]), item('saree', '7777', [['Pink', 3]])],
  [item('saree', '9551 M', [['Rani', 8]]), item('lehnga', '4132', [['Rani', 5]])]
);
eq('fewer pieces than last upload', ch.get(stockKey('saree', '9551')), -2);
eq('no change', ch.get(stockKey('lehnga', '4132')), 0);
eq('a new item is marked new', ch.get(stockKey('saree', '7777')), 'new');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
