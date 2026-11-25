// Matching stock to Kuntal codes. Found on the owner's real files: saree
// item numbers end in " M" ("9551 M"), so ZM-38 = 9551 never found its saree.
// " M" is the same product (owner); "(UNST)" is a different one (owner).

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { normItemNo } from './utils.js';
import { parseStockFile } from './excel-parser.js';
import { stockKey, mergeStockItems, indexStock, lookupKuntal, latestPerCategory, loadLatestStock, loadStockAsOf, loadDayChanges, changeSinceLast, clearStockCache, dayChangesLabel, setColourQty, fixSavedItems, loadItemFixRules } from './stock-store.js';
import { parseZMFile } from './excel-parser.js';
import { resolveStock } from './myntra.js';
import { analyzeStockChanges, sumSummaries, mergeMismatches } from './stock-analyzer.js';
import { staleStockIds } from './firestore-service.js';
import { buildZMProduct } from './zm-mapper.js';
import { generateDailyReport, reportFileName } from './report-generator.js';
import { buildSkipRows } from './skip-manager.js';

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
// (same files as above, so the page's read cache answers — check the dates used)
const dayBefore = await loadStockAsOf({ before: '2026-11-21', listHistory: hist, getStock: getS });
eq('the day before the 21st, per category', [dayBefore.lehnga.date, dayBefore.saree.date], ['2026-11-20', '2026-11-19']);

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

// ════ 11. Dashboard period totals from the daily summaries ════
const per = sumSummaries([
  { totalSoldPcs: 116, soldCount: 56, totalRestockedPcs: 149, restockedCount: 44, newArrivalsCount: 3, soldOutCount: 2 },
  null,
  { totalSoldPcs: 4, soldCount: 2, totalRestockedPcs: 0, restockedCount: 0, newArrivalsCount: 1, soldOutCount: 0 }
]);
eq('period totals add up every saved day', [per.totalSoldPcs, per.soldCount, per.totalRestockedPcs, per.restockedCount, per.newArrivalsCount, per.soldOutCount], [120, 58, 149, 44, 4, 2]);
eq('days with and without a saved summary are counted', [per.days, per.missing], [2, 1]);
eq('nothing saved → zeros', sumSummaries([]).totalSoldPcs, 0);

// ════ 12. A ZM row remembers the id its mapping is stored under ════
// Saved by hand as "3044." (as the saree file prints it): choosing Lehnga
// must write to that document, not to a new "3044" one.
const zmIdx = indexStock({ lehnga: [item('lehnga', '3044', [['Rani', 2]])], saree: [item('saree', '3044', [['Pink', 5]])] });
const zp = buildZMProduct({ zmCode: 'ZM-32', kuntalCode: '3044.' }, {}, zmIdx);
eq('row shows the clean code', zp.kuntalCode, '3044');
eq('row keeps the stored document id', zp.docId, '3044.');
eq('the id read from the store wins', buildZMProduct({ id: '3044.', zmCode: 'ZM-32', kuntalCode: '3044' }, {}, zmIdx).docId, '3044.');
eq('a stray record (category only, no code) can still be addressed', buildZMProduct({ id: '3044', category: 'lehnga' }, {}, zmIdx).docId, '3044');
eq('code in both files is a clash', zp.clash, true);
eq('chosen category is used', buildZMProduct({ zmCode: 'ZM-32', kuntalCode: '3044', category: 'lehnga' }, {}, zmIdx).totalQty, 2);

// ════ 13. Each stock document is read once per page ════
// Dashboard / Reports ask for "stock as of D" and "changes on D": both need
// D's two categories and the history. Firestore bills every read.
{
  const reads = { history: 0, stock: [] };
  const listHistory = async () => { reads.history++; return [{ date: '2026-11-20', lehngaCount: 1, sareeCount: 1 }, { date: '2026-11-21', lehngaCount: 1, sareeCount: 1 }]; };
  const getStock = async (d, c) => { reads.stock.push(d + c); return [item(c, '7002', [['Rani', d === '2026-11-21' ? 1 : 3]])]; };
  const now = await loadStockAsOf({ asOf: '2026-11-21', listHistory, getStock });
  const day = await loadDayChanges('2026-11-21', { listHistory, getStock });
  await loadStockAsOf({ before: '2026-11-21', listHistory, getStock });
  eq('history read once', reads.history, 1);
  eq('each day and category read once', reads.stock.sort(), ['2026-11-20lehnga', '2026-11-20saree', '2026-11-21lehnga', '2026-11-21saree']);
  eq('cached reads give the same figures', [now.lehnga.items[0].totalQty, day.previous[0].totalQty], [1, 3]);
  now.lehnga.items[0].colors[0].qty = 99;   // a page changing what it got…
  eq('…never changes what the next caller gets', (await loadStockAsOf({ asOf: '2026-11-21', listHistory, getStock })).lehnga.items[0].totalQty, 1);
  clearStockCache();
  await loadStockAsOf({ asOf: '2026-11-21', listHistory, getStock });
  eq('clearStockCache reads again', reads.history, 2);
}

