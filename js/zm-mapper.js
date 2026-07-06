// ═══════════════════════════════════════════════════════════════
// ZIMONZA — ZM Panel Mapper Logic
// ═══════════════════════════════════════════════════════════════

import { saveZMMapping, getAllZMMappings, updateUploadStatus, getAllUploadStatuses, getStockData, getAllUploadDates } from './firestore-service.js';
import { UPLOAD_STATUS, CATEGORIES } from './constants.js';
import { normItemNo, itemStitchType, normColorKey, itemStockLevel } from './utils.js';

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

  // Normalised key (drops trailing dot, case-insensitive) so mapping codes
  // join their stock despite formatting drift. Keeps "(UNST)" distinct.
  const norm = v => normItemNo(v).toUpperCase();
  const stockMap = new Map([
    ...lehngaStock.map(i => [norm(i.sku), i]),
    ...sareeStock.map(i => [norm(i.sku), i])
  ]);

  // Merge data
  const products = mappings.map(m => {
    const sku = normItemNo(m.kuntalCode);
    const stock = stockMap.get(norm(m.kuntalCode));
    const status = statuses[String(m.kuntalCode)] || statuses[sku] || { status: UPLOAD_STATUS.PENDING };
    return {
      zmCode: m.zmCode,
      kuntalCode: sku,
      sku,
      itemType: itemStitchType(m.kuntalCode), // 'stitched' | 'unstitched'
      name: stock?.name || '—',
      category: stock?.category || '—',
      colors: stock?.colors || [],
      totalQty: stock?.totalQty || 0,
      // Only a real stock doc gets a level; otherwise leave blank ('—') instead
      // of mislabelling un-stocked mappings as "Sold Out".
      stockLevel: stock ? itemStockLevel(stock) : '',
      uploadStatus: status.status || UPLOAD_STATUS.PENDING,
      uploadedColors: Array.isArray(status.uploadedColors) ? status.uploadedColors : [],
      notes: status.notes || '',
      updatedAt: status.updatedAt || null,
      hasStock: !!stock
    };
  });

  const totalColours    = products.reduce((s, p) => s + (p.colors?.length || 0), 0);
  const uploadedColours = products.reduce((s, p) => s + (p.uploadedColors?.length || 0), 0);
  const outOfStockColours = products.reduce((s, p) => {
    const sk = new Set((p.colors || []).map(c => normColorKey(c.name)));
    return s + (p.uploadedColors || []).filter(n => !sk.has(normColorKey(n))).length;
  }, 0);
  const summary = {
    total:        products.length,
    uploaded:     products.filter(p => p.uploadStatus === UPLOAD_STATUS.UPLOADED).length,
    partial:      products.filter(p => p.uploadStatus === UPLOAD_STATUS.PARTIAL).length,
    pending:      products.filter(p => p.uploadStatus === UPLOAD_STATUS.PENDING).length,
    notUploaded:  products.filter(p => p.uploadStatus === UPLOAD_STATUS.NOT_UPLOADED).length,
    skipped:      products.filter(p => p.uploadStatus === UPLOAD_STATUS.SKIPPED).length,
    lowStock:     products.filter(p => p.stockLevel === 'low').length,
    lehnga:       products.filter(p => p.category === CATEGORIES.LEHNGA).length,
    saree:        products.filter(p => p.category === CATEGORIES.SAREE).length,
    stitched:     products.filter(p => p.itemType === 'stitched').length,
    unstitched:   products.filter(p => p.itemType === 'unstitched').length,
    totalColours,
    uploadedColours,
    outOfStockColours,
    uploadedPct:  totalColours ? Math.round((uploadedColours / totalColours) * 100) : 0,
  };

  return { products, summary, latestDate };
}

/**
 * Update a product's upload status (+ optional per-colour uploaded list)
 */
export async function setUploadStatus(sku, status, notes, uploadedColors) {
  await updateUploadStatus(sku, status, notes, uploadedColors);
}
