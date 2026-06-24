// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Shared UI Components (Sidebar, Header, etc.)
// ═══════════════════════════════════════════════════════════════

import { NAV_ITEMS } from './constants.js';
import { logOut, currentUser } from './auth.js';
import { storage } from './utils.js';

let sidebarCollapsed = storage.get('sidebar_collapsed', false);

/**
 * Render the full sidebar + topbar into the page
 * @param {string} activePageId - ID of the current page (e.g. 'dashboard')
 */
/**
 * Once per tab session, pull the user's stock-level thresholds + custom
 * colour list from Firestore into localStorage so getStockLevel() and
 * colour-spelling checks are correct on any device (not just the one where
 * Settings was last saved). Fire-and-forget; never blocks the UI.
 */
function maybeHydrateSettings() {
  if (sessionStorage.getItem('zm_settings_hydrated')) return;
  sessionStorage.setItem('zm_settings_hydrated', '1');
  import('./firestore-service.js').then(async ({ getSettings, getCustomColours }) => {
    const [settings, colours] = await Promise.all([
      getSettings().catch(() => null),
      getCustomColours().catch(() => []),
    ]);
    if (settings?.lowStockThreshold)    localStorage.setItem('zm_low_threshold', settings.lowStockThreshold);
    if (settings?.mediumStockThreshold) localStorage.setItem('zm_medium_threshold', settings.mediumStockThreshold);
    if (Array.isArray(colours) && colours.length) localStorage.setItem('zm_custom_colours', JSON.stringify(colours));
  }).catch(() => {});
}

export function renderShell(activePageId) {
  applyTheme();
  maybeHydrateSettings();
  injectSidebar(activePageId);
  injectTopbar(activePageId);
  // Apply correct initial page-content margin based on sidebar state
  const pc = document.getElementById('page-content');
  if (pc) {
    pc.classList.toggle('ml-64', !sidebarCollapsed);
    pc.classList.toggle('ml-[68px]', sidebarCollapsed);
  }
  setupThemeToggle();
  setupSidebarToggle();
  setupMobileDrawer();
}

function applyTheme() {
  const theme = storage.get('theme', 'dark');
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light-mode', theme === 'light');
}

function injectSidebar(activePageId) {
  const existing = document.getElementById('app-sidebar');
  if (existing) existing.remove();

  const navHtml = NAV_ITEMS.map(item => {
    const isActive = item.id === activePageId;
    return `
    <a href="${item.href}" data-nav="${item.id}"
       class="nav-item group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative
              ${isActive
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }">
      <span class="icon-wrap flex-shrink-0 w-5 h-5">
        <i data-lucide="${item.icon}" class="w-[18px] h-[18px]"></i>
      </span>
      <span class="nav-label text-sm font-medium truncate ${sidebarCollapsed ? 'hidden' : ''}">
        ${item.label}
      </span>
      ${isActive ? '<span class="absolute right-2 w-1.5 h-1.5 rounded-full bg-emerald-400"></span>' : ''}
    </a>`;
  }).join('');

  const sidebar = document.createElement('aside');
  sidebar.id = 'app-sidebar';
  sidebar.className = `fixed top-0 left-0 h-full z-40 flex flex-col
    bg-slate-900/95 backdrop-blur-xl border-r border-white/5
    transition-all duration-300 ease-in-out
    ${sidebarCollapsed ? 'w-[68px]' : 'w-64'}`;

  sidebar.innerHTML = `
    <!-- Logo -->
    <div class="flex items-center gap-3 px-4 py-5 border-b border-white/5 flex-shrink-0">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/20">
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10"/>
        </svg>
      </div>
      <div class="flex flex-col ${sidebarCollapsed ? 'hidden' : ''}">
        <span class="text-white font-bold text-sm leading-tight">ZIMONZA</span>
        <span class="text-slate-500 text-[10px] font-medium uppercase tracking-wider">Stock Update</span>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 overflow-y-auto py-4 px-2 space-y-0.5 scrollbar-thin">
      ${navHtml}
    </nav>

    <!-- User section -->
    <div class="border-t border-white/5 p-3 flex-shrink-0">
      <div class="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 transition cursor-default">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
          <span class="text-white text-xs font-bold" id="user-initials">ZM</span>
        </div>
        <div class="flex flex-col min-w-0 ${sidebarCollapsed ? 'hidden' : ''}">
          <span class="text-slate-200 text-xs font-semibold truncate" id="user-name">Admin</span>
          <span class="text-slate-500 text-[10px] truncate" id="user-email"></span>
        </div>
      </div>
      <button id="sidebar-logout-btn"
        class="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition mt-1">
        <i data-lucide="log-out" class="w-4 h-4 flex-shrink-0"></i>
        <span class="text-xs font-medium ${sidebarCollapsed ? 'hidden' : ''}">Sign Out</span>
      </button>
    </div>
  `;

  document.body.prepend(sidebar);

  // Set user info
  const user = currentUser();
  if (user) {
    const initials = (user.email || 'ZM').slice(0, 2).toUpperCase();
    const nameEl = document.getElementById('user-name');
    const emailEl = document.getElementById('user-email');
    const initialsEl = document.getElementById('user-initials');
    if (nameEl) nameEl.textContent = user.displayName || 'Admin';
    if (emailEl) emailEl.textContent = user.email || '';
    if (initialsEl) initialsEl.textContent = initials;
  }

  document.getElementById('sidebar-logout-btn')?.addEventListener('click', logOut);

  // Init lucide icons
  if (window.lucide) window.lucide.createIcons();
}

