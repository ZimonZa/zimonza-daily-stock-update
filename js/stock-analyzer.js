// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Stock Comparison & Analysis Engine
// Compares current vs previous stock to detect changes
// ═══════════════════════════════════════════════════════════════

import { CHANGE_TYPES } from './constants.js';
import { getStockLevel, itemStockLevel, normColorKey } from './utils.js';

/**
 * Compare current stock items against previous stock items
 * Returns detailed change report per SKU and per color
 *
 * @param {Array} currentItems  - Parsed items from today's upload
 * @param {Array} previousItems - Items from previous upload date
 * @returns {Object} Analysis result
 */
export function analyzeStockChanges(currentItems, previousItems) {
  const prevMap = new Map((previousItems || []).map(i => [String(i.sku), i]));
  const currMap = new Map(currentItems.map(i => [String(i.sku), i]));

  const newArrivals = [];
  const soldItems = [];
  const restockedItems = [];
  const soldOutItems = [];
  const unchangedItems = [];

  // Process current items
  for (const curr of currentItems) {
    const sku = String(curr.sku);
    const prev = prevMap.get(sku);

    if (!prev) {
      // Brand new SKU
      newArrivals.push({
        ...curr,
        changeType: CHANGE_TYPES.NEW_ARRIVAL,
        prevQty: 0,
        currQty: curr.totalQty,
        colorChanges: (curr.colors || []).map(c => ({
          color: c.name,
          prevQty: 0,
          currQty: c.qty,
          change: c.qty,
          type: CHANGE_TYPES.NEW_ARRIVAL
        }))
      });
      continue;
    }

    // Build color maps for comparison
    const prevColorMap = new Map((prev.colors || []).map(c => [normColorKey(c.name), c]));
    const currColorMap = new Map((curr.colors || []).map(c => [normColorKey(c.name), c]));

    const colorChanges = [];
    let hasSold = false;
    let hasRestocked = false;

    // Check all colors from both maps
    const allColors = new Set([...prevColorMap.keys(), ...currColorMap.keys()]);

    for (const colorKey of allColors) {
      const p = prevColorMap.get(colorKey);
      const c = currColorMap.get(colorKey);
      const prevQty = p?.qty || 0;
      const currQty = c?.qty || 0;
      const change = currQty - prevQty;
      const colorName = c?.name || p?.name || colorKey;

      if (change === 0) continue;

      let type;
      if (change < 0) {
        type = currQty === 0 ? CHANGE_TYPES.SOLD_OUT : CHANGE_TYPES.SOLD;
        hasSold = true;
      } else {
        type = prevQty === 0 ? CHANGE_TYPES.NEW_ARRIVAL : CHANGE_TYPES.RESTOCKED;
        hasRestocked = true;
      }

      colorChanges.push({
        color: colorName,
        prevQty,
        currQty,
        change,
        type
      });
    }

    if (colorChanges.length === 0) {
      unchangedItems.push({ ...curr, changeType: CHANGE_TYPES.UNCHANGED });
      continue;
    }

    const baseInfo = {
      ...curr,
      prevQty: prev.totalQty,
      currQty: curr.totalQty,
      totalChange: curr.totalQty - prev.totalQty,
      colorChanges
    };

    // Check if entire item is sold out
    if (curr.totalQty === 0) {
      soldOutItems.push({ ...baseInfo, changeType: CHANGE_TYPES.SOLD_OUT });
    }

    // Separate into sold and restocked based on color-level changes
    const soldColors = colorChanges.filter(c => c.change < 0);
    const restockedColors = colorChanges.filter(c => c.change > 0);

    if (soldColors.length > 0) {
      soldItems.push({
        ...baseInfo,
        changeType: CHANGE_TYPES.SOLD,
        soldColorChanges: soldColors,
        totalSold: soldColors.reduce((s, c) => s + Math.abs(c.change), 0)
      });
    }

    if (restockedColors.length > 0) {
      restockedItems.push({
        ...baseInfo,
        changeType: CHANGE_TYPES.RESTOCKED,
        restockedColorChanges: restockedColors,
        totalRestocked: restockedColors.reduce((s, c) => s + c.change, 0)
      });
    }
  }

  // Check for items that disappeared (sold out completely, not in current)
  for (const prev of (previousItems || [])) {
    const sku = String(prev.sku);
    if (!currMap.has(sku) && prev.totalQty > 0) {
      soldOutItems.push({
        ...prev,
        changeType: CHANGE_TYPES.SOLD_OUT,
        prevQty: prev.totalQty,
        currQty: 0,
        totalChange: -prev.totalQty,
        colorChanges: (prev.colors || []).map(c => ({
          color: c.name,
          prevQty: c.qty,
          currQty: 0,
          change: -c.qty,
          type: CHANGE_TYPES.SOLD_OUT
        }))
      });
    }
  }

  return {
    newArrivals,
    soldItems,
    restockedItems,
    soldOutItems,
    unchangedItems,
    summary: {
      totalCurrent: currentItems.length,
      totalPrevious: (previousItems || []).length,
      newArrivalsCount: newArrivals.length,
      soldCount: soldItems.length,
      restockedCount: restockedItems.length,
      soldOutCount: soldOutItems.length,
      unchangedCount: unchangedItems.length,
      totalSoldPcs: soldItems.reduce((s, i) => s + (i.totalSold || 0), 0),
      totalRestockedPcs: restockedItems.reduce((s, i) => s + (i.totalRestocked || 0), 0)
    }
  };
}

