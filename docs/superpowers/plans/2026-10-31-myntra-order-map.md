# Myntra Order Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mapping shows Style ID, RTO stock exports with Kuntal price, a new Order Map tab shows where Myntra orders and returns come from, the Myntra page is polished, and the app is deployed.

**Architecture:** Build-less static app (ES modules, Firebase from CDN). New logic goes in pure modules (`js/order-geo.js`, additions to `js/myntra-dispatch.js` / `js/myntra-label-layout.js` / `js/myntra-returns.js`) that the existing Node test runner exercises; DOM code stays in the tab modules. Geo data ships as two static JSON files under `assets/geo/`, lazy-loaded with ECharts only when the Order Map tab opens.

**Tech Stack:** Vanilla JS ES modules, Tailwind CDN, SheetJS, Firebase v10 Firestore, ECharts 5.5.1 (cdnjs), Node test runner `tests/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-31-myntra-order-map-design.md`

## Global Constraints

- No build step and no new app dependencies. Build-time tools (CSV parsing, mapshaper, PNG rendering) run via `npx` in the scratchpad and are never committed.
- CDN scripts pin an exact version: ECharts `https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.1/echarts.min.js`.
- Every interpolated string in HTML goes through `esc()` (the app had an XSS audit; addresses and names are attacker-controlled label text).
- Display dates `dd/mm/yyyy`. New file names use `DD-MM-YYYY`. All file-name dates are **local** dates, never `toISOString()`.
- Order Map never writes stock. Its only Firestore write is `{ pinOverride }` via `updateDispatch`.
- Backfill writes only `destPin`, `payment`, `codAmount`, `paymentGuessed`, and only where the saved record has them empty.
- Risky = **≥ 3 orders** and (return rate **≥ 0.4** or any fake return).
- The map must show India's official boundary (all of J&K incl. PoK and Aksai Chin; Ladakh separate).
- Attribution line under the map: `PIN data: India Post via data.gov.in (GODL-India)`.
- Git: run every git command through the wrapper `"$S/g.sh"` where `S=/c/Users/royal/AppData/Local/Temp/claude/e--Work-Zimonza-ZimonZa-App-Zimonzam-Daily-Stock-Update/9e79c2fd-cba2-4402-b27e-6836adad37db/scratchpad` (adds `safe.directory`, author `banny368 <banny368@github.com>`, `core.autocrlf=false`). Work on branch `myntra-order-map`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test harness style: each suite defines `eq(name, got, want)` (JSON compare) and `ok(name, cond, extra)`, prints `N passed, M failed`, exits non-zero on failure. Suites import from `./<module>.js` (the runner copies `js/` into the sandbox).

## Review Focus

1. **Unfulfillable orders** (`status: 'unfulfillable'`, never shipped) must not count as orders anywhere on the map → test in Task 6.
2. **Combo parcel under a ZM/colour filter**: the order counts once, and pieces count only the matching products → test in Task 6.
3. **Geo data fails to load** (offline, 404, bad JSON): the Map tab shows an error card and every other tab keeps working → manual check in Task 7, plus `loadGeo` rejects with a readable message (Task 7 test).
4. **Backfill never overwrites**: a saved `destPin` `'801105'` stays even if the re-dropped label reads something else → test in Task 4.
5. **Old records** with no `products`, no `dispatchDate` or no `payment`: counted under "All" dates, excluded from bounded date ranges, shown as "not recorded" in payment views → test in Task 6.

---

### Task 1: Mapping tab shows the owner's nine columns

**Files:**
- Modify: `myntra.html` — `renderMappings()` table (≈ lines 1286–1321), card subtitle (line 139)

**Interfaces:** none new.

- [ ] **Step 1:** In `renderMappings()`, header order becomes: select-all ☐, `Live`, `SellerSkuCode`, `Style ID` (`thSort(mapView,'styleId','Style ID')`), `ZM Code`, `Colour`, `Item No.`, `Today's Stock`, `Kuntal Selling Price`, `Myntra MRP`, `Myntra ISP`. Body adds `<td>${esc(r.styleId) || '—'}</td>` after SellerSkuCode and drops the Product `<td>`. Export columns unchanged.
- [ ] **Step 2:** Subtitle (line 139) → `SellerSkuCode · Style ID · ZM code · colour · stock · price — upload pricing to fill the price columns`.
- [ ] **Step 3:** Run `node tests/run.mjs` → `all green — 7 suites` (parse check covers the page script).
- [ ] **Step 4:** Commit `Mapping: show Style ID, drop the product column`.

