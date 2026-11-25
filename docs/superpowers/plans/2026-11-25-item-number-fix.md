# Item Number / Name Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch swapped (`VELLY | 3447`) and split mixed (`3144 SANDHYA`) item number / name pairs in stock files. This happens in a new Upload Center step before analysis, and when any page reads old saved stock. Owner choices are remembered.

**Architecture:**
- One pure rule module, `js/item-columns.js`, works on parsed items. The parser is unchanged.
- `stock-store.js` applies the rule, with remembered rules from `settings/item_fixes`, to everything it reads.
- `upload.html` gets a "Check item numbers" card (layout A). The card turns ticks into rules, applies them to today's files and to the comparison baseline, and saves the rules only after a successful upload.

**Tech Stack:** Vanilla ES modules, no build; Firestore v10; tests via `node tests/run.mjs` (sandbox with Firebase stubs: `getDoc` → exists false unless `globalThis.__fsExists`, `setDoc` no-op).

**Spec:** `docs/superpowers/specs/2026-11-25-item-number-fix-design.md`

## Global Constraints

- **Code-like:** 2–6 digits, optional ` M`/`M.`, optional `(UNST)`, optional trailing dot. Regex: `/^\d{2,6}(\s*M\.?)?(\s*\(\s*UNST\s*\))?\.?$/i`.
- **Switch only when:** ITEM NO starts with a letter, ITEM NO is not code-like, and ITEM NAME is code-like.
- **Split only when:**
  - ITEM NO starts with 2–6 digits, is not code-like, and holds an unstitched marker (`UNST`/`UNTS`, bracketed or not),
  - or, after removing the number and marker, has 2 or more letters left. So `3297A` is never split.
- **Unstitched marker:** always becomes ` (UNST)` in the item number, never dropped.
- **Clash:** the new code belongs to another unfixed item in the same list with a different name (compared upper case, trailing dots trimmed). Not applied unless the remembered decision is `fix`.
- **Remembered rule key:** `category` + `from` = original ITEM NO cleaned with `normItemNo(...).toUpperCase()`. Decisions are `'keep' | 'fix'`.
- **Storage:** Firestore doc `settings/item_fixes` = `{ rules: [{category, from, decision}], updatedAt }`. It is written only after a successful upload save.
- **Copy:**
  - Card title "Check item numbers".
  - Process button "Process with N fixes →" when N > 0, otherwise "Process Stock".
  - Clash chip: "<code> is already <name> in this file — tick to merge".
  - Kept chip: "Kept as in file (remembered)".
- **Replies, UI text and docs in English.** No owner stock files are committed.
- **Deploy** only from the ZimonZa GitHub account, after the owner says so.

## Review Focus

1. A product the owner unticks today (kept as `VELLY`) must compare with yesterday's saved `VELLY` as the same item: no false new arrival or sold out. → Task 3 test `effectiveRules` + Task 4 harness check.
2. One saved day holding the same product both ways (`3447|VELLY` and `VELLY|3447`) is one item with summed colours, never two. → Task 1 test.
3. A remembered rule for one category never changes the other (lehnga `3044` vs saree `3044`). → Task 1 test.
4. Old saved day with `3144 SANDHYA` vs new upload with `3144`: unchanged, not sold out + new. → Task 2 test.
5. A file with no fixes shows no card and behaves exactly as today. → Task 4 harness check.

---

### Task 1: The rule — `js/item-columns.js`

**Files:**
- Create: `js/item-columns.js`
- Test: `tests/item-columns.test.js`

**Interfaces:**
- Produces:
  - `isCodeLike(v: any): boolean`
  - `proposeFix(sku: string, name: string): { sku, name, kind: 'switch'|'split' } | null`
  - `ruleKey(category: string, sku: string): string`, which returns `${category}|${normItemNo(sku).toUpperCase()}`
  - `fixItemColumns(items: Item[], category: string, rules?: Rule[]): { items: Item[], fixes: Fix[] }`
    - `Fix = { key, category, from: {sku, name}, to: {sku, name}, kind, status: 'fixed'|'clash'|'kept', clashWith?: string }`
    - Returned items keep every other field. Fixed items get the new `sku`/`name`. Items are **not merged**; callers merge.
  - `effectiveRules(baseRules: Rule[], fixes: Fix[], ticked: Map<key, boolean>): Rule[]`. For each fix:
    - ticked + `kept` → remove its `keep` rule
    - unticked + `fixed` (no clash) → add `keep`
    - ticked + `clash` → add `fix`
    - unticked + `clash` with an existing `fix` → remove it

    Other rules are untouched, and no key appears twice.
  - `Rule = { category, from, decision: 'keep'|'fix' }`
