# Myntra Pricing Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deactivated SKUs go out as quantity 0, the Pricing tab is editable cell-by-cell and in bulk with prices following everywhere, a saved bill number adds lines instead of overwriting, the Purchase flow is audited, and the app is deployed from the ZimonZa account.

**Architecture:** Same build-less ES-module app. New logic lands as pure exported functions next to the code that uses them (`js/myntra.js`, `js/myntra-pricing.js`, `js/myntra-purchase.js`) and is driven by the Node runner; DOM wiring stays in the tab modules and `myntra.html`.

**Tech Stack:** Vanilla JS ES modules, Tailwind CDN, SheetJS, jsPDF, Firebase v10 Firestore, `node tests/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-19-myntra-pricing-edit-design.md`

## Global Constraints

- No build step, no new dependencies.
- Every value from data interpolated into HTML goes through `esc()`.
- A blank price is `null`, never 0.
- ZM Code is not editable in place; it is the pricing doc id (`normZmCode`).
- Saved bills are never altered except by an owner-confirmed same-number append.
- Deploy only from GitHub account **ZimonZa** to `https://github.com/ZimonZa/zimonza-daily-stock-update.git`; if the stored credential or remote differs, stop and ask.
- Git through `"$S/g.sh"` with `S=/c/Users/royal/AppData/Local/Temp/claude/fcc10b0e0f9209e9/9e79c2fd-cba2-4402-b27e-6836adad37db/scratchpad` (adds safe.directory, author `banny368`, autocrlf off). Branch `myntra-pricing-edit`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test style: `eq(name, got, want)` / `ok(name, cond)`, print `N passed, M failed`, exit non-zero on failure.

## Review Focus

1. Bulk edit with a filter active and "Select all filtered" must change only the rows shown → `applyBulkEdit` test with a partial selection set (Task 2).
2. Same-number append onto a partly received bill keeps receipts, so the extra pieces show as outstanding → `shortfallOf(merged)` test (Task 5).
3. A deactivated SKU that also has Returns & RTO stock still goes out as 0, not the returns count → test (Task 1).
4. A typed bill number differing only in case or spaces (`' inv/26-27/0042 '`) finds the saved bill rather than creating a second one → `findSavedBill` test (Task 5).
5. A cart line whose rate was typed by hand keeps it when pricing changes, while an untouched line follows → `refreshCartPrices` test (Task 4).

---

### Task 1: Deactivated SKUs exported as quantity 0

**Files:** Modify `js/myntra.js` (`NON_EXPORT_STATUSES`, inactive branch of `generateInventoryUpdate`), `myntra.html` (`STATUS_CHIPS.inactive` label, `runGeneration` toast, the Mapping Live-toggle title, generator help text "Deactivated SKUs are excluded from the download", the inventory row lock). Test: `tests/core.test.js:129-133`.

**Interfaces:** Produces `isExportable(row)` true for `inactive`, false only for `duplicate`; inactive rows always `quantity: 0`.

- [ ] **Step 1: Failing test.** Replace the assertion at `core.test.js:133` with: exported SKUs → `['ZM-1-Morpichh', 'ZM-2-Rani']`; inactive row `quantity` → `0`; duplicate not exported. Add: `generateInventoryUpdate(['ZM-2-Rani'], ctx, gap, 50, { inactiveSkus: new Set(['zm-2-rani']), returnStock: new Map([['ZM-2|rani', { total: 3 }]]) })` → row `quantity` 0, `returnBoost` 0 (Review Focus 3).
- [ ] **Step 2:** `node tests/run.mjs core` → FAIL.
- [ ] **Step 3:** `NON_EXPORT_STATUSES = new Set(['duplicate'])`; inactive rows carry `quantity: 0, returnBoost: 0`. In `myntra.html` the quantity input is disabled when `r.status === 'inactive' || !isExportable(r)`, and the edit handler ignores inactive rows. Copy: chip `Deactivated → 0`; toast `, N deactivated SKU(s) sent as 0`; toggle title `Deactivated — sent to Myntra as 0`; help text `Deactivated SKUs are sent as 0.`
- [ ] **Step 4:** `node tests/run.mjs` → all green.
- [ ] **Step 5:** Commit `Inventory: deactivated SKUs are sent to Myntra as 0`.

