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
/** Unstitched marker, bracketed or bare; "UNTS" is a typo for it. */
const MARK = /\(?\s*\bUN(?:ST|TS)\b\s*\)?/i;

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
  const list = (items || []).filter(Boolean);
  const proposals = list.map(i => proposeFix(i.sku, i.name));
  const owners = new Map();   // clean code of an unfixed item → its name
  list.forEach((i, n) => { if (!proposals[n]) owners.set(normItemNo(i.sku).toUpperCase(), i.name); });
  const decided = new Map((rules || []).filter(r => r && r.category === category)
    .map(r => [ruleKey(category, r.from, r.to), r.decision]));

  const fixes = [];
  const out = list.map((i, n) => {
    const p = proposals[n];
    if (!p) return i;
    const key = ruleKey(category, i.sku, p.sku);
    const owner = owners.get(normItemNo(p.sku).toUpperCase());
    const clash = owner !== undefined && !sameName(owner, p.name);
    const decision = decided.get(key);
    const status = decision === 'keep' ? 'kept' : (clash && decision !== 'fix' ? 'clash' : 'fixed');
    const fix = { key, category, from: { sku: i.sku, name: i.name }, to: { sku: p.sku, name: p.name }, kind: p.kind, status };
    if (clash) fix.clashWith = owner;
    fixes.push(fix);
    return status === 'fixed' ? { ...i, sku: p.sku, name: p.name } : i;
  });
  return { items: out, fixes };
}

/**
 * The remembered rules after the owner's ticks. Only differences from the
 * default are stored: an unticked fix → 'keep'; a ticked clash → 'fix';
 * ticking a kept one, or unticking a remembered clash fix, forgets the rule.
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
    if (f.status === 'kept' && on) out.delete(f.key);
    else if (f.status === 'clash' && on) out.set(f.key, rule('fix'));
    else if (f.status === 'fixed' && !on) {
      if (out.get(f.key)?.decision === 'fix') out.delete(f.key);
      else out.set(f.key, rule('keep'));
    }
  }
  return [...out.values()];
}