### Task 2: Local file dates + RTO "Excel + Kuntal Price"

**Files:**
- Modify: `js/utils.js` (add `exportDateStamp`), `js/myntra-returns.js` (pure builder + handler, `stamp`), `js/myntra-orders.js:23`, `js/myntra-pricing.js:95`, `myntra.html:973` (`stamp`) and ≈ line 643 (button)
- Test: `tests/rto-export.test.js` (new)

**Interfaces:**
- Produces: `exportDateStamp(d = new Date()) → 'DD-MM-YYYY'` (utils.js).
- Produces: `rtoPriceExportRows(codes, priceIdx) → { rows: Array<{ zmCode, kuntalCode, colourList, pcs, price: number|null, value: number|null }>, totalPcs, totalValue, unpriced: number }` (myntra-returns.js). `codes` is `summariseReturnStock(...).codes`; `priceIdx` is `pricingIndex(state.pricing)`.
- Produces: `rtoPriceSheetAoa(result) → any[][]` — header `['ZM Code','Kuntal Code','Colours','Total Pcs','Kuntal Price','Value']`, one row per code, then `['GRAND TOTAL','','',totalPcs,'',totalValue]`, then (only if `unpriced > 0`) `['', '', `${unpriced} ZM code(s) have no Kuntal price — not in the total value`]`.

- [ ] **Step 1: Write the failing tests** in `tests/rto-export.test.js`:
  - `exportDateStamp(new Date(2026, 9, 31, 2, 15))` → `'31-10-2026'`; `exportDateStamp(new Date(2026, 0, 5))` → `'05-01-2026'`.
  - Given codes `[{zmCode:'ZM-42',kuntalCode:'3102',colours:[{name:'Rani',pcs:4},{name:'Black',pcs:2}],pcs:6}, {zmCode:'ZM-43',kuntalCode:'',colours:[{name:'Chiku',pcs:3},{name:'Pyazi',pcs:2}],pcs:5}, {zmCode:'ZM-99',kuntalCode:'',colours:[{name:'Red',pcs:1}],pcs:1}]` and `priceIdx = pricingIndex([{zmCode:'ZM-42',kuntalSellingPrice:8990},{zmCode:'ZM-043',kuntalCode:'3095',kuntalSellingPrice:6450}])`:
    - rows[0] → `{zmCode:'ZM-42',kuntalCode:'3102',colourList:'Rani 4 · Black 2',pcs:6,price:8990,value:53940}`
    - rows[1].kuntalCode → `'3095'` (falls back to pricing; zero-padded `ZM-043` matches), value `32250`
    - rows[2] → price `null`, value `null`
    - `totalPcs` 12, `totalValue` 86190, `unpriced` 1
  - `rtoPriceSheetAoa(result)`: length 6 (header + 3 + total + note); `[4]` → `['GRAND TOTAL','','',12,'',86190]`; `[5][2]` contains `'1 ZM code(s) have no Kuntal price'`. With every code priced → length 5 (no note).
