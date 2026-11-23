// Every "Download sample" file, read back through the app's own reader for
// that upload. A sample that the upload rejects, or reads with errors, would
// teach the owner the wrong format.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { SAMPLES, sampleSheets } from './sample-files.js';
import { parseStockFile, validateStockFile, parseZMFile, validateZMFile } from './excel-parser.js';
import { parseInventoryFile, parseMyntraMappingFile, validateMyntraMappingFile } from './myntra.js';
import { parsePricingFile, validatePricingFile } from './myntra-pricing.js';
import { parseReturnsFile, validateReturnsFile } from './myntra-returns.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

eq('one sample per Excel upload', Object.keys(SAMPLES).sort(),
  ['colours', 'lehnga', 'myntraInventory', 'myntraMapping', 'myntraPricing', 'myntraReturns', 'saree', 'zm']);

for (const key of Object.keys(SAMPLES)) {
  const { data, help } = sampleSheets(key);
  ok(`${key}: file name`, /^Sample_[A-Za-z_]+\.xlsx$/.test(SAMPLES[key].fileName), SAMPLES[key].fileName);
  eq(`${key}: the "How to fill" sheet has a row per column`, help.length, data[0].length + 1);
  eq(`${key}: How to fill header`, help[0], ['Column', 'Required?', 'What to put', 'Example']);
  ok(`${key}: every column is Required or Optional`, help.slice(1).every(r => r[1] === 'Required' || r[1] === 'Optional'));
}

// Stock files
for (const cat of ['lehnga', 'saree']) {
  const rows = sampleSheets(cat).data;
  eq(`${cat}: the upload accepts it`, validateStockFile(rows, cat).valid, true);
  const parsed = parseStockFile(rows, cat);
  eq(`${cat}: two items`, parsed.items.length, 2);
  eq(`${cat}: no colour errors`, parsed.validationStats.colourErrors.length, 0);
  eq(`${cat}: no BAL PCS mismatches`, parsed.validationStats.balPcsMismatches.length, 0);
}
eq('lehnga sample headings', sampleSheets('lehnga').data[0],
  ['ITEM NO', 'ITEM NAME', 'SUB LOCATION', 'COLOR', 'READY STOCK', 'SALES PCS', 'BAL PCS']);

// ZM list
const zmRows = sampleSheets('zm').data;
eq('zm: accepted', validateZMFile(zmRows).valid, true);
eq('zm: headings', zmRows[0], ['Zimonza Product Code', 'Kuntal Product Code', 'Category']);
eq('zm: two codes with their category', parseZMFile(zmRows).map(m => [m.zmCode, m.category]), [['ZM-1', 'lehnga'], ['ZM-38', 'saree']]);

// Colour list (Settings reads names from column A, skipping a "Colour" header)
const colRows = sampleSheets('colours').data;
const names = colRows.map(r => String(r?.[0] || '').trim()).filter((n, i) => n && !(i === 0 && /colou?r|name/i.test(n)));
eq('colours: two names', names.length, 2);

// Myntra
const inv = parseInventoryFile(sampleSheets('myntraInventory').data);
eq('inventory: two SKUs with a quantity column', [inv.skus.length, inv.hasQuantityColumn], [2, true]);
const mapRows = sampleSheets('myntraMapping').data;
eq('mapping: accepted', validateMyntraMappingFile(mapRows).valid, true);
const map = parseMyntraMappingFile(mapRows);
eq('mapping: two mappings, none invalid', [map.mappings.length, map.invalid.length], [2, 0]);
const priceRows = sampleSheets('myntraPricing').data;
eq('pricing: accepted', validatePricingFile(priceRows).valid, true);
const price = parsePricingFile(priceRows);
eq('pricing: two rows, none skipped', [price.rows.length, price.invalidZm.length], [2, 0]);
const retRows = sampleSheets('myntraReturns').data;
eq('returns: accepted', validateReturnsFile(retRows).valid, true);
const ret = parseReturnsFile(retRows, []);
eq('returns: two rows', ret.rows.length, 2);
ok('returns: dates read', ret.rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')), JSON.stringify(ret.rows.map(r => r.date)));
eq('returns: SellerSkuCode marked required', sampleSheets('myntraReturns').help.find(r => r[0] === 'SellerSkuCode')?.[1], 'Required');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
