// Stock files sometimes carry the item name in ITEM NO and the number in
// ITEM NAME ("VELLY | 3447"), or both in one cell ("3144 SANDHYA"). One rule
// puts the number in ITEM NO and the words in ITEM NAME — for uploads and
// for stock already saved. Patterns below are the real ones from the
// owner's 2026 files.

import { isCodeLike, proposeFix, ruleKey, fixItemColumns, effectiveRules, fixWarningCodes } from './item-columns.js';
import { parseStockFile } from './excel-parser.js';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};

const it = (sku, name) => ({ sku, name, colors: [{ name: 'Rani', qty: 1 }], totalQty: 1 });
const one = (sku, name, cat = 'saree', rules = []) => fixItemColumns([it(sku, name)], cat, rules);

eq('code-like', ['3447', '9551 M', '9551M.', '4094 (UNST)', '3121.', 'VELLY', '3144 SANDHYA', '1'].map(isCodeLike),
  [true, true, true, true, true, false, false, false]);
eq('rule key: category + cleaned code + proposed number, upper case', ruleKey('saree', 'velly.', '1465.'), 'saree|VELLY|1465');
eq('nothing to propose for a right-way row', proposeFix('4041', 'AVLON'), null);

// Switches (real patterns)
for (const [no, nm, code, word] of [['VELLY', '3447', '3447', 'VELLY'], ['AAROHI', '3296', '3296', 'AAROHI'], ['MATHS-3', '1300', '1300', 'MATHS-3'],
  ['RHEA', '1475', '1475', 'RHEA'], ['AARYA RETURN -2', '3431', '3431', 'AARYA RETURN -2'], ['AVSAR JACQUARD', '3226', '3226', 'AVSAR JACQUARD'],
  ['X SILK', '9551 M', '9551', 'X SILK'], ['Y', '4094 (UNST)', '4094 (UNST)', 'Y']]) {
  const r = one(no, nm);
  eq(`switch ${no} | ${nm}`, [r.items[0].sku, r.items[0].name, r.fixes[0]?.kind, r.fixes[0]?.status], [code, word, 'switch', 'fixed']);
}

// Splits (the 6 real patterns; sku as the parser stores it — trailing dot already trimmed)
for (const [no, nm, code, word] of [['1140 ROHINI FENDY', '1140 ROHINI FENDY', '1140', 'ROHINI FENDY'], ['3144 SANDHYA', '3144 SANDHYA', '3144', 'SANDHYA'],
  ['3538-RASMIKA', '3538-3538', '3538', 'RASMIKA'], ['3186.(UNST)RASHMIKA', '3186.(UNST)RASHMIKA.', '3186 (UNST)', 'RASHMIKA'],
  ['3229(UNTS)', 'BARSHA(UNTS)', '3229 (UNST)', 'BARSHA'], ['3137 UNST', '3137 UNST', '3137 (UNST)', '3137 (UNST)']]) {
  const r = one(no, nm);
  eq(`split ${no}`, [r.items[0].sku, r.items[0].name, r.fixes[0]?.kind], [code, word, 'split']);
}

// Untouched
for (const [no, nm] of [['4041', 'AVLON'], ['3044', '3044'], ['FREIGHT CHARGE', 'FREIGHT CHARGE'], ['GOA', 'GOA..'], ['3297A', 'NAME'], ['9551', 'SAREE 9551'], ['4094 (UNST)', 'FLEMINGO (UNST)']]) {
  const r = one(no, nm);
  eq(`untouched ${no} | ${nm}`, [r.fixes.length, r.items[0].sku, r.items[0].name], [0, no, nm]);
}

// Clash: 1300 already belongs to ROJA in the same list
const clash = fixItemColumns([it('1300', 'ROJA'), it('MATHS-3', '1300')], 'saree');
eq('clash not applied', [clash.items.map(i => i.sku), clash.fixes[0].status, clash.fixes[0].clashWith], [['1300', 'MATHS-3'], 'clash', 'ROJA']);
eq('clash applied when remembered "fix"',
  fixItemColumns([it('1300', 'ROJA'), it('MATHS-3', '1300')], 'saree', [{ category: 'saree', from: 'MATHS-3', to: '1300', decision: 'fix' }]).items.map(i => i.sku), ['1300', '1300']);
// Same product written both ways → applied (the caller merges them into one)
eq('same product both ways is not a clash', fixItemColumns([it('3447', 'VELLY'), it('VELLY', '3447')], 'saree').fixes[0].status, 'fixed');
eq('names compared ignoring case and trailing dots', fixItemColumns([it('1475', 'Rhea.'), it('RHEA', '1475')], 'saree').fixes[0].status, 'fixed');