- [ ] **Step 2:** Run `node tests/run.mjs rto-export` → FAIL (`exportDateStamp` / `rtoPriceExportRows` not exported).
- [ ] **Step 3:** Implement `exportDateStamp` in `js/utils.js` (local getters, zero-padded). Implement both builders in `js/myntra-returns.js`; price via `priceIdx.get(normZmCode(c.zmCode))`, `kuntalCode` = `c.kuntalCode || p?.kuntalCode || ''`.
- [ ] **Step 4:** Replace the four `stamp` definitions with `const stamp = () => today();` (import `today` where missing). Existing file-name formats otherwise unchanged.
- [ ] **Step 5:** Add button `ret-stock-xlsx-price` ("Excel + Kuntal Price", `file-spreadsheet` icon) after `ret-stock-xlsx` in `myntra.html`. Handler in `initReturnsTab`: rows from `summariseReturnStock(returns.filter(matchesFilters)).codes`; empty → `notify.warning('Nothing to export')`; build sheet with `XLSX.utils.aoa_to_sheet(rtoPriceSheetAoa(r))`, set `z: '#,##0'` on Total Pcs / Kuntal Price / Value cells, bold-free (SheetJS CE), widths `[12,14,46,11,14,14]`, sheet name `RTO Stock (Kuntal Price)`, file `RTO_Stock_Kuntal_Price_${exportDateStamp()}.xlsx`; toast `Exported N ZM code(s)` plus `· U without a Kuntal price` when `unpriced`.
- [ ] **Step 6:** Run `node tests/run.mjs` → all green, 8 suites.
- [ ] **Step 7:** Commit `RTO: Excel export with Kuntal price; file dates use local time`.

### Task 3: Read destination PIN and payment from Myntra labels

**Files:**
- Modify: `js/myntra-label-layout.js` (`extractMyntraFields`), `js/myntra-labels.js` (keyword fallback `out`, ≈ line 395), `js/myntra-dispatch.js` (`dispatchFromPageRecord`, `mergeByForwardId`)
- Test: `tests/label-layout.test.js` (append), `tests/dispatch.test.js` (append)

**Interfaces:**
- Produces on `extractMyntraFields(lines)` output and on every dispatch record: `destPin: string` (`''` when absent), `payment: 'cod'|'prepaid'|''`, `codAmount: number|null`, `paymentGuessed: boolean`. The keyword fallback reader (`myntra-labels.js:395`) sets `destPin:''`, `payment:''`, `codAmount:null`, `paymentGuessed:false`.

- [ ] **Step 1: Write the failing tests** (label-layout.test.js, using the existing `LABEL`, `head()` and `COMBO` fixtures):
  - LABEL → `destPin '801105'`, `payment 'cod'`, `codAmount 5846`, `paymentGuessed false`.
  - `head([...])` (Kanpur) → `destPin '208017'`, `payment 'cod'`, `codAmount null`, `paymentGuessed false`.
  - COMBO → `destPin '229001'`, `payment 'prepaid'`, `codAmount null`, `paymentGuessed true`.
  - A label with a line `PREPAID (No amount to be collected)` → `payment 'prepaid'`, `paymentGuessed false`.
  - The seller block's `395010` is never `destPin` (LABEL with the routing line removed → `destPin ''`).
  - Existing assertion still holds: routing code is not in `customer.address`.
  - dispatch.test.js: `dispatchFromPageRecord({ ...rec, destPin:'801105', payment:'cod', codAmount:5846, paymentGuessed:false })` carries all four; `mergeByForwardId` of two pages for one ID where page 1 has `destPin ''`, `payment ''` and page 2 has `'801105'`, `'cod'`, `5846` → merged record has page 2's values.
- [ ] **Step 2:** Run `node tests/run.mjs label-layout` and `dispatch` → FAIL.
- [ ] **Step 3:** In `extractMyntraFields`, scan only lines **above the buyer anchor**: routing line `^\(\s*([1-9]\d{5})\s*\)\s*-\s*\(\s*\d+\s*\)$` → `destPin`; a line exactly `COD` → cod; a line matching `/^prepaid\b/i` → prepaid; an `AMOUNT TO BE PAID` line followed within 3 lines by `/^rs\.?\s*([\d,]+(?:\.\d+)?)$/i` → cod with `codAmount = Math.round(Number(amount))`. Neither word printed → `payment 'prepaid'`, `paymentGuessed true` — unless an amount was found, which alone means cod. Set the four fallback fields in the keyword reader.
- [ ] **Step 4:** `dispatchFromPageRecord` copies the four fields (defaults as above). `mergeByForwardId`: when `existing.destPin` is empty take `d.destPin`; when `existing.payment` is empty take all three payment fields from `d`.
- [ ] **Step 5:** Run `node tests/run.mjs` → all green.
- [ ] **Step 6:** Commit `Labels: keep the destination PIN and COD/prepaid`.

### Task 4: Orders — backfill on re-drop, payment badge, focus hook

