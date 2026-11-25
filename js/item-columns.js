// ═══════════════════════════════════════════════════════════════
// ZIMONZA — ITEM NO / ITEM NAME fix
//
// The Kuntal stock files sometimes carry the item name in ITEM NO and the
// number in ITEM NAME ("VELLY | 3447"), or both in one cell ("3144 SANDHYA").
// The owner's rule: the number is the item number, the words are the name.
// One rule, used for every upload (Upload Center "Check item numbers") and
// for stock already saved (fixed when read). No Firestore here.
// ═══════════════════════════════════════════════════════════════

import { normItemNo } from './utils.js';

/** 2–6 digits, optional " M" / "M.", optional "(UNST)", optional trailing dot. */
const CODE = /^\d{2,6}(\s*M\.?)?(\s*\(\s*UNST\s*\))?\.?$/i;
/** Unstitched marker, bracketed or bare: UNST, UNSTITCHED (or UNSTICHED), and the typo UNTS. */
const MARK = /\(?\s*\bUN(?:ST(?:ITCHED|ICHED)?|TS)\b\s*\)?/i;

export const isCodeLike = (v) => CODE.test(String(v ?? '').trim());

/** Spaces collapsed, punctuation trimmed from both ends. */
const cleanWords = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/^[\s.\-_,;:]+|[\s.\-_,;:]+$/g, '');
const sameName = (a, b) => cleanWords(a).toUpperCase() === cleanWords(b).toUpperCase();
const letters = (s) => (String(s).match(/[A-Za-z]/g) || []).length;

const up = (v) => normItemNo(v).toUpperCase();
/**
 * The key a remembered decision is stored under: "saree|RHEA|1475".
 * The number is part of it — one word can carry several products
 * (RHEA → 1454 and 1475), each decided on its own.
 */
export const ruleKey = (category, sku, to = '') => `${category || ''}|${up(sku)}|${up(to)}`;

/**
 * What the rule would do to one ITEM NO / ITEM NAME pair, or null.
 * - switch: ITEM NO is a word, ITEM NAME is the number.
 * - split:  ITEM NO is a number with words or an unstitched marker after it.
 * @returns {{ sku: string, name: string, kind: 'switch'|'split' } | null}
 */
export function proposeFix(sku, name) {
  const no = String(sku ?? '').trim();
  const nm = String(name ?? '').trim();
  if (!no || isCodeLike(no)) return null;

  if (/^[A-Za-z]/.test(no) && isCodeLike(nm)) {
    return { sku: normItemNo(nm), name: cleanWords(no), kind: 'switch' };
  }

  const m = no.match(/^(\d{2,6})(.*)$/);
  if (!m) return null;
  const unst = MARK.test(m[2]);
  const words = cleanWords(m[2].replace(MARK, ' '));
  if (!unst && letters(words) < 2) return null;          // "3297A" stays as it is
  const code = unst ? `${m[1]} (UNST)` : m[1];
  const fromName = cleanWords(nm.replace(MARK, ' ').replace(/\d+/g, ' '));
  const newName = letters(words) ? words : (letters(fromName) ? fromName : code);
  return { sku: code, name: newName, kind: 'split' };
}

/**
 * Apply the rule to one category's items (one file, or one saved day).
 * A fix is NOT applied when its number already belongs to another item in
 * the list with a different name (a clash), unless remembered as 'fix';
 * a remembered 'keep' is never applied. Items are not merged here.
 * @param {Array<{sku, name}>} items
 * @param {string} category  'lehnga' | 'saree'
 * @param {Array<{category, from, to, decision: 'keep'|'fix'}>} rules
 * @returns {{ items: Array, fixes: Array<{key, category, from, to, kind, status, clashWith?}> }}
 */
