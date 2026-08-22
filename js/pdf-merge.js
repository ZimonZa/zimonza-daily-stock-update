// ═══════════════════════════════════════════════════════════════
// ZIMONZA — PDF Sorter & Merger
// Drop a pile of PDFs, get one merged file per document type.
// Labels merge with labels, invoices with invoices.
//
// Everything happens in the browser — no file ever leaves the
// machine, which matters because labels carry customer addresses.
// ═══════════════════════════════════════════════════════════════

// PDF.js reads; pdf-lib writes. Both lazily loaded so the PDF → Excel
// converter on the same page keeps its current load cost.
const PDFJS_URL    = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
const PDFLIB_URL   = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
  }
  return pdfjsPromise;
}

let pdfLibPromise = null;
/** pdf-lib ships UMD only — inject the tag once and resolve window.PDFLib. */
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = PDFLIB_URL;
      tag.onload = () => window.PDFLib
        ? resolve(window.PDFLib)
        : reject(new Error('pdf-lib loaded but PDFLib is missing'));
      tag.onerror = () => reject(new Error('Could not load the PDF merge library (check your connection)'));
      document.head.appendChild(tag);
    });
  }
  return pdfLibPromise;
}

// ═══════════════════ Group definitions ═══════════════════

export const UNSORTED = 'unsorted';

export const GROUPS = {
  label: {
    id: 'label',
    label: 'Label',
    icon: 'tag',
    nameWords: ['label', 'labels', 'shippinglabel', 'shiplabel', 'awb'],
    keywords: ['awb', 'ship to', 'shipping label', 'courier', 'pickup', 'delivery address',
               'return address', 'consignee', 'if undelivered', 'sold by'],
    // 4x6 in thermal ≈ 288×432pt, plus half-A4 and common label sizes
    sizes: [[288, 432], [283, 425], [302, 453], [396, 612], [595, 421]]
  },
  invoice: {
    id: 'invoice',
    label: 'Invoice',
    icon: 'receipt',
    nameWords: ['invoice', 'invoices', 'bill', 'taxinvoice'],
    keywords: ['tax invoice', 'gstin', 'hsn', 'cgst', 'sgst', 'igst', 'invoice no',
               'bill to', 'total amount', 'place of supply', 'amount in words'],
    sizes: [[595, 842], [612, 792]]   // A4, US Letter
  }
};

const GROUP_IDS = Object.keys(GROUPS);

