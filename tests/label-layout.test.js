// Reading a REAL Myntra label — the one the user sent, transcribed line
// for line in the order PDF.js reports it.
//
// The keyword reader failed this label completely: no "Ship To" marker, so
// no customer name, and the first 6-digit number on the page is the routing
// code "(801105)-(1509)" at the very top — so the address came back as
// "AMOUNT TO BE PAID EK_E2E Rs.5846.0 PAT/PNP (801105" AND was reported
// complete. Every assertion below exists because of that.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { itemsToLines, extractMyntraFields, looksLikeMyntraLabel } from './myntra-label-layout.js';
import { extractDispatchFields, parseLabelPdf } from './myntra-labels.js';
import { dispatchFromPageRecord } from './myntra-dispatch.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ── The label, top to bottom ──
const LABEL = [
  'EK_E2E',
  'AMOUNT TO BE PAID',
  'PAT/PNP',
  'Rs.5846.0',
  '(801105)-(1509)',
  'NORMAL - Fwd',
  'COD',
  'MYEC1118733669',
  "Buyer's Name And Address",
  'Akanksha',
  'Qtr no 400/B medical colony road no 3 , Near',
  'railway hospital  Khagaul Patna 801105 India',
  'If undelivered, Please return to',
  'KUNTAL FASHION PRIVATE',
  'GROUND FLOOR, PLOT NO 44 AND 45, SIDHHI',
  'VINAYAK ESTATE, OPP NEW BOMBAY MARKET,',
  'UMARWADA, Surat, Surat, Gujarat, 395010, Surat -',
  '395010, GUJARAT, India',
  'Seller Details',
  'KUNTAL FASHION PRIVATE LIMITED',
  '[ZM-43-Rani - T]',
  'LakhniBigha, H',
  'Buyer Declaration',
  'Purchase made',
  'I,Akanksha ,declare that the goods in this shipment are for personal use and not for resale.',
  'Myntra'
].join('\n');

const place = (rows) => rows.map((str, i) => ({
  str, height: 10, transform: [1, 0, 0, 10, 40, 800 - i * 14]
}));

// PDF.js gives y descending down the page
const items = place(LABEL.split('\n'));

// ════ 1. Lines rebuild in reading order ════
const lines = itemsToLines(items);
eq('every printed line survives', lines.length, LABEL.split('\n').length);
eq('reading order is top to bottom', lines[0].text, 'EK_E2E');
ok('and y descends', lines[0].y > lines[1].y);
ok('this is recognised as a Myntra label', looksLikeMyntraLabel(lines));

// Runs on the same visual line join left to right, not in PDF order
const sameLine = itemsToLines([
  { str: 'Patna 801105 India', width: 80, height: 10, transform: [1, 0, 0, 10, 82, 500] },
  { str: 'Khagaul', width: 38, height: 10, transform: [1, 0, 0, 10, 40, 500] }
]);
eq('one visual line', sameLine.length, 1);
eq('joined in x order, not PDF order', sameLine[0].text, 'Khagaul Patna 801105 India');

// A WIDE gap is a column break, not a space. Collapsing it would glue a
// name to whatever is printed beside it in the next column.
const twoCols = itemsToLines([
  { str: 'Akanksha', width: 44, height: 10, transform: [1, 0, 0, 10, 40, 500] },
  { str: 'Seller Details', width: 60, height: 10, transform: [1, 0, 0, 10, 300, 500] }
]);
ok('a column gap survives as a gap', /Akanksha {2,}Seller Details/.test(twoCols[0].text), twoCols[0].text);

// A bare PIN on its own line is address, not furniture
const pinLine = extractMyntraFields(itemsToLines(place(
  ['MYC1112223334', "Buyer's Name And Address", 'Asha Devi', '12 MG Road', '400053'])));
eq('a PIN alone on a line is kept', pinLine.address, '12 MG Road 400053');

// ════ 2. THE FIELDS — the four boxes on the label ════
const f = extractMyntraFields(lines);

