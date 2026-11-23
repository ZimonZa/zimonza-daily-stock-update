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

// ── Reads are remembered for the life of the page ──
// "Stock as of D" and "changes on D" both need D's files and the history;
// Firestore bills every document read, so each is fetched once per page.
// Callers always get fresh copies (mergeStockItems copies items and colours).
let memos = new WeakMap();   // loader → Map(key → Promise)
function remembered(load, keyOf) {
  if (!memos.has(load)) memos.set(load, new Map());
  const cache = memos.get(load);
  return (...args) => {
    const key = keyOf(...args);
    if (!cache.has(key)) {
      const p = Promise.resolve().then(() => load(...args));
      cache.set(key, p);
      p.catch(() => cache.delete(key));   // a failed read is tried again next time
    }
    return cache.get(key);
  };
}
const historyOnce = (listHistory) => remembered(listHistory, () => 'all');
const stockOnce = (getStock) => remembered(getStock, (date, cat) => `${date}|${cat}`);

/** Forget remembered reads (after this page writes stock or history). */
export function clearStockCache() { memos = new WeakMap(); }

/** Every history record, newest first (dates only matter here). */
async function allHistory() {
  return (await getRecentHistory(10000)).map(h => ({ ...h, date: h.date || h.id }));
}

/**
 * Stock as of a date: each category from its own last upload on or before
 * `asOf` (or strictly before `before`); no date → the latest. Merged.
 * @returns {Promise<{ lehnga: {date, items}, saree: {date, items} }>}
 */
export async function loadStockAsOf({ asOf = null, before = null, listHistory = allHistory, getStock = getStockData } = {}) {
  const history = (await historyOnce(listHistory)()).filter(h =>
    (!asOf || h.date <= asOf) && (!before || h.date < before));
  const dates = latestPerCategory(history);
  const read = stockOnce(getStock);
  const [l, s] = await Promise.all(CATS.map(cat => dates[cat] ? read(dates[cat], cat) : Promise.resolve([])));
  const tag = (list, cat) => mergeStockItems((list || []).map(i => ({ ...i, category: i.category || cat })));
  return {
    lehnga: { date: dates.lehnga, items: tag(l, CATEGORIES.LEHNGA) },
    saree: { date: dates.saree, items: tag(s, CATEGORIES.SAREE) }
  };
}

/**
 * What changed on one upload day: the categories uploaded ON that date,
 * each against its own previous upload. Feed to analyzeStockChanges(current,
 * previous, { categories }).
 * @returns {Promise<{ categories: string[], current: Array, previous: Array }>}
 */
export async function loadDayChanges(date, { listHistory = allHistory, getStock = getStockData } = {}) {
  const read = stockOnce(getStock);
  const lists = await Promise.all(CATS.map(cat => read(date, cat)));
  const categories = CATS.filter((_, i) => (lists[i] || []).length);
  const current = mergeStockItems(lists.flatMap((l, i) => (l || []).map(it => ({ ...it, category: it.category || CATS[i] }))));
  const before = await loadStockAsOf({ before: date, listHistory, getStock });
  const previous = categories.flatMap(cat => before[cat].items);
  return { categories, current, previous };
}

/**
 * Per item, pieces now minus pieces at the previous upload; 'new' for an
 * item the previous upload didn't have. Keyed by stockKey.
 */
export function changeSinceLast(currentItems, previousItems) {
  const before = new Map(mergeStockItems(previousItems || []).map(i => [stockKey(i.category, i.sku), i.totalQty]));
  return new Map(mergeStockItems(currentItems || []).map(i => {
    const k = stockKey(i.category, i.sku);
    return [k, before.has(k) ? i.totalQty - before.get(k) : 'new'];
  }));
}

/**
 * What a day's change lists are based on, for the line under a page title:
 * "Only lehnga uploaded on 22/11/2026 — saree not compared".
 */
export function dayChangesLabel(day, date, fmt = (d) => d) {
  const cats = day?.categories || [];
  const when = fmt(date);
  if (!cats.length) return `Nothing uploaded on ${when}`;
  if (cats.length === CATS.length) return `Lehnga and saree uploaded on ${when} — each compared with its own previous upload`;
  const missing = CATS.filter(c => !cats.includes(c));
  return `Only ${cats.join(' and ')} uploaded on ${when} — ${missing.join(' and ')} not compared`;
}

/** Current stock: each category from its own latest upload. */
export const loadLatestStock = (deps = {}) => loadStockAsOf(deps);

/** Both categories' items as one list (for pages that show everything). */
export const allItemsOf = (stock) => [...(stock?.lehnga?.items || []), ...(stock?.saree?.items || [])];

/** "Lehnga 21/11 · Saree 21/11" — which upload each category comes from. */
export function stockDatesLabel(stock, fmt = (d) => d) {
  const part = (name, d) => `${name} ${d ? fmt(d) : '—'}`;
  return `${part('Lehnga', stock?.lehnga?.date)} · ${part('Saree', stock?.saree?.date)}`;
}
