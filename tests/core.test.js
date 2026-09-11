// Core logic: the rules this business runs on, and the traps already hit.
// Every assertion here encodes a decision or a bug that once shipped.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import {
  normZmCode, toNum, round2, formatINR, amountInWords, formatDateDisplay, normColorKey
} from './utils.js';
import { parseSellerSku, generateInventoryUpdate, isExportable } from './myntra.js';
import { computeLine, computeTotals, resolveGstRate } from './myntra-purchase.js';
import { normReturnDate, resolveColumns, parseReturnsFile, correctColour, buildColourLookup,
         availableReturnStock, allocateFromReturns, isPullable, summariseReturnStock } from './myntra-returns.js';
import { swatchFor, luminance } from './swatches.js';
import { fileStem, classifySize, classifyText, classifyPdf, buildGroups, mergedFileName, byFileName, copyIndex } from './pdf-merge.js';
import { PURCHASE_DOC_TYPES, PURCHASE_ONLY_DOC_TYPES, isReturnDocType, isStockReturn, RETURN_TYPES } from './constants.js';
import { keyFromSellerSku, skuKey } from './myntra-labels.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ════ ZM code padding — the join the whole pricing feature rests on ════
eq('ZM-01 normalises', normZmCode('ZM-01'), 'ZM-1');
eq('zm 07 normalises', normZmCode('zm 07'), 'ZM-7');
eq('ZM-75 unchanged', normZmCode('ZM-75'), 'ZM-75');
eq('non-numeric falls through', normZmCode('ZM-75A'), 'ZM-75A');
eq('padded SKU parses to the plain code', parseSellerSku('ZM-01-Morpichh').zmCode, 'ZM-1');
eq('sku key folds padding and spacing', skuKey('ZM-01', 'Parrot  Green'), 'ZM-1|parrot green');
eq('key from a whole SKU', keyFromSellerSku('ZM-01-Parrot Green'), 'ZM-1|parrot green');

// ════ Numbers and money ════
eq('blank stays null, not zero', toNum(''), null);
eq('rupee and commas stripped', toNum('  8,990 '), 8990);
eq('Indian grouping', formatINR(1234567.5), '12,34,567.50');
eq('words', amountInWords(31824), 'Rupees Thirty One Thousand Eight Hundred Twenty Four Only');
eq('words with paise', amountInWords(100.5), 'Rupees One Hundred and Fifty Paise Only');
eq('round2 without float drift', round2(0.615), 0.62);

// ════ GST — exclusive basis, CGST and SGST each half ════
const rates = { lehnga: 18, saree: 5 };
const lehnga = computeLine({ category: 'lehnga', qty: 2, rate: 8990, gstRateOverride: null }, rates, 1);
eq('taxable is qty x rate', lehnga.taxable, 17980);
eq('CGST 9%', lehnga.cgst, 1618.2);
eq('SGST equals CGST', lehnga.sgst, lehnga.cgst);
const saree = computeLine({ category: 'saree', qty: 1, rate: 4500, gstRateOverride: null }, rates, 2);
eq('saree 2.5%', saree.cgst, 112.5);
eq('override wins', computeLine({ category: 'lehnga', qty: 1, rate: 1000, gstRateOverride: 12 }, rates, 3).gstRate, 12);
eq('override of 0 is honoured', resolveGstRate({ gstRateOverride: 0 }, rates).gstRate, 0);
eq('unknown category falls back and says so',
  [resolveGstRate({ category: 'kurti' }, rates).gstRate, resolveGstRate({ category: 'kurti' }, rates).fallback], [18, true]);

const t = computeTotals([lehnga, saree]).totals;
eq('grand = taxable + cgst + sgst', round2(t.subTotal + t.cgstTotal + t.sgstTotal), t.grand);
eq('rounds to whole rupees', t.grandRounded, 25941);
eq('round-off closes the gap', t.roundOff, -0.4);

// ════ Dates — day first, and the two bugs that shipped ════
eq('dd-mm-yyyy', normReturnDate('20-08-2026'), '2026-08-20');
eq('dd/mm/yyyy', normReturnDate('20/08/2026'), '2026-08-20');
eq('01/02/2026 is 1 February, not 2 January', normReturnDate('01/02/2026'), '2026-02-01');
eq('BUG: Excel serial was being dropped', normReturnDate(46254), '2026-08-20');
eq('BUG: a Date object shifted a day back in IST', normReturnDate(new Date(2026, 7, 20)), '2026-08-20');
eq('impossible month refused', normReturnDate('20/13/2026'), '');
eq('junk', normReturnDate('not a date'), '');
eq('display is dd/mm/yyyy', formatDateDisplay('2026-08-20'), '20/08/2026');
eq('never the string "Invalid Date"', formatDateDisplay('rubbish'), '');

