// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Reading a Myntra label by its LAYOUT
//
// The old reader flattened the page into one string and hunted for
// keywords. On a real Myntra label that fails badly: there is no
// "Ship To", and the first 6-digit number on the page is the routing
// code in "(801105)-(1509)" at the very top — so the address came back
// as "AMOUNT TO BE PAID EK_E2E Rs.5846.0 PAT/PNP (801105", and came
// back marked complete.
//
// A label is not a paragraph, it is a form. So keep the coordinates
// PDF.js already gives us, rebuild the lines, and read each field from
// where it actually sits:
//
//   Buyer's Name And Address   ← anchor
//   Akanksha                   ← the next line is the NAME
//   Qtr no 400/B ... 801105 India   ← everything under it is the ADDRESS
//   If undelivered, Please return to ← anchor: the address ended here,
//                                     and what follows is the SELLER
//
// Reading downward from an anchor is what makes the seller's own
// address impossible to mistake for the buyer's.
//
// Pure functions. No DOM, no PDF.js, no network.
// ═══════════════════════════════════════════════════════════════

/** Where the buyer block starts. */
const BUYER_ANCHOR = /buyer'?s?\s*name\s*(?:and|&)\s*address|buyer'?s?\s*details/i;

/**
 * Where it ends. Everything from here belongs to the seller or the
 * courier, and must never be read as the customer.
 */
const BLOCK_END = /if\s*undelivered|please\s*return\s*to|seller\s*details|buyer\s*declaration|sold\s*by|shipped\s*by|purchase\s*made|tax\s*invoice|original\s*for/i;

/**
 * The tracking ID. Myntra prints it under the barcode with a "MY"
 * prefix — MYC, MYEC and friends — so the letters after MY are not
 * pinned down, only the shape.
 */
const MYNTRA_TRACKING = /\bMY[A-Z]{0,4}\d{6,}\b/;

/** The SellerSkuCode, printed in square brackets with the size after it: [ZM-43-Rani - T] */
const BRACKET_SKU = /\[\s*([A-Za-z]{1,4}-\d+-[A-Za-z][A-Za-z0-9 ]*?)\s*(?:-\s*([A-Za-z0-9]{1,6})\s*)?\]/;

/** A 6-digit Indian PIN. Never used to FIND the address, only to confirm it. */
const PIN = /\b([1-9]\d{5})\b/;

/** Lines that are label furniture rather than an address. */
const NOT_ADDRESS = /^(?:cod|prepaid|normal\s*-?\s*fwd|amount\s*to\s*be\s*paid|rs\.?\s*[\d.,]+|[\d\s\-()/]+)$/i;

/**
 * Rebuild text lines from positioned PDF.js text items.
 *
 * PDF y-coordinates grow upward, so reading order is descending y.
 * Items within `yTolerance` of each other are the same line, ordered
 * left to right.
 *
 * @param {Array<{str:string, transform:number[], height?:number}>} items
 * @returns {Array<{y:number, x:number, text:string, height:number}>}
 */
export function itemsToLines(items, { yTolerance = 3 } = {}) {
  const placed = [];
  for (const it of items || []) {
    const str = String(it?.str ?? '');
    if (!str.trim()) continue;
    const t = it.transform || [];
    placed.push({
      str,
      x: Number(t[4]) || 0,
      y: Number(t[5]) || 0,
      // PDF.js normally reports width. When it does not, estimate from the
      // glyph count — without some width every run looks like a column break.
      width: Number(it.width) || str.length * (Number(it.height) || 10) * 0.5,
      height: Number(it.height) || Math.abs(Number(t[3])) || 0
    });
  }
  // Top of the page first
  placed.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const p of placed) {
    const line = lines.find(l => Math.abs(l.y - p.y) <= yTolerance);
    if (line) { line.parts.push(p); line.height = Math.max(line.height, p.height); }
    else lines.push({ y: p.y, parts: [p], height: p.height });
  }

  return lines.map(l => {
    const parts = l.parts.slice().sort((a, b) => a.x - b.x);
    // PDF.js splits a line into runs. A wide gap between two runs is a
    // COLUMN break, not a space — collapsing it would glue a name to the
    // address printed beside it, so it is preserved as a double space.
    let text = '';
    let cursor = null;
    for (const p of parts) {
      if (cursor !== null) text += (p.x - cursor > GAP_IS_A_COLUMN) ? '  ' : ' ';
      text += p.str.replace(/\s+/g, ' ').trim();
      cursor = p.x + p.width;
    }
    return { y: l.y, x: parts[0].x, height: l.height, text: text.trim() };
  });
}

