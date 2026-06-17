// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Filter & Search Helpers
// ═══════════════════════════════════════════════════════════════

import { today, daysAgo } from './utils.js';

/**
 * Filter stock items by various criteria
 */
export function filterItems(items, filters = {}) {
  let result = [...items];

  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    result = result.filter(i =>
      String(i.sku).toLowerCase().includes(q) ||
      String(i.name).toLowerCase().includes(q) ||
      (i.colors || []).some(c => c.name.toLowerCase().includes(q))
    );
  }

  if (filters.category && filters.category !== 'all') {
    result = result.filter(i => i.category === filters.category);
  }

  if (filters.stockLevel && filters.stockLevel !== 'all') {
    result = result.filter(i => i.stockLevel === filters.stockLevel);
  }

  if (filters.minQty !== undefined) {
    result = result.filter(i => (i.totalQty || 0) >= filters.minQty);
  }

  if (filters.maxQty !== undefined) {
    result = result.filter(i => (i.totalQty || 0) <= filters.maxQty);
  }

  return result;
}

/**
 * Get date range from a quick filter key
 */
export function getDateRange(rangeKey) {
  const t = today();
  switch (rangeKey) {
    case 'today':       return { from: t, to: t };
    case 'yesterday':   return { from: daysAgo(1), to: daysAgo(1) };
    case 'last3':       return { from: daysAgo(2), to: t };
    case 'last7':       return { from: daysAgo(6), to: t };
    case 'last30':      return { from: daysAgo(29), to: t };
    default:            return { from: t, to: t };
  }
}

/**
 * Build quick date filter buttons HTML
 */
export function quickDateFiltersHTML(activeKey = 'today') {
  const btns = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last3', label: 'Last 3 Days' },
    { key: 'last7', label: 'Last 7 Days' },
    { key: 'last30', label: 'Last 30 Days' }
  ];
  return btns.map(b => `
    <button data-range="${b.key}"
      class="quick-date-btn px-3 py-1.5 text-xs font-medium rounded-lg transition
        ${b.key === activeKey
          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          : 'bg-white/5 text-slate-400 hover:text-slate-200 border border-white/5 hover:bg-white/8'}">
      ${b.label}
    </button>`
  ).join('');
}

/**
 * Paginate an array
 */
export function paginate(arr, page = 1, perPage = 50) {
  const total = arr.length;
  const totalPages = Math.ceil(total / perPage);
  const start = (page - 1) * perPage;
  const items = arr.slice(start, start + perPage);
  return { items, total, totalPages, page, perPage };
}

/**
 * Render pagination controls HTML
 */
export function paginationHTML(page, totalPages, onPageChange) {
  if (totalPages <= 1) return '';
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(`
      <button data-page="${i}"
        class="page-btn w-8 h-8 text-xs rounded-lg transition
          ${i === page
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5'}">
        ${i}
      </button>`);
  }
  return `<div class="flex items-center gap-1 mt-4 justify-center">${pages.join('')}</div>`;
}
