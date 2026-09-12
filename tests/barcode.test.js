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

import { isNotFound } from './label-barcode.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
