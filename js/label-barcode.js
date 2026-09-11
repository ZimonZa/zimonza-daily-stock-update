// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Reading the barcode off a label page
//
// The tracking ID is normally printed as digits under the barcode, and
// reading that text costs nothing. This is the fallback for when it is
// not: the page is rasterised and the barcode itself is decoded.
//
// It runs ONLY on a page where the text layer gave no tracking ID. On a
// 200-page label file that is usually nought to two pages, so the cost
// lands where the value is instead of on every page.
//
// Two decoders, in order of cost:
//   1. The browser's own BarcodeDetector — Chrome and Edge have it, and
//      it downloads nothing at all.
//   2. ZXing from the CDN, imported dynamically so a session that never
//      needs it never fetches it.
// ═══════════════════════════════════════════════════════════════

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm';

// Courier labels use 1-D symbologies; Code 128 is near-universal for AWBs.
const FORMATS_NATIVE = ['code_128', 'code_39', 'codabar', 'itf'];

let nativeSupport = null;   // null = not asked yet
let zxingPromise = null;

/** Does this browser decode barcodes itself? Asked once. */
async function hasNativeDetector() {
  if (nativeSupport !== null) return nativeSupport;
  nativeSupport = false;
  try {
    if (typeof BarcodeDetector === 'function') {
      const supported = await BarcodeDetector.getSupportedFormats();
      nativeSupport = FORMATS_NATIVE.some(f => supported.includes(f));
    }
  } catch { nativeSupport = false; }
  return nativeSupport;
}

function loadZxing() {
  if (!zxingPromise) zxingPromise = import(/* @vite-ignore */ ZXING_URL);
  return zxingPromise;
}

/**
 * Render one PDF page to a canvas.
 * Barcodes need real pixels — at the default scale the bars blur into each
 * other and nothing decodes.
 */
async function renderPageToCanvas(pdfPage, scale) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // A white ground: a transparent canvas decodes as black-on-black.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function decodeNative(canvas) {
  const detector = new BarcodeDetector({ formats: FORMATS_NATIVE });
  const found = await detector.detect(canvas);
  if (!found?.length) return null;
  // The longest value is the tracking ID — short codes on a label are
  // things like the route or the size, not the AWB.
  const best = found.slice().sort((a, b) => String(b.rawValue).length - String(a.rawValue).length)[0];
  return best?.rawValue ? { value: String(best.rawValue), format: best.format || 'barcode' } : null;
}

async function decodeZxing(canvas) {
  const zx = await loadZxing();
  const hints = new Map();
  hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
    zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39,
    zx.BarcodeFormat.CODABAR, zx.BarcodeFormat.ITF
  ]);
  hints.set(zx.DecodeHintType.TRY_HARDER, true);
  const reader = new zx.BrowserMultiFormatReader(hints);
  const result = reader.decodeFromCanvas(canvas);
  const value = result?.getText?.();
  return value ? { value: String(value), format: 'barcode' } : null;
}

/** Tracking IDs are alphanumeric; couriers print separators that are not part of it. */
const tidy = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');

/** Long enough to be a courier ID, and carrying at least one digit. */
const plausible = (v) => v.length >= 8 && v.length <= 30 && /\d/.test(v);

/**
 * Decode the tracking barcode on one PDF page.
 *
 * Never throws — a page that will not decode is simply a page with no
 * tracking ID, which the review already knows how to show you.
 *
 * @returns {Promise<{value:string, format:string}|null>}
 */
export async function decodeTrackingBarcode(pdfPage, { scale = 3 } = {}) {
  if (!pdfPage || typeof document === 'undefined') return null;

  let canvas;
  try {
    canvas = await renderPageToCanvas(pdfPage, scale);
  } catch {
    return null;   // cannot rasterise; nothing more to try
  }

  for (const decode of [
    (await hasNativeDetector()) ? decodeNative : null,
    decodeZxing
  ]) {
    if (!decode) continue;
    try {
      const hit = await decode(canvas);
      if (!hit) continue;
      const value = tidy(hit.value);
      if (plausible(value)) return { value, format: hit.format };
    } catch {
      // This decoder could not read it. Try the next one.
    }
  }
  return null;
}

/** Told from the outside so a test need not stand up a canvas. */
export const __testing = { tidy, plausible };