/** Runs further apart than this are separate columns, not one sentence. */
const GAP_IS_A_COLUMN = 14;

/**
 * A line that carries no useful content.
 * A bare 6-digit PIN is the exception — it looks like furniture but it
 * is the most important line in an address.
 */
const isNoise = (t) => !t || t.length < 2 || (NOT_ADDRESS.test(t) && !/^[1-9]\d{5}$/.test(t));

/**
 * Read the buyer block: the name is the first real line under the
 * anchor, the address is everything after it until the block ends.
 */
function readBuyerBlock(lines, startIdx) {
  let name = '';
  const addressLines = [];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const text = lines[i].text;
    if (BLOCK_END.test(text)) break;
    if (isNoise(text)) continue;

    if (!name) {
      // The name sits alone on its line. If the label ran the name and
      // the address together, take only the part before the comma.
      name = text.split(/\s{2,}|,/)[0].trim();
      const rest = text.slice(name.length).replace(/^[,\s]+/, '').trim();
      if (rest) addressLines.push(rest);
      continue;
    }
    addressLines.push(text);
  }

  return { name, address: addressLines.join(' ').replace(/\s+/g, ' ').trim() };
}

/**
 * Pull every field this app needs out of one laid-out label page.
 *
 * Returns the same shape the old text reader did, plus `size` and
 * `layout: true` so a caller can tell which reader answered.
 */
export function extractMyntraFields(lines) {
  const out = {
    forwardId: '', forwardIdSource: '', orderId: '',
    customerName: '', address: '', sellerSkuCode: '', size: '',
    layout: true, missing: []
  };
  const rows = Array.isArray(lines) ? lines : [];
  const all = rows.map(l => l.text).join(' ');

  // ── Tracking ID — the MY-prefixed token under the barcode ──
  const track = MYNTRA_TRACKING.exec(all);
  if (track) { out.forwardId = track[0].toUpperCase(); out.forwardIdSource = 'text'; }

  // ── SellerSkuCode — bracketed, with the size after the dash ──
  const sku = BRACKET_SKU.exec(all);
  if (sku) {
    out.sellerSkuCode = sku[1].replace(/\s+/g, ' ').trim();
    out.size = (sku[2] || '').trim();
  }

  // ── Order ID, when the label carries one ──
  const order = /order\s*(?:id|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,24})/i.exec(all);
  if (order && order[1].toUpperCase() !== out.forwardId) out.orderId = order[1].toUpperCase();

  // ── Buyer name and address, read downward from the anchor ──
  const anchor = rows.findIndex(l => BUYER_ANCHOR.test(l.text));
  if (anchor >= 0) {
    const { name, address } = readBuyerBlock(rows, anchor);
    out.customerName = name;
    out.address = address;
  }

  for (const f of ['forwardId', 'orderId', 'customerName', 'address']) {
    if (!out[f]) out.missing.push(f);
  }
  return out;
}

/** Does this page look like a Myntra label at all? */
export function looksLikeMyntraLabel(lines) {
  const all = (Array.isArray(lines) ? lines : []).map(l => l.text).join(' ');
  return BUYER_ANCHOR.test(all) || MYNTRA_TRACKING.test(all);
}