// ════ Returns file — tolerant headers, lossless import ════
const H = ['Type','SellerSkuCode','ZM Code','Kuntal Code','Colour','Qty','Date','Order ID','AWB','Condition','Reason','Notes'];
const cols = resolveColumns(H);
eq('every column resolves',
  [cols.type, cols.sku, cols.zmCode, cols.kuntalCode, cols.colour, cols.qty, cols.date, cols.condition, cols.reason, cols.notes],
  [0,1,2,3,4,5,6,9,10,11]);
eq('Item No means Kuntal', resolveColumns(['Item No','Colour','Seller Sku Code']).kuntalCode, 0);
eq('remark does not steal reason', [resolveColumns(['SellerSkuCode','Reason','Remarks']).reason,
                                     resolveColumns(['SellerSkuCode','Reason','Remarks']).notes], [1, 2]);

const mappings = [{ sellerSkuCode: 'ZM-10-Pink', zmCode: 'ZM-10', colourName: 'Pink' }];
const parsed = parseReturnsFile([H,
  ['RTO','ZM-10-Pink','ZM-10',4144,'Pink',1,'20-08-2026','','','good','','keep me']], mappings);
eq('BUG: Kuntal Code was being thrown away', parsed.rows[0].kuntalCode, '4144');
eq('BUG: Condition was being blanked', parsed.rows[0].condition, 'good');
eq('notes survive', parsed.rows[0].notes, 'keep me');
ok('order id is not stored', !('orderId' in parsed.rows[0]));

const lookup = buildColourLookup(mappings);
eq('mapping spelling wins', correctColour('pinkk', 'ZM-10-Pink', lookup, ['Pink']).colourName, 'Pink');
eq('unrecognisable colour is left alone', correctColour('Zzyzx', 'ZM-99-X', lookup, ['Pink']).colourName, 'Zzyzx');

// ════ Returns register: what may leave, and how ════
const register = [
  { id: 'a', sellerSkuCode: 'ZM-42-Rani',  zmCode: 'ZM-42', colourName: 'Rani',  qty: 2, condition: '',        date: '2026-08-01' },
  { id: 'b', sellerSkuCode: 'ZM-42-Rani',  zmCode: 'ZM-42', colourName: 'Rani',  qty: 2, condition: 'good',    date: '2026-08-10' },
  { id: 'c', sellerSkuCode: 'ZM-43-Chiku', zmCode: 'ZM-43', colourName: 'Chiku', qty: 3, condition: 'damaged', date: '2026-08-02' }
];
eq('damaged is not shippable', isPullable({ condition: 'damaged', qty: 5 }), false);
const forLabel = availableReturnStock(register);
eq('label view hides damaged', [...forLabel.keys()], ['ZM-42|rani']);
const forGR = availableReturnStock(register, { includeHeldBack: true });
eq('GR view shows damaged too', forGR.get('ZM-43|chiku').total, 3);
eq('the default is unchanged by the option existing',
  [...availableReturnStock(register).keys()], [...availableReturnStock(register, { includeHeldBack: false }).keys()]);

const alloc = allocateFromReturns('ZM-42|rani', 3, forLabel);
eq('FIFO across rows', alloc.picks.map(p => [p.id, p.take]), [['a', 2], ['b', 1]]);
eq('condition rides along', alloc.picks.map(p => p.condition), ['', 'good']);
eq('over-draw is capped and reported',
  [allocateFromReturns('ZM-42|rani', 9, forLabel).taken, allocateFromReturns('ZM-42|rani', 9, forLabel).shortfall], [4, 5]);
eq('allocation is pure', register[0].qty, 2);

const sum = summariseReturnStock(register);
eq('total counts everything', sum.totals.pcs, 7);
eq('usable excludes damaged', sum.totals.usable, 4);
eq('held back', sum.totals.heldBack, 3);

// ════ Inventory update ════
const ctx = {
  zmToKuntal: new Map([['ZM-1', ['4132']], ['ZM-2', ['4131']]]),
  stockMap: new Map([
    ['4132', { sku: '4132', name: 'A', colors: [{ name: 'Morpichh', qty: 20 }] }],
    ['4131', { sku: '4131', name: 'B', colors: [{ name: 'Rani', qty: 20 }] }]
  ])
};
const gen = generateInventoryUpdate(['ZM-1-Morpichh', 'ZM-2-Rani', 'ZM-1-Morpichh'], ctx, 8, 50,
  { inactiveSkus: new Set(['zm-2-rani']) });
