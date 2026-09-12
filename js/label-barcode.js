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

/**
 * Grayscale, one byte per pixel, which is what ZXing's luminance source
 * wants. The green channel carries most of the perceived brightness, so
 * this is the standard ITU-R luma weighting.
 */
function toLuminance(imageData) {
  const { data, width, height } = imageData;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return out;
}

/**
 * Is this error just "nothing to decode here"?
 *
 * Three ways, because the CDN build is minified and only one of them is a
 * stable string: `getKind()` returns the static kind, `instanceof` works
 * against the exported class, and the message is the last resort.
 */
export function isNotFound(zx, err) {
  if (!err) return false;
  if (typeof err.getKind === 'function' && err.getKind() === 'NotFoundException') return true;
  if (zx?.NotFoundException && err instanceof zx.NotFoundException) return true;
  return /no\s+multiformat|not\s*found/i.test(err.message || '');
}

function zxingHints(zx) {
  const hints = new Map();
  hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
    zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39,
    zx.BarcodeFormat.CODABAR, zx.BarcodeFormat.ITF
  ]);
  hints.set(zx.DecodeHintType.TRY_HARDER, true);
  return hints;
}

/**
 * Decode with ZXing's CORE api — MultiFormatReader over a BinaryBitmap.
 *
 * The browser wrapper (`BrowserMultiFormatReader.decodeFromCanvas`) was
 * used here first and threw "decodeFromCanvas is not a function": that
 * helper's shape has moved between versions and across the ESM build. The
 * core classes have not moved, and they take raw pixels, so nothing about
 * this depends on a DOM convenience method existing.
 */
async function decodeZxing(canvas) {
  const zx = await loadZxing();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const source = new zx.RGBLuminanceSource(toLuminance(image), canvas.width, canvas.height);
  const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(source));
  const reader = new zx.MultiFormatReader();
  reader.setHints(zxingHints(zx));

  let result;
  try {
    result = reader.decode(bitmap);
  } catch (err) {
    // "No barcode on this page" is a normal answer, not a fault, and must
    // not surface as an error.
    //
    // Identifying it is fiddly: the CDN build is MINIFIED, so `err.name` is
    // "N", and the message is "No MultiFormat Readers were able to detect
    // the code" — which contains neither "not" nor "found". `getKind()`
    // returns the static, unminified kind string, so that is what we ask.
    if (isNotFound(zx, err)) return null;
    throw err;
  }
  const value = result?.getText?.() ?? result?.text;
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
  if (!pdfPage || typeof document === 'undefined') {
    return { value: '', format: '', reason: 'no page to read' };
  }

  let canvas;
  try {
    canvas = await renderPageToCanvas(pdfPage, scale);
  } catch (err) {
    return { value: '', format: '', reason: 'could not render the page: ' + (err?.message || err) };
  }

  const tried = [];
  let lastError = '';
  for (const [name, decode] of [
    ['browser', (await hasNativeDetector()) ? decodeNative : null],
    ['zxing', decodeZxing]
  ]) {
    if (!decode) continue;
    tried.push(name);
    try {
      const hit = await decode(canvas);
      if (!hit) continue;
      const value = tidy(hit.value);
      // A short code on a label is the route or the size, not the AWB.
      if (plausible(value)) return { value, format: hit.format, decoder: name, reason: '' };
      lastError = `decoded "${value}" but it is not a tracking ID`;
    } catch (err) {
      lastError = `${name}: ${err?.message || err}`;
    }
  }

  // Say WHY, so "no tracking ID" can be told apart from "the decoder broke".
  return {
    value: '', format: '',
    reason: lastError || (tried.length ? 'no barcode found on the page' : 'no decoder available')
  };
}

/**
 * Is barcode decoding usable in this browser at all?
 * Answered without decoding anything, so the UI can say so up front.
 */
export async function barcodeSupport() {
  if (typeof document === 'undefined') return { native: false, zxing: false, ready: false };
  const native = await hasNativeDetector();
  return {
    native,
    zxing: true,               // always reachable; it is only a download away
    ready: true,
    detail: native ? 'this browser decodes barcodes itself' : 'ZXing will be downloaded when first needed'
  };
}

/** Told from the outside so a test need not stand up a canvas. */
export const __testing = { tidy, plausible };
