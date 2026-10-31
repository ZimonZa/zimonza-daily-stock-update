# Myntra page: Mapping columns · RTO price export · Order Map · polish · deploy

## Context

The owner runs Myntra sales for Kuntal Fashion from `myntra.html` (static ES-module app, Firebase Auth + Firestore, hosted on **GitHub Pages from `main`** of `github.com/ZimonZa/zimonza-daily-stock-update`, live at `zimonza.github.io/zimonza-daily-stock-update`). They asked for four things, in their words:

1. **Mapping tab** — "I can't see Style ID". Show only: SellerSkuCode, Style ID, ZM Code, Colour, Item No, Today's Stock, Kuntal Selling Price, Myntra MRP, Myntra ISP.
2. **Returns & RTO → Stock in Returns & RTO (grouped by ZM code)** — an Excel export that includes Kuntal Selling Price: ZM Code, Kuntal Code, Colour, Total Pcs, Kuntal price, a grand-total row, export date in the file name.
3. **A new section for received orders** — use the orders already recorded in *Orders & Fake Returns*, read the PIN from each delivery address, and show an **India map by state** plus most-ordering cities/states and which products go where. They want it for all three: **know where buyers are, plan stock by region, spot risky areas** — and asked for any other helpful features.
4. **Make the whole Myntra page more professional**, check all code for errors, then **deploy**.

State today: all 7 test suites pass (`node tests/run.mjs` → all green). Git is clean and in sync with `origin/main`. Git refuses to run without `-c safe.directory=…` (folder ownership mismatch), so every git command uses that flag rather than changing global config.

## Decisions made with the owner

| Question | Answer |
|---|---|
| Mapping: keep Live switch + tick boxes? | **Keep** them (they drive activate/deactivate) |
| RTO Excel row layout | **One row per ZM code**, colours listed in one cell |
| Map purpose | **All three** (buyers, stock planning, risk) + extras |
| Extras (COD capture, weekly trend, zones) | **Keep all** |
| GUI scope | **Whole Myntra page** (all 7 tabs); other pages untouched |
| PIN → city/state | **Built-in India Post PIN list** shipped with the app |
| Old orders missing the label PIN / payment | **Backfill**: re-dropping old label PDFs fills in only those fields |
| Orders with no usable PIN | **Type a PIN** on the Unknown row (map-only override) |
| COD vs Prepaid wording (no prepaid sample available) | **Best guess**: `COD` line or an "Amount to be paid" figure → COD, otherwise Prepaid |
| Hosting | GitHub Pages only (Firebase Hosting URL returns 404) → deploy = push `main` |

## Order of work

One branch (`myntra-order-map`), four pieces, **one deploy at the end**:
1. Mapping columns (small) → 2. RTO price export (small) → 3. Order Map tab (project) → 4. Myntra page polish → 5. full check → merge to `main` + push (= deploy).

On approval: save this design as `docs/superpowers/specs/2026-10-31-myntra-order-map-design.md` (committed on the branch), then break it into test-first tasks with the writing-plans skill and build in the order above.

---

## 1. Mapping tab columns

File: `myntra.html` → `renderMappings()` (≈ line 1286).

- Columns, in this order: ☐ tick box · Live switch · **SellerSkuCode · Style ID · ZM Code · Colour · Item No. · Today's Stock · Kuntal Selling Price · Myntra MRP · Myntra ISP**.
- Add Style ID (`r.styleId`, already saved by `parseMyntraMappingFile` in `js/myntra.js:76` and stored in `firestore-service.js:98`); sortable via `thSort(mapView,'styleId','Style ID')`. Blank shows `—`.
- Remove the Product column. Search still matches product name (harmless, keeps the search useful).
- Update the card subtitle text to match the new columns.
- *My call:* CSV/Excel export of the mapping is unchanged (it already carries Style ID); only the on-screen table changes.

## 2. RTO "Excel with Kuntal Price"

Files: `myntra.html` (button next to `ret-stock-xlsx`, ≈ line 643), `js/myntra-returns.js`.

