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
 * Format date to display string: "16 May 2026"
 */
export function formatDateDisplay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
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