### Task 2: Pricing edit logic (pure) + delete in Firestore

**Files:** Modify `js/myntra-pricing.js`, `js/firestore-service.js` (add `deleteMyntraPricing`). Create `tests/pricing-edit.test.js`.

**Interfaces:**
- `EDIT_COLUMNS = ['kuntalCode','category','kuntalSellingPrice','myntraMrp','myntraMuPrice','myntraIsp']`; `PRICE_COLUMNS` = the last four.
- `validatePriceCell(column, raw) → { value, error }` — price columns via `toNum`: `''` → `null`; non-numeric or `< 0` → error `'Enter a number 0 or more'`; `kuntalCode` trimmed; `category` trimmed, lower-cased.
- `applyBulkEdit(rows, zmSet, column, action, amount) → rows` (new array). `action ∈ 'set'|'pct_up'|'pct_down'|'add'|'sub'`; text columns accept only `'set'`. Price results floor at 0, round to whole rupees, except `myntraMuPrice` → `round2`. A `null` price stays `null` under every action but `'set'`. Rows not in `zmSet` are returned unchanged.
- `pendingChanges(saved, edited) → { upserts: rows, deletes: zmCodes }` compared on `EDIT_COLUMNS` by `normZmCode`.
- `deleteMyntraPricing(zmCodes: string[]) → Promise<number>` (chunked batch delete of `COLLECTIONS.MYNTRA_PRICING/<normZmCode>`).

- [ ] **Step 1: Failing tests** (`tests/pricing-edit.test.js`):
  - `validatePriceCell('myntraIsp','13,849')` → `{ value: 13849, error: '' }`; `('myntraMrp','')` → `{ value: null, error: '' }`; `('kuntalSellingPrice','-5')` and `('kuntalSellingPrice','abc')` → error `'Enter a number 0 or more'`; `('category',' Lehnga ')` → `'lehnga'`.
  - Rows A `{zmCode:'ZM-43', kuntalSellingPrice:8990, myntraIsp:13849, myntraMuPrice:13830.76923, myntraMrp:null, category:'lehnga'}`, B `{zmCode:'ZM-49', kuntalSellingPrice:6450, ...}`.
  - `applyBulkEdit([A,B], new Set(['ZM-43']), 'myntraIsp', 'pct_up', 10)` → A ISP `15234`, B unchanged (Review Focus 1).
  - `pct_down 10` on KSP → `8091`; `sub 20000` → `0`; `add 100` on MRP `null` → `null`; `set 9999` on MRP → `9999`; `pct_up 10` on MU → `15213.85`; `('category','set','Saree')` → `'saree'`; `('category','pct_up',10)` → rows unchanged.
  - `pendingChanges([A,B], [A', C])` where `A'` has ISP 15234 and C is new `ZM-7` → `upserts` zmCodes `['ZM-43','ZM-7']`, `deletes` `['ZM-49']`; identical lists → `{ upserts: [], deletes: [] }`.
- [ ] **Step 2:** `node tests/run.mjs pricing-edit` → FAIL (exports missing).
- [ ] **Step 3:** Implement the four functions + `deleteMyntraPricing`.
- [ ] **Step 4:** `node tests/run.mjs` → all green.
- [ ] **Step 5:** Commit `Pricing: edit, bulk-edit and change-set logic`.

### Task 3: Pricing grid UI

**Files:** Modify `js/myntra-pricing.js` (`render`, new edit state), `myntra.html` (Pricing card: bulk bar + pending bar markup above `#price-table`; `beforeunload`), `css/zari.css` (`.pr-cell`, `.pr-dirty`, `.pr-bad`, `.pr-del`).

**Interfaces:** Consumes Task 2. Produces `initPricingTab(state).hasPendingChanges(): boolean`.

