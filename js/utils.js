// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Utility Functions
// ═══════════════════════════════════════════════════════════════

import { KNOWN_COLOURS } from './constants.js';

/**
 * Format a Date object or timestamp to YYYY-MM-DD string
 */
export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format a YYYY-MM-DD string for display as dd/mm/yyyy ("2026-05-16" → "16/05/2026").
 * Returns '' for anything unparseable so callers' `|| raw` fallbacks work —
 * never the string "Invalid Date".
 */
export function formatDateDisplay(dateStr) {
  const s = String(dateStr ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const d = new Date(s);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Get today's date string
 */
export function today() {
  return formatDate(new Date());
}

/**
 * Parse color string "(Red * 1 )( Blue * 2 )( Morpichh * 5 )"
 * Returns array of { name, qty }
 */
export function parseColors(colorStr) {
  if (!colorStr) return [];
  const str = String(colorStr).replace(/\n/g, ' ');
  const regex = /\(\s*([^*()]+?)\s*\*\s*(\d+)\s*\)/g;
  const colors = [];
  let match;
  while ((match = regex.exec(str)) !== null) {
    const name = match[1].trim();
    const qty = parseInt(match[2], 10);
    if (name && !isNaN(qty)) {
      colors.push({ name, qty });
    }
  }
  return colors;
}

/**
 * Canonical colour identity key — lowercase, trimmed, internal whitespace
 * collapsed. Used everywhere colours are compared/merged so spelling/spacing
 * variants ("Light  Blue" vs "Light Blue", "Red" vs "red ") map together.
 */
export const normColorKey = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Canonical item number — drops trailing dots/spaces ("3121." → "3121")
 * while preserving meaningful suffixes like "(UNST)".
 */
export const normItemNo = (s) => String(s ?? '').trim().replace(/[.\s]+$/, '').trim();

/**
 * Blouse stitch type from an item number: "(UNST)" → unstitched, else stitched.
 */
export const itemStitchType = (s) => /\(\s*UNST\s*\)/i.test(String(s ?? '')) ? 'unstitched' : 'stitched';

/**
 * Canonical ZM code — drops zero padding and normalises the separator so the
 * pricing file's "ZM-01" joins the mapping's "ZM-1". Anything that isn't
 * ZM-<digits> falls through as trimmed uppercase (unchanged behaviour).
 */
export const normZmCode = (s) => {
  const m = /^\s*zm\s*[-_ ]?\s*0*(\d+)\s*$/i.exec(String(s ?? ''));
  return m ? `ZM-${m[1]}` : String(s ?? '').trim().toUpperCase();
};

/**
 * Parse a spreadsheet money/number cell. Strips ₹, commas and spaces.
 * Blank/unparseable → null (NOT 0 — a missing Myntra MRP must stay missing).
 */
export function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[₹,\s]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Round to 2 decimals without float drift (0.615 → 0.62). */
export const round2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;

/** Indian-grouped money string: 123456.5 → "1,23,456.50" */
export function formatINR(n, decimals = 2) {
  const num = Number(n) || 0;
  const neg = num < 0;
  const fixed = Math.abs(num).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  // Last 3 digits, then groups of 2 (Indian numbering)
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return `${neg ? '-' : ''}${grouped}${dec ? '.' + dec : ''}`;
}

const WORDS_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const WORDS_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n) {
  if (n < 20) return WORDS_ONES[n];
  const t = WORDS_TENS[Math.floor(n / 10)];
  const o = WORDS_ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/**
 * Amount in words, Indian scale (Crore / Lakh / Thousand / Hundred).
 * 31824 → "Rupees Thirty One Thousand Eight Hundred Twenty Four Only"
 */
export function amountInWords(amount) {
  const num = Math.abs(Number(amount) || 0);
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  const chunk = (n) => {
    const parts = [];
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = Math.floor((n % 1000) / 100);
    const rest = n % 100;
    if (crore) parts.push(`${chunk(crore)} Crore`);
    if (lakh) parts.push(`${twoDigitWords(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`);
    if (hundred) parts.push(`${WORDS_ONES[hundred]} Hundred`);
    if (rest) parts.push(twoDigitWords(rest));
    return parts.join(' ');
  };

  const rupeeWords = rupees ? chunk(rupees) : 'Zero';
  let out = `Rupees ${rupeeWords}`;
  if (paise) out += ` and ${twoDigitWords(paise)} Paise`;
  return `${out} Only`;
}

/**
 * Merge duplicate color entries, summing quantities
 */
export function mergeColors(colorsArray) {
  const map = new Map();
  for (const { name, qty } of colorsArray) {
    const key = normColorKey(name);
    map.set(key, { name, qty: (map.get(key)?.qty || 0) + qty });
  }
  return Array.from(map.values());
}

/**
 * Get stock level label based on total quantity.
 * Thresholds are read from localStorage so Settings page changes apply immediately.
 */
export function getStockLevel(qty) {
  if (qty === 0) return 'sold_out';
  const low    = Number(localStorage.getItem('zm_low_threshold'))    || 2;
  const medium = Number(localStorage.getItem('zm_medium_threshold')) || 5;
  if (qty <= low)    return 'low';
  if (qty <= medium) return 'medium';
  return 'high';
}

/**
 * Worst (lowest-qty) colour's stock level. Zero-qty entries are ignored so a
 * listed-but-empty colour doesn't mark an in-stock product as sold out.
 */
export function worstColorLevel(colors) {
  const qtys = (colors || []).map(c => Number(c.qty) || 0).filter(q => q > 0);
  if (qtys.length === 0) return 'sold_out';
  return getStockLevel(Math.min(...qtys));
}

/**
 * Per-colour stock level for an item: worst colour when colour data exists,
 * otherwise fall back to the stored/total-based level (old Firestore docs).
 */
export function itemStockLevel(item) {
  if (Array.isArray(item?.colors) && item.colors.length > 0) {
    return worstColorLevel(item.colors);
  }
  return item?.stockLevel || getStockLevel(item?.totalQty || 0);
}

/**
 * Flatten items to one entry per LOW-stock colour:
 * [{ sku, name, category, colorName, qty }], sorted by qty ascending.
 */
export function lowColorEntries(items) {
  const out = [];
  for (const item of items || []) {
    for (const c of item.colors || []) {
      const qty = Number(c.qty) || 0;
      if (qty > 0 && getStockLevel(qty) === 'low') {
        out.push({ sku: item.sku, name: item.name, category: item.category, colorName: c.name, qty });
      }
    }
  }
  return out.sort((a, b) => a.qty - b.qty);
}

/**
 * Myntra gap threshold — a colour's stock must EXCEED this to be sent to
 * Myntra at half quantity. Read from localStorage so Settings applies
 * immediately; 0 is a valid value, hence the null check.
 */
export function getMyntraGapThreshold() {
  const raw = localStorage.getItem('zm_myntra_gap');
  if (raw === null || raw === '') return 8;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 8;
}

/**
 * Myntra take-percentage — how much of a colour's stock to send to Myntra
 * (50 = half, 75 = three quarters). Default 50, clamped to 1–100.
 */
export function getMyntraTakePercent() {
  const raw = localStorage.getItem('zm_myntra_percent');
  if (raw === null || raw === '') return 50;
  const v = Number(raw);
  if (!Number.isFinite(v)) return 50;
  return Math.min(100, Math.max(1, Math.floor(v)));
}

/**
 * Get stock level badge classes
 */
export function getStockBadgeClass(level) {
  const map = {
    low: 'bg-red-500/20 text-red-400 border border-red-500/30',
    medium: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    high: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    sold_out: 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
  };
  return map[level] || map.low;
}

/**
 * Debounce function
 */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Capitalize first letter of each word
 */
export function titleCase(str) {
  return String(str).replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

/**
 * Format number with comma separator
 */
export function formatNumber(n) {
  return Number(n).toLocaleString('en-IN');
}

/**
 * Deep clone an object
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Generate a unique ID
 */
export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * Get relative time string: "2 hours ago"
 */
export function relativeTime(timestamp) {
  const now = Date.now();
  const ts = timestamp?.toMillis ? timestamp.toMillis() : Number(timestamp);
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Check if a string is a valid date (YYYY-MM-DD)
 */
export function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str));
}

/**
 * Get date N days ago
 */
export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

/**
 * Sort array of objects by key descending
 */
export function sortByDesc(arr, key) {
  return [...arr].sort((a, b) => (b[key] > a[key] ? 1 : -1));
}

/**
 * Group array of objects by a key
 */
export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

/**
 * Throttle function
 */
export function throttle(fn, limit = 300) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Convert array of objects to CSV string
 */
export function toCSV(data, columns) {
  const headers = columns.map(c => c.label).join(',');
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? '';
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
    }).join(',')
  );
  return [headers, ...rows].join('\n');
}

/**
 * Download a string as a file
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Return the active colour list for spelling detection.
 * Uses custom list from localStorage if saved; falls back to built-in KNOWN_COLOURS.
 */
export function getEffectiveColours() {
  try {
    const custom = JSON.parse(localStorage.getItem('zm_custom_colours'));
    if (Array.isArray(custom) && custom.length > 0) return custom;
  } catch {}
  return KNOWN_COLOURS;
}

/**
 * Levenshtein edit distance between two strings
 */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

/**
 * Find the closest known colour within edit distance ≤ 2.
 * Returns { suggestion, distance } or null if name matches exactly or no close match.
 */
export function findColourSuggestion(name, knownColours) {
  const lower = name.toLowerCase();
  if (knownColours.some(c => c.toLowerCase() === lower)) return null;
  let best = null, bestDist = 3;
  for (const known of knownColours) {
    const dist = levenshtein(lower, known.toLowerCase());
    if (dist < bestDist) { best = known; bestDist = dist; }
  }
  return bestDist <= 2 ? { suggestion: best, distance: bestDist } : null;
}

/**
 * Storage helpers for theme/settings
 */
export const storage = {
  get: (key, def = null) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  },
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
  remove: (key) => localStorage.removeItem(key)
};
