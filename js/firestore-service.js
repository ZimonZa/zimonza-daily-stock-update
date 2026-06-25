// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Firestore Service Layer
// ═══════════════════════════════════════════════════════════════

import { db } from './firebase-config.js';
import { COLLECTIONS } from './constants.js';
import {
  doc, setDoc, getDoc, getDocs, deleteDoc,
  collection, query, orderBy, limit, serverTimestamp,
  writeBatch
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
