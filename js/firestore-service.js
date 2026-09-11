// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Firestore Service Layer
// ═══════════════════════════════════════════════════════════════

import { db } from './firebase-config.js';
import { COLLECTIONS, DEFAULT_PARTIES, GST_RATE_DEFAULTS, HSN_DEFAULTS, PURCHASE_DOC_TYPES, DISPATCH_STATUS } from './constants.js';
import { normZmCode } from './utils.js';
import { dispatchWritePayload } from './myntra-dispatch.js';
import {
  doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  collection, query, orderBy, limit, serverTimestamp,
  writeBatch, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ─── Batch Chunking Helper ───────────────────────────────────────
// Firestore limit: max 500 writes per batch. We use 499 for safety.
const BATCH_CHUNK_SIZE = 499;

async function runChunkedBatch(operations) {
  for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
    const chunk = operations.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) op(batch);
    await batch.commit();
  }
}

// ─── Daily Stock ────────────────────────────────────────────────

/** Save all stock items for a date+category (chunked for >499 docs) */
export async function saveStockData(date, category, items) {
  const catRef = collection(db, COLLECTIONS.DAILY_STOCK, date, category);
  const operations = items.map(item => (batch) => {
    const docRef = doc(catRef, String(item.sku));
    batch.set(docRef, { ...item, updatedAt: serverTimestamp() });
  });
  await runChunkedBatch(operations);
}

/** Save daily summary */
export async function saveDailySummary(date, summary) {
  const ref = doc(db, COLLECTIONS.DAILY_STOCK, date, 'meta', 'summary');
  await setDoc(ref, { ...summary, savedAt: serverTimestamp() });
}

