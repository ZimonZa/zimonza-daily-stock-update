// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Myntra Label PDF Reader
// Reads label.pdf and works out what has to go out.
// Rule: ONE PAGE = ONE PIECE. Three pages carrying "ZM-11-Purple"
// means three pieces of ZM-11-Purple.
// ═══════════════════════════════════════════════════════════════

import { normZmCode, normColorKey } from './utils.js';

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
 * Identify the SKU on one page's text.
 * Known mapping codes win; the generic scan is the flagged fallback.
 * Returns { key, sellerSkuCode, zmCode, colourName, mapped } or null.
 */
export function matchSkuOnPage(pageText, index) {
  const text = String(pageText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const upper = text.toUpperCase();

  for (const entry of index.codes) {
    if (upper.includes(entry.upper)) {
      return {
        key: entry.key,
        sellerSkuCode: entry.code,
        zmCode: normZmCode(entry.mapping.zmCode),
        colourName: entry.mapping.colourName,
        mapped: true
      };
    }
  }

  GENERIC_SKU_RE.lastIndex = 0;
  let m;
  while ((m = GENERIC_SKU_RE.exec(text))) {
    const tidied = tidyGenericMatch(m[0]);
    if (!tidied) continue;
    const key = skuKey(tidied.zmCode, tidied.colourName);
    // The mapping may hold this identity under different spacing/padding
    const known = index.byKey.get(key);
    if (known) {
      return {
        key,
        sellerSkuCode: known.sellerSkuCode,
        zmCode: normZmCode(known.zmCode),
        colourName: known.colourName,
        mapped: true
      };
    }
    return { key, ...tidied, mapped: false };
  }
  return null;
}

/**
 * Aggregate per-page matches into one line per SKU.
 * qty is the number of pages — one page, one piece.
 */
export function aggregatePages(pageMatches) {
  const byKey = new Map();
  const unreadablePages = [];

  pageMatches.forEach((match, i) => {
    const pageNo = i + 1;
    if (!match) { unreadablePages.push(pageNo); return; }
    const existing = byKey.get(match.key);
    if (existing) {
      existing.qty += 1;
      existing.pages.push(pageNo);
    } else {
      byKey.set(match.key, { ...match, qty: 1, pages: [pageNo] });
    }
  });

  const items = [...byKey.values()].sort((a, b) =>
    String(a.sellerSkuCode).localeCompare(String(b.sellerSkuCode), undefined, { numeric: true }));

  return { items, unreadablePages };
}

/**
 * Read a label PDF end to end.
 * @param {File} file
 * @param {Array} mappings  state.mappings — the known SellerSkuCodes
 * @param {(page:number,total:number)=>void} onProgress
 * @returns {Promise<{pages:number, items:Array, unreadablePages:number[], hasTextLayer:boolean}>}
 */
export async function parseLabelPdf(file, mappings, onProgress) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

  const index = buildSkuIndex(mappings);
  const pageMatches = [];
  let anyText = false;

  for (let p = 1; p <= pdf.numPages; p++) {
    if (onProgress) onProgress(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const text = tc.items.map(it => it.str).join(' ');
    if (text.trim()) anyText = true;
    pageMatches.push(matchSkuOnPage(text, index));
  }

  const { items, unreadablePages } = aggregatePages(pageMatches);
  return { pages: pdf.numPages, items, unreadablePages, hasTextLayer: anyText };
}
