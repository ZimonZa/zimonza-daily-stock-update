// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Myntra Label PDF Reader
// Reads label.pdf and works out what has to go out.
// A page is one PARCEL. Usually one piece, but Myntra prints the code
// once per piece, so a page repeating it four times is four pieces.
// ═══════════════════════════════════════════════════════════════

import { normZmCode, normColorKey } from './utils.js';
import { decodeTrackingBarcode } from './label-barcode.js';
import { itemsToLines, extractMyntraFields, looksLikeMyntraLabel } from './myntra-label-layout.js';

// Same PDF.js build and worker the PDF → Excel page already uses.
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';

let pdfjsPromise = null;
/** Load PDF.js once, lazily — the Purchase tab shouldn't pay for it unless used. */
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
  }
  return pdfjsPromise;
}

/** Canonical identity for a SKU: "ZM-01-Parrot  Green" → "ZM-1|parrot green" */
export const skuKey = (zmCode, colourName) => `${normZmCode(zmCode)}|${normColorKey(colourName)}`;

/** Same, from a whole SellerSkuCode string. Returns null if unparseable. */
export function keyFromSellerSku(sellerSkuCode) {
  const m = /^\s*(ZM[-_ ]?\d+)[-_](.+?)\s*$/i.exec(String(sellerSkuCode ?? ''));
  return m ? skuKey(m[1], m[2]) : null;
}

/**
 * Build the lookup the page scanner matches against.
 * Longest codes first so "ZM-11-Purple" wins over a shorter prefix that
 * also happens to be a real SKU.
 */
export function buildSkuIndex(mappings) {
  const byKey = new Map();
  const codes = [];
  for (const m of mappings || []) {
    const code = String(m.sellerSkuCode ?? '').trim();
    if (!code) continue;
    const key = skuKey(m.zmCode, m.colourName);
    if (!byKey.has(key)) byKey.set(key, m);
    codes.push({ code, upper: code.toUpperCase(), key, mapping: m });
  }
  codes.sort((a, b) => b.upper.length - a.upper.length);
  return { byKey, codes };
}

// Fallback scanner for codes that aren't in the mapping at all.
// Deliberately conservative: a colour is letters and single spaces, and we
// stop at the first token that looks like a label field rather than a colour.
const GENERIC_SKU_RE = /\bZM[-_ ]?0*\d+[-_][A-Za-z][A-Za-z]*(?:[ ][A-Za-z]+)?/gi;

// Words that follow a colour on a label but are not part of it.
const NOT_A_COLOUR_WORD = /^(qty|quantity|size|pcs|pc|order|sku|code|item|no|awb|courier|return|address|name|total|date|amount|price)$/i;

/** Trim a greedily-matched code back to a plausible colour. */
function tidyGenericMatch(raw) {
  const m = /^(ZM[-_ ]?0*\d+)[-_](.+)$/i.exec(raw.trim());
  if (!m) return null;
  const words = m[2].trim().split(/\s+/);
  while (words.length > 1 && NOT_A_COLOUR_WORD.test(words[words.length - 1])) words.pop();
  if (NOT_A_COLOUR_WORD.test(words[0])) return null;
  const colour = words.join(' ');
  return { zmCode: normZmCode(m[1]), colourName: colour, sellerSkuCode: `${normZmCode(m[1])}-${colour}` };
}

/**
 * Every SKU on one page's text, with how many PIECES of each.
 *
 * "One page = one piece" was wrong. A real label page can be one parcel
 * holding several pieces, and Myntra prints the code once per piece:
 *
 *     ZM-36-Rani -
 *     ZM-36-Rani -
 *     ZM-36-Rani -
 *     ZM-36-Rani -        Rs.41632.0  ← four lehengas, not one
 *
 * Counting that page as a single piece under-buys by three and records a
 * dispatch of 1 against a parcel of 4, so a return of the other three can
 * never be matched.
 *
 * Longest codes are consumed first — the index is sorted that way — so a
 * short code that happens to be a substring of a longer one cannot steal
 * its occurrences and be double-counted.
 *
 * @returns {Array<{key, sellerSkuCode, zmCode, colourName, mapped, count}>}
 */
