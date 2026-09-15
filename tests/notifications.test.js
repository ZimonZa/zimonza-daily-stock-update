// The REAL toast module, against a minimal DOM.
//
// Every assertion here exists because of a bug that shipped:
//   - Messages went into innerHTML unescaped. They carry customer names read
//     from label PDFs, decoded barcode values, file names and spreadsheet
//     cells, so a crafted value could inject markup. Honest text broke too:
//     "ZM-<no>-<colour>" rendered as "ZM--".
//   - The id was `toast-${Date.now()}`, so toasts raised in the same
//     millisecond shared one, and only the first ever auto-dismissed.

const made = [];
const byId = new Map();
const mkEl = (tag) => {
  const el = {
    tag, id: '', className: '', innerHTML: '', children: [],
    classList: { add() {}, remove() {} },
    appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); },
    remove() { byId.delete(this.id); }
  };
  made.push(el);
  return el;
};
globalThis.document = {
  createElement: mkEl,
  body: mkEl('body'),
  getElementById: (id) => byId.get(id) || null
};
globalThis.requestAnimationFrame = (fn) => fn();
const timers = [];
globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };

const { toast, escapeText } = await import('./_real-notifications.js');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };

// ── Escaping ──
ok('angle brackets are escaped', escapeText('<b>') === '&lt;b&gt;');
ok('ampersands first, so nothing is double-escaped', escapeText('a & <b>') === 'a &amp; &lt;b&gt;');
ok('quotes are escaped', escapeText(`"x" 'y'`) === '&quot;x&quot; &#39;y&#39;');
ok('null is empty, not "null"', escapeText(null) === '');

const hostile = toast('<img src=x onerror="alert(1)">', 'warning', 0);
const hostileEl = byId.get(hostile);
ok('THE RULE: a hostile message renders as text, not as an element',
  !/<img/i.test(hostileEl.innerHTML) && /&lt;img/.test(hostileEl.innerHTML), hostileEl.innerHTML.slice(0, 200));

const honest = byId.get(toast('Skipped 2 SKU(s) not matching ZM-<no>-<colour>', 'warning', 0));
ok('honest text with angle brackets survives intact',
  honest.innerHTML.includes('ZM-&lt;no&gt;-&lt;colour&gt;'), honest.innerHTML.slice(0, 200));

const name = byId.get(toast('Fake return recorded against O\'Brien & <Sons>', 'warning', 0));
ok('a customer name from a PDF cannot break out of the message',
  name.innerHTML.includes('O&#39;Brien &amp; &lt;Sons&gt;'));

// The icon and close button are the module's own markup and must still render
ok('the module\'s own icon still renders as markup', /<svg/.test(honest.innerHTML));
ok('and so does the close button', /<button/.test(honest.innerHTML));

// ── Unique ids ──
// Three toasts back to back, exactly as the barcode report raises them. Date.now()
// is frozen here, which is the worst case: every one in the same millisecond.
const realNow = Date.now;
Date.now = () => 1700000000000;
const ids = [toast('one'), toast('two'), toast('three')];
Date.now = realNow;
ok('THE RULE: toasts in the same millisecond get distinct ids', new Set(ids).size === 3, JSON.stringify(ids));

// Every timer must find ITS OWN toast
timers.length = 0;
byId.clear();
Date.now = () => 1700000000000;
const a = toast('first', 'info', 4000);
const b = toast('second', 'info', 4000);
Date.now = realNow;
ok('both toasts are on screen', byId.has(a) && byId.has(b));
timers.splice(0).forEach(fn => fn());      // dismiss timers fire
timers.splice(0).forEach(fn => fn());      // removal timers fire
ok('THE RULE: each auto-dismiss removes its own toast — none is left behind',
  !byId.has(a) && !byId.has(b), `left: ${[...byId.keys()].join(', ')}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
