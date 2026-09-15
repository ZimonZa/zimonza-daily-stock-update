// The barcode decoder's contract with ZXing.
//
// Every assertion here exists because a real failure reached the user:
//   "zxing: reader.decodeFromCanvas is not a function"
// The browser wrapper's shape moves between versions and builds; the core
// classes do not. And the CDN build is MINIFIED, so an exception's `name`
// is "N" and its message is "No MultiFormat Readers were able to detect
// the code" — which contains neither "not" nor "found".
//
// The shapes below were taken from the real @zxing/library@0.21.3 UMD
// build, not from memory.

import { isNotFound, trackingFromDecoded, __testing } from './label-barcode.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ── What the real library actually throws ──
class MinifiedNotFound extends Error {
  constructor() {
    super('No MultiFormat Readers were able to detect the code.');
    this.name = 'N';                       // minified, as observed
  }
  getKind() { return 'NotFoundException'; } // static kind, NOT minified
}
const zx = { NotFoundException: MinifiedNotFound };
const notFound = new MinifiedNotFound();

ok('the OLD guard missed it — this is the bug',
  !(notFound.name === 'NotFoundException' || /not\s*found/i.test(notFound.message)));

ok('getKind() identifies it through minification', isNotFound(zx, notFound));
ok('instanceof identifies it too', isNotFound({ NotFoundException: MinifiedNotFound }, notFound));
ok('the message is a last resort that also works',
  isNotFound({}, { message: 'No MultiFormat Readers were able to detect the code.' }));

// ── A genuine fault must NOT be swallowed as "no barcode" ──
const real = new TypeError('reader.decodeFromCanvas is not a function');
ok('a TypeError is not mistaken for an empty page', !isNotFound(zx, real));
ok('nor is an out-of-memory', !isNotFound(zx, new RangeError('Array buffer allocation failed')));
ok('nor a null error', !isNotFound(zx, null));

// ── What a decoded value is taken to mean ──
// trackingFromDecoded decides the `confident` flag. Get it wrong and an unsure
// decode is shown as a trusted tracking ID — the bug fixed in this audit.
const t = (v) => trackingFromDecoded(v);
ok('a clean MY value is confident', t(['MYEC1118733669']).confident === true && t(['MYEC1118733669']).value === 'MYEC1118733669');
ok('a MY number buried in DataMatrix shipment data is found, and confident',
  t(['AWB:MYEP1126210472|ORD:998877|PIN:229001']).value === 'MYEP1126210472' && t(['AWB:MYEP1126210472|X']).confident === true);
ok('lower case is normalised', t(['myec1118733669']).value === 'MYEC1118733669');
ok('the MY value wins over a route code decoded first',
  t(['LKO12345678RBY', 'MYEC1118733669']).value === 'MYEC1118733669');
const route = t(['LKO12345678RBY']);
ok('THE RULE: a plausible value that is not MY is returned UNconfident',
  route.value === 'LKO12345678RBY' && route.confident === false, JSON.stringify(route));
ok('a short code is not a tracking ID at all', t(['T']).value === '' && t(['1509']).value === '');
ok('an empty read is nothing', t([]).value === '' && t(null).value === '');

// ── Band order: the cheap band first ──
// Measured against the real library, the whole-page pass costs 2.5x the header
// band, and on Myntra labels EVERY page is decoded.
const { BANDS, releaseCanvas } = __testing;
ok('THE RULE: the header band is tried first, not the whole page',
  BANDS[0][0] === 0 && BANDS[0][1] < 1, JSON.stringify(BANDS[0]));
ok('the header band covers where the strip sits (13–22% down)', BANDS[0][0] <= 0.13 && BANDS[0][0] + BANDS[0][1] >= 0.22);
ok('the whole page is still tried', BANDS.some(([top, h]) => top === 0 && h === 1));
ok('every band stays inside the page', BANDS.every(([top, h]) => top >= 0 && h > 0 && top + h <= 1.0001));

// ── Memory ──
const canvas = { width: 1786, height: 2526 };
releaseCanvas(canvas);
ok('a finished canvas is zeroed so its pixels are freed at once', canvas.width === 0 && canvas.height === 0);
releaseCanvas(null);
ok('releasing nothing does not throw', true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
