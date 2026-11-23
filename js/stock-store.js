// ═══════════════════════════════════════════════════════════════
// ZIMONZA — one stock model for every page
//
// - A stock item is identified by CATEGORY + clean Kuntal code. Lehnga and
//   saree are never merged or compared with each other: lehnga "7002" and
//   saree "7002 M" are different products.
// - "9551 M" and "9551" in one category are the same item (normItemNo);
//   older stored data may still hold both, so readers merge them here.
// - Each category has its own latest upload date: a lehnga-only day must
//   never make sarees look missing.
// ═══════════════════════════════════════════════════════════════

import { normItemNo, normColorKey } from './utils.js';
import { CATEGORIES } from './constants.js';
import { getStockData, getRecentHistory } from './firestore-service.js';

const CATS = [CATEGORIES.LEHNGA, CATEGORIES.SAREE];
const cleanCode = (code) => normItemNo(code).toUpperCase();

/** "saree|9551" — the identity of a stock item. */
export function stockKey(category, code) {
  return `${category || ''}|${cleanCode(code)}`;
}

/**
 * Items that are the same product (same category, same clean code) become
 * one: colour quantities added, total recomputed, `sku` the clean code.
 * Order of first appearance is kept.
 */
export function mergeStockItems(items) {
  const byKey = new Map();
  for (const it of items || []) {
    if (!it) continue;
    const key = stockKey(it.category, it.sku);
    const code = normItemNo(it.sku);
    if (!byKey.has(key)) {
      byKey.set(key, { ...it, sku: code, colors: (it.colors || []).map(c => ({ ...c, qty: Number(c.qty) || 0 })) });
      continue;
    }
    const into = byKey.get(key);
    for (const c of it.colors || []) {
      const hit = into.colors.find(x => normColorKey(x.name) === normColorKey(c.name));
      if (hit) hit.qty += Number(c.qty) || 0;
      else into.colors.push({ ...c, qty: Number(c.qty) || 0 });
    }
  }
  return [...byKey.values()].map(it => ({ ...it, totalQty: it.colors.reduce((t, c) => t + c.qty, 0) }));
}

/** Stock by category, each keyed by clean code: { lehnga: Map, saree: Map }. */
export function indexStock({ lehnga = [], saree = [] } = {}) {
  const map = (list, cat) => new Map(mergeStockItems(list.map(i => ({ ...i, category: i.category || cat })))
    .map(i => [cleanCode(i.sku), i]));
  return { lehnga: map(lehnga, CATEGORIES.LEHNGA), saree: map(saree, CATEGORIES.SAREE) };
}

/**
 * The stock item for a Kuntal code.
 * - category chosen ('lehnga' | 'saree') → that file only;
 * - none chosen and the code is in one file → that one;
 * - none chosen and the code is in BOTH → clash: the saree item is used
 *   (what the app did before) and `both` carries the two, so a page can ask.
 * @returns {{ stock: object|null, category: string|null, clash: boolean, both: object|null }}
 */
export function lookupKuntal(code, category, index) {
  const key = cleanCode(code);
  if (category === CATEGORIES.LEHNGA || category === CATEGORIES.SAREE) {
    const stock = index?.[category]?.get(key) || null;
    return { stock, category: stock ? category : null, clash: false, both: null };
  }
  const l = index?.lehnga?.get(key) || null;
  const s = index?.saree?.get(key) || null;
  if (l && s) return { stock: s, category: CATEGORIES.SAREE, clash: true, both: { lehnga: l, saree: s } };
  if (s) return { stock: s, category: CATEGORIES.SAREE, clash: false, both: null };
  if (l) return { stock: l, category: CATEGORIES.LEHNGA, clash: false, both: null };
  return { stock: null, category: null, clash: false, both: null };
}

/**
 * The latest date holding each category. A history record written before
 * the per-category counts existed counts as holding both.
 * @param {Array<{date, lehngaCount?, sareeCount?}>} history
 */
export function latestPerCategory(history) {
  const out = { lehnga: null, saree: null };
  const sorted = [...(history || [])].filter(h => /^\d{4}-\d{2}-\d{2}$/.test(h?.date || ''))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const h of sorted) {
    const legacy = h.lehngaCount === undefined && h.sareeCount === undefined;
    if (!out.lehnga && (legacy || Number(h.lehngaCount) > 0)) out.lehnga = h.date;
    if (!out.saree && (legacy || Number(h.sareeCount) > 0)) out.saree = h.date;
    if (out.lehnga && out.saree) break;
  }
  return out;
}

/** Every history record, newest first (dates only matter here). */
async function allHistory() {
  return (await getRecentHistory(10000)).map(h => ({ ...h, date: h.date || h.id }));
}

/**
 * Current stock: each category from its own latest upload, merged.
 * @returns {Promise<{ lehnga: {date, items}, saree: {date, items} }>}
 */
export async function loadLatestStock({ listHistory = allHistory, getStock = getStockData } = {}) {
  const dates = latestPerCategory(await listHistory());
  const [l, s] = await Promise.all(CATS.map(cat => dates[cat] ? getStock(dates[cat], cat) : Promise.resolve([])));
  const tag = (list, cat) => mergeStockItems((list || []).map(i => ({ ...i, category: i.category || cat })));
  return {
    lehnga: { date: dates.lehnga, items: tag(l, CATEGORIES.LEHNGA) },
    saree: { date: dates.saree, items: tag(s, CATEGORIES.SAREE) }
  };
}
