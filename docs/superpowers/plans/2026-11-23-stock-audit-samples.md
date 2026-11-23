# Stock Matching, Samples, Mapping Delete, Dated Export & Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sarees (and every item) match their Kuntal code everywhere, uploads compare per category, every Excel upload has a downloadable sample, Myntra mappings can be deleted, PDF→Excel exports carry a chosen date, Stock Analysis is easier to read, and every page is audited and fixed.

**Architecture:** One normalisation rule in `normItemNo`, one shared stock model module (`js/stock-store.js`) that every page reads current stock through (per-category latest date, category-keyed merge, clash rule), one sample-file module (`js/sample-files.js`). Pure functions are unit-tested with the Node runner; page wiring is checked on a login-free harness fed with the owner's real stock files.

**Tech Stack:** Vanilla ES modules, SheetJS, Firebase v10 Firestore, `node tests/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-23-stock-audit-samples-design.md`

## Global Constraints

- Replies and all UI copy in English.
- `(UNST)` codes never match their plain code. Only a trailing ` M` / `M.` / `M` after a digit-only code is dropped.
- Lehnga and saree are never merged or compared with each other; keys are `` `${category}|${normItemNo(code).toUpperCase()}` ``.
- Clash with no category chosen → saree stock is used and the row is flagged; never sent to Myntra as 0 because of the clash.
- Each category reads from its own latest upload date.
- Sample files are built on click with SheetJS; name `Sample_<What>.xlsx`; sheet 2 named `How to fill`.
- Every data value interpolated into HTML goes through `esc()`.
- Real stock files at `E:\Work\Zimonza\Zimonza Stock Data` are read locally only, never committed or uploaded.
- Git via `"$S/g.sh"` (`S=/c/Users/royal/AppData/Local/Temp/claude/fcc10b0e0f9209e9/9e79c2fd-cba2-4402-b27e-6836adad37db/scratchpad`), branch `stock-audit-samples`, commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Deploy only from GitHub account ZimonZa after checking credential + remote.

## Review Focus

1. A history doc written before this change (no `lehngaCount`/`sareeCount`) must still count as having both categories → test in Task 2.
2. Re-uploading the same date with fewer items must not leave old item docs behind (they would be added again by the merge) → test in Task 3.
3. A ZM code with two Kuntal codes (stitched + `(UNST)`) keeps resolving to the first that has stock, as today → test in Task 4.
4. A sample file opened and re-uploaded unchanged must parse with zero errors through the real reader → test in Task 5.
5. Deleting a Mapping row that is ticked in the bulk selection removes it from the selection too, so a later bulk action cannot act on a deleted SKU → harness check in Task 6.

---

### Task 1: Item-number suffix rule and parse merge

**Files:** Modify `js/utils.js` (`normItemNo`), `js/excel-parser.js` (`parseStockFile` relies on it). Test: `tests/stock-match.test.js` (new).

**Interfaces:** Produces `normItemNo(s) → string` with the extra rule `/^(\d+)\s*M\.?$/i → '$1'` applied after the existing trim/trailing-dot cleanup.

- [ ] **Step 1: Failing tests:** `normItemNo('9551 M')` → `'9551'`; `'1008 M.'` → `'1008'`; `'9551M'` → `'9551'`; `'3107(UNST)'` → `'3107(UNST)'`; `'M'` → `'M'`; `'3121.'` → `'3121'`; `'REYMOND M'` → `'REYMOND M'`. `parseStockFile` on rows with header `ITEM NO, ITEM NAME, SUB LOCATION, COLOR, READY STOCK, SALES PCS, BAL PCS` and rows `['1121','A','MAIN GODOWN','(Rani * 2 )',2,0,2]`, `['1121 M','A','MAIN GODOWN','(Rani * 1 )( Pista * 3 )',4,0,4]` → one item, `sku` `'1121'`, colours Rani 3 / Pista 3, `totalQty` 6.
- [ ] **Step 2:** `node tests/run.mjs stock-match` → FAIL.
- [ ] **Step 3:** Implement the rule in `normItemNo`; confirm the parser's per-SKU merge sums colours (fix it if it overwrites).
- [ ] **Step 4:** `node tests/run.mjs` → all green.
- [ ] **Step 5:** Commit `Stock: an item number ending in " M" is the same product as the plain code`.

### Task 2: Shared stock model

**Files:** Create `js/stock-store.js`. Modify `js/stock-analyzer.js` (`analyzeStockChanges`). Test: `tests/stock-match.test.js`.

