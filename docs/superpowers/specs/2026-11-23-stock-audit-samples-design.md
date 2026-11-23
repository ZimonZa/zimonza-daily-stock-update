# Stock matching fix · Sample files · Mapping delete · Dated PDF export · Full audit

Owner decisions are marked **(owner)**; the rest are the builder's calls, marked *(my call)*.

## Context

The owner (2026-11-23) asked for: a full check of Dashboard, Upload Center, Stock Analysis, Low Stock, ZM Panel and all other pages, fixing any bugs; a date picker on the PDF → Excel stock export; a "Download sample" file on every Excel upload; select-all and single delete in Myntra Mapping; a sample file for Pricing; and the ZM Panel to find sarees for their Kuntal codes. Replies in English.

The owner uploads **both** the lehnga and the saree file every day **(owner)**.

### Root cause found (ZM Panel / sarees)
Checked against the real files in `E:\Work\Zimonza\Zimonza Stock Data` (latest 21-11-2026) and `Zimonza-Kuntal Product Code.xlsx` (79 ZM codes):
- Saree item numbers often end in **" M"** or **"M."** — 247 + 15 rows on 21-11-2026 (e.g. `9551 M`). The app keys stock by `normItemNo`, which keeps the suffix, so ZM-38 = `9551` never finds `9551 M`. **" M" / "M." is the same product as the plain code (owner).**
- On 10 days across 153 saved saree files, a code appears both plain and with " M" the same day (21-11-2026: `1121` and `1121 M`). *(my call)* Being the same product, their colour quantities are **added**.
- `3107(UNST)` is an unstitched blouse and **must stay separate** from `3107` **(owner)** — today's `normItemNo` behaviour, unchanged.
- 12 other unmatched codes (4113, 4138, 4086, 1269, 2888, 2935, 2937, 2950, 2969, 3026, 3134, 3109) are not in either file that day — correctly "no stock".

### Second bug found (Upload Center)
`analyzeStockChanges` compares today's items with **all** items of the previous date. Uploading only one category marks every item of the other category **Sold Out**, which then feeds Sold Out, Dashboard, History and the daily summary. Also `saveStockData` only writes — items removed from a re-uploaded file for the same date stay stored.

## 1. Stock matching

- `normItemNo(s)` (js/utils.js) additionally drops a trailing ` M` / `M.` / `M` after a digit-only code: `/^(\d+)\s*M\.?$/i → $1`. `(UNST)` and any other text are untouched. Because every reader already joins through `normItemNo` (parser, ZM mapper, Myntra `resolveStock`, returns, purchase), one change fixes the lookup everywhere.
- **Parsing** (`parseStockFile`): rows whose normalised code is equal merge into one item — colour quantities summed (the parser already merges rows per SKU; the new key makes `1121` and `1121 M` one SKU). Stored SKU becomes the plain code.
- **Old stored data** still holds `9551 M` docs: every place that builds a map from stored items keys it by **category + code** — `${category}|${normItemNo(sku).toUpperCase()}` — and merges duplicates **within a category only** (sum colours) via one shared helper `mergeStockItems(items) → items` in `js/stock-analyzer.js`. Lehnga and saree are never merged with each other, and the day-to-day comparison is per category (lehnga `7002` vs saree `7002 M` are different products). Used by: `analyzeStockChanges` (both sides), `loadZMPanelData`, `loadMyntraStockContext`, Stock Analysis, Low Stock, Sold Out and any other reader found in the audit.

