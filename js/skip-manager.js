// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Skip Panel Manager
// ═══════════════════════════════════════════════════════════════
import {
  addToSkip, removeFromSkip, getAllSkippedProducts,
  updateUploadStatus, getStockData, getAllUploadDates
} from './firestore-service.js';
import { UPLOAD_STATUS, CATEGORIES } from './constants.js';

export async function loadSkipPanelData() {
  const [skipped, dates] = await Promise.all([
    getAllSkippedProducts(),
    getAllUploadDates()
  ]);
  const latestDate = dates[0];
  let stockMap = new Map();
  if (latestDate) {
    const [lehnga, saree] = await Promise.all([
      getStockData(latestDate, CATEGORIES.LEHNGA),
      getStockData(latestDate, CATEGORIES.SAREE)
    ]);
    [...lehnga, ...saree].forEach(i => stockMap.set(String(i.sku), i));
  }
  return skipped.map(s => {
    const stock = stockMap.get(String(s.sku));
    return {
      ...s,
      name: stock?.name || '—',
      category: stock?.category || '—',
      colors: stock?.colors || [],
      totalQty: stock?.totalQty || 0,
      stockLevel: stock?.stockLevel || 'sold_out'
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