eq('YELLOW BOX — tracking ID', f.forwardId, 'MYEC1118733669');
eq('RED BOX — customer name', f.customerName, 'Akanksha');
eq('BLUE BOX — SellerSkuCode', f.sellerSkuCode, 'ZM-43-Rani');
ok('the size after the dash is stripped, not glued on', !/- ?T/.test(f.sellerSkuCode), f.sellerSkuCode);
ok('and no size field is carried', !('size' in f), JSON.stringify(Object.keys(f)));

// ORANGE BOX — the address, and only the address
ok('starts where the name ends', f.address.startsWith('Qtr no 400/B'), f.address);
ok('carries the delivery PIN', /\b801105\b/.test(f.address), f.address);
eq('the whole address, both printed lines',
  f.address, 'Qtr no 400/B medical colony road no 3 , Near railway hospital Khagaul Patna 801105 India');

// ════ 3. What must NEVER leak in ════
ok('the SELLER name is not the customer', !/kuntal/i.test(f.customerName));
ok('the seller address is not the buyer address', !/kuntal|gujarat|umarwada|surat/i.test(f.address), f.address);
ok('the seller PIN 395010 stays out', !/395010/.test(f.address), f.address);
ok('the routing code at the top is not the address',
  !/amount to be paid|EK_E2E|PAT\/PNP/i.test(f.address), f.address);
ok('the courier hub is not the address', !/lakhnibigha/i.test(f.address), f.address);
ok('the buyer declaration is not the address', !/declare|resale/i.test(f.address), f.address);
ok('the block stops at "If undelivered"', !/undelivered/i.test(f.address), f.address);
eq('only the order ID is reported missing', f.missing, ['orderId']);

// ════ 4. The old reader got this wrong — why the change was needed ════
const flat = lines.map(l => l.text).join(' ');
const old = extractDispatchFields(flat);
ok('the keyword reader found NO customer name', old.customerName === '', old.customerName);
ok('and an address that is not the address', !old.address.startsWith('Qtr no 400/B'), old.address);
ok('worse, it did not flag that address as missing', !old.missing.includes('address'));
ok('while the layout reader gets both right',
  f.customerName === 'Akanksha' && f.address.startsWith('Qtr no 400/B'));

// ════ 5. Tracking ID shapes — MYC and MYEC both ════
const withPrefix = (id) => extractMyntraFields(itemsToLines(
  place([id, "Buyer's Name And Address", 'Asha', 'Patna 801105']))).forwardId;
eq('MYC is read', withPrefix('MYC1118733669'), 'MYC1118733669');
eq('MYEC is read', withPrefix('MYEC1118733669'), 'MYEC1118733669');
eq('a longer MY prefix is read', withPrefix('MYNT9988776655'), 'MYNT9988776655');
eq('a plain number is not mistaken for one', withPrefix('801105'), '');

// ════ 5b. PDF.js SPLITS the printed string into runs ════
// This is the common case, not the edge case, and it silently lost the
// tracking ID — the one field the whole returns flow is keyed on.
const splitRuns = (gap) => extractMyntraFields(itemsToLines([
  { str: 'MYEC', width: 24, height: 10, transform: [1, 0, 0, 10, 150, 700] },
  { str: '1118733669', width: 60, height: 10, transform: [1, 0, 0, 10, 150 + gap, 700] },
  { str: "Buyer's Name And Address", width: 100, height: 10, transform: [1, 0, 0, 10, 40, 650] },
  { str: 'Akanksha', width: 44, height: 10, transform: [1, 0, 0, 10, 40, 636] }
])).forwardId;
eq('a tracking ID split across adjacent runs is rejoined', splitRuns(28), 'MYEC1118733669');
eq('even when the runs sit a column apart', splitRuns(50), 'MYEC1118733669');
eq('three runs still rejoin', extractMyntraFields(itemsToLines([
  { str: 'MY', width: 12, height: 10, transform: [1, 0, 0, 10, 150, 700] },
  { str: 'EC11187', width: 40, height: 10, transform: [1, 0, 0, 10, 164, 700] },
  { str: '33669', width: 30, height: 10, transform: [1, 0, 0, 10, 206, 700] }
])).forwardId, 'MYEC1118733669');