// Remembered keep, and rules only for their own category
const keepRule = [{ category: 'saree', from: 'VELLY', to: '3447', decision: 'keep' }];
eq('keep', [one('VELLY', '3447', 'saree', keepRule).items[0].sku, one('VELLY', '3447', 'saree', keepRule).fixes[0].status], ['VELLY', 'kept']);
eq('a lehnga rule does not touch saree', one('VELLY', '3447', 'saree', [{ category: 'lehnga', from: 'VELLY', to: '3447', decision: 'keep' }]).items[0].sku, '3447');
eq('a rule for RHEA→1475 does not touch RHEA→1454', one('RHEA', '1454', 'saree', [{ category: 'saree', from: 'RHEA', to: '1475', decision: 'keep' }]).items[0].sku, '1454');
eq('input items are not changed', (() => { const a = [it('VELLY', '3447')]; fixItemColumns(a, 'saree'); return a[0].sku; })(), 'VELLY');
eq('other fields kept', one('VELLY', '3447').items[0].colors, [{ name: 'Rani', qty: 1 }]);
eq('fix record', one('VELLY', '3447').fixes[0], { key: 'saree|VELLY|3447', category: 'saree', from: { sku: 'VELLY', name: '3447' }, to: { sku: '3447', name: 'VELLY' }, kind: 'switch', status: 'fixed' });

// effectiveRules: ticks → remembered rules
const fx = fixItemColumns([it('VELLY', '3447'), it('1300', 'ROJA'), it('MATHS-3', '1300')], 'saree').fixes;
eq('untick a fix → keep; tick a clash → fix',
  effectiveRules([], fx, new Map([['saree|VELLY|3447', false], ['saree|MATHS-3|1300', true]])),
  [{ category: 'saree', from: 'VELLY', to: '3447', decision: 'keep' }, { category: 'saree', from: 'MATHS-3', to: '1300', decision: 'fix' }]);
const kept = fixItemColumns([it('VELLY', '3447')], 'saree', keepRule).fixes;
eq('tick a kept one → forget it', effectiveRules(keepRule, kept, new Map([['saree|VELLY|3447', true]])), []);
const fixRule = [{ category: 'saree', from: 'MATHS-3', to: '1300', decision: 'fix' }];
const forced = fixItemColumns([it('1300', 'ROJA'), it('MATHS-3', '1300')], 'saree', fixRule).fixes;
eq('untick a remembered clash fix → forget it', effectiveRules(fixRule, forced, new Map([['saree|MATHS-3|1300', false]])), []);
eq('defaults change nothing', effectiveRules([{ category: 'lehnga', from: 'ASIAN', to: '6493', decision: 'keep' }], fx, new Map(fx.map(f => [f.key, f.status === 'fixed']))),
  [{ category: 'lehnga', from: 'ASIAN', to: '6493', decision: 'keep' }]);
eq('no key twice', effectiveRules(keepRule, fixItemColumns([it('VELLY', '3447')], 'saree').fixes, new Map([['saree|VELLY|3447', false]])), keepRule);

// The parser keeps each word + number pair as its own product: one word can
// carry several (RHEA → 1454 and 1475 in the real saree file).
const HEAD = ['ITEM NO', 'ITEM NAME', 'SUB LOCATION', 'COLOR', 'READY STOCK', 'SALES PCS', 'BAL PCS'];
const parsed = parseStockFile([HEAD,
  ['RHEA', '1475', 'MAIN GODOWN', '(Rani * 2 )', 2, 0, 2],
  ['RHEA.', '1454.', 'MAIN GODOWN', '(Pink * 3 )', 3, 0, 3],
  ['RHEA', '1475', 'SALES STUDIO', '(Rani * 1 )', 1, 0, 1],
  ['4041', 'AVLON', 'MAIN GODOWN', '(Red * 1 )', 1, 0, 1]], 'saree').items;
eq('parser: one word, two products → two items', parsed.map(i => `${i.sku}|${i.name}|${i.totalQty}`).sort(), ['4041|AVLON|1', 'RHEA|1454.|3', 'RHEA|1475|3']);
eq('…which the rule turns into 1454 and 1475', fixItemColumns(parsed, 'saree').items.map(i => `${i.sku}|${i.name}|${i.totalQty}`).sort(),
  ['1454|RHEA|3', '1475|RHEA|3', '4041|AVLON|1']);

// ── Review fix 2: a fixed item remembers where it came from, so a later
// "keep" turns a day already saved as 3447 back into VELLY when read ──
const fixedOne = one('VELLY', '3447').items[0];
eq('a fixed item carries fixedFrom', fixedOne.fixedFrom, { sku: 'VELLY', name: '3447' });
const savedFixed = { ...it('3447', 'VELLY'), fixedFrom: { sku: 'VELLY', name: '3447' } };
eq('saved fixed day + keep → read back as VELLY', fixItemColumns([savedFixed], 'saree', keepRule).items.map(i => [i.sku, i.name, i.fixedFrom]), [['VELLY', '3447', undefined]]);
eq('saved fixed day, no keep → stays 3447', fixItemColumns([savedFixed], 'saree').items[0].sku, '3447');
eq('a keep for another number does not reverse it', fixItemColumns([savedFixed], 'saree', [{ category: 'saree', from: 'VELLY', to: '9999', decision: 'keep' }]).items[0].sku, '3447');

