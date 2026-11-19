# Myntra: deactivated SKUs as 0 · Pricing hand-editing · Same-bill-number append · Purchase audit

Short design (three contained changes + an audit). Owner decisions are marked **(owner)**; everything else is the builder's call, marked *(my call)*.

## Context

The owner runs Myntra listings from `myntra.html`. They asked (2026-11-19):

1. A SKU switched **off** (Live toggle) in the Mapping tab must still appear in the generated inventory file — with quantity **0** — so Myntra shows it out of stock. Today it is left out of the file entirely (`NON_EXPORT_STATUSES` in `js/myntra.js:28`).
2. The Pricing tab must be editable by hand — any cell **(owner)**, and many rows at once including Category **(owner)** — and an edited price must show everywhere the app uses pricing.
3. Check the Purchase workflow end to end (bills, PDF). In particular: saving with a bill number that is already saved. Today `savePurchaseBill` (`js/firestore-service.js:234`) does a full `setDoc` on the id derived from the number, so the old bill — its lines **and** its receipts — is silently **replaced**. The owner expects the new lines to be **added** and the PDF re-made.
4. Deploy only from the **ZimonZa** GitHub account to `ZimonZa/zimonza-daily-stock-update` (GitHub Pages from `main`) **(owner)**. It is the only GitHub credential on this machine (Git Credential Manager: `ZimonZa`).

## 1. Deactivated SKUs → quantity 0

- `generateInventoryUpdate` keeps the `inactive` status, but such rows are **exported** with `quantity: 0`. Only `duplicate` stays out of the file.
- The quantity input for an inactive row stays **locked at 0** (cannot be hand-edited); returns boost never applies to it.
- Same rule for both paths: an uploaded inventory file and **Generate from Mapping** (which already uses every mapped SKU).
- Wording: status chip "Deactivated → 0"; toast "N deactivated SKU(s) sent as 0"; the Live toggle tooltip and the generator help text stop saying "excluded".
- Tests: update `tests/core.test.js:129-133` — the inactive row is exportable, its quantity is 0, a duplicate is still not.

## 2. Pricing tab — hand editing (Approach A, **owner**)

**Grid.** Every cell is an input: Kuntal Code, Category, Kuntal Selling Price, Myntra MRP, Myntra MU Price, Myntra ISP.
- *(my call)* **ZM Code is not editable in place** — it is the document id and the join key for Mapping, bills and returns. To change one, delete the row and add a new one.
- *(my call)* **+ Add style** row (ZM code typed, or picked from the "mapped styles with no pricing" list already shown), and a **delete** button per row. Both are pending changes like any edit.
- Category input offers existing categories (datalist); stored lowercase, as the upload does.
- Numbers: blank = no price (stays `null`, never 0 — same rule as the upload); negative or non-numeric is refused with the cell outlined red.

**Pending changes, then Save.** Edited cells turn amber; a bar shows "N changes · Save · Discard". Nothing is written until Save; Save writes all changed rows in one batch (`saveMyntraPricing`) and deletes removed rows (new `deleteMyntraPricing(zmCodes)`). Discard restores the last saved values.
- Leaving the page with unsaved changes asks first (`beforeunload`). Uploading a pricing file while changes are pending asks to discard them first.

**Bulk edit.** Tick rows (or "Select all filtered"), then pick a column and an action:
- price columns: **set to ₹**, **+ %**, **− %**, **+ ₹**, **− ₹**; results rounded to whole rupees *(my call; MU Price keeps 2 decimals)*; a blank price stays blank under ± operations;
- Kuntal Code / Category: **set to**.
Apply turns into pending cell edits (visible, reversible) — it never writes on its own.

**Everywhere at once.** After Save, `state.pricing` is replaced and `state.onPricingChange()` runs, so Mapping, Purchase picker, RTO "Excel + Kuntal Price", Order Map value and the Pricing summary all show the new figures immediately.
- *(my call)* **Purchase cart:** a line whose rate was taken from pricing and **not hand-edited** in the cart picks up the new price and category; a hand-edited rate is kept. (Lines get a `rateFromPricing` flag; editing the rate input clears it.)
- *(my call)* **Saved bills never change** — they are the record of what was billed.

Pure, tested functions (in `js/myntra-pricing.js`): `applyBulkEdit(rows, selectedZm, column, action, amount)`, `validatePriceCell(column, raw)`, `pendingChanges(saved, edited)` → `{ upserts, deletes }`.

## 3. Same bill number → add to the saved bill (Approach A, **owner**)

When Save is pressed with a bill number typed that matches a saved bill:
1. A confirm panel shows the saved bill: number, date, lines, total — "Add these M line(s) to it?"
2. **Yes →** merge, recompute, save, re-make and download the PDF of the **whole** bill; the Saved Bills list refreshes. **No →** nothing is written.

Merge rules — pure `mergeIntoBill(saved, newLines, rateTable)` → `{ bill, error }` in `js/myntra-purchase.js`:
- Document type must match (an invoice number can't receive Goods-Return lines) — otherwise refused with a message.
- Same SKU, same rate and same GST % → quantity added to the existing line. Same SKU at a **different** rate or GST % → refused, naming the SKU *(my call: receipts are tracked per SKU, so one SKU at two prices would make "received" ambiguous)*.
- New SKUs are appended, numbering continues.
- Kept from the saved bill: **bill date**, parties, place of supply, **receipts**. Note: the newly typed note if any, else the saved one.
- Totals and the rate-wise tax summary are recomputed from all lines (`computeLine`/`computeTotals`).
- Goods Return: register consumption covers only the newly added quantities (unchanged flow).
- The number counter is never touched by a merge. With no number typed, Save reserves a new number exactly as today.

## 4. Purchase audit

Read and exercise every Purchase path — new bill (each doc type), preview, ad-hoc PDF, save + PDF, re-download, duplicate, delete, receive/short-receive, Goods Return, note, Parties & GST — on the login-free harness (real `myntra.html`, auth and Firestore swapped by import map). PDF generation is checked by generating the jsPDF document and checking page count and that totals in it match the bill. Every bug found gets a failing test, then a fix; anything larger than a contained fix is reported to the owner before changing.

## 5. Deploy

On `main` via the ZimonZa GitHub account only (Git Credential Manager entry `ZimonZa`; remote `https://github.com/ZimonZa/zimonza-daily-stock-update.git`). Right before pushing: confirm the stored credential is still `ZimonZa` and the remote is unchanged; if either differs, stop and ask. After pushing: wait for GitHub Pages and confirm the live `myntra.html` serves the new code.

## Non-goals
- No change to how pricing files are uploaded or parsed.
- No editing of saved bills' lines other than appending via the same number.
- No change to other pages.

## Verification
- `node tests/run.mjs` green, with new/updated tests: inactive rows exported at 0; `applyBulkEdit`, `validatePriceCell`, `pendingChanges`; `mergeIntoBill` (same SKU adds qty, different rate refused, doc-type mismatch refused, receipts/date kept, totals recomputed); cart lines follow pricing unless hand-edited.
- Harness: Pricing grid edit → Save → Mapping/Purchase show the new price; bulk +10% on ISP; same-number save shows the confirm, merges, PDF has all lines.
- Live site loads after deploy.