**Interfaces:**
- `stockKey(category, code) → string` — `` `${category}|${normItemNo(code).toUpperCase()}` ``.
- `mergeStockItems(items) → items` — groups by `stockKey(item.category, item.sku)`, sums colour qty by `normColorKey`, recomputes `totalQty`, keeps the first item's other fields with `sku` = normalised code.
- `indexStock({ lehnga: items, saree: items }) → { lehnga: Map<code, item>, saree: Map<code, item> }` (code = `normItemNo(sku).toUpperCase()`, merged).
- `lookupKuntal(code, category, index) → { stock, category, clash, both }` — category given → that map only; else found in one map → that one; found in both → `clash: true`, `stock` = saree item, `both: { lehnga, saree }`.
- `latestPerCategory(history) → { lehnga: date|null, saree: date|null }` — `history` = `[{ date, lehngaCount, sareeCount }]`; a doc with neither count field counts as both.
- `loadLatestStock({ listHistory, getStock } = defaults) → { lehnga: { date, items }, saree: { date, items } }` (Firestore defaults: history collection docs, `getStockData`).
- `analyzeStockChanges(current, previous, { categories } = {})` — compares per category, only for `categories` (default: categories present in `current`), both sides passed through `mergeStockItems`, keys by `stockKey`. Output shape unchanged.