// But never ACROSS lines — that would manufacture an ID off two unrelated rows
eq('two separate lines are never fused into an ID', extractMyntraFields(itemsToLines(place(
  ['MY', '1118733669', "Buyer's Name And Address", 'Asha']))).forwardId, '');

// ════ 5c. Case, and the last-resort guess ════
eq('a lower-case tracking ID is still read', withPrefix('myec1118733669'), 'MYEC1118733669');
eq('and normalised to upper case', withPrefix('MyEc1118733669'), 'MYEC1118733669');

// A merged file can hold labels from another courier with no MY prefix.
// A blank field cannot be corrected because it says nothing; a flagged
// guess can. It is badged, and never treated as confidently read.
const guessed = extractMyntraFields(itemsToLines(place(
  ['SF7788990011223', "Buyer's Name And Address", 'Asha Devi', '12 MG Road 400053'])));
eq('a courier-shaped token is offered', guessed.forwardId, 'SF7788990011223');
eq('but only as a guess', guessed.forwardIdSource, 'guess');
ok('and the page text is kept so the guess can be checked',
  /SF7788990011223/.test(guessed.pageTextSample || ''), guessed.pageTextSample);

// A confident read must NOT be downgraded, nor carry the diagnostic
eq('a real MY id is confident', f.forwardIdSource, 'text');
ok('and needs no diagnostic', !f.pageTextSample);

// Things that look like IDs but are not
const notId = (line) => extractMyntraFields(itemsToLines(place(
  [line, "Buyer's Name And Address", 'Asha']))).forwardId;
eq('a PIN code is not a tracking ID', notId('801105'), '');
eq('a phone number is not a tracking ID', notId('9876543210'), '');
eq('a GSTIN is not a tracking ID', notId('24AAACC1206D1ZM'), '');
eq('our own SellerSkuCode is not a tracking ID', notId('ZM-43-Rani'), '');

// ════ 6. A label missing a field is flagged, never invented ════
const noName = extractMyntraFields(itemsToLines(place(
  ['MYC1112223334', "Buyer's Name And Address", 'If undelivered, Please return to', 'KUNTAL FASHION PRIVATE'])));
eq('an empty buyer block invents nothing', [noName.customerName, noName.address], ['', '']);
ok('and says both are missing',
  noName.missing.includes('customerName') && noName.missing.includes('address'));
ok('but the tracking ID still came through', noName.forwardId === 'MYC1112223334');

// ════ 7. End to end through parseLabelPdf ════
globalThis.__PDF_PAGES = [LABEL, LABEL];
const file = { name: 'label.pdf', arrayBuffer: async () => new ArrayBuffer(8) };
const maps = [{ sellerSkuCode: 'ZM-43-Rani', zmCode: 'ZM-43', colourName: 'Rani' }];
const result = await parseLabelPdf(file, maps, null, { barcodeFallback: false });

eq('both pages read', result.pageRecords.length, 2);
eq('the customer survives the whole pipeline', result.pageRecords[0].customerName, 'Akanksha');
eq('so does the address', result.pageRecords[0].address,
  'Qtr no 400/B medical colony road no 3 , Near railway hospital Khagaul Patna 801105 India');
eq('and the tracking ID', result.pageRecords[0].forwardId, 'MYEC1118733669');
eq('read from printed text, no barcode needed', result.pageRecords[0].forwardIdSource, 'text');
eq('the fulfilment aggregate still counts pieces', result.items[0].qty, 2);
eq('and names the mapped SKU', result.items[0].sellerSkuCode, 'ZM-43-Rani');

const d = dispatchFromPageRecord(result.pageRecords[0], { sourceFile: 'label.pdf', dispatchDate: '2026-09-11' });
eq('the dispatch record carries the name', d.customer.name, 'Akanksha');
eq('grouped by name, not by a masked address', d.customer.keyType, 'name');
eq('the dispatch carries the SKU', d.sellerSkuCode, 'ZM-43-Rani');
ok('and no size rides along', !('size' in d), JSON.stringify(Object.keys(d)));
eq('and the address, for when there is no name next time', d.customer.address,
  'Qtr no 400/B medical colony road no 3 , Near railway hospital Khagaul Patna 801105 India');
