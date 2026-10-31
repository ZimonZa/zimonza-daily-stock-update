// ═══════════════════════════════════════════════════════════════
// ZIMONZA — build the Order Map's data files
//
//   node scripts/build-geo.mjs <pincode.csv> <states.geojson>
//
// <pincode.csv>     India Post "All India Pincode Directory" (data.gov.in,
//                   GODL-India): CircleName, RegionName, DivisionName,
//                   OfficeName, Pincode, OfficeType, Delivery, District,
//                   StateName, Latitude, Longitude.
// <states.geojson>  DataMeet States/Admin2 (CC BY 4.0), simplified with
//                   mapshaper — e.g.
//                   mapshaper Admin2.shp -simplify 1.5% keep-shapes \
//                     -o states.geojson precision=0.001 format=geojson
//
// Writes assets/geo/pincodes.json and assets/geo/india-states.json with ONE
// spelling of every state, so the map and the PIN lookup always agree. Fails,
// naming the culprit, if a state from either file cannot be matched.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [csvPath, geoPath] = process.argv.slice(2);
if (!csvPath || !geoPath) {
  console.error('usage: node scripts/build-geo.mjs <pincode.csv> <states.geojson>');
  process.exit(2);
}
const outDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'assets', 'geo');

// ── The one spelling of every state and union territory ──
const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal'
];
const key = s => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/^the\s+/, '')
  .replace(/[^a-z]+/g, ' ').trim();
const ALIASES = {
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'nct of delhi': 'Delhi',
  'orissa': 'Odisha',
  'pondicherry': 'Puducherry',
  'uttaranchal': 'Uttarakhand'
};
const BY_KEY = new Map(STATES.map(s => [key(s), s]));
const canonState = (raw) => BY_KEY.get(key(raw)) || ALIASES[key(raw)] || null;

const titleCase = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  .replace(/(^|[\s(\-/.])([a-z])/g, (m, a, b) => a + b.toUpperCase());

// ── CSV ──
function* csvRows(t) {
  let field = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field); field = ''; yield row; row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); yield row; }
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const inIndia = (lat, lng) => lat > 6 && lat < 38 && lng > 68 && lng < 98;
const round3 = n => n === null ? null : Math.round(n * 1000) / 1000;

// "Khagaul Bazar SO" → "Khagaul Bazar"; head and sub offices name the locality
const OFFICE_SUFFIX = /\s+(?:g\.?\s*p\.?\s*o\.?|h\.?\s*o\.?|s\.?\s*o\.?|b\.?\s*o\.?|p\.?\s*o\.?)\s*$/i;
const RANK = { HO: 0, PO: 1, SO: 1, BO: 2 };

// ── Read the directory ──
const it = csvRows(readFileSync(csvPath, 'utf8'));
const head = it.next().value.map(h => h.trim());
const col = (name) => {
  const i = head.findIndex(h => h.toLowerCase() === name.toLowerCase());
  if (i < 0) throw new Error(`CSV has no "${name}" column`);
  return i;
};
const C = {
  office: col('OfficeName'), pin: col('Pincode'), type: col('OfficeType'),
  district: col('District'), state: col('StateName'), lat: col('Latitude'), lng: col('Longitude')
};

const unknownStates = new Set();
const byPin = new Map();          // pin → [{ district, state, office, type, lat, lng }]
for (const r of it) {
  if (r.length <= C.lng) continue;
  const pin = String(r[C.pin]).trim();
  if (!/^[1-9]\d{5}$/.test(pin)) continue;
  const state = canonState(r[C.state]);
  if (!state) { unknownStates.add(r[C.state]); continue; }
  const lat = Number(r[C.lat]), lng = Number(r[C.lng]);
  if (!byPin.has(pin)) byPin.set(pin, []);
  byPin.get(pin).push({
    district: titleCase(r[C.district]), state,
    office: r[C.office], type: String(r[C.type]).trim().toUpperCase(),
    lat: inIndia(lat, lng) ? lat : null, lng: inIndia(lat, lng) ? lng : null
  });
}
if (unknownStates.size) {
  console.error('States in the CSV with no match:', [...unknownStates].join(', '));
  process.exit(1);
}

// ── One district per PIN: the one with the most offices ──
const districts = [];             // [name, stateIdx, lat, lng]
const districtIdx = new Map();    // "state|district" → index
const districtPoints = new Map(); // index → { lat:[], lng:[] }
const pins = {};

for (const [pin, offices] of [...byPin.entries()].sort()) {
  const count = new Map();
  for (const o of offices) {
    const k = `${o.state}|${o.district}`;
    count.set(k, (count.get(k) || 0) + 1);
  }
  const [best] = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const [state, district] = best.split('|');
  if (!districtIdx.has(best)) {
    districtIdx.set(best, districts.length);
    districts.push([district, STATES.indexOf(state), null, null]);
    districtPoints.set(districts.length - 1, { lat: [], lng: [] });
  }
  const di = districtIdx.get(best);
  const mine = offices.filter(o => `${o.state}|${o.district}` === best);
  for (const o of mine) if (o.lat !== null) {
    districtPoints.get(di).lat.push(o.lat);
    districtPoints.get(di).lng.push(o.lng);
  }

  // The area: a head or sub office names the locality; branch offices are villages
  const named = [...mine].sort((a, b) => (RANK[a.type] ?? 3) - (RANK[b.type] ?? 3) || a.office.localeCompare(b.office));
  const area = titleCase(String(named[0]?.office || '').replace(OFFICE_SUFFIX, '').replace(OFFICE_SUFFIX, ''));
  pins[pin] = [di, area];
}
for (const [di, pts] of districtPoints) {
  districts[di][2] = round3(median(pts.lat));
  districts[di][3] = round3(median(pts.lng));
}

// ── The outline, renamed to the same spellings ──
const outline = JSON.parse(readFileSync(geoPath, 'utf8'));
const missing = [];
for (const f of outline.features) {
  const raw = f.properties.ST_NM ?? f.properties.name ?? f.properties.NAME_1;
  const name = canonState(raw);
  if (!name) missing.push(raw);
  f.properties = { name };
}
if (missing.length) {
  console.error('Outline features with no matching state:', missing.join(', '));
  process.exit(1);
}
const outlineNames = new Set(outline.features.map(f => f.properties.name));
const absent = STATES.filter(s => !outlineNames.has(s));
if (absent.length) {
  console.error('States with no outline feature:', absent.join(', '));
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const built = new Date();
const stamp = `${built.getFullYear()}-${String(built.getMonth() + 1).padStart(2, '0')}-${String(built.getDate()).padStart(2, '0')}`;
writeFileSync(join(outDir, 'pincodes.json'), JSON.stringify({
  v: 1,
  source: 'India Post — All India Pincode Directory, via data.gov.in (GODL-India)',
  built: stamp,
  states: STATES,
  districts,
  pins
}));
writeFileSync(join(outDir, 'india-states.json'), JSON.stringify({
  type: 'FeatureCollection',
  source: 'State boundaries: DataMeet India community, States/Admin2 (CC BY 4.0) — India\'s official boundary as per the Survey of India',
  features: outline.features
}));
console.log(`pins ${Object.keys(pins).length}, districts ${districts.length}, states ${STATES.length}, outline features ${outline.features.length}`);
