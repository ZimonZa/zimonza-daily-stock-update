// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Skip Panel Manager
// ═══════════════════════════════════════════════════════════════
import {
  addToSkip, removeFromSkip, getAllSkippedProducts,
  updateUploadStatus, getAllZMMappings
} from './firestore-service.js';
import { UPLOAD_STATUS } from './constants.js';
import { loadLatestStock, indexStock, lookupKuntal } from './stock-store.js';
import { itemStockLevel, normItemNo } from './utils.js';

export async function loadSkipPanelData() {
  const [skipped, zm, latest] = await Promise.all([
    getAllSkippedProducts(),
    getAllZMMappings(),
    loadLatestStock()
  ]);
  return buildSkipRows(skipped, zm, indexStock({ lehnga: latest.lehnga.items, saree: latest.saree.items }));
}

/**
 * Skip Panel rows: each skipped Kuntal code with its stock. A code in both
 * files uses the Lehnga / Saree choice made in the ZM Panel (was: always
 * the saree one).
 */
export function buildSkipRows(skipped, zmMappings, index) {
  const chosen = new Map((zmMappings || []).filter(m => m.category)
    .map(m => [normItemNo(m.kuntalCode).toUpperCase(), m.category]));
  return (skipped || []).map(s => {
    const stock = lookupKuntal(s.sku, chosen.get(normItemNo(s.sku).toUpperCase()) || '', index).stock;
    return {
      ...s,
      name: stock?.name || '—',
      category: stock?.category || '—',
      colors: stock?.colors || [],
      totalQty: stock?.totalQty || 0,
      stockLevel: stock ? itemStockLevel(stock) : 'sold_out'
    };
  });
}

export async function skipProduct(sku, notes = '') {
  await addToSkip(sku, notes);
  await updateUploadStatus(sku, UPLOAD_STATUS.SKIPPED, notes);
}

export async function unskipProduct(sku) {
  await removeFromSkip(sku);
  await updateUploadStatus(sku, UPLOAD_STATUS.NOT_UPLOADED);
}