### A Kuntal code in both files **(owner: decide per ZM code)**
On 21-11-2026, `3044` (ZM-32) is in the lehnga file and `3044.` in the saree file; 7002, 7007, 7008, 7010, 7014, 8003 clash once " M" is dropped; today the saree wins only because it is loaded second.
- Each ZM mapping gets an optional **Category** (`lehnga` | `saree` | blank). Set it in the ZM Panel (row edit) or with an optional third column `Category` in the ZM upload file; a file without the column leaves saved categories untouched.
- Lookup rule (ZM Panel, Myntra `resolveStock`, Purchase/Returns lookups): category set → that file only; blank and the code is in one file → that one; blank and the code is in **both** → flagged **"In both files — choose Lehnga or Saree"** in the ZM Panel (both stocks shown) and in Myntra Mapping. *(my call)* Until chosen, the saree stock is used (today's behaviour), so live Myntra listings are not suddenly sent as 0.
- **Re-upload of a date replaces** that date's category: `saveStockData` deletes docs of that date+category whose id is not in the new item list (`replaceStockData(date, category, items)`), so stale or old-suffix docs cannot double count.

## 2. Upload Center safety
- *(my call)* If only one of the two files is chosen, the review step shows a warning ("Saree file missing — only lehnga will be compared and saved") and the comparison runs **per uploaded category only**: previous items of a category not uploaded today are not compared (never Sold Out). `analyzeStockChanges(current, previous, { categories })`.
- *(my call)* **Each category has its own "latest".** Comparison baseline = the last earlier date that has **that category** (from history `lehngaCount` / `sareeCount` > 0). Every page that shows current stock (ZM Panel, Myntra, Low Stock, Stock Analysis, Skip Panel, Dashboard, Sold Out, …) reads each category from its own latest date through one shared `loadLatestStock()` → `{ lehnga: { date, items }, saree: { date, items } }`, so a lehnga-only day never makes sarees look missing or sends them to Myntra as 0.
- *(my call)* History and daily summary for a date: uploading one category later the same day updates only that category's counts; the other category's counts from earlier that day stay (no carry-forward from previous dates).

## 3. Sample files (Approach A, **owner**)
A **"Download sample"** link (icon + text) next to each Excel upload. Clicking builds an `.xlsx` in the browser with SheetJS (already loaded on every page involved): sheet 1 = exact headings + 2 example rows; sheet 2 **"How to fill"** = one row per column: column name, required/optional, what to put, example. File name `Sample_<What>.xlsx`. One shared module `js/sample-files.js`: `SAMPLES` definitions + `downloadSample(key)`.

| Upload | Headings (sheet 1) | Required |
|---|---|---|
| Upload Center — Lehnga, Saree | ITEM NO, ITEM NAME, SUB LOCATION, COLOR, READY STOCK, SALES PCS, BAL PCS | ITEM NO, SUB LOCATION (one of SALES STUDIO / MAIN GODOWN / MAIN GODOWN STUDIO / WAREHOUSE), COLOR as `(Red * 2 )( Blue * 1 )`, BAL PCS |
| ZM Panel | Zimonza Product Code, Kuntal Product Code, Category | first two; Category optional (Lehnga / Saree) |
| Settings — colour list | Colour | Colour (column A) |
| Myntra — Inventory update | sellerSkuCode, quantity | sellerSkuCode |
| Myntra — Mapping | Style Id, Article Type, Colour, SellerSkuCode | SellerSkuCode as `ZM-<n>-<Colour>` |
| Myntra — Pricing | ZM Code, Kuntal Code, Category, Kuntal Selling Price, Myntra MRP, Myntra MU Price, Myntra ISP | ZM Code, Kuntal Selling Price |
| Myntra — Returns & RTO | Type, SellerSkuCode, ZM Code, Kuntal Code, Colour, Qty, Date, Condition, Reason, Notes | Type, SellerSkuCode, Qty *(my call: the returns reader skips rows without SellerSkuCode, so the sample says it is required)* |

(8 uploads. Label PDFs and the PDF tools take files from Myntra / the ERP — no sample.) A test reads each generated sample back through the app's own parser and expects the example rows to parse cleanly.

## 4. Myntra Mapping delete
- Bin icon per row → `confirm('Delete mapping <SKU>?')`; "Delete selected" in the existing bulk bar → `confirm('Delete N mappings?')`. Works with the existing "select all shown".
- New `deleteMyntraMappings(sellerSkuCodes)` (doc id = SKU with `/` → `_`). *(my call)* The SKU's Live/Deactivated status doc is left as is (harmless; reused if the SKU is uploaded again). A deleted SKU no longer appears in Generate from Mapping.

## 5. PDF → Excel dated export
- A **Stock date** input next to the PDF upload (defaults to today, any past date allowed). Exports are named `<PDF file name>_<DD-MM-YYYY>.xlsx` and `<PDF file name>_<DD-MM-YYYY>-page<N>.csv`.
- Changing the date after converting renames the next export; nothing else changes.

## 6. Stock Analysis improvements *(owner agreed to proposal)*
- Lehnga / Saree / All tabs; pages of 50 rows with page controls; a **Change since last upload** column (+/− pcs, from the previous upload date); quick links to Low Stock, Sold Items, Restocked, Sold Out.

## 7. Full audit
Every page: Dashboard, Upload Center, Stock Analysis, Low Stock, New Arrivals, Sold Items, Restocked, Sold Out, Skip Panel, History, Reports, Settings, ZM Panel, PDF → Excel, Myntra, Login/Index. For each: page loads with no console errors on the login-free harness using **real** stock files (20 and 21-11-2026 parsed into the fake store), figures cross-checked against a hand count from the files, links/nav go where they should, Low Stock threshold behaviour (1–2 pcs per settings) verified. Each defect: failing test (unit where logic, harness where page wiring) → fix → green. Findings listed for the owner; anything larger than a contained fix is asked first.

## Non-goals
- No change to how Myntra label PDFs are read.
- No visual redesign beyond Stock Analysis tabs/pagination.

## Deploy
Push `main` from GitHub account **ZimonZa** only, after confirming the stored credential and remote, as before.

## Verification
`node tests/run.mjs` green with new tests: `normItemNo` suffix rule (9551 M, 1008 M., 9551M → plain; 3107(UNST) unchanged; "M" alone unchanged), parse merge of `1121` + `1121 M`, `mergeStockItems`, per-category comparison (only-lehnga upload marks no saree Sold Out), stale-doc replacement, each sample re-parsed by its reader, mapping delete, dated export names. Harness passes on real files; ZM-38 shows `9551` saree stock.