/** Display label for any group id, including derived and unsorted ones. */
export function groupLabel(id) {
  if (id === UNSORTED) return 'Unsorted';
  if (GROUPS[id]) return GROUPS[id].label;
  return String(id).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ═══════════════════ Signal 1: filename ═══════════════════

/**
 * Reduce a filename to its meaningful stem.
 * "Label (1).pdf", "Label-2.pdf", "label_copy.pdf", "LABEL 3.PDF" → "label"
 */
export function fileStem(fileName) {
  return String(fileName ?? '')
    .replace(/\.pdf$/i, '')
    .replace(/\((\d+)\)\s*$/, '')            // "Label (1)"
    .replace(/[-_ ]+copy\s*\d*$/i, '')       // "label_copy", "label copy 2"
    .replace(/[-_ ]+\d+$/, '')               // "Label-2", "label 3"
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()
    .trim();
}

/**
 * What the filename suggests. Returns { group, score, why } — score 0 when
 * the name says nothing, so a random name never votes for the wrong group.
 */
export function classifyFileName(fileName) {
  const stem = fileStem(fileName);
  if (!stem) return { group: null, score: 0, why: '' };

  for (const id of GROUP_IDS) {
    for (const word of GROUPS[id].nameWords) {
      if (stem === word) return { group: id, score: 1, why: 'name' };
      if (stem.includes(word)) return { group: id, score: 0.7, why: 'name' };
    }
  }
  // A consistent unknown stem becomes its own group ("manifest", "packingslip")
  return { group: stem, score: 0.5, why: 'name', derived: true };
}

// ═══════════════════ Signal 2: page content ═══════════════════

/** Keyword hits per group for one page's text. */
export function classifyText(text) {
  const t = String(text ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!t.trim()) return { group: null, score: 0, why: '' };

  let best = null, bestHits = 0, bestWord = '';
  for (const id of GROUP_IDS) {
    let hits = 0, firstWord = '';
    for (const kw of GROUPS[id].keywords) {
      if (t.includes(kw)) { hits++; if (!firstWord) firstWord = kw; }
    }
    if (hits > bestHits) { best = id; bestHits = hits; bestWord = firstWord; }
  }
  if (!best) return { group: null, score: 0, why: '' };
  // Two or more distinct hits is a confident read; one is suggestive
  return { group: best, score: Math.min(1, bestHits / 2), why: `"${bestWord}"` };
}

// ═══════════════════ Signal 3: page geometry ═══════════════════

/**
 * Page size vote. Works on a scanned label with no text at all, which is
 * exactly the case the other two signals cannot help with.
 */
export function classifySize(width, height) {
  const w = Number(width) || 0, h = Number(height) || 0;
  if (!w || !h) return { group: null, score: 0, why: '' };
  // Compare portrait-normalised so a rotated page still matches
  const shortSide = Math.min(w, h), longSide = Math.max(w, h);

  let best = null, bestDist = Infinity;
  for (const id of GROUP_IDS) {
    for (const [sw, sh] of GROUPS[id].sizes) {
      const ss = Math.min(sw, sh), ls = Math.max(sw, sh);
      const dist = Math.abs(shortSide - ss) / ss + Math.abs(longSide - ls) / ls;
      if (dist < bestDist) { bestDist = dist; best = id; }
    }
  }
  // Beyond 12% off on both axes the size tells us nothing useful
  if (bestDist > 0.24) return { group: null, score: 0, why: '' };
  const score = Math.max(0, 1 - bestDist / 0.24);
  const label = best === 'label' ? 'label size' : 'A4';
  return { group: best, score: score * 0.8, why: label };
}

// ═══════════════════ Combining the signals ═══════════════════

const WEIGHT = { name: 1.0, text: 1.2, size: 0.8 };

/** One page's verdict from its text and size, ignoring the filename. */
export function classifyPage(text, width, height) {
  const byText = classifyText(text);
  const bySize = classifySize(width, height);

  const scores = new Map();
  const reasons = new Map();
  const add = (sig, weight) => {
    if (!sig.group || !sig.score) return;
    scores.set(sig.group, (scores.get(sig.group) || 0) + sig.score * weight);
    if (sig.why) reasons.set(sig.group, [...(reasons.get(sig.group) || []), sig.why]);
  };
  add(byText, WEIGHT.text);
  add(bySize, WEIGHT.size);

  if (!scores.size) return { group: null, score: 0, why: '' };
  const [group, score] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return { group, score, why: (reasons.get(group) || []).join(' · ') };
}

/**
 * Classify a whole PDF from a plain descriptor:
 *   { fileName, pages: [{ width, height, text }] }
 *
 * Returns { group, mixed, pageGroups, confidence, why }.
 * `mixed` means the pages disagree — those PDFs get split page by page.
 */
export function classifyPdf({ fileName, pages }) {
  const byName = classifyFileName(fileName);
  const pageList = pages || [];

  const pageVerdicts = pageList.map(p => {
    const own = classifyPage(p.text, p.width, p.height);
    // The filename applies to every page, so fold it in per page
    if (!byName.group || !byName.score) return own;
    if (!own.group) {
      return { group: byName.group, score: byName.score * WEIGHT.name, why: byName.why };
    }
    if (own.group === byName.group) {
      return { group: own.group, score: own.score + byName.score * WEIGHT.name, why: `${byName.why} · ${own.why}` };
    }
    // Name and page disagree. The page's own evidence is the stronger claim,
    // but the contradicting signal is subtracted in full so the conflict lands
    // as visibly low confidence — never a confident wrong answer.
    const nameScore = byName.score * WEIGHT.name;
    return own.score >= nameScore
      ? { group: own.group,    score: own.score - nameScore, why: `${own.why} (name says ${groupLabel(byName.group)})` }
      : { group: byName.group, score: nameScore - own.score, why: `${byName.why} (pages look like ${groupLabel(own.group)})` };
  });

  const pageGroups = pageVerdicts.map(v => (v.group && v.score > 0 ? v.group : UNSORTED));
  const distinct = [...new Set(pageGroups)];

  // No pages at all (unreadable file) — caller marks it, we don't guess
  if (!pageGroups.length) {
    return { group: byName.group || UNSORTED, mixed: false, pageGroups: [], confidence: 0, why: byName.why };
  }

  if (distinct.length === 1) {
    const group = distinct[0];
    const avg = pageVerdicts.reduce((s, v) => s + (v.score || 0), 0) / pageVerdicts.length;
    return {
      group,
      mixed: false,
      pageGroups,
      confidence: Math.min(1, avg / 2),
      why: pageVerdicts[0]?.why || byName.why
    };
  }

  // Pages disagree → split. Report the makeup so the UI can explain it.
  const counts = pageGroups.reduce((m, g) => m.set(g, (m.get(g) || 0) + 1), new Map());
  const why = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${n} ${groupLabel(g).toLowerCase()}`)
    .join(' · ');
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { group: dominant, mixed: true, pageGroups, confidence: 0.6, why };
}

// ═══════════════════ Grouping ═══════════════════

/**
 * The copy number a browser appends when a name repeats:
 * "Label.pdf" → 0, "Label (1).pdf" → 1, "Label-2.pdf" → 2.
 */
export function copyIndex(fileName) {
  const base = String(fileName ?? '').replace(/\.pdf$/i, '');
  const m = /\((\d+)\)\s*$/.exec(base) || /[-_ ](\d+)$/.exec(base);
  return m ? Number(m[1]) : 0;
}

/**
 * Natural filename order — the order a person expects when printing:
 * the original first, then its copies in numeric order.
 *   Label.pdf · Label (1).pdf · Label (2).pdf · Label (10).pdf
 * Sorting on the raw string instead would put "Label (2)" before "Label.pdf",
 * because "(" collates before ".". Stem-then-number is explicit and stable.
 */
export const byFileName = (a, b) => {
  const sa = fileStem(a.fileName), sb = fileStem(b.fileName);
  if (sa !== sb) return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
  const ca = copyIndex(a.fileName), cb = copyIndex(b.fileName);
  if (ca !== cb) return ca - cb;
  return String(a.fileName).localeCompare(String(b.fileName), undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * Turn classified files into merge groups of page references.
 * A file with an `override` goes wholly to that group, ignoring a split.
 *
 * @param {Array} files  [{ fileName, pages, decision, override, unreadable, order }]
 * @returns {Array} [{ id, label, files, pageCount, pages: [{ fileIndex, pageIndex }] }]
 */
export function buildGroups(files) {
  const groups = new Map();
  const ensure = (id) => {
    if (!groups.has(id)) groups.set(id, { id, label: groupLabel(id), files: new Set(), pages: [] });
    return groups.get(id);
  };

  files.forEach((file, fileIndex) => {
    if (file.unreadable) return;
    const pageCount = file.pages?.length || 0;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      // Override wins over everything, including a page-level split
      const id = file.override
        || file.decision?.pageGroups?.[pageIndex]
        || file.decision?.group
        || UNSORTED;
      const g = ensure(id);
      g.pages.push({ fileIndex, pageIndex });
      g.files.add(fileIndex);
    }
  });

  return [...groups.values()]
    .map(g => ({ ...g, files: [...g.files], fileCount: g.files.size, pageCount: g.pages.length }))
    .sort((a, b) => {
      // Known groups first in declaration order, then derived, unsorted last
      const rank = id => id === UNSORTED ? 99 : (GROUP_IDS.indexOf(id) >= 0 ? GROUP_IDS.indexOf(id) : 50);
      return rank(a.id) - rank(b.id) || a.label.localeCompare(b.label);
    });
}

// ═══════════════════ Filenames ═══════════════════

/** Strip anything a filesystem would object to. */
export const safeFileNamePart = (s) =>
  String(s ?? '').trim().replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, '_').replace(/^-+|-+$/g, '') || 'group';

/**
 * Merged filename for a group, stamped with the BATCH date the user chose —
 * not today. A batch prepared for the 20th keeps that name when merged later.
 * @param {string} groupId
 * @param {string} isoDate  YYYY-MM-DD; falls back to today when blank
 */
export function mergedFileName(groupId, isoDate) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate ?? '').trim())
    ? String(isoDate).trim()
    : new Date().toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-');
  return `${safeFileNamePart(groupLabel(groupId))}_merged_${d}-${m}-${y}.pdf`;
}

// ═══════════════════ Reading & merging ═══════════════════

/**
 * Read one PDF into the descriptor classifyPdf expects.
 * Never throws: an unreadable file comes back flagged so the batch survives.
 */
export async function describePdf(file) {
  try {
    const pdfjsLib = await loadPdfJs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Keep our own copy — PDF.js detaches the buffer it is handed
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      pages.push({
        width: vp.width,
        height: vp.height,
        text: tc.items.map(i => i.str).join(' ')
      });
    }
    return { fileName: file.name, bytes, pages, unreadable: false };
  } catch (err) {
    return { fileName: file.name, bytes: null, pages: [], unreadable: true, error: err.message };
  }
}

/**
 * Merge a group's page references into one PDF.
 * @param {Array} groupPages  [{ fileIndex, pageIndex }] in final order
 * @param {Array} files       the described files (need `bytes`)
 * @returns {Promise<Uint8Array>}
 */
export async function mergeGroup(groupPages, files) {
  const PDFLib = await loadPdfLib();
  const out = await PDFLib.PDFDocument.create();

  // Parse each source once, however many pages it contributes
  const loaded = new Map();
  const docFor = async (fileIndex) => {
    if (loaded.has(fileIndex)) return loaded.get(fileIndex);
    const file = files[fileIndex];
    if (!file?.bytes) { loaded.set(fileIndex, null); return null; }
    try {
      // ignoreEncryption covers the common "owner password on print" case
      const doc = await PDFLib.PDFDocument.load(file.bytes.slice(), { ignoreEncryption: true });
      loaded.set(fileIndex, doc);
      return doc;
    } catch {
      loaded.set(fileIndex, null);
      return null;
    }
  };

  // Copy in contiguous runs from the same source — far fewer copyPages calls
  let i = 0;
  const skipped = new Set();
  while (i < groupPages.length) {
    const fileIndex = groupPages[i].fileIndex;
    const run = [];
    while (i < groupPages.length && groupPages[i].fileIndex === fileIndex) {
      run.push(groupPages[i].pageIndex);
      i++;
    }
    const doc = await docFor(fileIndex);
    if (!doc) { skipped.add(fileIndex); continue; }
    const copied = await out.copyPages(doc, run);
    copied.forEach(pg => out.addPage(pg));
  }

  const bytes = await out.save();
  return { bytes, pageCount: out.getPageCount(), skippedFiles: [...skipped] };
}

/** Hand a merged PDF to the browser as a download. */
export function downloadPdfBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