delete globalThis.__PDF_PAGES;

// ════ 7b. The barcode reader — what it does and what it admits to ════
const NL = String.fromCharCode(10);
const NO_ID = LABEL.split(NL).filter(l => l !== 'MYEC1118733669').join(NL);

// Fallback: only pages with no printed number cost a decode
globalThis.__PDF_PAGES = [LABEL, NO_ID];
const asked = [];
const decoder = async (page) => {
  asked.push(page._page);
  return { value: 'MYEC7777666655', format: 'code_128' };
};
const fb = await parseLabelPdf(file, maps, null, { decodeBarcode: decoder });
eq('only the page missing a printed ID is decoded', asked, [2]);
eq('page 1 keeps its printed ID', fb.pageRecords[0].forwardId, 'MYEC1118733669');
eq('page 2 gets its ID from the barcode', fb.pageRecords[1].forwardId, 'MYEC7777666655');
eq('and is marked as such', fb.pageRecords[1].forwardIdSource, 'barcode');
eq('the pages that needed it are reported', fb.barcodePages, [2]);

// Force: every page decoded, and agreement is stated rather than assumed
asked.length = 0;
const agree = async (page) => { asked.push(page._page); return { value: 'MYEC1118733669', format: 'code_128' }; };
globalThis.__PDF_PAGES = [LABEL, LABEL];
const forced = await parseLabelPdf(file, maps, null, { forceBarcode: true, decodeBarcode: agree });
eq('force reads EVERY page', asked, [1, 2]);
eq('agreement is recorded', forced.pageRecords[0].forwardIdSource, 'text+barcode');
eq('and no mismatch raised', forced.barcodeMismatchPages, []);

// Disagreement: neither value is silently preferred
const disagree = async () => ({ value: 'MYEC9999000011', format: 'code_128' });
const clash = await parseLabelPdf(file, maps, null, { forceBarcode: true, decodeBarcode: disagree });
eq('the printed number is NOT overwritten', clash.pageRecords[0].forwardId, 'MYEC1118733669');
eq('the barcode value is kept beside it', clash.pageRecords[0].barcodeValue, 'MYEC9999000011');
eq('and the row is flagged for a human', clash.pageRecords[0].forwardIdSource, 'text-barcode-mismatch');
eq('both pages reported', clash.barcodeMismatchPages, [1, 2]);

// A decoder that fails must say WHY, not vanish
globalThis.__PDF_PAGES = [NO_ID];
const broken = async () => ({ value: '', format: '', reason: 'no barcode found on the page' });
const failed = await parseLabelPdf(file, maps, null, { decodeBarcode: broken });
eq('the failure is reported, not swallowed', failed.barcodeFailures.length, 1);
eq('with the page', failed.barcodeFailures[0].page, 1);
ok('and a reason', /no barcode found/.test(failed.barcodeFailures[0].reason), failed.barcodeFailures[0].reason);
ok('the row survives with a flagged blank',
  failed.pageRecords[0].forwardId === '' && failed.pageRecords[0].missing.includes('forwardId'));
delete globalThis.__PDF_PAGES;

// ════ 7c. A page is a PARCEL, not automatically one piece ════
// Page 4 of the real file prints "ZM-36-Rani -" four times and charges
// Rs.41632 — four lehengas in one parcel. Counting it as one under-buys by
// three and records a dispatch of 1 against a parcel of 4, so a return of the
// other three could never be matched.
const parcelMaps = [
  { sellerSkuCode: 'ZM-36-Rani', zmCode: 'ZM-36', colourName: 'Rani' },
  { sellerSkuCode: 'ZM-88-Chiku', zmCode: 'ZM-88', colourName: 'Chiku' }
];
const head = (extra) => [
  'EK_E2E', 'KNU/KYP', '(208017)-(1509)', 'COD',
  "Buyer's Name And Address", 'Amna', '69 Kalyanpur Kanpur 208017 India',
  'If undelivered, Please return to', 'KUNTAL FASHION PRIVATE'
].concat(extra).join(NL);

