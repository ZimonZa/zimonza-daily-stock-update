// Loading the Order Map's data. When a file cannot be fetched the tab must
// say which one and why — a blank map with no message is impossible to act on.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { loadGeo } from './myntra-ordermap.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

const DIR = { v: 1, states: ['Bihar'], districts: [], pins: {} };
const OUTLINE = { type: 'FeatureCollection', features: [] };
const asked = [];
const okFetch = async (url) => {
  asked.push(url);
  return { ok: true, status: 200, json: async () => (url.endsWith('pincodes.json') ? DIR : OUTLINE) };
};

const got = await loadGeo(okFetch, 'assets/geo/');
eq('both files load', got, { dir: DIR, outline: OUTLINE });
eq('from the folder given', asked.sort(), ['assets/geo/india-states.json', 'assets/geo/pincodes.json']);

const missing = async (url) => url.endsWith('pincodes.json')
  ? { ok: false, status: 404, json: async () => { throw new Error('not json'); } }
  : okFetch(url);
let err = null;
try { await loadGeo(missing, 'assets/geo/'); } catch (e) { err = e; }
ok('a missing file rejects', err instanceof Error);
ok('and names the file and the status', /pincodes\.json/.test(err?.message) && /404/.test(err?.message), err?.message);

const offline = async () => { throw new TypeError('Failed to fetch'); };
err = null;
try { await loadGeo(offline, 'assets/geo/'); } catch (e) { err = e; }
ok('offline names a file too', /Could not load map data: (pincodes|india-states)\.json/.test(err?.message), err?.message);

const garbled = async (url) => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } });
err = null;
try { await loadGeo(garbled, 'assets/geo/'); } catch (e) { err = e; }
ok('a corrupt file says so', /Could not load map data/.test(err?.message), err?.message);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
