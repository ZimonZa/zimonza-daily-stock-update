// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Colour Swatches
// Every record in this app is keyed by a textile colour name.
// This turns that name into its actual colour, so a table of four
// hundred rows can be scanned by eye instead of read.
// ═══════════════════════════════════════════════════════════════

import { normColorKey } from './utils.js';

/**
 * Real values for the colour names this business actually uses.
 * The Indian textile names are the ones that matter — they are what
 * appears in the SKUs, and they are the ones no generic palette has.
 */
const SWATCHES = {
  // ── Indian textile vocabulary ──
  'morpichh':      '#0F6F6C',   // peacock neck — deep teal-green
  'rani':          '#E3006D',   // rani pink — the queen's magenta
  'firozi':        '#2FB3C4',   // turquoise
  'pista':         '#9DC183',   // pistachio
  'chiku':         '#8B5A3C',   // sapota — soft fruit brown
  'pyazi':         '#B85C7A',   // onion skin
  'mehendi':       '#6B7A2F',   // henna
  'saffron':       '#F4661B',
  'sandalwood':    '#C9A882',
  'terracotta':    '#C4623E',
  'brick':         '#A03B24',
  'parrot green':  '#5FBF3B',
  'bottle green':  '#0B5F3B',

  // ── Standard ──
  'red':           '#DC2626',
  'blue':          '#2563EB',
  'green':         '#16A34A',
  'black':         '#141418',
  'white':         '#F5F5F0',
  'yellow':        '#EAB308',
  'orange':        '#F97316',
  'pink':          '#EC4899',
  'purple':        '#9333EA',
  'brown':         '#78492B',
  'grey':          '#8A8A93',
  'gray':          '#8A8A93',
  'maroon':        '#7A1D2E',
  'navy':          '#1B2A5B',
  'cyan':          '#22D3EE',
  'magenta':       '#D6249F',
  'violet':        '#7C3AED',
  'indigo':        '#3F3D8F',

  // ── Pastels / neutrals ──
  'cream':         '#F3E6C8',
  'ivory':         '#F6F1E0',
  'beige':         '#D9C7A7',
  'peach':         '#F7B195',
  'coral':         '#F4796B',
  'mint':          '#8FD9BA',
  'lavender':      '#B79CE0',
  'rose':          '#E28299',
  'mauve':         '#B084A8',
  'lilac':         '#C0A2DA',
  'blush':         '#F0BFC2',
  'nude':          '#DDB89C',
  'champagne':     '#EAD2A8',
  'taupe':         '#9C8878',
  'khaki':         '#B5A46B',
  'sand':          '#DCC49A',

  // ── Rich tones ──
  'burgundy':      '#6E1B2E',
  'wine':          '#79233A',
  'rust':          '#B45B2B',
  'copper':        '#C0693B',
  'bronze':        '#A2703C',
  'gold':          '#D9A441',
  'silver':        '#C2C6CC',
  'teal':          '#0F8B8D',
  'turquoise':     '#31C3C0',
  'mustard':       '#D8A21C',
  'olive':         '#7A7A32',
  'lime':          '#A8D63A',
  'sage':          '#A3B394',
  'charcoal':      '#3A3A42',
  'slate':         '#64748B',

  // ── Compounds ──
  'sky blue':      '#67C4EE',
  'royal blue':    '#2549C9',
  'off white':     '#EFEADF',
  'light blue':    '#8FC9E8',
  'dark blue':     '#16306B',
  'dark green':    '#155F34',
  'light green':   '#86D68B',
  'light pink':    '#F5B9CB',
  'hot pink':      '#F0369C',
  'baby pink':     '#F7C9D6',
  'dark red':      '#8E1B1B',
  'blood red':     '#8A1220',
  'deep red':      '#9B1226',
  'lemon yellow':  '#F2DE4C'
};

/** Names that mean "several colours" and get the multi treatment. */
const MULTI = new Set(['multi', 'multicolor', 'multicolour', 'assorted', 'mixed']);

/**
 * Stable colour for a name we have never seen.
 * Hashed so the same unknown name always looks the same, and pinned to a
 * mid lightness so it can never come back near-black on a near-black page.
 */
function fallbackColour(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const sat = 42 + (Math.abs(hash >> 8) % 26);    // 42–67%
  // 58–71%. Blue contributes only 0.07 to relative luminance, so a blue-ish
  // hue at 52% lightness lands under the visibility floor on a near-black page.
  const light = 58 + (Math.abs(hash >> 16) % 14);
  return hslToHex(hue, sat, light);
}

function hslToHex(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Relative luminance, 0–1. Used to decide how a chip is ringed. */
export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return 0;
  const int = parseInt(m[1], 16);
  const srgb = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/**
 * The swatch for a colour name.
 * @returns {{ hex:string, known:boolean, multi:boolean, dark:boolean, name:string }}
 */
export function swatchFor(name) {
  const clean = String(name ?? '').trim();
  const key = normColorKey(clean);
  if (!key) return { hex: '#4A4A55', known: false, multi: false, dark: true, name: '' };

  if (MULTI.has(key)) {
    return { hex: '#D9A441', known: true, multi: true, dark: false, name: clean };
  }

  const known = Object.prototype.hasOwnProperty.call(SWATCHES, key);
  const hex = known ? SWATCHES[key] : fallbackColour(key);
  // Very dark chips get a brighter ring so they stay visible on the ink ground
  return { hex, known, multi: false, dark: luminance(hex) < 0.12, name: clean };
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A colour dot on its own — for use inside an existing cell.
 * @param {string} name
 * @param {{size?:number}} opts
 */
export function swatchDot(name, opts = {}) {
  const s = swatchFor(name);
  const size = opts.size || 10;
  const style = s.multi
    ? `background:conic-gradient(from 0deg,#E3006D,#F4661B,#EAB308,#16A34A,#2FB3C4,#7C3AED,#E3006D)`
    : `background:${s.hex}`;
  return `<span class="zm-dot${s.dark ? ' zm-dot-dark' : ''}" style="${style};width:${size}px;height:${size}px"
    title="${esc(s.name)}${s.known ? '' : ' (colour not in the known list)'}"></span>`;
}

/**
 * Dot plus label — the standard way a colour reads in this app.
 * @param {string} name
 * @param {number|string} [count]  optional trailing count
 */
export function swatchChip(name, count) {
  const s = swatchFor(name);
  if (!s.name) return '<span class="zm-muted">—</span>';
  return `<span class="zm-chip">${swatchDot(name)}<span class="zm-chip-name">${esc(s.name)}</span>${
    count === undefined || count === null || count === '' ? '' : `<b>${esc(count)}</b>`}</span>`;
}