// ── Review fix 3: decisions follow the clash, not the stored rule ──
// A remembered 'fix' on a day with no clash: untick must keep it as in file
const fixNoClash = fixItemColumns([it('MATHS-3', '1300')], 'saree', fixRule).fixes;
eq('remembered fix, no clash today, unticked → keep', effectiveRules(fixRule, fixNoClash, new Map([['saree|MATHS-3|1300', false]])),
  [{ category: 'saree', from: 'MATHS-3', to: '1300', decision: 'keep' }]);
// A remembered 'keep' on a day that is a clash: tick must fix it anyway
const keepMaths = [{ category: 'saree', from: 'MATHS-3', to: '1300', decision: 'keep' }];
const keptClash = fixItemColumns([it('1300', 'ROJA'), it('MATHS-3', '1300')], 'saree', keepMaths).fixes;
eq('remembered keep on a clash day, ticked → fix', effectiveRules(keepMaths, keptClash, new Map([['saree|MATHS-3|1300', true]])),
  [{ category: 'saree', from: 'MATHS-3', to: '1300', decision: 'fix' }]);
eq('…and that rule really fixes it', fixItemColumns([it('1300', 'ROJA'), it('MATHS-3', '1300')], 'saree',
  effectiveRules(keepMaths, keptClash, new Map([['saree|MATHS-3|1300', true]]))).items.map(i => i.sku), ['1300', '1300']);

// ── Minor 1: two different words sent to one number are a clash, not a merge ──
const twoWords = fixItemColumns([it('RHEA', '1475'), it('ROJA', '1475')], 'saree');
eq('two words → one number: both need you', [twoWords.fixes.map(f => f.status), twoWords.items.map(i => i.sku)], [['clash', 'clash'], ['RHEA', 'ROJA']]);
eq('…each names the other', twoWords.fixes.map(f => f.clashWith), ['ROJA', 'RHEA']);
const twoSplits = fixItemColumns([it('3144 RED', '3144 RED'), it('3144 BLUE', '3144 BLUE')], 'saree');
eq('two splits → one number: both need you', twoSplits.fixes.map(f => f.status), ['clash', 'clash']);
eq('same word written twice is still one product', fixItemColumns([it('RHEA', '1475'), it('RHEA.', '1475')], 'saree').fixes.map(f => f.status), ['fixed', 'fixed']);
eq('a remembered fix settles one of them', fixItemColumns([it('RHEA', '1475'), it('ROJA', '1475')], 'saree',
  [{ category: 'saree', from: 'RHEA', to: '1475', decision: 'fix' }]).items.map(i => i.sku), ['1475', 'ROJA']);
// "UNSTITCHED" spelled out (or misspelt) keeps the unstitched marker
for (const [no, code] of [['4094 UNSTITCHED', '4094 (UNST)'], ['4094 (UNSTITCHED)', '4094 (UNST)'], ['3144 UNSTICHED', '3144 (UNST)']])
  eq(`unstitched spelled out: ${no}`, [one(no, 'FLEMINGO').items[0].sku, one(no, 'FLEMINGO').items[0].name], [code, 'FLEMINGO']);

// ── Minor 4: warning rows show the exact number, even when one word carries two products ──
const rheaRaw = [it('RHEA', '1454'), it('RHEA', '1475')];
const warned = fixWarningCodes({
  balPcsMismatches: [{ sku: 'RHEA', name: '1454', category: 'saree', diff: 1 }],
  colourErrors: [{ found: 'Ranii', skus: ['RHEA'], items: [{ sku: 'RHEA', name: '1454' }, { sku: 'RHEA', name: '1475' }], category: 'saree' }]
}, 'saree', rheaRaw, []);
eq('BAL PCS row → its own number', [warned.balPcsMismatches[0].sku, warned.balPcsMismatches[0].name], ['1454', 'RHEA']);
eq('colour warning → both numbers', warned.colourErrors[0].skus, ['1454', '1475']);
eq('a kept product keeps its word in warnings', fixWarningCodes({ balPcsMismatches: [{ sku: 'RHEA', name: '1454' }], colourErrors: [] }, 'saree', rheaRaw,
  [{ category: 'saree', from: 'RHEA', to: '1454', decision: 'keep' }]).balPcsMismatches[0].sku, 'RHEA');
const parsedWarn = parseStockFile([HEAD,
  ['RHEA', '1454', 'MAIN GODOWN', '(Ranii * 2 )', 2, 0, 2],
  ['RHEA', '1475', 'MAIN GODOWN', '(Ranii * 1 )', 1, 0, 1]], 'saree');
eq('parser: a colour warning lists each word + number pair', (parsedWarn.validationStats.colourErrors[0]?.items || []).map(x => `${x.sku}|${x.name}`), ['RHEA|1454', 'RHEA|1475']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