export function matchSkusOnPage(pageText, index) {
  const text = String(pageText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const found = [];
  let rest = text.toUpperCase();

  // A code only counts when it stands on its own. Without this, "ZM-11-Pink"
  // matched inside "ZM-11-Pinkish" and "ZM-1-Red" inside "XZM-1-Red" — a
  // different product recorded, with no sign anything was wrong.
  const isWordChar = (ch) => !!ch && /[A-Z0-9]/.test(ch);

  for (const entry of index.codes) {
    let count = 0;
    let first = -1;
    let from = 0;
    let at;
    while ((at = rest.indexOf(entry.upper, from)) !== -1) {
      const end = at + entry.upper.length;
      if (isWordChar(rest[at - 1]) || isWordChar(rest[end])) {
        from = at + 1;              // part of a longer token — not this code
        continue;
      }
      if (first === -1) first = at;
      count++;
      // Blank out what was matched so a shorter code cannot re-count it.
      // Same length, so every later index stays valid.
      rest = rest.slice(0, at) + ' '.repeat(entry.upper.length) + rest.slice(end);
      from = end;
    }
    if (count) {
      found.push({
        key: entry.key,
        sellerSkuCode: entry.code,
        zmCode: normZmCode(entry.mapping.zmCode),
        colourName: entry.mapping.colourName,
        mapped: true,
        count,
        at: first
      });
    }
  }
  if (found.length) {
    // The index is sorted by code LENGTH so that longer codes match first.
    // That order is meaningless to a reader, so hand them back in the order
    // they appear on the page — otherwise "the page's SKU" is arbitrary.
    found.sort((a, b) => a.at - b.at);
    return found;
  }

  // Nothing in the mapping matched. Fall back to the generic scan, which is
  // flagged so an unknown code is visibly unknown.
  const byKey = new Map();
  GENERIC_SKU_RE.lastIndex = 0;
  let m;
  while ((m = GENERIC_SKU_RE.exec(text))) {
    const tidied = tidyGenericMatch(m[0]);
    if (!tidied) continue;
    const key = skuKey(tidied.zmCode, tidied.colourName);
    const known = index.byKey.get(key);
    const row = known
      ? { key, sellerSkuCode: known.sellerSkuCode, zmCode: normZmCode(known.zmCode), colourName: known.colourName, mapped: true }
      : { key, ...tidied, mapped: false };
    const seen = byKey.get(key);
    if (seen) seen.count++;
    else byKey.set(key, { ...row, count: 1 });
  }
  return [...byKey.values()];
}

/**
 * The first SKU on a page. Kept for callers that only want an identity and
 * not a count.
 */
export function matchSkuOnPage(pageText, index) {
  const all = matchSkusOnPage(pageText, index);
  if (!all.length) return null;
  const { count, ...first } = all[0];
  return first;
}

/**
 * Aggregate per-page matches into one line per SKU.
 *
 * `pageMatches[i]` is the ARRAY of SKUs found on page i+1, each with its own
 * piece count, so a parcel holding four pieces contributes four.
 */
export function aggregatePages(pageMatches) {
  const byKey = new Map();
  const unreadablePages = [];

  pageMatches.forEach((matches, i) => {
    const pageNo = i + 1;
    // Tolerate a single match object, so an older caller still works
    const list = Array.isArray(matches) ? matches : (matches ? [matches] : []);
    if (!list.length) { unreadablePages.push(pageNo); return; }

    for (const match of list) {
      const pieces = Math.max(1, Number(match.count) || 1);
      const existing = byKey.get(match.key);
      if (existing) {
        existing.qty += pieces;
        if (!existing.pages.includes(pageNo)) existing.pages.push(pageNo);
      } else {
        const { count, ...rest } = match;
        byKey.set(match.key, { ...rest, qty: pieces, pages: [pageNo] });
      }
    }
  });

  const items = [...byKey.values()].sort((a, b) =>
    String(a.sellerSkuCode).localeCompare(String(b.sellerSkuCode), undefined, { numeric: true }));

  return { items, unreadablePages };
}

/**
 * Read a label PDF end to end.
 *
 * @param {File} file
 * @param {Array} mappings  state.mappings — the known SellerSkuCodes
 * @param {(page:number,total:number)=>void} onProgress
 * @param {{barcodeFallback?:boolean, decodeBarcode?:Function}} opts
 *   `barcodeFallback` rasterises and decodes the barcode on pages where the
 *   printed text gave no tracking ID. `decodeBarcode` overrides the decoder,
 *   so a test can run this path without a canvas.
 * @returns {Promise<{pages:number, items:Array, unreadablePages:number[], hasTextLayer:boolean, pageRecords:Array, barcodePages:number[]}>}
 */
export async function parseLabelPdf(file, mappings, onProgress, opts = {}) {
  const { barcodeFallback = true, forceBarcode = false, decodeBarcode = decodeTrackingBarcode } = opts;
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

  const index = buildSkuIndex(mappings);
  const pageMatches = [];
  const pageRecords = [];
  const barcodePages = [];
  const barcodeFailures = [];
  const barcodeMismatchPages = [];
  let anyText = false;

  for (let p = 1; p <= pdf.numPages; p++) {
    if (onProgress) onProgress(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // Keep the coordinates. A label is a form, not a paragraph, and the
    // fields are told apart by where they sit far more reliably than by
    // the words around them.
    const lines = itemsToLines(tc.items);
    const text = lines.map(l => l.text).join(' ');
    if (text.trim()) anyText = true;
    // Every SKU on the page, each with its own piece count. A parcel can
    // hold several pieces and prints its code once per piece.
    const matches = matchSkusOnPage(text, index);
    pageMatches.push(matches);
    const pieces = matches.reduce((n, m) => n + (Number(m.count) || 1), 0);

    // One record per page for dispatch tracking. The aggregate above is
    // unchanged, so the fulfilment path sees exactly what it saw before.
    //
    // Layout reader first — it knows where a Myntra label keeps things.
    // The keyword reader stays as the fallback for every other courier.
    const fields = looksLikeMyntraLabel(lines)
      ? extractMyntraFields(lines)
      : extractDispatchFields(text);
    // Keep what the reader said about provenance — it may have said 'guess'.
    // Overwriting that with 'text' made the "guess — check" badge dead code
    // and, worse, made a guess look like a confident read.
    if (!fields.forwardIdSource) fields.forwardIdSource = fields.forwardId ? 'text' : '';
    const guessedId = fields.forwardIdSource === 'guess';

    // Normally only when the printed text gave nothing — rasterising every
    // page to re-read a number that is already printed would cost minutes
    // for no extra answer. `forceBarcode` overrides that and reads every
    // page, which also cross-checks the printed digits.
    //
    // A GUESS does not count as having an ID. On a real Myntra label the
    // number under the barcode is artwork, not text, so the barcode is the
    // only true source — letting a guess suppress that read would trade the
    // right answer for a plausible one.
    const wantBarcode = barcodeFallback && (forceBarcode || !fields.forwardId || guessedId);
    if (wantBarcode) {
      const hit = await decodeBarcode(page);
      // A decoder can read SOMETHING that is not a Myntra tracking number — a
      // route code, or DataMatrix shipment data. It says so with
      // confident:false, and that must reach the badge: presenting an unsure
      // decode as a trusted "barcode" read is exactly the confidently-wrong
      // failure this reader exists to avoid.
      if (hit?.value && hit.confident === false) {
        // Only ever fills a blank. It never replaces a printed number, and a
        // text guess is no worse than it, so that is left alone too.
        if (!fields.forwardId) {
          fields.forwardId = hit.value;
          fields.forwardIdSource = 'barcode-guess';
          fields.missing = fields.missing.filter(f => f !== 'forwardId');
        }
        barcodeFailures.push({ page: p, reason: hit.reason || 'decoded a value that is not a tracking number' });
      } else if (hit?.value) {
        if (!fields.forwardId || guessedId) {
          fields.forwardId = hit.value;
          fields.forwardIdSource = 'barcode';
          fields.missing = fields.missing.filter(f => f !== 'forwardId');
          delete fields.pageTextSample;
          barcodePages.push(p);
        } else if (hit.value !== fields.forwardId) {
          // The printed digits and the barcode disagree. Neither is
          // silently preferred — the row is flagged for a human.
          fields.barcodeValue = hit.value;
          fields.forwardIdSource = 'text-barcode-mismatch';
          barcodeMismatchPages.push(p);
        } else {
          fields.forwardIdSource = 'text+barcode';
          barcodePages.push(p);
        }
      } else {
        // Why it failed, so "nothing printed" reads differently from
        // "the decoder could not cope".
        barcodeFailures.push({ page: p, reason: hit?.reason || 'no barcode found' });
      }
    }

    pageRecords.push({
      page: p, ...fields,
      sku: matches[0] || null,
      skus: matches,
      // How many pieces this ONE page represents
      pieces: pieces || 1
    });

    // Let PDF.js drop this page's fonts, operator lists and render caches.
    // Without it a 200-page file keeps every page's resources alive until the
    // whole read ends.
    page.cleanup?.();
  }

  // And the document itself, once every page has been read
  pdf.cleanup?.();

  const { items, unreadablePages } = aggregatePages(pageMatches);
  return {
    pages: pdf.numPages, items, unreadablePages, hasTextLayer: anyText, pageRecords,
    barcodePages, barcodeFailures, barcodeMismatchPages
  };
}

// ═══════════════════════════════════════════════════════════════
// Dispatch details — who is receiving this piece
//
// Everything here reads the PRINTED TEXT. Courier labels print the
// tracking ID as digits under the barcode, so the text layer already
// carries it; decoding the barcode image would cost a megabyte and
// minutes on a 200-page file for the same answer.
//
// Every field is independently optional. A page missing one is kept and
// flagged — silently dropping a dispatch is worse than an incomplete one.
// ═══════════════════════════════════════════════════════════════

/** Labelled first — that is the only reading we can be confident about. */
const TRACKING_LABELLED = /(?:awb|air\s*way\s*bill|waybill|tracking(?:\s*(?:id|no|number))?|shipment\s*(?:id|no))\s*(?:no\.?|number|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{7,24})/i;

/** A bare token that looks like a courier ID, when nothing is labelled. */
const TRACKING_BARE = /\b(?=[A-Z0-9-]{10,24}\b)(?=.*\d)[A-Z][A-Z0-9-]{9,23}\b|\b\d{11,18}\b/;

const ORDER_ID_RE = /order\s*(?:id|no\.?|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,24})/i;

/** The name follows the "ship to" marker. */
const CUSTOMER_RE = /(?:ship\s*to|deliver(?:y)?\s*to|customer\s*(?:name)?|consignee|bill\s*to)\s*[:#-]?\s*([A-Za-z][A-Za-z.\s'-]{1,48})/i;

/** A 6-digit Indian PIN anchors the address block. */
const PINCODE_RE = /\b([1-9]\d{5})\b/;

// Words that end a captured name — they start the next field on the label
const NAME_STOPWORDS = /\b(?:address|addr|phone|mobile|pin|pincode|order|awb|tracking|qty|quantity|sku|size|colour|color|courier|route|invoice|gstin|seller|sold\s*by|return|if\s*undelivered)\b/i;

/** Trim a captured name where the next label field begins. */
function tidyName(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const stop = NAME_STOPWORDS.exec(s);
  if (stop) s = s.slice(0, stop.index).trim();
  s = s.replace(/[.,;:\-\s]+$/, '').trim();
  // One or two stray letters is noise, not a name
  return s.length >= 2 && /[A-Za-z]{2}/.test(s) ? s : '';
}

/** The address text around the PIN code, when one is present. */
function extractAddress(text) {
  const pin = PINCODE_RE.exec(text);
  if (!pin) return '';
  const start = Math.max(0, pin.index - 90);
  return text.slice(start, pin.index + 6).replace(/\s+/g, ' ').trim();
}

/**
 * Pull the dispatch fields off one page's text.
 * Returns every field it could read, plus `missing` naming the rest.
 */
export function extractDispatchFields(pageText) {
  const text = String(pageText ?? '').replace(/\s+/g, ' ').trim();
  const out = { forwardId: '', orderId: '', customerName: '', address: '', missing: [] };
  if (!text) { out.missing = ['forwardId', 'orderId', 'customerName', 'address']; return out; }

  const labelled = TRACKING_LABELLED.exec(text);
  if (labelled) {
    out.forwardId = labelled[1].toUpperCase();
  } else {
    const bare = TRACKING_BARE.exec(text);
    if (bare) out.forwardId = bare[0].toUpperCase();
  }

  const order = ORDER_ID_RE.exec(text);
  // An "Order" capture that grabbed the tracking ID is not an order ID
  if (order && order[1].toUpperCase() !== out.forwardId) out.orderId = order[1].toUpperCase();

  const cust = CUSTOMER_RE.exec(text);
  if (cust) out.customerName = tidyName(cust[1]);

  out.address = extractAddress(text);

  for (const f of ['forwardId', 'orderId', 'customerName', 'address']) {
    if (!out[f]) out.missing.push(f);
  }
  return out;
}