- Consumes: `normItemNo` from `./utils.js` only. No Firestore and no stock-store import (stock-store will import this module).

- [ ] **Step 1: Write the failing tests** in `tests/item-columns.test.js` (plain `eq` helper like the other suites):

```js
const it = (sku, name) => ({ sku, name, colors: [{ name: 'Rani', qty: 1 }], totalQty: 1 });
const one = (sku, name, cat = 'saree', rules = []) => fixItemColumns([it(sku, name)], cat, rules);
// switches (real patterns)
for (const [no, nm, code, word] of [['VELLY','3447','3447','VELLY'], ['AAROHI','3296','3296','AAROHI'], ['MATHS-3','1300','1300','MATHS-3'],
  ['RHEA','1475','1475','RHEA'], ['AARYA RETURN -2','3431','3431','AARYA RETURN -2'], ['AVSAR JACQUARD','3226','3226','AVSAR JACQUARD'],
  ['X SILK','9551 M','9551','X SILK'], ['Y','4094 (UNST)','4094 (UNST)','Y']])
  eq(`switch ${no}|${nm}`, [one(no, nm).items[0].sku, one(no, nm).items[0].name, one(no, nm).fixes[0].kind], [code, word, 'switch']);
// splits (the 6 real patterns; sku as the parser stores it, trailing dot already trimmed)
for (const [no, nm, code, word] of [['1140 ROHINI FENDY','1140 ROHINI FENDY','1140','ROHINI FENDY'], ['3144 SANDHYA','3144 SANDHYA','3144','SANDHYA'],
  ['3538-RASMIKA','3538-3538','3538','RASMIKA'], ['3186.(UNST)RASHMIKA','3186.(UNST)RASHMIKA.','3186 (UNST)','RASHMIKA'],
  ['3229(UNTS)','BARSHA(UNTS)','3229 (UNST)','BARSHA'], ['3137 UNST','3137 UNST','3137 (UNST)','3137 (UNST)']])
  eq(`split ${no}`, [one(no, nm).items[0].sku, one(no, nm).items[0].name, one(no, nm).fixes[0].kind], [code, word, 'split']);
// untouched
for (const [no, nm] of [['4041','AVLON'], ['3044','3044'], ['FREIGHT CHARGE','FREIGHT CHARGE'], ['GOA','GOA..'], ['3297A','NAME'], ['9551','SAREE 9551']])
  eq(`untouched ${no}|${nm}`, [one(no, nm).fixes.length, one(no, nm).items[0].sku], [0, no]);
// clash: 1300 is ROJA in the same list
const clash = fixItemColumns([it('1300', 'ROJA'), it('MATHS-3', '1300')], 'saree');
eq('clash not applied', [clash.items.map(i => i.sku), clash.fixes[0].status, clash.fixes[0].clashWith], [['1300', 'MATHS-3'], 'clash', 'ROJA']);
eq('clash applied when remembered fix', fixItemColumns([it('1300','ROJA'), it('MATHS-3','1300')], 'saree', [{ category: 'saree', from: 'MATHS-3', decision: 'fix' }]).items.map(i => i.sku), ['1300', '1300']);
// same product both ways → applied (names match), caller merges
eq('same product both ways', fixItemColumns([it('3447', 'VELLY'), it('VELLY', '3447')], 'saree').fixes[0].status, 'fixed');
// keep, and category scope
eq('keep', [one('VELLY','3447','saree',[{ category:'saree', from:'VELLY', decision:'keep' }]).items[0].sku, one('VELLY','3447','saree',[{ category:'saree', from:'VELLY', decision:'keep' }]).fixes[0].status], ['VELLY','kept']);
eq('rule for lehnga does not touch saree', one('VELLY','3447','saree',[{ category:'lehnga', from:'VELLY', decision:'keep' }]).items[0].sku, '3447');
eq('input items not changed', (() => { const a = [it('VELLY','3447')]; fixItemColumns(a, 'saree'); return a[0].sku; })(), 'VELLY');
// effectiveRules
const fx = fixItemColumns([it('VELLY','3447'), it('1300','ROJA'), it('MATHS-3','1300')], 'saree').fixes;
eq('untick a fix → keep; tick a clash → fix', effectiveRules([], fx, new Map([['saree|VELLY', false], ['saree|MATHS-3', true]])),
  [{ category:'saree', from:'VELLY', decision:'keep' }, { category:'saree', from:'MATHS-3', decision:'fix' }]);
const kept = fixItemColumns([it('VELLY','3447')], 'saree', [{ category:'saree', from:'VELLY', decision:'keep' }]).fixes;
eq('tick a kept one → forget it', effectiveRules([{ category:'saree', from:'VELLY', decision:'keep' }], kept, new Map([['saree|VELLY', true]])), []);
eq('defaults change nothing', effectiveRules([{ category:'lehnga', from:'ASIAN', decision:'keep' }], fx, new Map(fx.map(f => [f.key, f.status === 'fixed']))), [{ category:'lehnga', from:'ASIAN', decision:'keep' }]);
```

