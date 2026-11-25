# Item number / item name fix — design

**Date:** 2026-11-25 · **Branch:** `item-number-fix` · **Owner decisions:** see "Decided with the owner"

## Intent

In the Kuntal stock files (Lehenga Choli and Saree), some rows have the item name in **ITEM NO** and the item number in **ITEM NAME** (`VELLY | 3447`), and a few hold both in one cell (`3144 SANDHYA`). The app saves the word as the item number, so these products never match their Kuntal code (ZM Panel, Myntra, Skip Panel) and they appear in lists under a word.

The owner wants a step in the Upload Center, before the analysis, that puts the number in ITEM NO and the English words in ITEM NAME. Then the files are processed and saved. The same correction applies to stock already saved.

## What the real files show (309 files, 2026)

| Case | Rows | Distinct | Example | Action |
|---|---|---|---|---|
| Right way round | 162,824 | — | `4041 \| AVLON` | none |
| Same number in both cells | 46,850 | — | `3044 \| 3044` | none |
| **Swapped** | 11,297 | 155 products (≈20 lehnga + ≈200 saree rows a day) | `VELLY \| 3447`, `MATHS-3 \| 1300`, `RHEA. \| 1475` | switch |
| **Mixed in one cell** | 469 | 6 patterns, all saree | `3144 SANDHYA`, `3229(UNTS) \| BARSHA(UNTS)` | split |
| No number anywhere | 180 | — | `FREIGHT CHARGE`, `GOA` | none |

- The swaps are consistent: a swapped product is swapped every day. The one exception is saree **1300**, which appears in the same file as `1300 | ROJA` *and* `MATHS-3 | 1300` (a **clash**).
- None of the 6 mixed numbers exists as a separate row on the same day.
- Every saved day already holds the 155 products under the word (code `VELLY`).

## Goals

1. Every upload (both files) gets a **Check item numbers** step after the files are dropped and before Compare. It lists every row the app will fix. All fixes start ticked, so pressing Process fixes everything automatically. Unticking a row keeps it exactly as the file has it.
2. An untick is **remembered**. It applies to future uploads and to old saved data.
3. **Old saved stock is fixed when it is read**: VELLY saved on 20-11 reads as 3447 on every page. The first upload after this ships shows **no** false "sold out" (VELLY) / "new arrival" (3447).
4. New uploads are saved with the fixed item number (document id `3447`).

## Non-goals

- Rewriting stored documents (owner chose "fix when reading"). Raw Firestore records keep the word.
- Fixing rows with no number anywhere, or rows where both cells hold the same number.
- A Settings page for remembered decisions. They are managed in the Upload Center step whenever that product is in the files.
- The PDF → Excel converter output (separate tool).

## Anti-goals (a failure even if it "works")

- Changing a row that was already right.
- Silently merging two different products under one number (the 1300 case).
- Losing the unstitched distinction: `3137 UNST` must stay `3137 (UNST)`, never `3137`.
- False sold-out / new-arrival / sold / restocked on the first upload after the change, or whenever a remembered decision changes.
- A new upload and the read-side fix disagreeing about the same row.

## Decided with the owner

| Question | Answer |
|---|---|
| Fix stock already saved too? | **Yes** |
| Split mixed cells (`3144 SANDHYA`) too? | **Yes** |
| Automatic or approve each? | **Both**: every fix ticked by default; untick to keep as in file |
| Remember an untick? | **Yes**, for future uploads **and** old data |
| Layout | **A**: its own step card (`1 Files → 2 Check item numbers → 3 Compare & review → 4 Save`) |
| How to fix old data | **Fix when reading** (no rewrite) |

## The rule (one function, used by the upload and by every reader)

**Code-like** = 2–6 digits, optional ` M`/`M.`, optional `(UNST)`, optional trailing dot (`3447`, `9551 M`, `4094 (UNST)`).

For an item (`sku` = ITEM NO, `name` = ITEM NAME) in one category of one file / one saved day:

1. **Switch**: ITEM NO starts with a letter and is not code-like, and ITEM NAME is code-like. New ITEM NO is the cleaned ITEM NAME (`normItemNo`, so `9551 M` → `9551`, `(UNST)` kept). New ITEM NAME is the old ITEM NO with trailing dots trimmed (`RHEA.` → `RHEA`).
2. **Split**: ITEM NO starts with 2–6 digits and also has other text (`3144 SANDHYA`, `3538-RASMIKA`, `3186.(UNST)RASHMIKA.`, `3229(UNTS)`, `3137 UNST`).
   - **New ITEM NO** is the number, plus ` (UNST)` if an unstitched marker is present (`UNST`/`UNTS`, with or without brackets).
   - **New ITEM NAME** is the words left in ITEM NO after removing the number, the marker and punctuation.
     - If nothing is left, the words left in ITEM NAME after removing digits, the marker and punctuation (`BARSHA(UNTS)` → `BARSHA`).
     - If still nothing, the new ITEM NO itself.

   Expected:

   | In the file | ITEM NO | ITEM NAME |
   |---|---|---|
   | `1140 ROHINI FENDY` | 1140 | ROHINI FENDY |
   | `3144 SANDHYA` | 3144 | SANDHYA |
   | `3538-RASMIKA \| 3538-3538` | 3538 | RASMIKA |
   | `3186.(UNST)RASHMIKA.` | 3186 (UNST) | RASHMIKA |
   | `3229(UNTS) \| BARSHA(UNTS)` | 3229 (UNST) | BARSHA |
   | `3137 UNST` | 3137 (UNST) | 3137 (UNST) |