**Files:**
- Modify: `js/myntra-dispatch.js` (add `backfillPatch`), `js/myntra-orders.js` (`commitLabel` ≈ line 275, `noteCell`/`renderConfirm`/`renderConfirmMeta` ≈ 685–925, orders table row, return object)
- Test: `tests/dispatch.test.js`, `tests/orders-ui.test.js` (append)

**Interfaces:**
- Consumes: the four fields from Task 3.
- Produces: `backfillPatch(saved, parsed) → { destPin?, payment?, codAmount?, paymentGuessed? } | null` — `destPin` included when `saved.destPin` is empty and `parsed.destPin` is not; the three payment fields included together when `saved.payment` is empty and `parsed.payment` is not.
- Produces on the Orders tab API: `focusForwardId(id: string) → void` (sets the search box and `view.q` to `id`, renders).

- [ ] **Step 1: Write the failing tests:**
  - dispatch.test.js: `backfillPatch({destPin:'', payment:''}, {destPin:'801105', payment:'cod', codAmount:5846, paymentGuessed:false})` → `{destPin:'801105', payment:'cod', codAmount:5846, paymentGuessed:false}`; saved `destPin:'801105'` + parsed `'208017'` → no `destPin` key (Review Focus 4); both already filled → `null`; parsed empty → `null`.
  - orders-ui.test.js: store holds a **returned** record `d9` (forwardId `MYEC1118733669`, `status:'returned'`, `return:{type:'fake_return',…}`, no `destPin`). Drop the LABEL page; the row is `locked`; click Save → `writes.updates` has exactly one entry `{ id:'d9', patch }` where `Object.keys(patch).sort()` is `['codAmount','destPin','payment','paymentGuessed']`; `writes.dispatches` is empty; the stored `d9.status`, `d9.return`, `d9.customer` are unchanged; the toast says `1 order(s) filled in`.
  - orders-ui.test.js: a dropped page whose saved record already has all four fields → Save with nothing ticked → `notify.warning('Nothing ticked to save')` and no writes.
- [ ] **Step 2:** Run `node tests/run.mjs dispatch` and `orders-ui` → FAIL.
- [ ] **Step 3:** Implement `backfillPatch`. In `commitLabel`: compute `fills = pending.rows.filter(r => (r._dupe === 'exists' && !r._keep) || r._dupe === 'locked').map(r => ({ id: r._existingId, patch: backfillPatch(dispatches.find(d => d.id === r._existingId), r) })).filter(f => f.patch)`; the "nothing to save" guard fires only when `keep` and `fills` are both empty; write each fill with `store.updateDispatch(id, patch)`; toast `N order(s) saved` and/or `F order(s) filled in (PIN / payment)`.
- [ ] **Step 4:** UI: `noteCell` adds `<span class="ord-fill">fills PIN / payment</span>` when the row would backfill; the confirm note adds `· F will fill in PIN / payment`; Save label becomes `Fill in F order(s)` when only fills exist. Orders table and review show a payment chip: `COD ₹5,846` / `COD` / `Prepaid` / `Prepaid?` (guessed) / nothing for old records. Add `focusForwardId` to the returned API.
- [ ] **Step 5:** Run `node tests/run.mjs` → all green.
- [ ] **Step 6:** Commit `Orders: re-dropping a label fills in PIN and payment, nothing else`.

### Task 5: Geo data — PIN directory and India outline

**Files:**
- Create: `scripts/build-geo.mjs`, `assets/geo/pincodes.json`, `assets/geo/india-states.json`, `tests/geo-data.test.js`
- Modify: `tests/run.mjs` (copy `assets/geo/*.json` into `<sandbox>/geo/`)

**Interfaces:**
- Produces `assets/geo/pincodes.json`: `{ v: 1, source: string, built: 'YYYY-MM-DD', states: string[], districts: Array<[name: string, stateIdx: number, lat: number, lng: number]>, pins: { [pin: string]: [districtIdx: number, area: string] } }`.
- Produces `assets/geo/india-states.json`: GeoJSON `FeatureCollection`, each feature `properties.name` equal to one entry of `pincodes.json` `states` (same spelling), one feature per state/UT (36).