- [ ] **Step 2: Run** `node tests/run.mjs item-columns`. Expected: FAIL. The module does not exist.
- [ ] **Step 3: Implement** the five exports in `js/item-columns.js` per Global Constraints. Names come from the leftover words, upper case as written, with spaces collapsed and leading/trailing punctuation trimmed.
- [ ] **Step 4: Run** `node tests/run.mjs`. Expected: `all green — 19 suites`.
- [ ] **Step 5: Commit** `Item columns: switch / split rule for swapped item number and name`.

### Task 2: Old saved stock fixed when read

**Files:**
- Modify: `js/firestore-service.js` (add two functions near `getCustomColours`)
- Modify: `js/stock-store.js` (`loadStockAsOf`, `loadDayChanges`, new exports)
- Test: `tests/stock-match.test.js` (new section)

**Interfaces:**
- Consumes: `fixItemColumns`, `Rule` (Task 1).
- Produces:
  - `getItemFixRules(): Promise<Rule[]>`: reads `settings/item_fixes`; a missing doc gives `[]`.
  - `saveItemFixRules(rules: Rule[]): Promise<void>`: `setDoc` with `{ rules, updatedAt: serverTimestamp() }`.
  - `loadStockAsOf({ ..., getRules = getItemFixRules })` and `loadDayChanges(date, { ..., getRules })` apply `fixItemColumns(list, cat, rules).items` before merging. Rules are read once per page through the existing `remembered()` cache.
  - `loadItemFixRules(getRules = getItemFixRules): Promise<Rule[]>`, cached, for `upload.html`.
  - `fixSavedItems(items: Item[], category: string, rules: Rule[]): Item[]`, which is `mergeStockItems(fixItemColumns(items-with-category, category, rules).items)`.
  - `clearStockCache()` also forgets the rules.

- [ ] **Step 1: Write the failing tests** (new section in `tests/stock-match.test.js`, with injected `listHistory`, `getStock`, `getRules`):
  - Stored 20-11 saree has `VELLY|3447` (Rani 5) and `3144 SANDHYA|3144 SANDHYA` (Pink 2). The 21-11 upload has `3447|VELLY` (Rani 4) and `3144|SANDHYA` (Pink 2).
  - `loadStockAsOf({ asOf: '2026-11-20' })` gives saree skus `['3447', '3144']` and the name of 3447 is `'VELLY'`.
  - `analyzeStockChanges(day.current, day.previous, { categories })` for `loadDayChanges('2026-11-21')` gives `newArrivals` `[]`, `soldOutItems` `[]`, and `soldItems` skus `['3447']`.
  - With `getRules = async () => [{ category:'saree', from:'VELLY', decision:'keep' }]` (after `clearStockCache()`), the 20-11 saree skus include `'VELLY'`.
  - A stored day with both `3447|VELLY` (Rani 1) and `VELLY|3447` (Rani 2) reads as one item `3447` with total 3.
  - The rules are read once across `loadStockAsOf` + `loadDayChanges` (count calls).
- [ ] **Step 2: Run** `node tests/run.mjs stock-match`. Expected: FAIL. The skus are still `VELLY` / `3144 SANDHYA`.
- [ ] **Step 3: Implement** the Interfaces above. In `loadStockAsOf` the `tag()` helper and in `loadDayChanges` the `current`/`previous` lists both pass through `fixItemColumns` before `mergeStockItems`.
- [ ] **Step 4: Run** `node tests/run.mjs`. Expected: all green, 19 suites.
- [ ] **Step 5: Commit** `Old saved stock: swapped / mixed item numbers fixed when read`.

### Task 3: Upload Center — "Check item numbers" step

**Files:**
- Modify: `upload.html`
  - markup: a new card `#item-check` between `#preview-section` and `#process-section`
  - `handleFile`, `updateProcessBtn`, `startProcessing`, `approveAndSave`, `baselineItems`
