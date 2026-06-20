// ═══════════════════════════════════════════════════════════════
// ZIMONZA — PDF → Excel Converter
// Standalone module: no Firebase, no auth.
// Reads text-based PDFs with pdf.js and reconstructs a row/column
// grid by clustering text items on their x/y coordinates.
// ═══════════════════════════════════════════════════════════════

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Cluster the left-x of every item into column anchors.
 * Returns a sorted array of anchor x-positions.
 */
function detectColumns(items, xTol) {
  const xs = items.map(it => it.x).sort((a, b) => a - b);
  const anchors = [];
  for (const x of xs) {
    const last = anchors[anchors.length - 1];
    if (last == null || x - last.sum / last.n > xTol) {
      anchors.push({ sum: x, n: 1 });
    } else {
      last.sum += x;
      last.n += 1;
    }
  }
  return anchors.map(a => a.sum / a.n);
}

function colIndexFor(x, anchors) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const d = Math.abs(x - anchors[i]);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

/**
 * Convert one page's text items into a 2D array of cells.
 */
function buildPageGrid(rawItems) {
  // Normalize items → { str, x, y, h, w }
  const items = rawItems
    .filter(it => it.str && it.str.trim() !== '')
    .map(it => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      h: Math.abs(it.transform[3]) || 0,
      w: it.width || 0,
    }));

  if (!items.length) return [];

  const yTol = (median(items.map(i => i.h)) || 6) * 0.6 || 4;
  // Approx per-character width → column merge tolerance
  const charW = median(
    items.filter(i => i.w > 0 && i.str.length > 0).map(i => i.w / i.str.length)
  ) || 0;
  const xTol = charW > 1 ? charW * 2 : 10;

  // ── Row clustering (top of page first → highest y first) ──
  const byY = [...items].sort((a, b) => b.y - a.y);
  const rows = [];
  let current = null;
  for (const it of byY) {
    if (!current || Math.abs(it.y - current.y) > yTol) {
      current = { y: it.y, items: [it] };
      rows.push(current);
    } else {
      current.items.push(it);
    }
  }

  // ── Column anchors (page-wide) ──
  const anchors = detectColumns(items, xTol);
  const maxCols = anchors.length;

  // ── Place each item into its row/column cell ──
  const grid = rows.map(row => {
    const cells = new Array(maxCols).fill('');
    row.items
      .sort((a, b) => a.x - b.x)
      .forEach(it => {
        const ci = colIndexFor(it.x, anchors);
        cells[ci] = cells[ci] ? `${cells[ci]} ${it.str}`.trim() : it.str.trim();
      });
    return cells;
  });

  // Drop fully-empty rows
  return grid.filter(r => r.some(c => c !== ''));
}

/**
 * Convert a PDF File into per-page grids.
 * @param {File} file
 * @param {(page:number, total:number)=>void} onProgress
 * @returns {Promise<{pages:Array<{pageNum:number, rows:string[][]}>, maxCols:number, totalRows:number}>}
 */
export async function convertPdfToGrid(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

  const pages = [];
  let maxCols = 0;
  let totalRows = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    if (onProgress) onProgress(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows = buildPageGrid(content.items);
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    maxCols = Math.max(maxCols, cols);
    totalRows += rows.length;
    pages.push({ pageNum: p, rows });
  }

  return { pages, maxCols, totalRows };
}
