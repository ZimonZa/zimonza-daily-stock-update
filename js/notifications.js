// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Toast Notification System
// ═══════════════════════════════════════════════════════════════

let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(container);
  }
  return container;
}

const ICONS = {
  success: `<svg class="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`,
  error:   `<svg class="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`,
  warning: `<svg class="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`,
  info:    `<svg class="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 16v-4m0-4h.01"/></svg>`
};

const BORDER_COLORS = {
  success: 'border-emerald-500/40',
  error: 'border-red-500/40',
  warning: 'border-amber-500/40',
  info: 'border-blue-500/40'
};

// Toast messages are PLAIN TEXT. They carry customer names read from label
// PDFs, decoded barcode values, file names and spreadsheet cells — all
// untrusted — and inserting them as HTML let a crafted value inject markup.
// It also mangled honest text: "ZM-<no>-<colour>" rendered as "ZM--",
// because the browser parsed <no> and <colour> as tags.
export const escapeText = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// A counter, not the clock. Toasts raised in the same millisecond used to
// share an id, so each dismiss timer found only the first one and the rest
// stayed on screen for good.
let toastSeq = 0;

/**
 * Show a toast notification
 * @param {string} message  plain text — it is escaped, never parsed as HTML
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration ms (0 = permanent)
 */
export function toast(message, type = 'info', duration = 4000) {
  const c = getContainer();
  const id = `toast-${Date.now()}-${++toastSeq}`;
  const border = BORDER_COLORS[type] || BORDER_COLORS.info;

  const el = document.createElement('div');
  el.id = id;
  el.className = `pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border ${border}
    bg-slate-800/95 backdrop-blur-md shadow-2xl text-sm text-slate-200 max-w-xs
    translate-x-full opacity-0 transition-all duration-300 ease-out`;

  el.innerHTML = `
    ${ICONS[type] || ICONS.info}
    <span class="flex-1 leading-snug">${escapeText(message)}</span>
    <button onclick="this.closest('[id^=toast]').remove()" class="text-slate-400 hover:text-white ml-1 flex-shrink-0">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>`;

  c.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.remove('translate-x-full', 'opacity-0');
    });
  });

  // Auto dismiss
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

function dismissToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('translate-x-full', 'opacity-0');
  setTimeout(() => el.remove(), 300);
}

export const notify = {
  success: (msg, dur) => toast(msg, 'success', dur),
  error: (msg, dur) => toast(msg, 'error', dur),
  warning: (msg, dur) => toast(msg, 'warning', dur),
  info: (msg, dur) => toast(msg, 'info', dur)
};

export default notify;