- Modify: `css/zari.css` (`.ic-*` styles)
- Test: `tests/item-columns.test.js` (`effectiveRules` already covers the tick logic). The UI is checked in Task 4.

**Interfaces:**
- Consumes:
  - `fixItemColumns` and `effectiveRules` (Task 1)
  - `loadItemFixRules`, `fixSavedItems`, `clearStockCache`, `mergeStockItems` (Task 2)
  - `saveItemFixRules` (Task 2)
- Produces (page-internal):
  - `state[cat].raw`: parsed items as read
  - `baseRules`: loaded at page start
  - `ticked: Map<key, boolean>`
  - `currentRules()`: `effectiveRules(baseRules, allFixes(), ticked)`
  - `fixedItems(cat)`: `mergeStockItems(fixItemColumns(state[cat].raw, cat, currentRules()).items)`

- [ ] **Step 1: Card markup and render**
  - The heading reads `Check item numbers`, then `N rows to fix · Lehnga a · Saree b`.
  - Chips show Switched / Split / Needs you.
  - Buttons: Tick all, Untick all; plus a search box by code or name.
  - The table has one line per fix: tick · File · In the file (`from.sku | from.name`, struck through when ticked) · Will save as (`to.sku | to.name`) · chip (Switched / Split / clash chip / kept chip).
  - Default ticks: `fixed` → ticked; `clash` and `kept` → unticked.
  - The card is hidden when there are no fixes.
  - All text goes through `esc()`. Listeners are delegated: no inline handlers (the `escape` suite scans `upload`).
- [ ] **Step 2: Process button.** `updateProcessBtn()` sets the label to `Process with N fixes →` (N = ticked count) or `Process Stock`.
- [ ] **Step 3: Processing uses the fixed items and rules.**
  - `startProcessing` builds `allCurrent` from `fixedItems(cat)` for each uploaded category.
  - `baselineItems(date, cats)` passes each read list through `fixSavedItems(list, cat, currentRules())`.
  - The read-back after saving (`dayL`/`dayS`) does the same.
  - BAL PCS mismatch rows (`sku`) and colour-error rows (`skus[]`): map each code through the applied fixes (`from` → `to`), shown and saved that way.
- [ ] **Step 4: Remember on success.**
  - In `approveAndSave`, after the history write succeeds: if `currentRules()` differs from `baseRules` (compare as JSON sorted by key), call `saveItemFixRules(currentRules())`, set `baseRules` to it, and run `clearStockCache()`.
  - A cancel or failed save writes nothing.
- [ ] **Step 5: Run** `node tests/run.mjs`. Expected: all green, including the `parse` and `escape` checks of `upload`.
- [ ] **Step 6: Commit** `Upload Center: Check item numbers step before processing`.

### Task 4: Real-data check, README, review, deploy

**Files:**
- Modify: `README.md` (section "Item numbers fixed automatically" + Tests line)
- Harness (git-ignored, under `.superpowers/sdd/2026-11-25-item-number-fix/`): login-free page copies with an in-memory fake Firestore. It is seeded by parsing the owner's real 20-11 and 21-11 files with the app's own `parseStockFile` (stored **as parsed today**, i.e. with `VELLY` codes) and includes `getItemFixRules` / `saveItemFixRules` fakes.

- [ ] **Step 1: Browser check of the Upload Center on real files.** Upload 21-11 over stored 20-11. Expected:
  - The card lists the day's fixes: about 155 products, split chips for the mixed patterns, the 1300 clash unticked.
  - The review's new / sold / restocked / sold-out counts equal the Node computation of the same two days with the rule applied to both.
  - No item code in the saved 21-11 data is a word that has a numeric partner.
- [ ] **Step 2: Untick check.** Untick `VELLY`, process and save. Expected:
  - `settings/item_fixes` gets `{ saree, VELLY, keep }` only after the save.
  - The review shows VELLY unchanged, not new or sold out.
- [ ] **Step 3: No-fix check.** A file with no swapped rows shows no card, and the button reads `Process Stock`.
- [ ] **Step 4: Pages check.** Stock Analysis, ZM Panel and Myntra show `3447 · VELLY`; no console errors.
- [ ] **Step 5: README**, then `node tests/run.mjs` green, then commit.
- [ ] **Step 6: Final whole-branch review**, one fix pass, then ask the owner to deploy (ZimonZa account, fast-forward `main`, push, confirm live).
