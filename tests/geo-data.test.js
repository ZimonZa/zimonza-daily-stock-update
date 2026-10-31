// The two map data files: India Post's PIN directory and the state outline.
// A state name that differs by one letter between them is a state that never
// lights up on the map, so the names are checked against each other here.

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}\n   got  ${a}\n   want ${b}`); }
};
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

const read = (f) => JSON.parse(readFileSync(new URL(`./geo/${f}`, import.meta.url), 'utf8'));
const dir = read('pincodes.json');
const outline = read('india-states.json');

const where = (pin) => {
  const hit = dir.pins[pin];
  if (!hit) return null;
  const [name, si] = dir.districts[hit[0]];
  return { district: name, state: dir.states[si], area: hit[1] };
};

// ════ 1. Names agree ════
const featureNames = outline.features.map(f => f.properties.name).sort();
eq('36 states and union territories in the directory', dir.states.length, 36);
eq('one outline feature per state, same names', featureNames, [...dir.states].sort());
ok('the merged Dadra/Daman UT is one state', dir.states.includes('Dadra and Nagar Haveli and Daman and Diu'));
ok('Ladakh is its own union territory', dir.states.includes('Ladakh') && dir.states.includes('Jammu and Kashmir'));

// ════ 2. Known PINs resolve ════
eq('110001 is Delhi', where('110001')?.state, 'Delhi');
eq('400001 is Mumbai, Maharashtra', [where('400001')?.district, where('400001')?.state], ['Mumbai', 'Maharashtra']);
eq('560001 is Bengaluru Urban, Karnataka', [where('560001')?.district, where('560001')?.state], ['Bengaluru Urban', 'Karnataka']);
eq('201301 (Noida) is Gautam Buddha Nagar, Uttar Pradesh',
  [where('201301')?.district, where('201301')?.state], ['Gautam Buddha Nagar', 'Uttar Pradesh']);
eq('201301 area reads Noida', where('201301')?.area, 'Noida');
eq('the real labels: 801105 Patna, Bihar', [where('801105')?.district, where('801105')?.state], ['Patna', 'Bihar']);
eq('208017 Kanpur Nagar, Uttar Pradesh', [where('208017')?.district, where('208017')?.state], ['Kanpur Nagar', 'Uttar Pradesh']);
eq('229001 Rae Bareli, Uttar Pradesh (the combo label)', [where('229001')?.district, where('229001')?.state], ['Rae Bareli', 'Uttar Pradesh']);
ok('more than 18,000 PINs', Object.keys(dir.pins).length > 18000, String(Object.keys(dir.pins).length));

// ════ 3. Coordinates are in India ════
const placed = dir.districts.filter(d => d[2] !== null);
ok('at least 95% of districts have a position', placed.length / dir.districts.length >= 0.95,
  `${placed.length}/${dir.districts.length}`);
const outside = placed.filter(([, , lat, lng]) => !(lat > 6 && lat < 38 && lng > 68 && lng < 98));
eq('no district is placed outside India', outside.map(d => d[0]), []);

// ════ 4. Small enough to ship ════
ok('PIN directory under 600 KB', readFileSync(new URL('./geo/pincodes.json', import.meta.url)).length < 600 * 1024);
ok('outline under 400 KB', readFileSync(new URL('./geo/india-states.json', import.meta.url)).length < 400 * 1024);
ok('the source is recorded', /India Post/.test(dir.source) && /DataMeet/.test(outline.source || ''), dir.source);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