globalThis.__PDF_PAGES = [head(['ZM-36-Rani -', 'ZM-36-Rani -', 'ZM-36-Rani -', 'ZM-36-Rani -'])];
const four = await parseLabelPdf(file, parcelMaps, null, { barcodeFallback: false });
eq('four printed codes are four pieces', four.items[0].qty, 4);
eq('still one page', four.items[0].pages, [1]);
eq('the dispatch record carries four', dispatchFromPageRecord(four.pageRecords[0], {}).qty, 4);

// A MIXED parcel must not credit the whole total to whichever code came first
globalThis.__PDF_PAGES = [head(['ZM-88-Chiku -', 'ZM-36-Rani -', 'ZM-36-Rani -'])];
const mixed = await parseLabelPdf(file, parcelMaps, null, { barcodeFallback: false });
eq('each code keeps its own count',
  mixed.items.map(i => [i.sellerSkuCode, i.qty]).sort(),
  [['ZM-36-Rani', 2], ['ZM-88-Chiku', 1]].sort());
eq('SKUs come back in the order the PAGE prints them, not by code length',
  mixed.pageRecords[0].skus.map(s => s.sellerSkuCode), ['ZM-88-Chiku', 'ZM-36-Rani']);
const md = dispatchFromPageRecord(mixed.pageRecords[0], {});
eq('the dispatch names the first-printed code', md.sellerSkuCode, 'ZM-88-Chiku');
eq('THE RULE: and claims only ITS pieces, not the parcel total', md.qty, 1);
eq('a mixed parcel is visibly mixed', md.mixedSkus, ['ZM-88-Chiku', 'ZM-36-Rani']);

// A single-code page is completely unchanged
globalThis.__PDF_PAGES = [head(['ZM-36-Rani -'])];
const one = await parseLabelPdf(file, parcelMaps, null, { barcodeFallback: false });
eq('one code is still one piece', one.items[0].qty, 1);
ok('and carries no mixed list', !dispatchFromPageRecord(one.pageRecords[0], {}).mixedSkus);

// ════ 7d. A GUESS is not an answer ════
// The tracking number on a real Myntra label is barcode artwork, not text.
// If a guessed ID were allowed to fill the field it would SUPPRESS the barcode
// read — trading the only true source for a plausible one.
const guessPage = head(['SF7788990011223', 'ZM-36-Rani -']);

globalThis.__PDF_PAGES = [guessPage];
let barcodeReads = 0;
const gotBarcode = await parseLabelPdf(file, parcelMaps, null, {
  decodeBarcode: async () => { barcodeReads++; return { value: 'MYEC1118733247', format: 'code_128' }; }
});
eq('THE RULE: a guess does NOT suppress the barcode read', barcodeReads, 1);
eq('and the barcode wins', gotBarcode.pageRecords[0].forwardId, 'MYEC1118733247');
eq('marked as decoded, not as printed', gotBarcode.pageRecords[0].forwardIdSource, 'barcode');
ok('and the diagnostic is dropped once the real ID is known',
  !gotBarcode.pageRecords[0].pageTextSample);

globalThis.__PDF_PAGES = [guessPage];
const stillGuess = await parseLabelPdf(file, parcelMaps, null, {
  decodeBarcode: async () => ({ value: '', reason: 'no barcode found' })
});
eq('with no barcode the guess survives', stillGuess.pageRecords[0].forwardId, 'SF7788990011223');
eq('and stays badged a guess, never promoted to "text"',
  stillGuess.pageRecords[0].forwardIdSource, 'guess');
delete globalThis.__PDF_PAGES;

// ════ 8. A non-Myntra label still goes to the keyword reader ════
const courier = itemsToLines(place(['AWB: SF1234567890123', 'Ship To: Ravi Kumar', 'Delhi 110085']));
ok('a label with no Myntra marks is not claimed by the layout reader',
  !looksLikeMyntraLabel(courier));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