- New button **"Excel + Kuntal Price"** in the *Stock in Returns & RTO* header. Existing CSV/Excel buttons stay.
- New pure export: `rtoPriceExportRows(codes, priceIdx)` in `myntra-returns.js`, fed by the same `summariseReturnStock(returns.filter(matchesFilters)).codes` the on-screen table uses (so it **follows the filters**, like the existing export). Price from `pricingIndex(state.pricing).get(normZmCode(zm))?.kuntalSellingPrice` (`js/myntra-pricing.js`).
- Sheet layout (one row per ZM code):

  | ZM Code | Kuntal Code | Colours | Total Pcs | Kuntal Price | Value |
  |---|---|---|---|---|---|
  | ZM-42 | 3102 | Rani 4 · Black 2 | 6 | 8990 | 53940 |
  | **GRAND TOTAL** | | | **sum pcs** | | **sum value** |

  - Total Pcs = all pieces held (same as the on-screen "Pcs"), Value = pcs × Kuntal price, numbers written as numbers (Excel can sum them) with `#,##0` format.
  - *My call:* a ZM code with no Kuntal price gets a blank price and value; the grand-total value covers priced rows only, and a note row under the total says "N ZM codes have no Kuntal price — not in the total value". The toast says the same.
  - Kuntal Code falls back to pricing's `kuntalCode` when the register row had none.
- File name: `RTO_Stock_Kuntal_Price_DD-MM-YYYY.xlsx` (date of export, local time).
- **Bug fix (all four copies):** `stamp()` in `myntra.html:973`, `myntra-returns.js:31`, `myntra-orders.js:23`, `myntra-pricing.js:95` uses `toISOString()` (UTC), so exports before 05:30 IST carry yesterday's date. Replace with `today()` from `js/utils.js:35` (local). Existing file-name formats otherwise unchanged.

---

## 3. Order Map tab (new, 7th tab)

### Intent
Turn the orders already recorded in *Orders & Fake Returns* into a picture of **where Myntra buyers are, what they buy where, and where returns come from**, so the owner can target, stock and be careful by region. No new upload — it reads the same `dispatches` collection.

### Goals
- India map shaded by state; switch the shading between **Orders · Pieces · Return % · Fake returns**; hover = numbers; click a state = everything below narrows to it (click again / "All India" chip clears).
- City bubbles on the map for the top cities.
- Tables: Top states, Top cities, Top PINs; Product × State; Risky areas; Unknown location.
- Weekly trend (top 5 states); Zone summary.
- COD vs Prepaid and COD amount from labels **from now on**; estimated order value for all orders.
- Filters: date range (Last 7 / 30 / 90 days / All / custom from–to, on `dispatchDate`), ZM code, colour.
- KPI tiles: Orders · Pieces · States · Cities · Return % · Fake returns.
- One Excel export of everything.

### Non-goals
- No change to how orders are returned or keyed (customer grouping stays exactly as is). Recording only gains the new label fields and the narrow backfill described below.
- Nothing here touches stock, Purchase or Returns & RTO.
- No street-level map, no geocoding of full addresses, no online lookups.
- Other app pages are not redesigned.

### Anti-goals (would make it a failure even if it "works")
- A PIN that isn't the buyer's — above all the **seller's own 395010 (Surat)** from the "If undelivered" block — placing an order in the wrong state.
- Flagging a whole town as risky on one or two parcels.
- Customer data leaving the browser (no external lookup services).
- A map that shows India's borders other than the official ones.
- Slowing down the other tabs (map code and data must load only when the Map tab is opened).

### Data

**Orders** — `ordersTab.getDispatches()` (already loaded by `initOrdersTab`, `js/myntra-orders.js:126`); re-render on `state.onOrdersChange`. Per record: `customer.address`, `products` (via `productsOf(d)` in `js/myntra-dispatch.js:164`), `qty`, `dispatchDate`, `status`, `return.type` (`rto` / `customer_return` / `fake_return`, `js/constants.js:115`).

**Which PIN an order uses** — first that exists, and each table row says which one it came from:
1. `pinOverride` — typed by the owner on the Unknown row (see UI).
2. `destPin` — **new field, read from the label's routing code** `(NNNNNN)-(NNNN)` at the top of every Myntra label. Verified on all three real fixtures in `tests/label-layout.test.js`: `(801105)` = Khagaul Patna buyer, `(208017)` = Kanpur buyer, `(229001)` = Rae Bareli — the combo label whose address has **no PIN at all**. Today `NOT_ADDRESS` (`js/myntra-label-layout.js:119`) discards that line, so nothing saved has it.
3. The **last** 6-digit `[1-9]\d{5}` in `customer.address` (derived on the fly, follows edits). Old keyword-reader addresses like `AMOUNT TO BE PAID … (801105` resolve correctly this way too, since that bracketed number is the buyer's PIN. The seller's PIN 395010 is never taken from an address that also carries the seller block (test this).
No PIN, or a PIN not in the directory → **Unknown location**.