eq('statuses', gen.rows.map(r => r.status), ['ok', 'inactive', 'duplicate']);
eq('half of 20', gen.rows[0].quantity, 10);
eq('deactivated and duplicate never reach the file',
  gen.rows.filter(isExportable).map(r => r.sellerSkuCode), ['ZM-1-Morpichh']);

// ════ Document types ════
eq('GR is flagged a return', isReturnDocType('goods_return'), true);
eq('a PO is not', isReturnDocType('purchase_order'), false);
eq('a label run can never raise a return', PURCHASE_ONLY_DOC_TYPES.map(x => x.id),
  ['tax_invoice', 'purchase_order', 'proforma']);
eq('RTO puts stock back', isStockReturn(RETURN_TYPES.RTO), true);
eq('a fake return does NOT', isStockReturn(RETURN_TYPES.FAKE_RETURN), false);

// ════ Colour swatches ════
eq('Morpichh is peacock', swatchFor('Morpichh').hex, '#0F6F6C');
eq('Rani is magenta', swatchFor('Rani').hex, '#E3006D');
eq('case and spacing folded', swatchFor('  parrot   green ').hex, swatchFor('Parrot Green').hex);
eq('unknown names are stable', swatchFor('Zzyzx Teal').hex, swatchFor('zzyzx  teal').hex);
ok('BUG: blue fallbacks vanished on a near-black page',
  ['Qwerty', 'Blorp', 'Xanadu'].every(n => luminance(swatchFor(n).hex) > 0.12));
eq('black is flagged so its chip gets a brighter ring', swatchFor('Black').dark, true);

// ════ PDF sorter ════
eq('copy markers stripped', ['Label.pdf','Label (1).pdf','Label-2.pdf','label_copy.pdf','LABEL 3.PDF']
  .map(fileStem), ['label','label','label','label','label']);
eq('4x6 reads as a label', classifySize(288, 432).group, 'label');
eq('A4 reads as an invoice', classifySize(595, 842).group, 'invoice');
eq('a random size votes for nothing', classifySize(100, 100).score, 0);
eq('invoice words', classifyText('TAX INVOICE GSTIN 24AAAAA HSN 6204 CGST').group, 'invoice');

const invoiceText = 'TAX INVOICE GSTIN 24AAAAA HSN CGST SGST';
const labelText = 'Shipping Label AWB 123 Ship To Someone Courier';
const mixed = classifyPdf({ fileName: 'combined.pdf', pages: [
  { width: 288, height: 432, text: labelText }, { width: 595, height: 842, text: invoiceText },
  { width: 288, height: 432, text: labelText }, { width: 595, height: 842, text: invoiceText }] });
eq('a mixed file is flagged and routed', [mixed.mixed, mixed.pageGroups],
  [true, ['label','invoice','label','invoice']]);
const conflict = classifyPdf({ fileName: 'Label.pdf', pages: [{ width: 595, height: 842, text: invoiceText }] });
eq('name vs pages conflict follows the pages', conflict.group, 'invoice');
ok('BUG: a conflict used to come out confident', conflict.confidence < 0.5, String(conflict.confidence));

eq('BUG: "(" sorted before "." so copies preceded the original',
  ['Label (10).pdf','Label (2).pdf','Label.pdf'].map(f => ({ fileName: f })).sort(byFileName).map(f => f.fileName),
  ['Label.pdf','Label (2).pdf','Label (10).pdf']);
eq('copy index', [copyIndex('Label.pdf'), copyIndex('Label (2).pdf')], [0, 2]);
eq('the batch date names the file, not today',
  mergedFileName('label', '2026-08-20'), 'Label_merged_20-08-2026.pdf');

const groups = buildGroups([
  { fileName: 'a.pdf', pages: [1,2,3].map(() => ({})), decision: { group: 'label', pageGroups: ['label','label','label'] } },
  { fileName: 'b.pdf', pages: [1,2].map(() => ({})),   decision: { group: 'invoice', pageGroups: ['invoice','invoice'] } },
  { fileName: 'c.pdf', pages: [], unreadable: true, decision: null }
]);
eq('nothing is lost in grouping', groups.reduce((s, g) => s + g.pageCount, 0), 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
