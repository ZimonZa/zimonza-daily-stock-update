// Text from the owner's stock files (codes, names, colours, locations, file
// names) is written into the pages as HTML. A quote, apostrophe or < in it
// must show as text, never break a row or an inline handler.

import { readFileSync, existsSync } from 'node:fs';
import { escHtml } from './utils.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

ok('escHtml turns markup into text', escHtml(`<b x="1">O'Neil & co</b>`) === '&lt;b x=&quot;1&quot;&gt;O&#39;Neil &amp; co&lt;/b&gt;', escHtml(`<b x="1">O'Neil & co</b>`));
ok('escHtml of nothing is empty', escHtml(undefined) === '' && escHtml(null) === '');
ok('escHtml keeps numbers', escHtml(12) === '12');

// Every page / module that renders stock items
const files = ['low-stock', 'new-arrivals', 'sold-items', 'restocked', 'sold-out', 'reports', 'skip-panel',
  'zm-panel', 'upload', 'stock-analysis', 'dashboard-js'];
const FIELD = /\$\{\s*[A-Za-z_]+\.(sku|name|colorName|colourName|category|zmCode|kuntalCode|text|sub)\s*\}/g;
const HANDLER = /\bon(click|input|change)="[^"]*\$\{/g;
for (const f of files) {
  const path = f === 'dashboard-js' ? new URL('./dashboard.js', import.meta.url) : new URL(`./_page-${f}.txt`, import.meta.url);
  if (!existsSync(path)) { ok(`${f}: source found`, false); continue; }
  const lines = readFileSync(path, 'utf8').split('\n');
  const raw = [];
  lines.forEach((line, n) => {
    if (!/<[a-z]/i.test(line)) return;               // only lines that build HTML
    for (const m of line.matchAll(FIELD)) raw.push(`${n + 1}: ${m[0]}`);
  });
  ok(`${f}: stock-file text is escaped`, raw.length === 0, raw.join(' | '));
  const handlers = lines.map((l, n) => [...l.matchAll(HANDLER)].map(() => n + 1)).flat();
  ok(`${f}: no inline handler built from data`, handlers.length === 0, `lines ${handlers.join(', ')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