**PIN directory** — `assets/geo/pincodes.json`, built once from India Post's *All India Pincode Directory* (data.gov.in, GODL-India licence, attribution required):
- ~19,000 PINs → district ("city"), state, area (most common office name), and coordinates.
- About 1,250 PINs span two districts → keep the district with the most post offices for that PIN.
- Coordinates: median of that PIN's offices, discarding points outside India's bounding box (the source has some bad points). District bubble position = median of its PINs.
- State names normalised at build time to **exactly** the GeoJSON feature names (e.g. `THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU`, `LADAKH`, `DELHI`), so lookups never miss on spelling.
- Compact shape: `{ v, source, states:[…], districts:[[name, stateIdx, lat, lng]…], pins:{ "110001":[districtIdx, "Area"] } }`. Target ≤ 600 KB raw (GitHub Pages serves it gzipped).
- Built by a committed script `scripts/build-geo.mjs` (Node, no deps beyond what's needed for CSV parsing) so it can be refreshed later. If data.gov.in's download needs a captcha and can't be fetched, **ask the owner to download the one CSV** and point the script at it.
- "City" is India Post's district name (Noida → *Gautam Buddha Nagar*, Gurgaon → *Gurugram*); hover/table shows the area name beside it.

**State outline** — `assets/geo/india-states.json`, simplified GeoJSON (target ≤ 400 KB) that shows **India's official boundary** (all of J&K incl. PoK and Aksai Chin, Ladakh as its own UT). Candidates: Survey-of-India-derived shapefile (VTIITI repo) converted with mapshaper, or a state GeoJSON checked against it. **Verify visually before shipping.**

**New label fields** — extend `extractMyntraFields` (`js/myntra-label-layout.js:216`) to also return:
- `destPin` — from the routing-code line (above).
- `payment: 'cod' | 'prepaid'` and `codAmount: number | null`, by the owner-approved **best guess** (no prepaid sample exists): a line that is exactly `COD`, or an `AMOUNT TO BE PAID` block with an `Rs.` figure (on the real label the figure sits two lines below, after the hub code — read the nearest `Rs.` line within the header band, before the buyer anchor) → `cod` with that amount; otherwise `prepaid`. `paymentGuessed: true` when neither `COD` nor `PREPAID` was printed (e.g. the combo label prints only `NORMAL - Fwd`), so a guess is never shown as a reading.
- The keyword fallback reader (non-Myntra labels) leaves all four blank.
Carry them through `dispatchFromPageRecord` (`js/myntra-dispatch.js:48`) and `mergeByForwardId` (first non-empty wins); `dispatchWritePayload` already passes unknown fields through. Show a small COD/Prepaid badge (with "?" when guessed) in the Orders review and table.

**Backfill on re-drop** (owner approved) — new pure `backfillPatch(saved, parsed)` in `js/myntra-dispatch.js`: returns only `{ destPin, payment, codAmount, paymentGuessed }` fields that are **empty on the saved record and present on the parsed row**, else `null`. In `commitLabel` (`js/myntra-orders.js`), every review row classified `exists` or `locked` by `classifyAgainstSaved` (`js/myntra-dispatch.js:332`) that is *not* ticked for a full update gets its patch written with `updateDispatch(existingId, patch)` (`js/firestore-service.js:383`). It never touches `status`, `return`, `customer`, products or dates — including on returned (locked) parcels. The review shows "fills PIN / payment" on those rows, Save is enabled when only backfills exist ("Fill in N orders"), and the toast counts them. Records with no saved order are unaffected.

**Estimated value (all orders)** — products × Myntra ISP from pricing (`pricingIndex`, `myntraIsp`), labelled "Est. value (Myntra ISP)". Unpriced products contribute nothing and are counted in a footnote.

### Calculations — new pure module `js/order-geo.js` (no DOM, no Firestore)
- `extractPin(address)`; `lookupPin(pin, dir)` → `{ state, district, area, lat, lng } | null`.
- `filterOrders(dispatches, { from, to, zm, colour, state })`.
- `summarise(dispatches, dir, priceIdx)` → `{ kpis, byState, byCity, byPin, productByState, risky, unknown, weekly, zones, payment }`.
  - Per group: orders, pieces, returned, rto, customerReturn, fake, returnRate, estValue, cod, prepaid, codAmount.
  - **Risky**: PIN or city with **≥ 3 orders** and (return rate ≥ 40% **or** any fake return) — same thresholds as `offenderSummary` (`js/myntra-dispatch.js:231`).
  - **Product × State**: rows = SellerSkuCode (switchable to ZM code), columns = top 8 states by pieces + "Other", cells = pieces.
  - **Weekly**: Monday-start weeks, orders for the top 5 states.
  - **Zones**: the Government's zonal councils — Northern, Central, Eastern, Western, Southern, North-Eastern (*my call*: six zones, since the official grouping has a Central zone).
- Fully unit-tested (see Verification).

### UI — `myntra.html` + new `js/myntra-ordermap.js` (`initOrderMapTab(state, { ordersTab })`)
- Tab button `tabbtn-ordermap` ("Order Map", `map` icon) after Orders; add `'ordermap'` to `TABS` (`myntra.html:1051`).
- **Lazy load** on first open: ECharts (exact pinned version from cdnjs, ≥ 2 weeks old) via script injection, then both JSON files; show a skeleton while loading and a clear error card if either fails.
- Layout (top → bottom):
  1. Filter bar: date range · ZM code · colour · "All India" chip (when a state is selected) · Excel export.
  2. KPI tiles (existing `kpi-tile` styles).
  3. Map (left, ~60%) with metric switch (Orders / Pieces / Return % / Fake) + city bubbles; Top states + Top cities (right). Stacks on narrow screens.
  4. Product × State heat table (toggle SKU / ZM code).
  5. Risky areas table (PIN, area, city, state, orders, RTO, customer returns, fake, return %).
  6. Weekly trend chart · Zone summary · COD vs Prepaid by state (with "N orders before payment was recorded").
  7. Unknown location list (forward ID, customer, address, reason: "no PIN" / "PIN not in directory") with a **PIN box + Save** on each row (owner approved): accepts 6 digits that exist in the directory, writes `{ pinOverride }` via `updateDispatch` — address, customer key and returns untouched — and the row moves onto the map. A typed PIN shows a "typed" marker wherever it's used, with a clear (×) to remove it. Plus **Open in Orders** → switches to the Orders tab with that forward ID in its search box. A hint says old orders can also be filled by re-dropping their label PDF in Orders.
  8. Footer attribution: "PIN data: India Post via data.gov.in (GODL-India)".
- Colours: Midnight Zari tokens (`css/zari.css`) — gold ramp for volume metrics, red ramp for Return % / Fake.
- Export `Myntra_Order_Map_DD-MM-YYYY.xlsx`, sheets: States, Cities, PINs, Product x State, Risky Areas, Zones, Unknown Location. Follows the current filters. Customer names appear only on the Unknown Location sheet (needed to fix them).

---

## 4. Myntra page polish (all 7 tabs)

Keep the Midnight Zari look; make the tabs consistent and tidy. Checklist applied to every tab:
- One card-header pattern: icon tile · title · one-line subtitle · actions on the right that wrap below on narrow screens.
- Toolbars: search, filters and count line up and wrap cleanly; consistent control heights.
- Tables: sticky header, numbers right-aligned in IBM Plex Mono, consistent cell padding, one sort-arrow style, totals rows where a column is summable.
- Empty states: icon + one line + the action to take (e.g. "Upload the mapping file above").
- Loading: skeleton rows while Firestore loads instead of a blank panel.
- Tab bar with 7 tabs: horizontal scroll with edge fade on small screens, active tab scrolled into view.
- Phone width (390 px): no horizontal page scroll — wide tables scroll inside their card.
- Shared bits go into `css/zari.css` / `css/custom.css`, not per-tab inline styles.
Non-goal: changing behaviour or wording of existing features beyond headers/empty states.

## 5. Check & deploy

1. `node tests/run.mjs` — all suites green, including the new ones; the parse check covers the `myntra.html` page script.
2. Browser smoke test via a local server (`npx serve .` or `python -m http.server`): open every Myntra tab, check the console is clean, check at desktop and 390 px. Login is Firebase Auth — if it blocks automated clicking, ask the owner to log in or click through.
3. README: Myntra hub table (7 tabs), Order Map section, `dispatches` fields (`payment`, `codAmount`), `assets/geo/*`, data licence/attribution.
4. Write this design to `docs/superpowers/specs/2026-10-31-myntra-order-map-design.md`; commit per piece on branch `myntra-order-map`.
5. Deploy: merge to `main`, `git push origin main` (GitHub Pages rebuilds). Then load `zimonza.github.io/zimonza-daily-stock-update/myntra.html#ordermap` and confirm it loads.

---

## Approaches considered

- **PIN → location:** (a) bundled India Post list — **chosen**: instant, offline, private; new PINs show as unknown until refreshed. (b) Online PIN API + Firestore cache — slow first load, flaky, PINs leave the app. (c) Both — most complete, more moving parts.
- **Map drawing** (*my call*): **ECharts** — map shading, hover, click and charts (trend) in one lazy-loaded library. Leaflet + OSM tiles rejected: street-level clutter, external tiles, and OSM's boundary policy. Hand-made D3/SVG rejected: much more code for the same result.
- **RTO export layout:** per colour vs **per ZM code (chosen)** — matches the on-screen table.
- **Mapping controls:** remove vs **keep switch + tick boxes (chosen)** — removing would kill activate/deactivate.

## Left to the builder
Exact GeoJSON source and simplification level (must pass the official-boundary check); exact ECharts version; colour ramps; data-prep script internals; COD regex details (from real fixtures); polish details within the checklist.

## Critical files
- `myntra.html` — Mapping table, RTO button, new tab markup + mount, `TABS`, `stamp()`.
- `js/myntra-returns.js` — `rtoPriceExportRows`, new export handler, `stamp()`.
- `js/order-geo.js` (new) — pure calculations.
- `js/myntra-ordermap.js` (new) — tab UI, lazy loading, export.
- `js/myntra-label-layout.js`, `js/myntra-dispatch.js`, `js/myntra-orders.js` — `destPin` + payment + amount capture, `backfillPatch` + backfill on re-drop, badge, "Open in Orders" hook. (`updateDispatch` in `js/firestore-service.js` already exists — no change.)
- `assets/geo/pincodes.json`, `assets/geo/india-states.json` (new data); `scripts/build-geo.mjs` (new).
- `css/zari.css` / `css/custom.css` — polish.
- `tests/order-geo.test.js` (new), additions to `tests/label-layout.test.js`, `tests/dispatch.test.js`, a returns-export test.
- `README.md`.

## Verification
- **Unit:** PIN precedence (`pinOverride` → `destPin` → last PIN in address); `extractPin` (last PIN wins; old `… (801105` address resolves to 801105; seller 395010 never taken; none → null); `destPin` read from all three real fixtures (801105, 208017, 229001 — the combo); payment: COD fixture → `cod` + 5846, combo (`NORMAL - Fwd`) → `prepaid` + `paymentGuessed`; `backfillPatch` fills only empty fields, returns `null` when nothing to add, and a backfilled **returned** record keeps its `status`, `return` and `customer` byte-for-byte; `lookupPin`, state/city/PIN aggregation, return % and risky thresholds (2 orders never flagged; 3 with 2 RTO flagged; 1 fake on 3 orders flagged), product × state, Monday-start weeks, zones, date/ZM/colour/state filters, unknown list, est. value with unpriced products; payment/amount extraction on COD and prepaid fixtures and through `dispatchFromPageRecord`/`mergeByForwardId`; `rtoPriceExportRows` grand totals and the missing-price note; `today()`-based file names.
- **Data:** every state name in `pincodes.json` matches a GeoJSON feature; known PINs resolve (110001 → Delhi, 400001 → Mumbai, 560001 → Bengaluru Urban, 201301 → Gautam Buddha Nagar / Uttar Pradesh); the outline is visually checked for the official boundary.
- **Browser:** each tab renders with no console errors at desktop and 390 px; Map tab lazy-loads only when opened; Excel files open with the right columns, totals and dated names.
- **Deploy:** live URL loads the Order Map tab after the push.