- [ ] **Step 1:** Edit state `draft` = deep copy of `state.pricing`, plus `deleted: Set`, `selected: Set`. Table cells become `<input class="pr-cell" data-zm data-col>` for every `EDIT_COLUMNS` column; ZM Code is text. Dirty cells (value ≠ saved) get `.pr-dirty`; invalid get `.pr-bad` and the error as `title`. Row tick box + header "select all filtered". Row delete button toggles `deleted` (row shown struck through, `.pr-del`).
- [ ] **Step 2:** **+ Add style**: an input for ZM code (datalist of mapped styles without pricing) → adds a blank row to `draft` (refused if the code exists or does not normalise to `ZM-<n>`).
- [ ] **Step 3:** Bulk bar (shown when `selected.size`): column select, action select (text columns: only "Set to"), amount input, **Apply** → `draft = applyBulkEdit(draft, selected, …)`.
- [ ] **Step 4:** Pending bar (shown when `pendingChanges` non-empty or `deleted.size`): `N change(s)` · **Save** · **Discard**. Save refuses while any `.pr-bad` cell exists; otherwise `saveMyntraPricing(upserts)` + `deleteMyntraPricing(deletes)`, then `state.pricing = await getAllMyntraPricing()`, reset draft, `state.onPricingChange()`, toast `N pricing change(s) saved`. Discard resets draft.
- [ ] **Step 5:** File upload with pending changes → `confirm('Discard N unsaved pricing change(s) and upload this file?')`. `myntra.html` adds `beforeunload` when `pricingTab.hasPendingChanges()`.
- [ ] **Step 6:** `node tests/run.mjs` → all green. Harness (login-free `myntra.html`, see Task 6): edit a cell, bulk +10% ISP on two ticked rows, add + delete a row, Save → Mapping tab shows the new prices; Discard restores. No console errors; 390 px layout scrolls the table inside its card.
- [ ] **Step 7:** Commit `Pricing tab: edit any cell, bulk edit, add and delete styles`.

### Task 4: Purchase cart follows pricing

**Files:** Modify `js/myntra-purchase.js` (`addLine` sets `rateFromPricing: true`; rate input clears it; `render` calls the refresher), test in `tests/purchase.test.js`.

**Interfaces:** `refreshCartPrices(cart, priceIdx) → { cart, changed: number }` — only lines with `rateFromPricing === true` and a pricing row take `rate = kuntalSellingPrice` (when not null) and `category` (when non-empty).

- [ ] **Step 1: Failing test:** line `{sellerSkuCode:'ZM-43-Rani', zmCode:'ZM-43', rate:8990, category:'lehnga', rateFromPricing:true}` with price 9500/'saree' → rate 9500, category 'saree', `changed` 1; same line with `rateFromPricing:false` → unchanged (Review Focus 5); line without the flag → unchanged; price `kuntalSellingPrice:null` → rate unchanged.
- [ ] **Step 2:** `node tests/run.mjs purchase` → FAIL.
- [ ] **Step 3:** Implement; in `render()` apply to both carts, `persist()` when `changed`.
- [ ] **Step 4:** `node tests/run.mjs` → all green.
- [ ] **Step 5:** Commit `Purchase cart picks up edited prices unless the rate was typed`.

### Task 5: Same bill number appends

**Files:** Modify `js/myntra-purchase.js` (`saveBill`), `myntra.html` (merge confirm modal `#pur-merge-modal` with `#pur-merge-summary`, `#pur-merge-confirm`, `#pur-merge-cancel`), tests in `tests/purchase.test.js`.

**Interfaces:**
- `findSavedBill(bills, typed) → bill|null` — compares `String(billNo).replace(/\s+/g,'').toUpperCase()`.
- `mergeIntoBill(saved, newLines, rateTable, { docType, note }) → { bill, error }` — `error` strings: `'<billNo> is a <saved docTypeLabel> — switch the document type to add to it'`; `'<sellerSkuCode> is already on <billNo> at ₹<rate> / <gst>% GST — set the same rate and GST to add to it'`.