function injectTopbar(activePageId) {
  const existing = document.getElementById('app-topbar');
  if (existing) existing.remove();

  const page = NAV_ITEMS.find(n => n.id === activePageId);
  const pageLabel = page?.label || 'Dashboard';

  const topbar = document.createElement('header');
  topbar.id = 'app-topbar';
  topbar.className = `fixed top-0 right-0 z-30 flex items-center justify-between
    px-6 h-16 bg-slate-900/80 backdrop-blur-xl border-b border-white/5
    transition-all duration-300 ${sidebarCollapsed ? 'left-[68px]' : 'left-64'}`;

  topbar.innerHTML = `
    <!-- Left: Sidebar toggle + breadcrumb -->
    <div class="flex items-center gap-4">
      <button id="sidebar-toggle-btn"
        class="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition">
        <i data-lucide="panel-left" class="w-5 h-5"></i>
      </button>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-slate-500">Zimonza</span>
        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-600"></i>
        <span class="text-slate-200 font-semibold">${pageLabel}</span>
      </div>
    </div>

    <!-- Right: Actions -->
    <div class="flex items-center gap-2">
      <!-- Date badge -->
      <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/8 text-xs text-slate-400">
        <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
        <span id="topbar-date"></span>
      </div>

      <!-- Theme toggle -->
      <button id="theme-toggle-btn"
        class="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition"
        title="Toggle theme">
        <i data-lucide="sun" class="w-5 h-5 hidden" id="icon-sun"></i>
        <i data-lucide="moon" class="w-5 h-5" id="icon-moon"></i>
      </button>

      <!-- Mobile menu -->
      <button id="mobile-menu-btn"
        class="lg:hidden p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition">
        <i data-lucide="menu" class="w-5 h-5"></i>
      </button>
    </div>
  `;

  const sidebarEl = document.getElementById('app-sidebar');
  document.body.insertBefore(topbar, sidebarEl?.nextSibling ?? null);

  // Set date
  const dateEl = document.getElementById('topbar-date');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Theme icons
  const theme = storage.get('theme', 'dark');
  if (theme === 'light') {
    document.getElementById('icon-sun')?.classList.remove('hidden');
    document.getElementById('icon-moon')?.classList.add('hidden');
  }

  if (window.lucide) window.lucide.createIcons();
}

function setupThemeToggle() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#theme-toggle-btn');
    if (!btn) return;
    const current = storage.get('theme', 'dark');
    const next = current === 'dark' ? 'light' : 'dark';
    storage.set('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.documentElement.classList.toggle('light-mode', next === 'light');
    document.getElementById('icon-sun')?.classList.toggle('hidden', next === 'dark');
    document.getElementById('icon-moon')?.classList.toggle('hidden', next === 'light');
  });
}

function setupSidebarToggle() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#sidebar-toggle-btn');
    if (!btn) return;
    sidebarCollapsed = !sidebarCollapsed;
    storage.set('sidebar_collapsed', sidebarCollapsed);

    const sidebar = document.getElementById('app-sidebar');
    const topbar = document.getElementById('app-topbar');
    const content = document.getElementById('page-content');

    if (sidebar) {
      sidebar.classList.toggle('w-64', !sidebarCollapsed);
      sidebar.classList.toggle('w-[68px]', sidebarCollapsed);
    }
    if (topbar) {
      topbar.classList.toggle('left-64', !sidebarCollapsed);
      topbar.classList.toggle('left-[68px]', sidebarCollapsed);
    }
    if (content) {
      content.classList.toggle('ml-64', !sidebarCollapsed);
      content.classList.toggle('ml-[68px]', sidebarCollapsed);
    }

    // Toggle labels
    document.querySelectorAll('.nav-label').forEach(el => {
      el.classList.toggle('hidden', sidebarCollapsed);
    });
    document.querySelectorAll('#app-sidebar .flex-col').forEach(el => {
      el.classList.toggle('hidden', sidebarCollapsed);
    });
  });

}