/** Get stock items for a date+category */
export async function getStockData(date, category) {
  const catRef = collection(db, COLLECTIONS.DAILY_STOCK, date, category);
  const snap = await getDocs(catRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get daily summary */
export async function getDailySummary(date) {
  const ref = doc(db, COLLECTIONS.DAILY_STOCK, date, 'meta', 'summary');
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/** Get all uploaded dates (reads from history collection where docs are explicitly created) */
export async function getAllUploadDates() {
  const snap = await getDocs(collection(db, COLLECTIONS.HISTORY));
  return snap.docs.map(d => d.id).filter(id => /^\d{4}-\d{2}-\d{2}$/.test(id)).sort().reverse();
}

/** Get previous upload date before given date */
export async function getPreviousUploadDate(date) {
  const all = await getAllUploadDates();
  const idx = all.indexOf(date);
  return idx < all.length - 1 ? all[idx + 1] : null;
}

// ─── ZM Mapping ─────────────────────────────────────────────────

/** Save ZM mapping data (chunked for >499 docs) */
export async function saveZMMapping(mappings) {
  const operations = mappings.map(m => (batch) => {
    const ref = doc(db, COLLECTIONS.ZM_MAPPING, String(m.kuntalCode));
    batch.set(ref, { zmCode: m.zmCode, kuntalCode: m.kuntalCode, updatedAt: serverTimestamp() });
  });
  await runChunkedBatch(operations);
}

/** Get all ZM mappings */
export async function getAllZMMappings() {
  const snap = await getDocs(collection(db, COLLECTIONS.ZM_MAPPING));
  return snap.docs.map(d => d.data());
}

// ─── Myntra Mapping ─────────────────────────────────────────────

/** Save Myntra mapping data (chunked for >499 docs), keyed by SellerSkuCode */
export async function saveMyntraMappings(mappings) {
  const operations = mappings.map(m => (batch) => {
    const id = String(m.sellerSkuCode).replace(/\//g, '_');
    const ref = doc(db, COLLECTIONS.MYNTRA_MAPPING, id);
    batch.set(ref, {
      styleId: m.styleId ?? '',
      articleType: m.articleType ?? '',
      colour: m.colour ?? '',
      sellerSkuCode: m.sellerSkuCode,
      zmCode: m.zmCode,
      colourName: m.colourName,
      updatedAt: serverTimestamp()
    });
  });
  await runChunkedBatch(operations);
}

/** Get all Myntra mappings */
export async function getAllMyntraMappings() {
  const snap = await getDocs(collection(db, COLLECTIONS.MYNTRA_MAPPING));
  return snap.docs.map(d => d.data());
}

// ─── Myntra Pricing ─────────────────────────────────────────────

/** Save Myntra pricing rows (chunked), keyed by normalised ZM code */
export async function saveMyntraPricing(rows) {
  const operations = rows.map(r => (batch) => {
    const ref = doc(db, COLLECTIONS.MYNTRA_PRICING, normZmCode(r.zmCode));
    batch.set(ref, {
      zmCode: normZmCode(r.zmCode),
      rawZmCode: r.rawZmCode ?? r.zmCode ?? '',
      kuntalCode: r.kuntalCode ?? '',
      category: r.category ?? '',
      kuntalSellingPrice: r.kuntalSellingPrice ?? null,
      myntraMrp: r.myntraMrp ?? null,
      myntraMuPrice: r.myntraMuPrice ?? null,
      myntraIsp: r.myntraIsp ?? null,
      updatedAt: serverTimestamp()
    });
  });
  await runChunkedBatch(operations);
}

/** Get all Myntra pricing rows */
export async function getAllMyntraPricing() {
  const snap = await getDocs(collection(db, COLLECTIONS.MYNTRA_PRICING));
  return snap.docs.map(d => d.data());
}

/** Delete every pricing row (used by "Replace all" on re-upload) */
export async function clearMyntraPricing() {
  const snap = await getDocs(collection(db, COLLECTIONS.MYNTRA_PRICING));
  if (!snap.docs.length) return 0;
  await runChunkedBatch(snap.docs.map(d => (batch) => batch.delete(d.ref)));
  return snap.docs.length;
}

// ─── Myntra SKU Status (active / deactive on Myntra) ────────────
// A missing doc means ACTIVE. We only ever store explicit decisions, so a
// fresh mapping upload doesn't need 400 status writes to mean "all live".

const skuStatusId = (sku) => String(sku).replace(/\//g, '_');

/** Set one SellerSkuCode active/inactive */
export async function setMyntraSkuActive(sellerSkuCode, active) {
  const ref = doc(db, COLLECTIONS.MYNTRA_SKU_STATUS, skuStatusId(sellerSkuCode));
  await setDoc(ref, {
    sellerSkuCode: String(sellerSkuCode),
    active: !!active,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/** Set many SellerSkuCodes active/inactive at once (chunked) */
export async function setMyntraSkuActiveBulk(sellerSkuCodes, active) {
  const operations = sellerSkuCodes.map(sku => (batch) => {
    const ref = doc(db, COLLECTIONS.MYNTRA_SKU_STATUS, skuStatusId(sku));
    batch.set(ref, {
      sellerSkuCode: String(sku),
      active: !!active,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
  await runChunkedBatch(operations);
}

/** Map of sellerSkuCode → { active } for every SKU with an explicit decision */
export async function getAllMyntraSkuStatus() {
  const snap = await getDocs(collection(db, COLLECTIONS.MYNTRA_SKU_STATUS));
  const map = {};
  snap.docs.forEach(d => {
    const data = d.data();
    if (data?.sellerSkuCode) map[data.sellerSkuCode] = data;
  });
  return map;
}

// ─── Myntra Returns & RTO ───────────────────────────────────────
// Its own collection. Pieces leave it only through a pick slip or a Goods
// Return — generating an inventory update never consumes it, even when the
// "include returns" toggle is on. Declaring what you hold is not spending it.

/** Add return/RTO rows (auto-id docs, chunked) */
export async function addMyntraReturns(rows) {
  const col = collection(db, COLLECTIONS.MYNTRA_RETURNS);
  const operations = rows.map(r => (batch) => {
    batch.set(doc(col), { ...r, createdAt: serverTimestamp() });
  });
  await runChunkedBatch(operations);
}

/** Get all return/RTO rows */
export async function getAllMyntraReturns() {
  const snap = await getDocs(collection(db, COLLECTIONS.MYNTRA_RETURNS));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Patch a single return/RTO row */
export async function updateMyntraReturn(id, patch) {
  await updateDoc(doc(db, COLLECTIONS.MYNTRA_RETURNS, id), { ...patch, updatedAt: serverTimestamp() });
}

/** Delete a single return/RTO row */
export async function deleteMyntraReturn(id) {
  await deleteDoc(doc(db, COLLECTIONS.MYNTRA_RETURNS, id));
}

/** Delete many return/RTO rows at once (chunked) */
export async function deleteMyntraReturns(ids) {
  const operations = (ids || []).map(id => (batch) => {
    batch.delete(doc(db, COLLECTIONS.MYNTRA_RETURNS, id));
  });
  await runChunkedBatch(operations);
}

// ─── Purchase Bills ─────────────────────────────────────────────

const billId = (billNo) => String(billNo).replace(/[\/\\#?\s]+/g, '_');

/** Save (or overwrite) a purchase bill, keyed by its bill number */
export async function savePurchaseBill(bill) {
  const id = billId(bill.billNo);
  await setDoc(doc(db, COLLECTIONS.PURCHASE_BILLS, id), {
    ...bill,
    id,
    savedAt: serverTimestamp()
  });
  return id;
}

/** Get all purchase bills, newest bill date first */
export async function getAllPurchaseBills() {
  const snap = await getDocs(collection(db, COLLECTIONS.PURCHASE_BILLS));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.billDate ?? '').localeCompare(String(a.billDate ?? '')));
}

/** Delete a purchase bill */
export async function deletePurchaseBill(id) {
  await deleteDoc(doc(db, COLLECTIONS.PURCHASE_BILLS, id));
}

/**
 * Reserve the next sequential number for a document type.
 * Transactional so two tabs can't hand out the same invoice number.
 * Returns { seq, financialYear, billNo } e.g. "INV/25-26/0042".
 */
export async function nextBillNumber(docTypeId) {
  const type = PURCHASE_DOC_TYPES.find(t => t.id === docTypeId) || PURCHASE_DOC_TYPES[0];
  const fy = financialYearLabel(new Date());
  const key = `${type.id}_${fy}`;
  const ref = doc(db, COLLECTIONS.SETTINGS, 'purchase_counters');

  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const next = (Number(data[key]) || 0) + 1;
    tx.set(ref, { [key]: next, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });

  return { seq, financialYear: fy, billNo: `${type.prefix}/${fy}/${String(seq).padStart(4, '0')}` };
}

// ─── Stock Pick Slips (goods taken back out of Returns / RTO) ───
// The return rows are decremented in place, so the slip IS the record of
// what was consumed and when. Keep it accurate.

export async function savePickSlip(slip) {
  const id = billId(slip.slipNo);
  await setDoc(doc(db, COLLECTIONS.PICK_SLIPS, id), { ...slip, id, savedAt: serverTimestamp() });
  return id;
}

/** All pick slips, newest slip date first */
export async function getAllPickSlips() {
  const snap = await getDocs(collection(db, COLLECTIONS.PICK_SLIPS));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

export async function deletePickSlip(id) {
  await deleteDoc(doc(db, COLLECTIONS.PICK_SLIPS, id));
}

/**
 * Reserve the next pick-slip number, e.g. "PS/26-27/0007".
 * Shares the counters doc (and the transaction pattern) with nextBillNumber.
 */
export async function nextSlipNumber() {
  const fy = financialYearLabel(new Date());
  const key = `pick_slip_${fy}`;
  const ref = doc(db, COLLECTIONS.SETTINGS, 'purchase_counters');

  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const next = (Number(data[key]) || 0) + 1;
    tx.set(ref, { [key]: next, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });

  return { seq, financialYear: fy, slipNo: `PS/${fy}/${String(seq).padStart(4, '0')}` };
}

/**
 * Apply the stock consumed by a pick slip to the return rows.
 * Partially used rows are decremented; rows that reach zero are deleted.
 * @param {Array<{id:string, remaining:number}>} updates
 */
export async function applyReturnConsumption(updates) {
  const operations = updates.map(u => (batch) => {
    const ref = doc(db, COLLECTIONS.MYNTRA_RETURNS, u.id);
    if (u.remaining > 0) batch.update(ref, { qty: u.remaining, updatedAt: serverTimestamp() });
    else batch.delete(ref);
  });
  await runChunkedBatch(operations);
}

/** Indian financial year label for a date: 2026-08-21 → "26-27" (Apr–Mar) */
export function financialYearLabel(date = new Date()) {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1; // April = month 3
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

// ─── Dispatches (what went out, and what came back) ─────────────
// Keyed by forward tracking ID, so a returning parcel is found by the
// number printed on it.

// The tracking ID is the document id, so it must survive punctuation and
// whitespace identically every time — "SF 123/456" and "SF123456" are one
// parcel, and must not become two documents.
const dispatchId = (forwardId) => String(forwardId).trim().toUpperCase().replace(/[/\\#?\s]+/g, '_');

/**
 * Save dispatch records (chunked).
 *
 * A record marked `_update` patches details only. Re-reading a label must
 * never push `status: 'shipped'` and `return: null` over a parcel that has
 * already come back — that would erase the return, and with it the evidence
 * behind a fake-return finding.
 */
export async function saveDispatches(records) {
  const withId = (records || []).filter(r => r.forwardId);
  const operations = withId.map(r => (batch) => {
    const id = dispatchId(r.forwardId);
    batch.set(doc(db, COLLECTIONS.DISPATCHES, id),
      { ...dispatchWritePayload(r), id, updatedAt: serverTimestamp() }, { merge: true });
  });
  await runChunkedBatch(operations);
  return withId.length;
}

/** One dispatch with no tracking ID yet — stored under a generated id. */
export async function addDispatch(record) {
  const col = collection(db, COLLECTIONS.DISPATCHES);
  const ref = record.forwardId ? doc(db, COLLECTIONS.DISPATCHES, dispatchId(record.forwardId)) : doc(col);
  await setDoc(ref, { ...dispatchWritePayload(record), id: ref.id, updatedAt: serverTimestamp() }, { merge: true });
  return ref.id;
}

export async function getAllDispatches() {
  const snap = await getDocs(collection(db, COLLECTIONS.DISPATCHES));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateDispatch(id, patch) {
  await updateDoc(doc(db, COLLECTIONS.DISPATCHES, id), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteDispatch(id) {
  await deleteDoc(doc(db, COLLECTIONS.DISPATCHES, id));
}

/** Mark an order that can never be shipped — the supplier never sent it. */
export async function markDispatchUnfulfillable(id, reason) {
  await updateDispatch(id, { status: DISPATCH_STATUS.UNFULFILLABLE, unfulfillableReason: String(reason ?? '').trim() });
}

/** What actually arrived against a purchase order, line by line. */
export async function savePurchaseReceipts(billId, receipts) {
  await updateDoc(doc(db, COLLECTIONS.PURCHASE_BILLS, billId), {
    receipts, receivedAt: serverTimestamp()
  });
}

// ─── Purchase Settings (parties, GST rates, bank, terms) ────────

export async function getPurchaseSettings() {
  const ref = doc(db, COLLECTIONS.SETTINGS, 'purchase');
  const snap = await getDoc(ref);
  const saved = snap.exists() ? snap.data() : {};
  return {
    ...DEFAULT_PARTIES,
    ...saved,
    defaultNote: saved.defaultNote ?? '',
    gstRates: { ...GST_RATE_DEFAULTS, ...(saved.gstRates || {}) },
    hsnCodes: { ...HSN_DEFAULTS, ...(saved.hsnCodes || {}) }
  };
}

export async function savePurchaseSettings(settings) {
  const ref = doc(db, COLLECTIONS.SETTINGS, 'purchase');
  await setDoc(ref, { ...settings, updatedAt: serverTimestamp() }, { merge: true });
}

// ─── Website Upload Status ───────────────────────────────────────

/** Update upload status for a SKU (optionally the per-colour uploaded list) */
export async function updateUploadStatus(sku, status, notes = '', uploadedColors) {
  const ref = doc(db, COLLECTIONS.WEBSITE_STATUS, String(sku));
  const payload = { sku: String(sku), status, notes, updatedAt: serverTimestamp() };
  if (Array.isArray(uploadedColors)) payload.uploadedColors = uploadedColors;
  await setDoc(ref, payload, { merge: true });
}

/** Get all upload statuses */
export async function getAllUploadStatuses() {
  const snap = await getDocs(collection(db, COLLECTIONS.WEBSITE_STATUS));
  const map = {};
  snap.docs.forEach(d => { map[d.id] = d.data(); });
  return map;
}

/** Get upload status for single SKU */
export async function getUploadStatus(sku) {
  const ref = doc(db, COLLECTIONS.WEBSITE_STATUS, String(sku));
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : { status: 'pending' };
}

// ─── Skip Products ───────────────────────────────────────────────

/** Add a product to skip list */
export async function addToSkip(sku, notes = '') {
  const ref = doc(db, COLLECTIONS.SKIP_PRODUCTS, String(sku));
  await setDoc(ref, { sku: String(sku), notes, skippedAt: serverTimestamp() }, { merge: true });
}

/** Remove from skip list */
export async function removeFromSkip(sku) {
  const ref = doc(db, COLLECTIONS.SKIP_PRODUCTS, String(sku));
  await deleteDoc(ref);
}

/** Get all skipped products */
export async function getAllSkippedProducts() {
  const snap = await getDocs(collection(db, COLLECTIONS.SKIP_PRODUCTS));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Check if a product is skipped */
export async function isSkipped(sku) {
  const ref = doc(db, COLLECTIONS.SKIP_PRODUCTS, String(sku));
  const snap = await getDoc(ref);
  return snap.exists();
}

// ─── Upload History ──────────────────────────────────────────────

/** Save upload event to history */
export async function saveUploadHistory(date, data) {
  const ref = doc(db, COLLECTIONS.HISTORY, date);
  await setDoc(ref, {
    date,
    ...data,
    uploadedAt: serverTimestamp()
  }, { merge: true });
}

/** Get upload history for a date */
export async function getUploadHistory(date) {
  const ref = doc(db, COLLECTIONS.HISTORY, date);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/** Get recent upload history */
export async function getRecentHistory(limitCount = 30) {
  const q = query(
    collection(db, COLLECTIONS.HISTORY),
    orderBy('uploadedAt', 'desc'),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Reports ─────────────────────────────────────────────────────

/** Save a report */
export async function saveReport(reportData) {
  const ref = doc(collection(db, COLLECTIONS.REPORTS));
  await setDoc(ref, { ...reportData, createdAt: serverTimestamp() });
  return ref.id;
}

/** Get all reports */
export async function getAllReports() {
  const q = query(collection(db, COLLECTIONS.REPORTS), orderBy('createdAt', 'desc'), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Settings ────────────────────────────────────────────────────

/** Save settings */
export async function saveSettings(settings) {
  const ref = doc(db, COLLECTIONS.SETTINGS, 'general');
  await setDoc(ref, { ...settings, updatedAt: serverTimestamp() }, { merge: true });
}

/** Get settings */
export async function getSettings() {
  const ref = doc(db, COLLECTIONS.SETTINGS, 'general');
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : {
    lowStockThreshold: 2,
    mediumStockThreshold: 5,
    notificationsEnabled: true,
    theme: 'dark'
  };
}

// ─── Delete Upload Record ────────────────────────────────────────

/** Delete all stock data and history record for a given date */
export async function deleteUploadRecord(date) {
  for (const cat of ['lehnga', 'saree']) {
    const snap = await getDocs(collection(db, COLLECTIONS.DAILY_STOCK, date, cat));
    if (snap.docs.length > 0) {
      const ops = snap.docs.map(d => (batch) => batch.delete(d.ref));
      await runChunkedBatch(ops);
    }
  }
  try {
    await deleteDoc(doc(db, COLLECTIONS.DAILY_STOCK, date, 'meta', 'summary'));
  } catch {}
  await deleteDoc(doc(db, COLLECTIONS.HISTORY, date));
}

// ─── Custom Colour Names ─────────────────────────────────────

/** Save custom colour names list */
export async function saveCustomColours(colours) {
  const ref = doc(db, COLLECTIONS.SETTINGS, 'colours');
  await setDoc(ref, { colours, updatedAt: serverTimestamp() });
}

/** Get custom colour names list */
export async function getCustomColours() {
  const ref = doc(db, COLLECTIONS.SETTINGS, 'colours');
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data().colours || []) : [];
}