// ════ 14. Daily report = stock as of that date, each category its own upload ════
{
  const listHistory = async () => [{ date: '2026-11-21', lehngaCount: 1, sareeCount: 2 }, { date: '2026-11-22', lehngaCount: 1, sareeCount: 0 }];
  const files = {
    '2026-11-21|lehnga': [item('lehnga', '4132', [['Rani', 5]])],
    '2026-11-21|saree': [item('saree', '9551 M', [['Pink', 2]]), item('saree', '9551', [['Rani', 1]])],
    '2026-11-22|lehnga': [item('lehnga', '4132', [['Rani', 4]])]
  };
  const getStock = async (d, c) => files[`${d}|${c}`] || [];
  const rep = await generateDailyReport('2026-11-22', { listHistory, getStock, getSummary: async () => null });
  eq('lehnga-only day still reports the sarees from their last upload', rep.items.map(i => `${i.category} ${i.sku} ${i.totalQty}`).sort(), ['lehnga 4132 4', 'saree 9551 3']);
  eq('report says which upload each category is from', rep.stockDates, { lehnga: '2026-11-22', saree: '2026-11-21' });
  eq('totals follow', [rep.totalSKUs, rep.totalPcs], [2, 7]);
}

// ════ 15. Pages say which files a day's changes come from ════
const fmtD = (d) => d.split('-').reverse().join('/');
eq('both files that day', dayChangesLabel({ categories: ['lehnga', 'saree'] }, '2026-11-21', fmtD),
  'Lehnga and saree uploaded on 21/11/2026 — each compared with its own previous upload');
eq('one file that day', dayChangesLabel({ categories: ['lehnga'] }, '2026-11-22', fmtD),
  'Only lehnga uploaded on 22/11/2026 — saree not compared');
eq('nothing that day', dayChangesLabel({ categories: [] }, '2026-11-23', fmtD), 'Nothing uploaded on 23/11/2026');

// ════ 16. Upload review: editing a colour changes the right item ════
// Lehnga 7002 and saree "7002 M" are both code 7002 — the review must not
// edit one when the owner changes the other.
{
  const items = [item('lehnga', '7002', [['Pink', 4]]), item('saree', '7002', [['Pink', 3], ["D'Firozi", 2]])];
  const got = setColourQty(items, stockKey('saree', '7002'), 'pink', '1');
  eq('the saree changes', [got.category, got.totalQty, items[1].colors[0].qty], ['saree', 3, 1]);
  eq('the lehnga with the same code does not', items[0].totalQty, 4);
  eq("a colour with an apostrophe can be edited", setColourQty(items, stockKey('saree', '7002'), "D'Firozi", '5').totalQty, 6);
  eq('negative or blank → 0', setColourQty(items, stockKey('lehnga', '7002'), 'Pink', '-3').totalQty, 0);
  eq('unknown item → null', setColourQty(items, stockKey('saree', '9999'), 'Pink', '1'), null);
}

// ════ 17. BAL PCS mismatches survive a second upload the same day ════
{
  const morning = [{ sku: '4132', category: 'lehnga', diff: 2 }, { sku: '9551', category: 'saree', diff: -1 }];
  const sareeAgain = [{ sku: '1008', category: 'saree', diff: 3 }];
  eq('a saree-only re-upload keeps the lehnga rows and replaces the saree ones',
    mergeMismatches(morning, sareeAgain, ['saree']).map(m => m.sku), ['4132', '1008']);
  eq('both files again → only the new rows', mergeMismatches(morning, sareeAgain, ['lehnga', 'saree']).map(m => m.sku), ['1008']);
  eq('nothing saved before', mergeMismatches(null, sareeAgain, ['saree']).length, 1);
  eq('capped for the 1 MB document limit', mergeMismatches([], Array.from({ length: 2500 }, (_, i) => ({ sku: String(i), category: 'saree' })), ['saree']).length, 2000);
}

// ════ 18. Merging old "9551 M" + "9551" records keeps everything ════
{
  const a = { ...item('saree', '9551 M', [['Rani', 1]]), stockLevel: 'low',
    locations: { 'MAIN GODOWN': [{ name: 'Rani', qty: 1 }] } };
  const b = { ...item('saree', '9551', [['Rani', 9], ['Pink', 8]]), stockLevel: 'high',
    locations: { 'MAIN GODOWN': [{ name: 'Rani', qty: 4 }], 'SALES STUDIO': [{ name: 'Rani', qty: 5 }, { name: 'Pink', qty: 8 }] } };
  const [m] = mergeStockItems([a, b]);
  eq('locations from both records, pieces added per colour', m.locations,
    { 'MAIN GODOWN': [{ name: 'Rani', qty: 5 }], 'SALES STUDIO': [{ name: 'Rani', qty: 5 }, { name: 'Pink', qty: 8 }] });
  eq('level worked out again from the merged colours', m.stockLevel, 'high');
  eq('a single record is left as it is', mergeStockItems([a])[0].stockLevel, 'low');
  eq('the input records are not changed', a.locations['MAIN GODOWN'][0].qty, 1);
}

