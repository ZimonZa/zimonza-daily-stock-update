// Deleting Myntra mappings: the right documents, nothing for an empty list.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { deleteMyntraMappings } from './firestore-service.js';

let pass = 0, fail = 0;
const eq = (n, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log(`FAIL ${n}
   got  ${a}
   want ${b}`); }
};

globalThis.__fsDeletes = [];
eq('returns how many were deleted', await deleteMyntraMappings(['ZM-1-Red', 'ZM-2/Blue']), 2);
eq('deletes each mapping by its id (a slash becomes _)', globalThis.__fsDeletes.map(r => r.id), ['ZM-1-Red', 'ZM-2_Blue']);
globalThis.__fsDeletes = [];
eq('an empty list deletes nothing', [await deleteMyntraMappings([]), globalThis.__fsDeletes.length], [0, 0]);

console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