- [ ] **Step 1: Failing tests:** `mergeStockItems` of stored lehnga `7002` and saree `7002 M` → two items; of saree `9551 M` + `9551` → one, quantities summed. `lookupKuntal('3044', '', idx)` where both maps hold 3044 → `clash` true, `stock.category` `'saree'`; with `'lehnga'` → lehnga item, `clash` false; `'4132'` only in lehnga → lehnga, `clash` false; missing → `stock` null. `latestPerCategory([{date:'2026-11-21', lehngaCount:358, sareeCount:0}, {date:'2026-11-20', lehngaCount:350, sareeCount:780}])` → `{ lehnga: '2026-11-21', saree: '2026-11-20' }`; a doc `{date:'2026-11-19'}` alone → both `'2026-11-19'` (Review Focus 1). `analyzeStockChanges(lehngaOnlyToday, yesterdayBoth)` → no saree item in `soldOutItems`; saree `9551 M` yesterday vs `9551` today with same colours → unchanged, not New + Sold Out.
- [ ] **Step 2:** `node tests/run.mjs stock-match` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node tests/run.mjs` → green (update any existing analyzer test that relied on cross-category behaviour; ledger it).
- [ ] **Step 5:** Commit `Stock: one shared model — per-category latest date, category-keyed merge, clash rule`.

### Task 3: Upload Center — per-category compare, replace on re-upload, history merge

**Files:** Modify `upload.html` (process + `approveAndSave`), `js/firestore-service.js` (`replaceStockData`). Test: `tests/stock-match.test.js`.

**Interfaces:** `staleStockIds(existingIds: string[], items) → string[]` (ids not among `String(item.sku)`), pure; `replaceStockData(date, category, items)` = write items + delete `staleStockIds`.

- [ ] **Step 1: Failing test:** `staleStockIds(['9551 M','4132','1121'], [{sku:'9551'},{sku:'4132'}])` → `['9551 M','1121']` (Review Focus 2).
- [ ] **Step 2:** FAIL → implement → green.
- [ ] **Step 3:** `upload.html`: one file missing → amber warning in the review panel `"<Saree|Lehnga> file not added — only <lehnga|saree> is compared and saved today."`; baseline per category = `latestPerCategory` over dates `< uploadDate`; compare with `analyzeStockChanges(current, prev, { categories: uploaded })`; save with `replaceStockData`; after save, read back both categories of `uploadDate` and compute the summary over categories that have data that day, each vs its own baseline; history writes `lehngaCount`/`sareeCount` only for uploaded categories (merge), totals recomputed from what is stored for that date.
- [ ] **Step 4:** Harness (Task 9 harness) upload 20-11 then 21-11 real files: counts match a direct comparison computed in Node from the same files; lehnga-only upload marks no saree sold out.
- [ ] **Step 5:** Commit `Upload Center: compare each category with its own last upload; re-upload replaces`.

### Task 4: ZM category, clash flag, and every reader on the shared model

**Files:** Modify `js/excel-parser.js` (`parseZMFile` optional 3rd column `Category`), `js/firestore-service.js` (`saveZMMapping` writes `category` only when given — merge), `js/zm-mapper.js`, `zm-panel.html` (Category select in the edit modal, clash badge + both stocks), `js/myntra.js` (`loadMyntraStockContext`, `resolveStock`), `myntra.html` (Mapping clash chip), and readers of latest stock: `low-stock.html`, `sold-out.html`, `stock-analysis.html`, `js/skip-manager.js`, `js/dashboard.js` (plus any other found by `grep "dates\[0\]\|getStockData"`). Tests: `tests/stock-match.test.js`, `tests/core.test.js`.

**Interfaces:** ZM mapping record `{ zmCode, kuntalCode, category: 'lehnga'|'saree'|'' }`. Myntra ctx `{ latestDate, dates: { lehnga, saree }, index, zmToKuntal: Map<zm, Array<{ kuntalCode, category }>> }`; `resolveStock(zmCode, ctx) → { stock, kuntalCode, reason, clash }`.

- [ ] **Step 1: Failing tests:** `parseZMFile([['Zimonza Product Code','Kuntal Product Code','Category'],['ZM-38','9551','Saree'],['ZM-32','3044','']])` → `[{zmCode:'ZM-38',kuntalCode:'9551',category:'saree'},{zmCode:'ZM-32',kuntalCode:'3044',category:''}]`; 2-column file → `category: ''`. `resolveStock('ZM-38', ctx)` with saree `9551 M` stored → stock found, `kuntalCode '9551'`; ZM-32 with 3044 in both, no category → `clash` true, saree stock; category `'lehnga'` → lehnga stock; ZM with `['3107','3107(UNST)']` where only `3107(UNST)` stocked → finds `3107(UNST)` (Review Focus 3).
- [ ] **Step 2:** FAIL → implement data side → green.
- [ ] **Step 3:** UI: ZM Panel row badge `In both files — choose` + edit-modal Category select saving via `saveZMMapping([{ zmCode, kuntalCode, category }])`; Myntra Mapping status chip `Lehnga/Saree not chosen` for clash rows. All listed pages read via `loadLatestStock()`; each page shows its date(s) ("Lehnga 21/11 · Saree 21/11").
- [ ] **Step 4:** `node tests/run.mjs` green; harness: ZM-38 shows saree stock from the real 21-11 file; ZM-32 shows the clash badge.
- [ ] **Step 5:** Commit `ZM Panel + Myntra: sarees found by Kuntal code; choose a category when a code is in both files`.

### Task 5: Sample files

**Files:** Create `js/sample-files.js`; modify `upload.html`, `zm-panel.html`, `settings.html`, `myntra.html` (inventory, mapping, pricing, returns drops). Test: `tests/sample-files.test.js`.

**Interfaces:** `SAMPLES: Record<key, { fileName, headers: string[], rows: any[][], help: Array<[column, 'Required'|'Optional', what, example]> }>` with keys `lehnga`, `saree`, `zm`, `colours`, `myntraInventory`, `myntraMapping`, `myntraPricing`, `myntraReturns`; `sampleSheets(key) → { data: any[][], help: any[][] }` (pure, no XLSX); `downloadSample(key)` builds the workbook from `sampleSheets` with the page's global `XLSX`. Headings/required columns exactly as the spec table.

- [ ] **Step 1: Failing test:** for each key, `sampleSheets(key).data` fed to the page's own reader: `parseStockFile(rows,'lehnga'|'saree')` 2 items, 0 colour errors; `parseZMFile` 2 mappings; colour list 2 names; `parseInventoryFile` 2 SKUs; `parseMyntraMappingFile` 2 mappings 0 invalid; `parsePricingFile` 2 rows; `parseReturnsFile` 2 rows (Review Focus 4). `sampleSheets(key).help` has a header row plus one row per data header.
- [ ] **Step 2:** FAIL → implement → green.
- [ ] **Step 3:** A link `⤓ Download sample` under each drop zone text (`data-sample="<key>"`, click stops propagation so it doesn't open the file picker).
- [ ] **Step 4:** Harness: each link downloads a file named `Sample_<What>.xlsx`.
- [ ] **Step 5:** Commit `Every Excel upload has a Download sample with headings and a How to fill sheet`.

### Task 6: Myntra Mapping delete

**Files:** Modify `js/firestore-service.js` (`deleteMyntraMappings(sellerSkuCodes) → Promise<number>`, ids `String(sku).replace(/\//g,'_')`), `myntra.html` (row bin button, "Delete selected" in `map-bulkbar`). Test: `tests/bill-store.test.js` style stub test in `tests/mapping-delete.test.js`.

- [ ] **Step 1: Failing test:** with the runner's batch stub recording deletes, `deleteMyntraMappings(['ZM-1-Red','ZM-2/Blue'])` deletes ids `['ZM-1-Red','ZM-2_Blue']`, returns 2; empty list → 0, no write.
- [ ] **Step 2:** FAIL → implement (extend the runner's `writeBatch` stub to record `delete` refs) → green.
- [ ] **Step 3:** UI: confirm text `Delete mapping <SKU>?` / `Delete <N> selected mapping(s)? This cannot be undone.`; after delete: remove from `state.mappings`, from `mapSelection` (Review Focus 5), re-render, toast `N mapping(s) deleted`.
- [ ] **Step 4:** Harness check: single delete, select-all-shown delete, selection count resets.
- [ ] **Step 5:** Commit `Myntra Mapping: delete one or many mappings`.

### Task 7: PDF → Excel dated export

**Files:** Modify `pdf-to-excel.html` (date input `#pdf-stock-date`, default today, `max` today), `js/pdf-to-excel.js` (pure helper). Test: `tests/core.test.js`.

**Interfaces:** `datedExportName(base, isoDate, ext, page = null) → string` — `Saree` + `2026-11-21` + `xlsx` → `Saree_21-11-2026.xlsx`; with page 3 + `csv` → `Saree_21-11-2026-page3.csv`; blank date → today's local date.

- [ ] **Step 1:** Failing tests for the three cases → FAIL → implement → green.
- [ ] **Step 2:** Both export buttons use it; the date box sits beside the upload with label `Stock date`.
- [ ] **Step 3:** Commit `PDF → Excel: pick the stock date; exports are named with it`.

### Task 8: Stock Analysis — tabs, pages, change column, links

**Files:** Modify `stock-analysis.html` (+ `js/filters.js` if pagination helper lives there). Test: `tests/stock-match.test.js`.

**Interfaces:** `changeSinceLast(currentItems, previousItems) → Map<stockKey, number>` (current total − previous total; new item → +total).

- [ ] **Step 1:** Failing test: saree `9551` 6 pcs today vs `9551 M` 8 yesterday → `-2`; new item → `+N`.
- [ ] **Step 2:** FAIL → implement → green.
- [ ] **Step 3:** UI: tabs `All · Lehnga · Saree` with counts; 50 rows per page with Prev/Next and "Showing 1–50 of 789"; column `Change` (green +, red −, `new`); a row of links to `low-stock.html`, `sold-items.html`, `restocked.html`, `sold-out.html`; previous date read per category.
- [ ] **Step 4:** Harness on real files: tab counts equal parsed item counts; page 2 starts at row 51.
- [ ] **Step 5:** Commit `Stock Analysis: category tabs, 50 per page, change since last upload, quick links`.

### Task 9: Full audit on real data

**Files:** findings decide; harness in the gitignored workspace.

- [ ] **Step 1:** Harness: login-free copies of every page (import map swaps `js/auth.js` and `js/firestore-service.js` for an in-memory fake seeded by parsing the real 20-11 and 21-11-2026 files + `Zimonza-Kuntal Product Code.xlsx` through the app's own readers).
- [ ] **Step 2:** For each page — Dashboard, Upload Center, Stock Analysis, Low Stock, New Arrivals, Sold Items, Restocked, Sold Out, Skip Panel, History, Reports, Settings, ZM Panel, PDF → Excel, Myntra, Login, Index: no console errors; every nav/link target exists; figures checked against a Node computation from the same files (totals, low-stock list = colours with 1–2 pcs per Settings thresholds, sold/restocked counts).
- [ ] **Step 3:** Each defect: failing test (unit or harness) → fix → green → commit `<Page>: <what was wrong>`. Anything beyond a contained fix → ask the owner.

### Task 10: README, review, deploy

- [ ] **Step 1:** README: " M" rule, per-category latest, ZM Category, sample files, mapping delete, dated export, Stock Analysis changes.
- [ ] **Step 2:** `node tests/run.mjs` green; commit.
- [ ] **Step 3:** Final whole-branch review, one fix pass.
- [ ] **Step 4:** Check `cmdkey /list` → only `ZimonZa`; remote `https://github.com/ZimonZa/zimonza-daily-stock-update.git`; fast-forward `main`, push, wait for Pages, confirm live pages load without errors.
