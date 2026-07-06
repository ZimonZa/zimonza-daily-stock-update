// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Myntra Logic
// Mapping file parsing, SKU → stock resolution, inventory generator
// ═══════════════════════════════════════════════════════════════

import { getAllZMMappings, getStockData, getAllUploadDates } from './firestore-service.js';
import { CATEGORIES } from './constants.js';
import { normItemNo, normColorKey } from './utils.js';

// "ZM-75-Morpichh" → zmCode "ZM-75", colour "Morpichh" (colour may contain spaces)
export const MYNTRA_SKU_RE = /^(ZM-\d+)-(.+)$/i;

/**
 * Parse a Myntra SellerSkuCode into { zmCode, colourName }, or null.
 */
export function parseSellerSku(sku) {
  const m = MYNTRA_SKU_RE.exec(String(sku ?? '').trim());
  if (!m) return null;
  return { zmCode: m[1].toUpperCase(), colourName: m[2].trim() };
}

const isBlankRow = (row) => !row || row.every(c => c === null || String(c).trim() === '');

/**
 * Locate the header row (first 10 rows) by a cell matching the given regex.
 * Returns { rowIdx, colIdx } or null.
 */
function findHeaderCell(rows, regex) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      if (regex.test(String(row[j] ?? '').trim())) return { rowIdx: i, colIdx: j };
    }
  }
  return null;
}

const SKU_HEADER_RE = /seller\s*sku/i;

/**
 * Validate a Myntra mapping file (rows from readExcelFile).
 */
export function validateMyntraMappingFile(rows) {
  if (!rows || rows.length < 2) return { valid: false, error: 'File appears empty' };
  const skuHeader = findHeaderCell(rows, SKU_HEADER_RE);
  if (!skuHeader) {
    return { valid: false, error: 'Invalid Myntra mapping file: expected a "SellerSkuCode" column' };
  }
  return { valid: true, dataCount: rows.length - skuHeader.rowIdx - 1 };
}

/**
 * Parse a Myntra mapping file (Style Id, Article Type, Colour, SellerSkuCode).
 * Blank rows (e.g. ",,,") are skipped; SKUs not matching ZM-<n>-<colour> are
 * collected in `invalid`.
 * Returns { mappings, invalid, skippedBlank }.
 */
export function parseMyntraMappingFile(rows) {
  const skuHeader = findHeaderCell(rows, SKU_HEADER_RE);
  const headerRowIdx = skuHeader ? skuHeader.rowIdx : 0;
  const header = rows[headerRowIdx] || [];

  const colIdx = (regex, fallback) => {
    const idx = header.findIndex(c => regex.test(String(c ?? '').trim()));
    return idx >= 0 ? idx : fallback;
  };
  const cols = {
    styleId: colIdx(/style\s*id/i, 0),
    articleType: colIdx(/article/i, 1),
    colour: colIdx(/^colou?r$/i, 2),
    sellerSkuCode: skuHeader ? skuHeader.colIdx : 3
  };

  const mappings = [];
  const invalid = [];
  let skippedBlank = 0;

  for (const row of rows.slice(headerRowIdx + 1)) {
    if (isBlankRow(row)) { skippedBlank++; continue; }
    const sellerSkuCode = String(row[cols.sellerSkuCode] ?? '').trim();
    if (!sellerSkuCode) { skippedBlank++; continue; }
    const parsed = parseSellerSku(sellerSkuCode);
    if (!parsed) { invalid.push(sellerSkuCode); continue; }
    mappings.push({
      styleId: String(row[cols.styleId] ?? '').trim(),
      articleType: String(row[cols.articleType] ?? '').trim(),
      colour: String(row[cols.colour] ?? '').trim(),
      sellerSkuCode,
      zmCode: parsed.zmCode,
      colourName: parsed.colourName
    });
  }

  return { mappings, invalid, skippedBlank };
}

/**
 * Parse an inventory update file (sellerSkuCode, quantity).
 * The quantity column is optional — quantities are always recomputed.
 * Returns { skus, skippedBlank, hasQuantityColumn }.
 */
export function parseInventoryFile(rows) {
  if (!rows || !rows.length) return { skus: [], skippedBlank: 0, hasQuantityColumn: false };
  const skuHeader = findHeaderCell(rows, SKU_HEADER_RE);
  const headerRowIdx = skuHeader ? skuHeader.rowIdx : 0;
  const skuCol = skuHeader ? skuHeader.colIdx : 0;
  const header = rows[headerRowIdx] || [];
  const hasQuantityColumn = header.some(c => /quantity|qty/i.test(String(c ?? '').trim()));

  const skus = [];
  let skippedBlank = 0;
  for (const row of rows.slice(headerRowIdx + 1)) {
    if (isBlankRow(row)) { skippedBlank++; continue; }
    const sku = String(row[skuCol] ?? '').trim();
    if (!sku) { skippedBlank++; continue; }
    skus.push(sku);
  }
  return { skus, skippedBlank, hasQuantityColumn };
}

