// Deleting Myntra mappings: the right documents, nothing for an empty list.

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;

import { deleteMyntraMappings, deleteZMMappings } from './firestore-service.js';

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

// ZM Panel: delete the ZM ↔ Kuntal mapping under the id it is stored as
globalThis.__fsDeletes = [];
eq('ZM: returns how many were deleted', await deleteZMMappings(['3044.', '9551', '9551', '']), 2);
eq('ZM: each mapping by its stored id, once', globalThis.__fsDeletes.map(r => [r.col, r.id]), [['zm_mapping', '3044.'], ['zm_mapping', '9551']]);
globalThis.__fsDeletes = [];
eq('ZM: an empty list deletes nothing', [await deleteZMMappings([]), globalThis.__fsDeletes.length], [0, 0]);

console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
