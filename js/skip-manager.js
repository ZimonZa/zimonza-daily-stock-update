// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Skip Panel Manager
// ═══════════════════════════════════════════════════════════════
import {
  addToSkip, removeFromSkip, getAllSkippedProducts,
  updateUploadStatus, getStockData, getAllUploadDates
} from './firestore-service.js';
import { UPLOAD_STATUS, CATEGORIES } from './constants.js';
import { loadLatestStock, indexStock, lookupKuntal } from './stock-store.js';
import { itemStockLevel } from './utils.js';

export async function loadSkipPanelData() {
  const [skipped, dates] = await Promise.all([
    getAllSkippedProducts(),
    getAllUploadDates()
  ]);
  const latest = await loadLatestStock();
  const index = indexStock({ lehnga: latest.lehnga.items, saree: latest.saree.items });
  return skipped.map(s => {
    const stock = lookupKuntal(s.sku, '', index).stock;
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