export function fixItemColumns(items, category, rules = []) {
  const decided = new Map((rules || []).filter(r => r && r.category === category)
    .map(r => [ruleKey(category, r.from, r.to), r.decision]));
  // A day saved after the fix holds "3447" with fixedFrom VELLY; a later
  // "keep" for VELLY → 3447 turns it back, so old days follow the choice.
  const list = (items || []).filter(Boolean).map(i => {
    const f = i.fixedFrom;
    if (!f || decided.get(ruleKey(category, f.sku, i.sku)) !== 'keep') return i;
    const { fixedFrom, ...rest } = i;
    return { ...rest, sku: f.sku, name: f.name };
  });
  const proposals = list.map(i => proposeFix(i.sku, i.name));
  const owners = new Map();   // clean code of an unfixed item → its name
  list.forEach((i, n) => { if (!proposals[n]) owners.set(normItemNo(i.sku).toUpperCase(), i.name); });
  // Two different words sent to one number ("RHEA | 1475" and "ROJA | 1475")
  // are a clash too — never merged without the owner's tick.
  const byTarget = new Map();   // clean target code → names proposed for it
  proposals.forEach(p => { if (p) { const t = normItemNo(p.sku).toUpperCase(); (byTarget.get(t) || byTarget.set(t, []).get(t)).push(p.name); } });

  const fixes = [];
  const out = list.map((i, n) => {
    const p = proposals[n];
    if (!p) return i;
    const key = ruleKey(category, i.sku, p.sku);
    const target = normItemNo(p.sku).toUpperCase();
    const owner = owners.get(target);
    const rival = (byTarget.get(target) || []).find(n => !sameName(n, p.name));
    const clashWith = owner !== undefined && !sameName(owner, p.name) ? owner : rival;
    const clash = clashWith !== undefined;
    const decision = decided.get(key);
    const status = decision === 'keep' ? 'kept' : (clash && decision !== 'fix' ? 'clash' : 'fixed');
    const fix = { key, category, from: { sku: i.sku, name: i.name }, to: { sku: p.sku, name: p.name }, kind: p.kind, status };
    if (clash) fix.clashWith = clashWith;
    fixes.push(fix);
    return status === 'fixed' ? { ...i, sku: p.sku, name: p.name, fixedFrom: { sku: i.sku, name: i.name } } : i;
  });
  return { items: out, fixes };
}

/**
 * Warning rows (BAL PCS mismatches, colour warnings) with the code each row
 * ends up with — exact even when one word carries two products (RHEA →
 * 1454 / 1475): a row is matched by its own ITEM NO + ITEM NAME pair.
 * @param {{ balPcsMismatches?: Array<{sku, name}>, colourErrors?: Array<{skus, items?: Array<{sku, name}>}> }} stats
 * @param {string} category
 * @param {Array<{sku, name}>} items  the file's parsed items (before fixing)
 * @param {Array} rules  the rules in force
 */
export function fixWarningCodes(stats, category, items, rules = []) {
  const applied = new Set(fixItemColumns(items, category, rules).fixes.filter(f => f.status === 'fixed').map(f => f.key));
  const fixedPair = (sku, name) => {
    const p = proposeFix(sku, name);
    return p && applied.has(ruleKey(category, sku, p.sku)) ? p : null;
  };
  const firstTo = new Map();   // older warning rows without pairs: the word's first number
  for (const i of items || []) { const p = fixedPair(i.sku, i.name); if (p && !firstTo.has(i.sku)) firstTo.set(i.sku, p.sku); }
  return {
    ...stats,
    balPcsMismatches: (stats?.balPcsMismatches || []).map(m => {
      const p = fixedPair(m.sku, m.name);
      return p ? { ...m, sku: p.sku, name: p.name } : m;
    }),
    colourErrors: (stats?.colourErrors || []).map(e => ({
      ...e,
      skus: e.items?.length
        ? [...new Set(e.items.map(x => fixedPair(x.sku, x.name)?.sku || x.sku))]
        : (e.skus || []).map(x => firstTo.get(x) || x)
    }))
  };
}

/**
 * The remembered rules after the owner's ticks. Only differences from the
 * default are stored, and the default follows TODAY's clash, not the rule:
 * - ticked:   clash → 'fix'; no clash → no rule (fixing is the default)
 * - unticked: no clash → 'keep'; clash → no rule (not fixing is the default)
 * @param {Array} baseRules  rules before this upload
 * @param {Array} fixes      from fixItemColumns (with baseRules applied)
 * @param {Map<string, boolean>} ticked  fix.key → ticked
 */
export function effectiveRules(baseRules, fixes, ticked) {
  const out = new Map((baseRules || []).map(r => [ruleKey(r.category, r.from, r.to), r]));
  for (const f of fixes || []) {
    if (!ticked?.has(f.key)) continue;
    const on = !!ticked.get(f.key);
    const rule = (decision) => ({ category: f.category, from: up(f.from.sku), to: up(f.to.sku), decision });
    const clash = f.clashWith !== undefined;
    if (on && f.status !== 'fixed') {
      if (clash) out.set(f.key, rule('fix')); else out.delete(f.key);
    } else if (!on && f.status === 'fixed') {
      if (clash) out.delete(f.key); else out.set(f.key, rule('keep'));
    }
  }
  return [...out.values()];
}