- [ ] **Step 1: Failing tests:** saved `{ billNo:'INV/26-27/0042', docType:'tax_invoice', docTypeLabel:'Tax Invoice', billDate:'2026-11-10', note:'old', parties:{x:1}, receipts:[{sellerSkuCode:'ZM-43-Rani', ordered:2, received:2}], lines:[computeLine({sellerSkuCode:'ZM-43-Rani', category:'lehnga', qty:2, rate:8990}, {lehnga:18}, 1)] }`; new lines Rani qty 1 rate 8990 + `ZM-49-Pyazi` qty 1 rate 6450 lehnga:
  - merged lines → `[['ZM-43-Rani',3,1],['ZM-49-Pyazi',1,2]]` (sku, qty, srNo); `totals.subTotal` 33420; `billDate` `'2026-11-10'`; `receipts`, `parties`, `billNo` kept; note `''` keeps `'old'`, note `'new'` replaces.
  - `shortfallOf(merged).pcs` → `2`: Rani ordered 3, received 2 (short 1); Pyazi is absent from the kept receipts, so it counts as not arrived (short 1) (Review Focus 2).
  - Rani at rate 9000 → `bill` null, error contains `'ZM-43-Rani'`; docType `'goods_return'` → error contains `'Tax Invoice'`.
  - `findSavedBill([saved], ' inv/26-27/0042 ')` → saved; `findSavedBill([saved], 'INV/26-27/0043')` → null (Review Focus 4).
- [ ] **Step 2:** `node tests/run.mjs purchase` → FAIL.
- [ ] **Step 3:** Implement both. In `saveBill`: typed number + `findSavedBill(bills, typed)` → `mergeIntoBill`; error → toast, stop; else open the modal (summary: number, saved date, saved lines + total, lines being added, new total; note that the bill date stays). Confirm → `savePurchaseBill(merged)` (GR consumption as today, after the write), toast `M line(s) added to <billNo> — ₹<total>`, PDF of the whole merged bill, clear cart, refresh. Cancel → nothing written. No typed number → unchanged path.
- [ ] **Step 4:** `node tests/run.mjs` → all green.
- [ ] **Step 5:** Commit `Purchase: saving to an existing bill number adds to it, after a confirm`.

### Task 6: Purchase audit

**Files:** Whatever the findings touch; tests in `tests/purchase.test.js`.

- [ ] **Step 1:** Rebuild the login-free harness (copy of `myntra.html` with an import map swapping `js/auth.js` and `js/firestore-service.js` for fakes that keep bills in memory) in the gitignored workspace.
- [ ] **Step 2:** Exercise and note result of each: new Tax Invoice / PO / Proforma / Goods Return; preview; ad-hoc PDF; Save + PDF; re-download; duplicate; delete; receive + short receive; note on PDF; Parties & GST save; same-number append (Task 5). For PDFs, call `exportBillPDF` with `jsPDF.save` stubbed to capture the doc: page count ≥ 1, and the grand total text present.
- [ ] **Step 3:** Each defect: failing test → fix → `node tests/run.mjs` green → commit `Purchase: <what was wrong>`. A defect needing more than a contained fix is reported to the owner first.

### Task 7: Docs, review, deploy

**Files:** `README.md`.

- [ ] **Step 1:** README: Inventory section (deactivated → 0), Pricing editing section, Purchase same-number append; Myntra hub table rows updated.
- [ ] **Step 2:** `node tests/run.mjs` → all green; commit `README: pricing editing, deactivated as 0, bill append`.
- [ ] **Step 3:** Final whole-branch review (fresh reviewer), fix pass.
- [ ] **Step 4:** Pre-push check: `cmdkey /list` shows only GitHub user `ZimonZa`; `git remote get-url origin` is `https://github.com/ZimonZa/zimonza-daily-stock-update.git`. Otherwise stop and ask.
- [ ] **Step 5:** `"$S/g.sh" checkout main && "$S/g.sh" merge --ff-only myntra-pricing-edit && GIT_TERMINAL_PROMPT=0 "$S/g.sh" push origin main`; wait for GitHub Pages; confirm the live `myntra.html` contains the new pricing markup and loads without console errors.
