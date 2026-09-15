// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Reading the barcode off a label page
//
// The page is rasterised and the barcode itself is decoded.
//
// It runs on a page where the text layer gave no tracking ID. On a real
// MYNTRA label that is EVERY page: the number under the barcode is part of
// the barcode artwork, not text — confirmed on four real label files. So
// this is the primary source there, not a rare fallback, and its cost is
// paid per page: see BANDS for why the cheap band goes first.
//
// Two decoders, in order of cost:
//   1. The browser's own BarcodeDetector — Chrome and Edge have it, and
//      it downloads nothing at all.
//   2. ZXing from the CDN, imported dynamically so a session that never
//      needs it never fetches it.
// ═══════════════════════════════════════════════════════════════

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm';

// Courier labels use 1-D symbologies; Code 128 is near-universal for AWBs.
const FORMATS_NATIVE = ['code_128', 'code_39', 'codabar', 'itf', 'data_matrix', 'qr_code', 'pdf417'];

let nativeSupport = null;   // null = not asked yet
let nativeFormats = [];     // the subset of FORMATS_NATIVE this browser handles
let zxingPromise = null;

/** Does this browser decode barcodes itself? Asked once. */
async function hasNativeDetector() {
  if (nativeSupport !== null) return nativeSupport;
  nativeSupport = false;
  try {
    if (typeof BarcodeDetector === 'function') {
      const supported = await BarcodeDetector.getSupportedFormats();
      nativeFormats = FORMATS_NATIVE.filter(f => supported.includes(f));
      nativeSupport = nativeFormats.length > 0;
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

/** Zero the canvas so its backing store is released straight away. */
function releaseCanvas(canvas) {
  if (!canvas) return;
  try { canvas.width = 0; canvas.height = 0; } catch { /* already gone */ }
}

async function decodeNative(canvas) {
  // Only the formats this browser actually supports. Asking for one it does
  // not can make the constructor throw, and the native decoder would then
  // fail on every page and never be used at all.
  const detector = new BarcodeDetector({ formats: nativeFormats.length ? nativeFormats : FORMATS_NATIVE });
  const found = await detector.detect(canvas);
  // Every value it saw — picking the right one is trackingFromDecoded's job,
  // and a label carries several codes that are not the AWB.
  return (found || []).map(f => String(f.rawValue ?? '')).filter(Boolean);
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

/**
 * The 2D square on a Myntra label is worth reading too — it carries shipment
 * data that usually contains the AWB, so if the 1D strip will not scan the
 * DataMatrix may still give up the number.
 */
function zxingHints(zx, { twoD = true } = {}) {
  const formats = [
    zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39,
    zx.BarcodeFormat.CODABAR, zx.BarcodeFormat.ITF
  ];
  if (twoD) formats.push(zx.BarcodeFormat.DATA_MATRIX, zx.BarcodeFormat.QR_CODE, zx.BarcodeFormat.PDF_417);
  const hints = new Map();
  hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, formats);
  hints.set(zx.DecodeHintType.TRY_HARDER, true);
  return hints;
}

/**
 * Bands of the page to try, as [topFraction, heightFraction].
 *
 * A full A4 page is mostly text; the barcode is maybe 8% of it. ZXing's 1D
 * reader samples a limited set of rows, so on a busy full page it can miss a
 * strip it would read easily on its own. Cropping to a band removes the
 * noise and multiplies the sampled rows that actually cross the barcode.
 *
 * The HEADER band goes first. On every real Myntra label seen so far the AWB
 * strip sits 13–22% of the way down the page, and the whole-page pass — which
 * also looks for 2D codes — was measured against the real library at 2.5x
 * the cost of the header band. Running it first spent that on every page of
 * a file before trying where the barcode actually is; and since the number is
 * barcode artwork on these labels, EVERY page pays it. The whole page (with
 * the DataMatrix) is now the second resort, the rest walk down the page.
 */
const BANDS = [
  [0, 0.40],     // the header block, where the AWB strip lives
  [0, 1],        // whole page, 2D codes included
  [0.05, 0.25],
  [0.15, 0.30],
  [0, 0.60],
  [0.30, 0.40],
  [0.55, 0.45]   // the bottom, for labels laid out the other way up
];

/**
 * Decode with ZXing's CORE api — MultiFormatReader over a BinaryBitmap.
 *
 * The browser wrapper (`BrowserMultiFormatReader.decodeFromCanvas`) was
 * used here first and threw "decodeFromCanvas is not a function": that
 * helper's shape has moved between versions and across the ESM build. The
 * core classes have not moved, and they take raw pixels, so nothing about
 * this depends on a DOM convenience method existing.
 *
 * Returns EVERY value it managed to read across the bands, because the one
 * we want may not be the first one found.
 */
async function decodeZxing(canvas) {
  const zx = await loadZxing();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const luminance = toLuminance(image);
  const W = canvas.width, H = canvas.height;

  const reader = new zx.MultiFormatReader();
  const values = [];
  let lastError = null;

  for (const [top, height] of BANDS) {
    const y = Math.max(0, Math.floor(H * top));
    const h = Math.min(H - y, Math.max(1, Math.floor(H * height)));
    if (h < 20) continue;

    // Crop on the luminance source — verified supported by this build.
    let source = new zx.RGBLuminanceSource(luminance, W, H);
    if (y !== 0 || h !== H) source = source.crop(0, y, W, h);

    // Do NOT call reader.reset() here. It nulls MultiFormatReader's internal
    // readers array, and on a reader that has not yet had setHints() called
    // the next decode throws "this.readers is not iterable" — a TypeError,
    // not a NotFoundException, so it would surface to the user as a broken
    // decoder on every single page. Verified against the real 0.21.3 build.
    reader.setHints(zxingHints(zx, { twoD: top === 0 && height === 1 }));

    try {
      const result = reader.decode(new zx.BinaryBitmap(new zx.HybridBinarizer(source)));
      const value = result?.getText?.() ?? result?.text;
      if (value) {
        values.push(String(value));
        // A MY-prefixed value is the one we came for; stop as soon as we see it.
        if (MY_TOKEN.test(String(value))) break;
      }
    } catch (err) {
      // "Nothing in this band" is the normal answer, not a fault.
      if (!isNotFound(zx, err)) lastError = err;
    }
  }

  if (!values.length && lastError) throw lastError;
  return values;
}

/** Tracking IDs are alphanumeric; couriers print separators that are not part of it. */
const tidy = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');

/** Long enough to be a courier ID, and carrying at least one digit. */
const plausible = (v) => v.length >= 8 && v.length <= 30 && /\d/.test(v);

/** Myntra's own tracking shape — MYC…, MYEC…, MYEP… */
const MY_TOKEN = /MY[A-Z]{0,4}\d{6,}/i;

/**
 * Pull a tracking ID out of whatever a barcode actually contained.
 *
 * A 1D strip decodes to the number itself. A DataMatrix decodes to a blob of
 * shipment data with the number buried in it, so the MY token is searched for
 * before the whole string is considered.
 */
export function trackingFromDecoded(values) {
  const list = (Array.isArray(values) ? values : [values]).filter(Boolean).map(String);

  for (const raw of list) {
    const hit = MY_TOKEN.exec(raw.replace(/\s+/g, ''));
    if (hit) return { value: hit[0].toUpperCase(), confident: true };
  }
  for (const raw of list) {
    const v = tidy(raw);
    if (plausible(v)) return { value: v, confident: false };
  }
  return { value: '', confident: false };
}

/**
 * Decode the tracking barcode on one PDF page.
 *
 * Never throws — a page that will not decode is simply a page with no
 * tracking ID, which the review already knows how to show you.
 *
 * @returns {Promise<{value:string, format:string}|null>}
 */
export async function decodeTrackingBarcode(pdfPage, { scale = 3, retryScale = 5 } = {}) {
  if (!pdfPage || typeof document === 'undefined') {
    return { value: '', format: '', reason: 'no page to read' };
  }

  const notes = [];
  let best = null;      // a plausible-but-unconfident value, kept as a last resort

  // Escalate only as far as needed: most pages answer on the first pass.
  for (const px of [scale, retryScale]) {
    let canvas;
    try {
      canvas = await renderPageToCanvas(pdfPage, px);
    } catch (err) {
      notes.push(`render at ${px}x failed: ${err?.message || err}`);
      continue;
    }

    try {
      for (const [name, decode] of [
        ['browser', (await hasNativeDetector()) ? decodeNative : null],
        ['zxing', decodeZxing]
      ]) {
        if (!decode) continue;
        try {
          const raw = await decode(canvas);
          const values = Array.isArray(raw) ? raw : (raw?.value ? [raw.value] : []);
          if (!values.length) continue;

          const hit = trackingFromDecoded(values);
          if (hit.confident) {
            return { value: hit.value, format: 'barcode', decoder: name, scale: px, confident: true, reason: '' };
          }
          // Something decoded, but it does not look like a Myntra AWB. Hold it
          // in case nothing better turns up, and say so rather than pretending.
          if (hit.value && !best) {
            // confident:false travels with it, so the parser can badge this as
            // a guess instead of presenting it as a trusted barcode read.
            best = { value: hit.value, format: 'barcode', decoder: name, scale: px, confident: false,
                     reason: `decoded "${hit.value}", which is not a MY… tracking number — check it` };
          }
        } catch (err) {
          notes.push(`${name} at ${px}x: ${err?.message || err}`);
        }
      }
    } finally {
      // Free the pixels now rather than whenever the collector gets round to
      // it. A 3x A4 page is ~18 MB of RGBA and a 5x retry ~50 MB; across a
      // 200-page file, holding them until GC is what makes a tab stall.
      releaseCanvas(canvas);
    }
  }

  if (best) return best;

  // Say WHY, so "no tracking ID" can be told apart from "the decoder broke".
  return {
    value: '', format: '',
    reason: notes.length ? notes[0] : 'no barcode could be decoded on this page'
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
export const __testing = { tidy, plausible, BANDS, releaseCanvas };