/**
 * Compute stock health metrics from items
 */
export function computeStockHealth(items) {
  const total = items.length;
  if (total === 0) return { low: 0, medium: 0, high: 0, soldOut: 0, total: 0 };

  const counts = { low: 0, medium: 0, high: 0, sold_out: 0 };
  for (const item of items) {
    const level = itemStockLevel(item);
    counts[level] = (counts[level] || 0) + 1;
  }

  return {
    low: counts.low,
    medium: counts.medium,
    high: counts.high,
    soldOut: counts.sold_out,
    total,
    lowPct: Math.round((counts.low / total) * 100),
    mediumPct: Math.round((counts.medium / total) * 100),
    highPct: Math.round((counts.high / total) * 100)
  };
}

/**
 * Compute stock health per COLOUR: every product-colour entry is classified
 * on its own quantity. Items without colour data count once as sold_out.
 */
export function computeColorHealth(items) {
  const counts = { low: 0, medium: 0, high: 0, sold_out: 0 };
  let total = 0;
  for (const item of items) {
    const colors = Array.isArray(item.colors) ? item.colors : [];
    if (colors.length === 0) {
      counts.sold_out++;
      total++;
      continue;
    }
    for (const c of colors) {
      counts[getStockLevel(Number(c.qty) || 0)]++;
      total++;
    }
  }
  if (total === 0) return { low: 0, medium: 0, high: 0, soldOut: 0, total: 0, lowPct: 0, mediumPct: 0, highPct: 0 };
  return {
    low: counts.low,
    medium: counts.medium,
    high: counts.high,
    soldOut: counts.sold_out,
    total,
    lowPct: Math.round((counts.low / total) * 100),
    mediumPct: Math.round((counts.medium / total) * 100),
    highPct: Math.round((counts.high / total) * 100)
  };
}

/**
 * Find fast-moving products (most sold in period)
 */
export function findFastMovers(soldItems, topN = 10) {
  return [...soldItems]
    .sort((a, b) => (b.totalSold || 0) - (a.totalSold || 0))
    .slice(0, topN);
}

/**
 * Find dead stock (unchanged for multiple uploads)
 */
export function findDeadStock(items, unchangedItems) {
  const unchangedSkus = new Set(unchangedItems.map(i => String(i.sku)));
  return items.filter(i => unchangedSkus.has(String(i.sku)));
}

/**
 * Get top colors by quantity sold across all sold items
 */
export function getTopColors(soldItems, topN = 10) {
  const colorMap = new Map();
  for (const item of soldItems) {
    for (const cc of (item.soldColorChanges || item.colorChanges || [])) {
      if (cc.change < 0) {
        const key = normColorKey(cc.color);
        colorMap.set(key, {
          name: cc.color,
          totalSold: (colorMap.get(key)?.totalSold || 0) + Math.abs(cc.change)
        });
      }
    }
  }
  return [...colorMap.values()]
    .sort((a, b) => b.totalSold - a.totalSold)
    .slice(0, topN);
}