/**
 * Load everything needed to resolve Myntra SKUs against today's stock:
 * latest upload date, stock indexed by item number, and ZM code → Kuntal codes.
 */
export async function loadMyntraStockContext() {
  const [zmMappings, dates] = await Promise.all([
    getAllZMMappings(),
    getAllUploadDates()
  ]);

  const latestDate = dates[0] || null;
  let lehngaStock = [], sareeStock = [];
  if (latestDate) {
    [lehngaStock, sareeStock] = await Promise.all([
      getStockData(latestDate, CATEGORIES.LEHNGA),
      getStockData(latestDate, CATEGORIES.SAREE)
    ]);
  }

  const norm = v => normItemNo(v).toUpperCase();
  const stockMap = new Map([
    ...lehngaStock.map(i => [norm(i.sku), i]),
    ...sareeStock.map(i => [norm(i.sku), i])
  ]);

  // A ZM code can map to several Kuntal codes (e.g. stitched + unstitched)
  const zmToKuntal = new Map();
  for (const m of zmMappings) {
    const key = String(m.zmCode ?? '').trim().toUpperCase();
    if (!key) continue;
    if (!zmToKuntal.has(key)) zmToKuntal.set(key, []);
    zmToKuntal.get(key).push(m.kuntalCode);
  }

  return { latestDate, stockMap, zmToKuntal };
}

/**
 * Resolve a ZM code to a stock item via the ZM mapping.
 * Returns { stock, kuntalCode, reason } — reason set when stock is null:
 * 'no_zm_mapping' | 'no_stock_item'.
 */
export function resolveStock(zmCode, ctx) {
  const kuntals = ctx.zmToKuntal.get(String(zmCode ?? '').trim().toUpperCase());
  if (!kuntals || !kuntals.length) return { stock: null, kuntalCode: null, reason: 'no_zm_mapping' };
  for (const k of kuntals) {
    const stock = ctx.stockMap.get(normItemNo(k).toUpperCase());
    if (stock) return { stock, kuntalCode: normItemNo(k), reason: null };
  }
  return { stock: null, kuntalCode: normItemNo(kuntals[0]), reason: 'no_stock_item' };
}

/**
 * Quantity of the given colour on a stock item, or null when the colour
 * isn't present (colour identity via normColorKey).
 */
export function findColourQty(stockItem, colourName) {
  const key = normColorKey(colourName);
  const c = (stockItem?.colors || []).find(c => normColorKey(c.name) === key);
  return c ? (Number(c.qty) || 0) : null;
}

/**
 * Generate the Myntra inventory update for a list of SellerSkuCodes.
 * Rule: colour stock strictly greater than `gap` → floor(stock/2), else 0.
 * Duplicates are flagged and excluded from export (first occurrence wins).
 * Returns { rows, summary }.
 */
export function generateInventoryUpdate(skus, ctx, gap) {
  const seen = new Set();
  const rows = [];

  for (const rawSku of skus) {
    const sellerSkuCode = String(rawSku).trim();
    const base = { sellerSkuCode, zmCode: '', colourName: '', kuntalCode: '', productName: '', stockQty: null, quantity: 0 };

    if (seen.has(sellerSkuCode.toLowerCase())) {
      rows.push({ ...base, status: 'duplicate' });
      continue;
    }
    seen.add(sellerSkuCode.toLowerCase());

    const parsed = parseSellerSku(sellerSkuCode);
    if (!parsed) {
      rows.push({ ...base, status: 'invalid_sku' });
      continue;
    }
    base.zmCode = parsed.zmCode;
    base.colourName = parsed.colourName;

    const { stock, kuntalCode, reason } = resolveStock(parsed.zmCode, ctx);
    base.kuntalCode = kuntalCode || '';
    if (!stock) {
      rows.push({ ...base, status: reason });
      continue;
    }
    base.productName = stock.name || '';

    const qty = findColourQty(stock, parsed.colourName);
    if (qty === null) {
      rows.push({ ...base, status: 'colour_not_found' });
      continue;
    }
    base.stockQty = qty;

    if (qty > gap) {
      rows.push({ ...base, quantity: Math.floor(qty / 2), status: 'ok' });
    } else {
      rows.push({ ...base, status: 'below_gap' });
    }
  }

  const count = s => rows.filter(r => r.status === s).length;
  const summary = {
    total: rows.length,
    filled: count('ok'),
    belowGap: count('below_gap'),
    duplicates: count('duplicate'),
    missing: count('invalid_sku') + count('no_zm_mapping') + count('no_stock_item') + count('colour_not_found'),
    exported: rows.filter(r => r.status !== 'duplicate').length
  };

  return { rows, summary };
}
