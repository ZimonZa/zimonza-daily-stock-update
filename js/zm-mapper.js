// ═══════════════════════════════════════════════════════════════
// ZIMONZA — ZM Panel Mapper Logic
// ═══════════════════════════════════════════════════════════════

import { saveZMMapping, getAllZMMappings, updateUploadStatus, getAllUploadStatuses, getStockData, getAllUploadDates } from './firestore-service.js';
import { UPLOAD_STATUS, CATEGORIES } from './constants.js';

/**
 * Load full ZM panel data: mappings + stock + statuses
 */
export async function loadZMPanelData() {
  const [mappings, statuses, dates] = await Promise.all([
    getAllZMMappings(),
    getAllUploadStatuses(),
    getAllUploadDates()
  ]);

  const latestDate = dates[0];
  let lehngaStock = [], sareeStock = [];

  if (latestDate) {
    [lehngaStock, sareeStock] = await Promise.all([
      getStockData(latestDate, CATEGORIES.LEHNGA),
      getStockData(latestDate, CATEGORIES.SAREE)
    ]);
  }

  const stockMap = new Map([
    ...lehngaStock.map(i => [String(i.sku), i]),
    ...sareeStock.map(i => [String(i.sku), i])
  ]);

  // Merge data
  const products = mappings.map(m => {
    const sku = String(m.kuntalCode);
    const stock = stockMap.get(sku);
    const status = statuses[sku] || { status: UPLOAD_STATUS.PENDING };
    return {
      zmCode: m.zmCode,
      kuntalCode: m.kuntalCode,
      sku,
      name: stock?.name || '—',
      category: stock?.category || '—',
      colors: stock?.colors || [],
      totalQty: stock?.totalQty || 0,
      stockLevel: stock?.stockLevel || 'sold_out',
      uploadStatus: status.status || UPLOAD_STATUS.PENDING,
      notes: status.notes || '',
      hasStock: !!stock
    };
  });

  const summary = {
    total: products.length,
    uploaded: products.filter(p => p.uploadStatus === UPLOAD_STATUS.UPLOADED).length,
    pending: products.filter(p => p.uploadStatus === UPLOAD_STATUS.PENDING || p.uploadStatus === UPLOAD_STATUS.NOT_UPLOADED).length,
    skipped: products.filter(p => p.uploadStatus === UPLOAD_STATUS.SKIPPED).length,
    lowStock: products.filter(p => p.stockLevel === 'low').length
  };

  return { products, summary, latestDate };
}

/**
 * Update a product's upload status
 */
export async function setUploadStatus(sku, status, notes) {
  await updateUploadStatus(sku, status, notes);
}