// ════ 19. Report files are named with the day first ════
eq('daily CSV', reportFileName('daily', '2026-11-21', 'csv'), 'zimonza-daily_21-11-2026.csv');
eq('weekly PDF', reportFileName('weekly', '2026-11-21', 'pdf'), 'zimonza-weekly_21-11-2026.pdf');
eq('no slash ever reaches a file name', /[\\/]/.test(reportFileName('daily', '2026-11-21', 'xlsx')), false);

// ════ 20. Skip Panel follows the Lehnga / Saree choice made in the ZM Panel ════
{
  const idx = indexStock({ lehnga: [item('lehnga', '3044', [['Rani', 2]])], saree: [item('saree', '3044', [['Pink', 5]]), item('saree', '9551', [['Pink', 7]])] });
  const rows = buildSkipRows(
    [{ sku: '3044', notes: 'x' }, { sku: '9551 M' }, { sku: '4113' }],
    [{ zmCode: 'ZM-32', kuntalCode: '3044.', category: 'lehnga' }],
    idx);
  eq('chosen category used (mapping stored as "3044.")', [rows[0].category, rows[0].totalQty], ['lehnga', 2]);
  eq('no choice → the one file that has it', [rows[1].category, rows[1].totalQty], ['saree', 7]);
  eq('not in stock', [rows[2].name, rows[2].stockLevel], ['—', 'sold_out']);
  eq('notes kept', rows[0].notes, 'x');
}

// ════ 21. Old saved stock: swapped / mixed item numbers fixed when read ════
{
  clearStockCache();
  const listHistory = async () => [{ date: '2026-11-20', lehngaCount: 0, sareeCount: 2 }, { date: '2026-11-21', lehngaCount: 0, sareeCount: 2 }];
  const files = {
    // saved before the fix: the word is the code
    '2026-11-20|saree': [{ ...item('saree', 'VELLY', [['Rani', 5]]), name: '3447' }, { ...item('saree', '3144 SANDHYA', [['Pink', 2]]), name: '3144 SANDHYA' }],
    // saved after the fix
    '2026-11-21|saree': [{ ...item('saree', '3447', [['Rani', 4]]), name: 'VELLY' }, { ...item('saree', '3144', [['Pink', 2]]), name: 'SANDHYA' }]
  };
  const getStock = async (d, c) => files[`${d}|${c}`] || [];
  let ruleReads = 0;
  const getRules = async () => { ruleReads++; return []; };
  const old = await loadStockAsOf({ asOf: '2026-11-20', listHistory, getStock, getRules });
  eq('old day reads with numbers', old.saree.items.map(i => i.sku), ['3447', '3144']);
  eq('…and the word as the name', old.saree.items[0].name, 'VELLY');
  const day = await loadDayChanges('2026-11-21', { listHistory, getStock, getRules });
  const a = analyzeStockChanges(day.current, day.previous, { categories: day.categories });
  eq('no false new arrival or sold out across the change', [a.newArrivals.length, a.soldOutItems.length], [0, 0]);
  eq('the real sale still shows', a.soldItems.map(i => i.sku), ['3447']);
  eq('rules read once per page', ruleReads, 1);

  clearStockCache();
  const keep = async () => [{ category: 'saree', from: 'VELLY', to: '3447', decision: 'keep' }];
  eq('a remembered keep leaves the old day as saved',
    (await loadStockAsOf({ asOf: '2026-11-20', listHistory, getStock, getRules: keep })).saree.items.map(i => i.sku), ['VELLY', '3144']);

  clearStockCache();
  const both = { '2026-11-20|saree': [{ ...item('saree', '3447', [['Rani', 1]]), name: 'VELLY' }, { ...item('saree', 'VELLY', [['Rani', 2]]), name: '3447' }] };
  const one = await loadStockAsOf({ asOf: '2026-11-20', listHistory, getStock: async (d, c) => both[`${d}|${c}`] || [], getRules });
  eq('the same product saved both ways is one item', one.saree.items.map(i => `${i.sku}:${i.totalQty}`), ['3447:3']);

  eq('fixSavedItems (Upload Center reads)', fixSavedItems([{ sku: 'VELLY', name: '3447', colors: [{ name: 'Rani', qty: 2 }] }], 'saree', []).map(i => [i.sku, i.name, i.category, i.totalQty]),
    [['3447', 'VELLY', 'saree', 2]]);
  clearStockCache();
  eq('loadItemFixRules reads the rules', await loadItemFixRules(keep), [{ category: 'saree', from: 'VELLY', to: '3447', decision: 'keep' }]);
  clearStockCache();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