- [ ] **Step 1: Get the PIN CSV.** Try in order: data.gov.in's "All India Pincode directory with contact details along with Latitude and longitude" (resource id `0a0764783fd34e2cb2d2581876f56d77`; fields `circlename, regionname, divisionname, officename, pincode, officetype, delivery, district, statename, latitude, longitude`); then a mirror of the same India Post file (e.g. Dataful dataset 19996, `saravanakumargn/All-India-Pincode-Directory`). Save under the scratchpad (never in the repo). If every route needs a captcha, **stop and ask the owner** to download the CSV from data.gov.in and put it in the scratchpad.
- [ ] **Step 2: Get the outline.** Download the Survey-of-India-derived state shapefile (`VTIITI/India-State-and-Country-Shapefile-Updated-Jan-2020`) into the scratchpad; convert and simplify with `npx mapshaper` to GeoJSON ≤ 400 KB, keeping a `name` property per state.
- [ ] **Step 3: Check the boundary visually.** Render the GeoJSON to PNG in the scratchpad (e.g. `npx @resvg/resvg-js-cli` on an SVG generated from the features) and look at it: J&K including PoK and Aksai Chin, Ladakh as its own unit, Arunachal Pradesh complete. If it fails, try the next source; do not ship a failing outline.
- [ ] **Step 4: Write `scripts/build-geo.mjs <csv> <geojson>`**: one PIN → the district with the most offices; area = most common office name (strip ` B.O`/` S.O`/` H.O` suffixes, title case); coords = median of the PIN's offices inside lat 6–38, lng 68–98; district coords = median of its PINs; state names normalised to the GeoJSON names through an explicit alias table (e.g. `DELHI`↔`NCT OF DELHI`, the merged Dadra/Nagar Haveli/Daman/Diu UT), and the script **fails** listing any state name it cannot map. Writes both files to `assets/geo/`; `pincodes.json` ≤ 600 KB.
- [ ] **Step 5: Write `tests/geo-data.test.js`** (reads `./geo/pincodes.json` and `./geo/india-states.json`): every `states` entry is a feature name and vice versa; `pins['110001']` resolves to state Delhi; `400001` → district Mumbai, Maharashtra; `560001` → Bengaluru Urban (or the CSV's spelling of it), Karnataka; `201301` → Gautam Buddha Nagar, Uttar Pradesh; `801105`, `208017`, `229001` all resolve (Bihar, Uttar Pradesh, Uttar Pradesh); pin count > 18000; every district's lat/lng is inside India's bbox.
- [ ] **Step 6:** Update `tests/run.mjs` `build()` to copy `assets/geo/*.json` into `join(sandbox, 'geo')`. Run `node tests/run.mjs` → all green.
- [ ] **Step 7:** Commit `Geo data: India Post PIN directory and official state outline` (README attribution comes in Task 9).

### Task 6: `js/order-geo.js` — the numbers behind the map

**Files:**
- Create: `js/order-geo.js`, `tests/order-geo.test.js`

**Interfaces:**
- Consumes: `productsOf` (myntra-dispatch.js), `normZmCode`, `normColorKey` (utils.js), `RETURN_TYPES`, `DISPATCH_STATUS` (constants.js), the `pincodes.json` shape from Task 5, `pricingIndex` output.
- Produces:
  - `extractPin(address: string) → string|null` — cut the text at the first `/if\s+undelivered|kuntal\s+fashion/i`, then the last `[1-9]\d{5}` not preceded/followed by a digit.
  - `orderPin(d) → { pin: string, source: 'typed'|'label'|'address' } | null` — `d.pinOverride` → `d.destPin` → `extractPin(d.customer?.address)`.
  - `lookupPin(pin, dir) → { pin, state, district, area, lat, lng } | null`.
  - `validatePinOverride(pin, dir) → ''|string` — `''` when 6 digits and in `dir`; else `'Enter a 6-digit PIN'` / `'PIN not found in the India Post list'`.
  - `filterOrders(dispatches, { from = '', to = '', zm = '', colour = '', state = '' }, dir) → Array<{ d, loc, products }>` — drops `status === 'unfulfillable'`; bounded dates exclude records without `dispatchDate`; `products` keeps only matching products when `zm`/`colour` is set (an order with none is dropped); `loc` is `lookupPin(orderPin(d)?.pin, dir)` with `pinSource` added, or `null`.
  - `summarise(filtered, priceIdx) → { kpis, byState, byCity, byPin, risky, unknown, zones, payment, unpricedProducts }` where each group is `{ key, label, state, orders, pieces, returned, rto, customerReturn, fake, returnRate, estValue, cod, prepaid, codAmount, unrecordedPayment }`; `kpis` = `{ orders, pieces, states, cities, returnRate, fake, estValue, located, unknown }`; `byCity` key = `state|district`, label = district; `byPin` label = `area`; `unknown` = `[{ id, forwardId, customer, address, reason: 'no PIN'|'PIN not in directory' }]`.
  - `riskyAreas(groups, { minOrders = 3, flagAbove = 0.4 } = {}) → groups` sorted by returnRate desc then orders desc.
  - `productByState(filtered, { by = 'sku', topStates = 8 } = {}) → { columns: string[] /* top states + 'Other' */, rows: Array<{ key, total, cells: number[] }> }` by pieces, rows sorted by total desc.
  - `weeklyTrend(filtered, { topStates = 5 } = {}) → { weeks: string[] /* Monday ISO dates, ascending, no gaps */, series: Array<{ state, counts: number[] }> }`.
  - `ZONES: Record<'Northern'|'Central'|'Eastern'|'Western'|'Southern'|'North-Eastern', string[]>` (state names as in `pincodes.json`), `zoneOf(state) → string` (`'Other'` if unmapped).
  - `orderMapSheets(summary, pbs) → Array<{ name, aoa }>` — sheets `States`, `Cities`, `PINs`, `Product x State`, `Risky Areas`, `Zones`, `Unknown Location`.

- [ ] **Step 1: Write the failing tests** in `tests/order-geo.test.js` with a hand-made `dir` (4 states, 5 districts, ~8 PINs incl. 801105, 208017, 229001, 201301, 395010) and ~12 dispatch fixtures:
  - `extractPin('railway hospital Khagaul Patna 801105 India')` → `'801105'`; `'AMOUNT TO BE PAID EK_E2E Rs.5846.0 PAT/PNP (801105'` → `'801105'`; `'12 MG Road 400053 If undelivered, Please return to KUNTAL FASHION … Gujarat, 395010'` → `'400053'`; `'397/21 OPPOSITE … AMARNAGAR'` → `null`; `'Flat 1234567'` → `null`.
  - `orderPin`: override beats label beats address; source names correct.
  - `validatePinOverride('2013', dir)` → `'Enter a 6-digit PIN'`; `'999999'` → `'PIN not found in the India Post list'`; `'201301'` → `''`.
  - `filterOrders`: unfulfillable dropped (Review Focus 1); combo `[ZM-49 ×1, ZM-43 ×1]` with `zm:'ZM-43'` → kept once, `products` length 1, pieces 1 (Review Focus 2); a record with no `dispatchDate` kept for `{}` and dropped for `{from:'2026-10-01'}`; an old record with only `sellerSkuCode`/`qty` (no `products`) counts its pieces (Review Focus 5); `state` filter keeps only that state.
  - `summarise`: state totals and return rate (`returned / orders`), `rto`/`customerReturn`/`fake` split; `estValue` = qty × `myntraIsp`, unpriced product counted in `unpricedProducts`; payment: `cod`, `prepaid`, `codAmount` sum, `unrecordedPayment` for records without `payment` (Review Focus 5); `unknown` reasons `'no PIN'` and `'PIN not in directory'`.
  - `riskyAreas`: 2 orders / 2 RTO → not flagged; 3 orders / 2 RTO → flagged; 3 orders / 1 fake → flagged; 5 orders / 1 RTO → not flagged.
  - `productByState`: columns are the top N states + `'Other'`; cells sum to `total`; `by:'zm'` merges colours.
  - `weeklyTrend`: dispatches on Sun 2026-10-25 and Mon 2026-10-26 fall in weeks `'2026-10-19'` and `'2026-10-26'`; an empty week in between appears with zeros.
  - `zoneOf('UTTAR PRADESH')` → `'Central'`; `zoneOf('BIHAR')` → `'Eastern'`; `zoneOf('KARNATAKA')` → `'Southern'`; every state in the real `pincodes.json` maps to a zone (read `./geo/pincodes.json`).
  - `orderMapSheets`: 7 sheets in the order above; `Unknown Location` is the only sheet containing a customer name.
- [ ] **Step 2:** Run `node tests/run.mjs order-geo` → FAIL (module missing).
- [ ] **Step 3:** Implement `js/order-geo.js` (pure; no DOM, no Firestore imports). Zone lists follow the Zonal Councils: Northern = J&K, Ladakh, Himachal, Punjab, Chandigarh, Haryana, Delhi, Rajasthan; Central = Uttar Pradesh, Uttarakhand, Madhya Pradesh, Chhattisgarh; Eastern = Bihar, Jharkhand, Odisha, West Bengal; Western = Gujarat, Maharashtra, Goa, Dadra/Nagar Haveli/Daman/Diu; Southern = Andhra Pradesh, Telangana, Karnataka, Kerala, Tamil Nadu, Puducherry, Lakshadweep, Andaman & Nicobar; North-Eastern = Assam, Arunachal, Manipur, Meghalaya, Mizoram, Nagaland, Tripura, Sikkim.
- [ ] **Step 4:** Run `node tests/run.mjs` → all green.
- [ ] **Step 5:** Commit `Order Map: pure location, return and product calculations`.

### Task 7: Order Map tab UI

**Files:**
- Create: `js/myntra-ordermap.js`, `tests/ordermap-load.test.js`
- Modify: `myntra.html` (tab button after Orders, `<div id="tab-ordermap">` markup, `TABS` at line 1051, mount in `load()`, `state.setTab = setTab`, KPI tab count), `css/zari.css` (map panel, heat cells, chips)

**Interfaces:**
- Consumes: everything from Task 6; `ordersTab.getDispatches()`, `ordersTab.refresh()`, `ordersTab.focusForwardId(id)` (Task 4); `state.pricing`; `pricingIndex`; `updateDispatch` (firestore-service.js, overridable via `state.storage`).
- Produces: `initOrderMapTab(state, { ordersTab }) → { render(): void, onShow(): Promise<void> }` and `loadGeo(fetchFn = fetch, base = 'assets/geo/') → Promise<{ dir, outline }>` (rejects with `Error('Could not load map data: <file> (<status>)')`).

- [ ] **Step 1: Write the failing test** `tests/ordermap-load.test.js`: `loadGeo` with a fake fetch returning both JSON bodies → resolves `{ dir, outline }`; with a fake 404 for `pincodes.json` → rejects with a message containing `pincodes.json` and `404` (Review Focus 3).
- [ ] **Step 2:** Run `node tests/run.mjs ordermap-load` → FAIL.
- [ ] **Step 3:** Implement `loadGeo` and the tab. `onShow()` runs once per page load: inject `<script src=".../echarts/5.5.1/echarts.min.js">`, `await loadGeo()`, `echarts.registerMap('india', outline)`; skeleton while loading; error card on failure (other tabs untouched). `setTab('ordermap')` calls `onShow()`; `state.onOrdersChange` and `state.onPricingChange` also call `orderMap.render()` (only if loaded).
- [ ] **Step 4:** Layout per the spec, ids prefixed `om-`: filter bar (`om-range` 7/30/90/All/custom with `om-from`/`om-to`, `om-zm`, `om-colour`, `om-state-chip`, `om-export`), KPI tiles, map with metric switch (Orders / Pieces / Return % / Fake; gold ramp for volume, red ramp for Return % / Fake; city bubbles = top 25 cities via `scatter` on district coords), Top states + Top cities beside it (stack under 1024 px), Top PINs (area, city, state, orders, return %), Product × State table (`SKU | ZM code` toggle, cell background alpha ∝ value), Risky areas, Weekly trend (ECharts line), Zones table, COD vs Prepaid by state with `N orders before payment was recorded`, Unknown location rows with PIN input + Save (`validatePinOverride`, then `updateDispatch(id, { pinOverride })`, then `ordersTab.refresh()`), × to clear (`{ pinOverride: null }`), `Open in Orders` (`state.setTab('orders'); ordersTab.focusForwardId(forwardId)`), hint about re-dropping old PDFs, attribution line. Clicking a state sets `view.state`; clicking it again or the chip clears it. Every value from records goes through `esc()`.
- [ ] **Step 5:** Excel: `orderMapSheets(...)` → one workbook, file `Myntra_Order_Map_${exportDateStamp()}.xlsx`.
- [ ] **Step 6:** Run `node tests/run.mjs` → all green. Serve locally (`npx serve .` from the repo root), open `myntra.html#ordermap`, confirm: map draws, hover/click work, filters change numbers, export opens, no console errors; then block `assets/geo/pincodes.json` (rename temporarily) and confirm the error card appears and the Mapping tab still works. Login is Firebase Auth — if automation can't log in, ask the owner to log in in the browser.
- [ ] **Step 7:** Commit `Order Map tab: India map, cities, products by state, risky areas`.

### Task 8: Myntra page polish (all 7 tabs)

**Files:**
- Modify: `css/zari.css` (or `css/custom.css` for layout), `myntra.html` (card headers, tab bar), `js/ui-components.js` (shared helpers), the empty-state strings in `myntra.html`, `js/myntra-pricing.js`, `js/myntra-purchase.js`, `js/myntra-returns.js`, `js/myntra-orders.js`, `js/myntra-ordermap.js`

**Interfaces:**
- Produces: `emptyStateHTML(icon: string, line: string, hint?: string) → string` and `skeletonRows(cols: number, rows = 5) → string` in `js/ui-components.js`; CSS classes `.zm-card-head` (wrapping header), `.zm-num` (right-aligned IBM Plex Mono), `.zm-tabbar.has-fade-left/right`.

- [ ] **Step 1:** Add the two helpers and the CSS classes. Tab bar: edge fades toggled on scroll; `setTab` calls `scrollIntoView({ inline:'nearest', block:'nearest' })` on the active tab button.
- [ ] **Step 2:** Apply per tab: card headers use `.zm-card-head` (actions wrap under the title below 640 px); toolbars `flex-wrap` with consistent `zm-input` heights; numeric `<td>`s get `.zm-num`; each "No … yet" message becomes `emptyStateHTML(...)` with the action to take; Firestore-loading panels show `skeletonRows(...)` until `load()` resolves.
- [ ] **Step 3:** Run `node tests/run.mjs` → all green (orders-ui may need its fake DOM to tolerate the new helpers — fix the test double, not the behaviour).
- [ ] **Step 4:** Browser check every tab at 1440 px and 390 px: no horizontal page scroll, wide tables scroll inside their card, headers wrap cleanly, console clean.
- [ ] **Step 5:** Commit `Myntra page: consistent headers, tables, empty states and phone layout`.

### Task 9: Check, document, deploy

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** README: Myntra hub table gets the 7th tab; new "🗺️ Order Map" section (what it shows, PIN precedence typed → label → address, risky rule, backfill on re-drop, typed PIN); Orders section notes the payment chip and "best guess" rule; Firestore structure adds `destPin, payment, codAmount, paymentGuessed, pinOverride` to `dispatches`; File Structure adds `assets/geo/`, `scripts/build-geo.mjs`, `js/order-geo.js`, `js/myntra-ordermap.js`; External Libraries adds ECharts; data attribution (India Post / data.gov.in, GODL-India).
- [ ] **Step 2:** `node tests/run.mjs` → `all green — 11 suites`. Full browser pass over all 7 tabs (desktop + 390 px), console clean.
- [ ] **Step 3:** Commit `README: Order Map, label fields, geo data`.
- [ ] **Step 4:** Deploy: `"$S/g.sh" checkout main && "$S/g.sh" merge --ff-only myntra-order-map && "$S/g.sh" push origin main`. If the push asks for credentials, stop and tell the owner.
- [ ] **Step 5:** After GitHub Pages rebuilds (poll `https://zimonza.github.io/zimonza-daily-stock-update/myntra.html` until it shows the `Order Map` tab, up to ~10 min), confirm `assets/geo/pincodes.json` returns 200 and the tab loads.