/**
 * Mobile off-canvas drawer: hamburger opens sidebar over a backdrop.
 * On <1024px the sidebar is translated off-screen by CSS; toggling
 * `.sidebar-open` slides it in. Idempotent — safe to call per render.
 */
function setupMobileDrawer() {
  // Backdrop element (create once)
  let backdrop = document.getElementById('sidebar-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }

  const closeDrawer = () => {
    document.getElementById('app-sidebar')?.classList.remove('sidebar-open');
    backdrop.classList.remove('show');
    document.body.classList.remove('drawer-open');
  };
  const openDrawer = () => {
    document.getElementById('app-sidebar')?.classList.add('sidebar-open');
    backdrop.classList.add('show');
    document.body.classList.add('drawer-open');
  };

  // Wire global listeners once
  if (window.__zmDrawerWired) return;
  window.__zmDrawerWired = true;

  document.addEventListener('click', (e) => {
    if (e.target.closest('#mobile-menu-btn')) {
      const open = document.getElementById('app-sidebar')?.classList.contains('sidebar-open');
      open ? closeDrawer() : openDrawer();
      return;
    }
    if (e.target.closest('#sidebar-backdrop')) { closeDrawer(); return; }
    // Tapping a nav link navigates → close immediately for snappy feel
    if (e.target.closest('#app-sidebar .nav-item')) closeDrawer();
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  window.addEventListener('resize', () => { if (window.innerWidth >= 1024) closeDrawer(); });
}

/**
 * Create a stat card element
 */
export function createStatCard({ title, value, icon, subtitle, color = 'emerald', trend }) {
  const colorMap = {
    emerald: 'from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 text-emerald-400',
    amber: 'from-amber-500/10 to-amber-500/5 border-amber-500/20 text-amber-400',
    red: 'from-red-500/10 to-red-500/5 border-red-500/20 text-red-400',
    blue: 'from-blue-500/10 to-blue-500/5 border-blue-500/20 text-blue-400',
    purple: 'from-purple-500/10 to-purple-500/5 border-purple-500/20 text-purple-400',
    slate: 'from-slate-500/10 to-slate-500/5 border-slate-500/20 text-slate-400'
  };
  const cls = colorMap[color] || colorMap.emerald;
  return `
  <div class="stat-card bg-gradient-to-br ${cls} border rounded-2xl p-5 flex flex-col gap-3 hover:scale-[1.01] transition-transform duration-200">
    <div class="flex items-center justify-between">
      <span class="text-slate-400 text-sm font-medium">${title}</span>
      <div class="p-2 rounded-xl bg-white/5">
        <i data-lucide="${icon}" class="w-4 h-4"></i>
      </div>
    </div>
    <div class="flex items-end justify-between">
      <span class="text-3xl font-bold text-white">${value}</span>
      ${trend ? `<span class="text-xs ${trend > 0 ? 'text-emerald-400' : 'text-red-400'}">${trend > 0 ? '↑' : '↓'} ${Math.abs(trend)}</span>` : ''}
    </div>
    ${subtitle ? `<span class="text-slate-500 text-xs">${subtitle}</span>` : ''}
  </div>`;
}

/**
 * Skeleton loader for cards
 */
export function skeletonCard(height = 'h-32') {
  return `<div class="animate-pulse bg-white/5 rounded-2xl ${height} border border-white/5"></div>`;
}

/**
 * Empty state widget
 */
export function emptyState(icon, title, subtitle) {
  return `
  <div class="flex flex-col items-center justify-center py-16 text-center">
    <div class="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
      <i data-lucide="${icon}" class="w-8 h-8 text-slate-600"></i>
    </div>
    <h3 class="text-slate-300 font-semibold text-lg mb-1">${title}</h3>
    <p class="text-slate-500 text-sm max-w-xs">${subtitle}</p>
  </div>`;
}

/**
 * Generic data table renderer
 */
export function renderTable({ columns, rows, emptyMsg = 'No data found' }) {
  if (!rows.length) {
    return `<div class="text-center py-8 text-slate-500 text-sm">${emptyMsg}</div>`;
  }
  const headers = columns.map(c => `<th class="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">${c.label}</th>`).join('');
  const rowsHtml = rows.map(row => {
    const cells = columns.map(c => {
      const val = c.render ? c.render(row) : (row[c.key] ?? '—');
      return `<td class="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">${val}</td>`;
    }).join('');
    return `<tr class="border-t border-white/5 hover:bg-white/3 transition">${cells}</tr>`;
  }).join('');
  return `
  <div class="overflow-x-auto">
    <table class="w-full">
      <thead class="bg-white/3"><tr>${headers}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}
