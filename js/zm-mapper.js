// ═══════════════════════════════════════════════════════════════
// ZIMONZA — ZM Panel Mapper Logic
// ═══════════════════════════════════════════════════════════════

import { saveZMMapping, getAllZMMappings, updateUploadStatus, getAllUploadStatuses } from './firestore-service.js';
import { UPLOAD_STATUS, CATEGORIES } from './constants.js';
import { normItemNo, itemStitchType, normColorKey, itemStockLevel } from './utils.js';
import { loadLatestStock, indexStock, lookupKuntal } from './stock-store.js';

/**
 * Load full ZM panel data: mappings + stock + statuses
 */
export async function loadZMPanelData() {
  const [mappings, statuses, current] = await Promise.all([
    getAllZMMappings(),
    getAllUploadStatuses(),
    loadLatestStock()
  ]);

  // Each category from its own latest upload; "9551 M" finds 9551, "(UNST)"
  // stays its own product. A code in BOTH files uses the chosen category, or
  // is flagged so the owner can choose.
  const index = indexStock({ lehnga: current.lehnga.items, saree: current.saree.items });
  const latestDate = [current.lehnga.date, current.saree.date].filter(Boolean).sort().pop() || null;

  // Merge data
  const products = mappings.map(m => {
    const sku = normItemNo(m.kuntalCode);
    const hit = lookupKuntal(m.kuntalCode, m.category || '', index);
    const stock = hit.stock;
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
      hasStock: !!stock,
      chosenCategory: m.category || '',
      clash: hit.clash,
      both: hit.both ? { lehnga: hit.both.lehnga.totalQty, saree: hit.both.saree.totalQty,
        lehngaName: hit.both.lehnga.name, sareeName: hit.both.saree.name } : null
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
    clashes:      products.filter(p => p.clash).length,
    totalColours,
    uploadedColours,
    outOfStockColours,
    uploadedPct:  totalColours ? Math.round((uploadedColours / totalColours) * 100) : 0,
  };

  return { products, summary, latestDate, stockDates: { lehnga: current.lehnga.date, saree: current.saree.date } };
}

/**
 * Update a product's upload status (+ optional per-colour uploaded list)
 */
export async function setUploadStatus(sku, status, notes, uploadedColors) {
  await updateUploadStatus(sku, status, notes, uploadedColors);
}