3. **Clash**: the new ITEM NO already belongs to another item in the same list (same category, same file or saved day) whose name differs (ignoring case and trailing dots). Then the fix is **not** applied unless the owner ticked it (remembered as "fix"). If the names match, it is the same product and is applied and merged.
4. **Remembered decisions** override the defaults, keyed by category + the original ITEM NO (cleaned, upper case):
   - `keep`: never fix.
   - `fix`: fix even on a clash.
5. Everything else is left exactly as it is.

The function works on **items** (after the parser groups rows), so the upload and the readers share it. Items that end up with the same code are merged by `mergeStockItems`, which already merges colours, locations and level. It returns the fixed items plus a list of fixes: `{ category, from: {sku, name}, to: {sku, name}, kind: 'switch'|'split', status: 'fixed'|'clash'|'kept' }`.

## Upload Center flow (layout A)

1. **Files:** drop the Lehenga Choli and/or Saree file, as today.
2. **Check item numbers** (new card, shown when there is at least one fix, clash or remembered row):
   - The heading reads `N rows to fix · Lehnga a · Saree b`, with chips for Switched / Split / Needs you.
   - Tick all, Untick all, and search by code or name.
   - One line per product per file: tick box · file · "In the file" (struck through when fixed) · "Will save as" · a kind chip.
   - Clash rows start **unticked** with "<number> is already <name> in this file — tick to merge".
   - Remembered keeps start unticked with "Kept as in file (remembered) · Forget". Ticking one is the same as Forget.
   - The Process button reads **Process with N fixes →**.
3. **Compare & review:** the existing review, using the fixed items. Both sides of the comparison (today's file and the previous upload) go through the same rule, so a swapped product compares 3447 with 3447.
4. **Save:** fixed items are saved (document id = fixed code). When the save succeeds, the owner's changes to the defaults are written to the remembered list. A cancelled upload changes nothing.
   - Only differences from the default are stored:
     - an unticked normal fix → `keep`
     - a ticked clash → `fix`
     - ticking a remembered `keep` → that rule is removed
     - unticking a remembered `fix` → that rule is removed
   - After the write, the page forgets its cached reads, so the read-back of the saved day uses the new rules.
   - Rules are only ever written by a successful save. Loading the page or ticking boxes writes nothing.

BAL PCS mismatch rows and colour-error rows show the fixed code.

## Old saved data (fix when reading)

- Every reader of saved stock applies the rule with the remembered list before merging:
  - `stock-store.js`: `loadStockAsOf` and `loadDayChanges`, which feed every page, the ZM Panel, Myntra, Skip Panel and Reports.
  - The two direct readers in `upload.html`: the baseline for the comparison, and the read-back of the day after saving.
- The remembered list is one small Firestore document, `settings/item_fixes` → `{ rules: [{ category, from, decision: 'keep'|'fix' }], updatedAt }`. It is read once per page (memoised like the other stock reads) and is injectable for tests.
- Re-uploading an old date saves fixed codes; `replaceStockData` already removes the stale `VELLY` document.

## Approaches considered

1. **Fix when reading** (chosen): no rewrite, no cost, works on every saved day at once, and is reversible. It costs one small read per page, and raw records keep the word. This matches how `9551 M` = `9551` already works.
2. **One-time rewrite**: a clean database, but tens of thousands of writes over the free daily limit, irreversible, and later remembered changes would not reach old days.
3. **Both**: extra moving parts for no visible gain.

UI options: **A, its own step card** (chosen) vs B, a third tab in the file-check panel (easier to miss).

## Verification

- **Unit:**
  - Each of the 6 split patterns and a sample of the 155 real swaps (`VELLY|3447`, `AAROHI|3296`, `MATHS-3|1300`, `RHEA.|1475`, `AARYA RETURN -2|3431`, `9551 M` names).
  - Untouched: right-way, same-number and no-number rows.
  - The 1300 clash stays unless the remembered decision is `fix`; same-name duplicates merge.
  - `keep` blocks both the upload and the read fix.
  - A stored day with `VELLY` vs a new upload with `3447` gives **no** new arrival or sold out.
  - Unstitched kept separate.
- **Browser (real 20-11 and 21-11 files):**
  - The step lists about 220 rows; untick, re-tick and Forget work.
  - Process counts follow the ticks; the review shows no 155-item false changes.
  - The saved codes are numeric; the remembered list is written only on a successful save.
  - Stock Analysis, the ZM Panel and Myntra show 3447 for VELLY.

## Left to the builder

The module name for the rule (e.g. `js/item-columns.js`), the exact regular expressions (they must pass the table above), how the parser keeps the raw items so ticks can be re-applied without re-reading the file, chip colours (Midnight Zari tokens), and the search behaviour.
