# 🏆 ZIMONZA DAILY STOCK UPDATE
**Premium Inventory Intelligence & Product Upload Management System**

A world-class SaaS-style inventory dashboard built with HTML5, Tailwind CSS, Vanilla JavaScript (ES Modules), and Firebase — zero frameworks, zero build steps.

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/zimonza-daily-stock-update.git
cd zimonza-daily-stock-update
```

### 2. Configure Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project (or use existing)
3. Enable **Authentication → Email/Password**
4. Enable **Cloud Firestore** (start in production mode)
5. Go to **Project Settings → Your Apps → Web App**
6. Copy the config object and paste into **`js/firebase-config.js`**:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3. Create Admin User

In Firebase Console → Authentication → Add user with email & password.

### 4. Deploy Firestore Rules

In Firebase Console → Firestore → Rules, paste the contents of `firestore.rules`.

### 5. Run Locally

```bash
# Option A: Python
python3 -m http.server 8080

# Option B: Node
npx serve .

# Option C: VS Code Live Server
# Right-click index.html → Open with Live Server
```

Visit `http://localhost:8080`

---

## 📁 File Structure

```
/
├── index.html              ← Entry point (redirects to login/dashboard)
├── login.html              ← Firebase Auth login
├── dashboard.html          ← KPI + Charts executive dashboard
├── upload.html             ← Excel file upload & processing center
├── stock-analysis.html     ← Full inventory table with filters
├── zm-panel.html           ← ZM product code & upload status manager
├── pdf-to-excel.html       ← PDF → Excel converter + PDF sorter/merger
├── myntra.html             ← Myntra hub: inventory update, mapping, pricing,
│                             purchase billing, returns & RTO, orders, order map
├── new-arrivals.html       ← Newly detected SKUs
├── sold-items.html         ← Stock decreases with color breakdown
├── restocked.html          ← Stock increases panel
├── sold-out.html           ← Zero-quantity products
├── low-stock.html          ← 1–2 pcs remaining (card view)
├── skip-panel.html         ← Products excluded from upload workflow
├── history.html            ← Calendar-based upload history
├── reports.html            ← Generate & export PDF/Excel/CSV reports
├── settings.html           ← Theme, thresholds, Firebase config
│
├── css/
│   ├── custom.css          ← Core layout + legacy components
│   ├── animations.css      ← Keyframes
│   ├── theme.css           ← Badges, chips, page-specific bits
│   └── zari.css            ← 🎨 Midnight Zari design system (loaded last)
│
├── js/
│   ├── firebase-config.js  ← ⚙️ YOUR FIREBASE CREDENTIALS GO HERE
│   ├── auth.js             ← Authentication module
│   ├── firestore-service.js← All Firestore read/write operations
│   ├── excel-parser.js     ← SheetJS-powered Excel processor
│   ├── stock-analyzer.js   ← Comparison engine (sold/restock/new)
│   ├── zm-mapper.js        ← ZM product code logic
│   ├── myntra.js           ← SKU parsing, stock resolution, update generator
│   ├── myntra-pricing.js   ← Myntra Pricing.xlsx parser + Pricing tab
│   ├── myntra-purchase.js  ← Purchase cart, GST maths, bill history
│   ├── myntra-returns.js   ← Customer returns & RTO register
│   ├── invoice-pdf.js      ← GST bill PDF, pick slip PDF + previews
│   ├── myntra-labels.js    ← label.pdf reader (one page = one parcel)
│   ├── pdf-merge.js        ← PDF sorter & merger (label/invoice grouping)
│   ├── myntra-fulfilment.js← Label → RTO stock first, then purchase
│   ├── myntra-dispatch.js  ← Dispatch records + return-abuse analytics
│   ├── label-barcode.js    ← Barcode fallback when the text has no ID
│   ├── myntra-label-layout.js ← Reads a Myntra label by position, not keywords
│   ├── myntra-orders.js    ← Orders & fake returns tab
│   ├── order-geo.js        ← Order Map maths: PIN → place, states, cities, risk
│   ├── myntra-ordermap.js  ← Order Map tab (ECharts, loaded on first open)
│   ├── skip-manager.js     ← Skip list management
│   ├── history-manager.js  ← Calendar & history logic
│   ├── report-generator.js ← PDF/Excel/CSV export
│   ├── charts.js           ← Chart.js wrappers
│   ├── ui-components.js    ← Sidebar, topbar, shared components
│   ├── notifications.js    ← Toast notification system
│   ├── filters.js          ← Filter & pagination helpers
│   ├── utils.js            ← Date, color parsing, formatters
│   └── constants.js        ← App-wide constants & column maps
│
├── assets/geo/
│   ├── pincodes.json       ← India Post PIN directory, compacted (19,300 PINs)
│   └── india-states.json   ← State outline, India's official boundary
├── scripts/build-geo.mjs   ← Rebuilds both geo files from their sources
├── tests/                  ← node tests/run.mjs
├── firestore.rules         ← Firestore security rules
├── firebase.json           ← Firebase Hosting config
└── .env.example            ← Environment variables template
```

---

## 📡 Orders & Fake Returns

Sixth tab on the Myntra page. Every label that ships becomes a **dispatch**, keyed by the forward tracking ID under its barcode — so when a parcel comes back, you find it by the number written on it.

**A report, and nothing else.** Orders & Fake Returns is deliberately **not linked** to Purchase or to Returns & RTO. Labels reach it only by being dropped on this tab — the Purchase tab no longer feeds it — and nothing recorded here ever creates, moves or removes stock. Returned pieces go back into stock through the Returns & RTO tab, by hand.

Because Purchase no longer shares its parse, it also no longer decodes barcodes: it needs SKUs and piece counts only, and the tracking ID on a Myntra label is barcode artwork, so leaving that on would rasterise every page for a value it never used.

**Getting labels in — date first, then the PDF.**

1. **Pick the dispatch date.** It starts on today and cannot go past today. Every order in the PDF you drop is recorded as dispatched on this date, so it is chosen *before* the file, not guessed from the day you happen to upload.
2. **Drop that day's label PDF.**

Until the date is valid the drop zone is locked — greyed, the file picker disabled — and a PDF dropped on it anyway is refused unread with a message saying to pick the date first. A date must be a real calendar date (30 February is not) and not in the future. The picker never remembers yesterday's choice: a date carried over from an earlier session would silently mis-date a whole day's orders.

The review header names the day it is recording. Change the date while the review is open and the rows move with it — except any row whose date you already set by hand, which keeps its own. **Add Order** starts on the same picked day and follows the same rule.

**Combo parcels.** One label page is one parcel, and a parcel can carry several products — Myntra prints one line per piece:

```
ZM-49-Pyazi -
ZM-43-Chiku -        ← one parcel, two products, two pieces
```

Every product is read and kept on the **one** parcel record, each with its own piece count; the parcel total is their sum. The review lists them all, editable line by line, with **+ product** and **×** to correct a misread. The orders table shows each product with its colour chip, and search finds a parcel by any product in it — not just the first. A parcel printed across two pages under one tracking ID folds into a single record, adding up by code rather than listing a product twice.

**Reading the label — by its layout, not by keywords.**

A Myntra label is a form, not a paragraph. The old reader flattened the page into one string and hunted for words like "Ship To" — which a Myntra label does not contain. On a real label it returned **no customer name at all**, and an address of `AMOUNT TO BE PAID EK_E2E Rs.5846.0 PAT/PNP (801105` — the courier routing code at the very top of the page, because that is the first six-digit number on it. Worse, it reported that address as complete.

So the coordinates PDF.js already provides are kept, the lines are rebuilt in reading order, and each field is read from where it sits:

| Field | Where it is |
|---|---|
| **Tracking ID** | the `MY`-prefixed token under the barcode — `MYC…`, `MYEC…` |
| **Customer name** | the first line under **"Buyer's Name And Address"** |
| **Delivery address** | every line after the name, until **"If undelivered"** |
| **SellerSkuCode** | the bracketed code, `[ZM-43-Rani - T]` → `ZM-43-Rani`; the size after the dash is dropped |

Reading *downward from an anchor* is what makes the seller's own address impossible to mistake for the buyer's. Everything from "If undelivered" onward belongs to Kuntal Fashion, and the reader stops there. A wide horizontal gap between two runs is treated as a column break rather than a space, so a name never gets glued to whatever is printed beside it.

**The tracking ID survives being split.** PDF.js breaks one printed string into however many runs it likes, so `MYEC1118733669` commonly arrives as `MYEC` + `1118733669` and reads back as `MYEC 1118733669`. A boundary-anchored pattern misses that, and the ID — the one field the whole returns flow is keyed on — was being lost in silence. Each line is now tried as printed, then rejoined with no spaces and tried again. Never across lines: fusing two rows could manufacture an ID that was never on the label.

A label with no Myntra markings falls back to the old keyword reader, so other couriers still work.

**Then, cheap answers first.**

1. **The printed text**, read by layout as above. This costs nothing.
2. **The barcode itself.** The page is rendered to an image and decoded — with the browser's own `BarcodeDetector` where it exists (Chrome, Edge: no download at all), and ZXing from the CDN otherwise, imported lazily so a session that never needs it never fetches it.

   By default this runs *only* where the text gave no tracking ID. Tick **Read every barcode** on the Orders tab and it decodes every page and checks each against the printed number:

   | Outcome | Badge |
   |---|---|
   | they agree | `text ✓ barcode` |
   | **they disagree** | `text ≠ barcode` — **neither is chosen for you**; the printed value is kept and the barcode value stored beside it |
   | nothing printed, barcode read | `barcode` |

   A decode that fails now reports **why**. "No barcode found on the page" reads very differently from "the decoder threw", and a decoder that quietly returns nothing is indistinguishable from a label that has no barcode.

On a real Myntra label the text never carries the tracking number — it is barcode artwork — so in practice the barcode is read on **every** page. That makes its cost per-page, which is why the decoder tries the header band where the strip actually sits before the far more expensive whole-page pass (measured at 2.5× the cost), and frees each page's pixels as soon as it is done. **Every row shows which route its ID came from** — `text`, `barcode`, `barcode? check` (read, but not a MY… number) or `typed` — because a decoded value is not the same claim as one the label actually printed.

Tracking ID, order ID, customer name and address are each read independently, and **anything the label did not print is flagged rather than invented** — an empty buyer block yields two flagged blanks, never a guess.

**Destination PIN and payment.** The bracketed routing code at the top of every Myntra label — `(801105)-(1509)` — is the buyer's PIN. On a combo label it is often the only PIN printed anywhere, so it is kept as `destPin`. The header also says whether the parcel is COD; the amount to collect is kept as `codAmount`. No prepaid label has been seen yet, so the rule is a stated best guess: `COD` printed, or an amount to collect, means COD; anything else is prepaid, and `paymentGuessed` marks it whenever neither word was printed. The orders table shows a chip — `COD ₹5,846`, `Prepaid`, or `Prepaid?` for a guess.

**Re-dropping an old label fills in what is missing — and nothing else.** Orders saved before these fields existed have no `destPin` or payment. Drop their label PDF again: every saved order that matches (including a returned, locked one) gets exactly `destPin`, `payment`, `codAmount` and `paymentGuessed` — only where it has none. Status, the return, the customer, products and dates are never part of that write, so a fake-return record stays exactly as it was. The review marks those rows *fills PIN / payment*, and Save reads *Fill in N order(s)* when that is all there is to do.

**The review is editable.** Every cell is a live input — tracking ID, order ID, SellerSkuCode, quantity, customer, address, dispatch date. Fix whatever the label got wrong, then save. Two things follow your edits automatically:

- **Correcting a name or address re-groups the record.** The repeat-returner key is name → address → order ID; typing a name into a row that only had an address moves it into the name group, so the analytics never count stale evidence.
- **A corrected SellerSkuCode brings its ZM code and colour with it**, so a record cannot end up pointing at a style that does not exist.

**Pages with no tracking ID are listed too**, with a blank cell to type into — losing a parcel is worse than showing an incomplete row. Saved without one, it is called out: a return cannot find that parcel until an ID is added.

**Re-uploading the same file is safe.** Each row is checked against what is already saved:

| | |
|---|---|
| new | ticked, saves normally |
| already saved | **unticked**, flagged — tick it to update the details |
| **already returned** | **locked.** Cannot be saved over at all |

An update writes the details only: `status` and `return` are stripped from the payload entirely, so correcting a customer's name can never push a returned parcel back to `shipped` or erase the return. That last row matters most — a fake-return record is the evidence against a customer, and dropping the same PDF twice used to destroy it.

**Recording a return.** Search the forward ID, hit Open, enter the return ID and pick the type. Every type is **recorded in the report only** — no stock changes:

| Type | Effect |
|---|---|
| RTO | Marked returned, with its return ID and the condition it came back in |
| Customer Return | Same |
| **Fake Return** | Marked returned, with **what was actually inside** — and it counts against the customer |

The modal states which of these will happen before you save.

**Repeat returners.** Grouped by the best key the label gave — customer name where printed, otherwise delivery address, otherwise order ID — and every row shows **which key it matched on**, so a count built on a masked address never reads as a confirmed person. A single fake return flags a customer on its own; a high return rate needs at least three orders behind it to mean anything.

---

## 🗺️ Order Map

Seventh tab on the Myntra page. It reads the orders already recorded in **Orders & Fake Returns** — nothing new to upload — and shows where they go, what sells where, and where parcels come back from. It writes nothing except a PIN typed by hand, and never touches stock.

**Which PIN an order belongs to** — the first that exists, and every PIN row says which:

| Source | Where it comes from |
|---|---|
| `typed` | typed by hand on the Unknown list (stored as `pinOverride`) |
| `label` | the label's routing code (`destPin`) |
| `address` | the last 6-digit PIN in the delivery address, never from the seller's return-to block |

The PIN is looked up in India Post's directory, shipped with the app as `assets/geo/pincodes.json`. "City" is India Post's **district** name — Noida shows as *Gautam Buddha Nagar*, Gurgaon as *Gurugram* — with the area name beside it.

**What it shows**, all following the date range (7 / 30 / 90 days, all, or custom), ZM code and colour filters:

- **India by state**, shaded by Orders, Pieces, Return % or Fake returns. Hover for the numbers; **click a state** and everything below narrows to it. Dots are the 25 busiest cities.
- **Top states, cities and PINs.**
- **Which products go where** — pieces per SKU (or ZM code) across the busiest states, for stock planning.
- **Risky areas** — a PIN or city is flagged only with **3 or more orders** and a return rate of 40%+ or any fake return; one bad parcel never flags a town.
- **Orders per week** for the top five states, **zones** (the Government's six Zonal Councils), and **COD vs Prepaid** by state, with how many orders predate payment being recorded.
- **Value** at Myntra ISP from the Pricing tab, shown in lakh/crore short form with the full figure on hover; product lines with no ISP are left out and counted.
- **Unknown location** — orders with no usable PIN. Type a PIN (it must exist in the directory) and the order moves onto the map; × removes a typed PIN. Or re-drop the label in Orders to fill it in.
- **Export Excel** — States, Cities, PINs, Product x State, Risky Areas, Zones, Unknown Location. Customer names appear only on Unknown Location, where they are needed to fix a row.

An unfulfillable order never shipped, so it is never counted. A bounded date range leaves out orders with no dispatch date; *All time* keeps them.

ECharts and both data files load the first time the tab is opened, so no other tab pays for them. If either fails, the tab says which file and why; the other tabs carry on.

**Data and licences.** PIN data: India Post *All India Pincode Directory* via data.gov.in (GODL-India). State boundaries: DataMeet India community, `States/Admin2` (CC BY 4.0), which follows India's official boundary — all of Jammu & Kashmir, and Ladakh including Gilgit-Baltistan and Aksai Chin. Rebuild both with `node scripts/build-geo.mjs <pincode.csv> <states.geojson>`; it fails, naming the culprit, if any state name does not match between the two.

---

## ↩️ GR — Goods Return / Credit Note

A fourth document type in the Purchase tab, for stock you bought and no longer want.

Selecting **Goods Return (Credit Note)** flips the tab into return mode:

- **Lines come only from the Returns & RTO register.** Never the mapping catalogue, never a fresh purchase, never another supplier. A GR is dead stock going back where it came from.
- **Damaged and missing pieces are included** — they are the first thing you would send back. The condition prints on each line so Kuntal can see why.
- **Quantities are capped** at what the register actually holds, in the picker and on edit.
- **Two separate carts.** Purchase and GR persist under different keys, so switching document type never mixes lines from two different sources.

The document flips with it: parties become **RETURNED BY** (you) → **RETURNED TO** (Kuntal Antique ART), the header carries your name, a **Condition** column appears, and the totals bar reads **CREDIT DUE**. A purchase bill is untouched — the column set is built from the lines, and every difference hangs off one `isReturn` flag.

GST is the same arithmetic: a credit note reverses tax at the rate it was charged, so a GR and the equivalent purchase produce identical numbers. The wording carries the direction, not a negative sign.

**Saving** follows the same order as a label run — allocate against the register as it stands *now* (a cart left open while stock moved cannot over-draw), write the document, and only then decrement. Paperwork before stock, so a failure leaves a visible document rather than pieces that quietly vanished.

Saved GRs sit in **Saved Bills**, badged and tinted, with the running credit raised shown alongside the count.

The **Fulfil from Label** flow excludes GR from its "Buy as" list — a label sends goods out to a customer and can never raise a return.

---

## 🎨 Midnight Zari

The interface is built on *zari* — the metallic thread woven through the textiles this business sells.

| Token | Value | Role |
|---|---|---|
| `--void` | `#07070A` | page ground |
| `--ink` | `#0E0E14` | panels |
| `--zari` | `#D9A441` | the gold thread |
| `--silk` | `#EDE7DA` | text — warm off-white, never `#FFF` |

**Type.** Bricolage Grotesque for display, IBM Plex Sans for UI, **IBM Plex Mono for every code and figure** — `ZM-42-Morpichh` and `8,990.00` only line up in a tabular face. Deliberately not a high-contrast serif: black + gold + didone is the reflex luxury pairing and would make an operations tool read as a perfume advert.

**The colour chip.** Every colour name renders in its real colour ([js/swatches.js](js/swatches.js)) — Morpichh peacock, Rani magenta, Firozi turquoise, Chiku sapota brown. Unknown names get a deterministic hashed colour, pinned above a luminance floor so none can vanish on a near-black page. It is how you find one row in four hundred.

**How it reaches 15 pages.** The pages carry 830+ hardcoded Tailwind colour utilities. Rather than rewrite that markup, [css/zari.css](css/zari.css) remaps them:

```css
.text-slate-500.text-slate-500 { color: var(--silk-3); }
```

The doubled class gives specificity `0-2-0`, which beats the Tailwind Play CDN rules injected at runtime after our own stylesheet link — without a single `!important`. One stylesheet, every page, no markup churn.

**Motion** lives in the chrome — ambient drift, sheen sweeps on hover, count-up KPIs, a sliding gold tab rail. Inside a 400-row table it is hover response only. All of it stops under `prefers-reduced-motion`, and the ambient animation pauses when the tab is hidden.

**Contrast, measured rather than assumed.** Every foreground was checked against the ink ground. Two failures turned up and were fixed: faint text at 2.76:1, now 4.21; and dark button text over the dark end of the foil ramp at 2.32:1 — buttons now use a floored ramp that never drops below 5.75:1.

---

## 📄 PDF Sorter & Merger

Second tab on the **PDF → Excel** page. Drop in any number of PDFs — `Label.pdf`, `Label (1).pdf`, `invoice.pdf`, anything — and get back **one merged PDF per document type**. Everything happens in the browser; no file is ever uploaded, which matters because labels carry customer addresses.

**How it decides what goes where.** Three signals, weighted and summed rather than tried in order:

| Signal | Example |
|---|---|
| Filename | `Label (1).pdf`, `Label-2.pdf`, `label_copy.pdf` all reduce to `label` |
| Content | *invoice* — `tax invoice`, `gstin`, `hsn`, `cgst` · *label* — `awb`, `ship to`, `courier` |
| Page size | 4×6 in thermal ≈ label · A4 / Letter ≈ invoice |

Because they are combined, a file called `8s7d6f.pdf` is still placed correctly by its content and size, and a **scanned label with no text at all** is still placed by its name and size. Where the signals contradict each other — a file named `Label.pdf` whose pages are plainly A4 invoices — the conflict shows up as **low confidence** with the reason spelled out, rather than a confident wrong answer. Every file has a dropdown to override the guess.

**Mixed PDFs are split.** Myntra sometimes ships one file with labels and invoices alternating. Each page is classified separately, and a file whose pages disagree is marked *Mixed — split* and its pages routed individually.

**Order and date.** Files sort naturally — the original first, then its copies in numeric order (`Label.pdf`, `Label (2).pdf`, `Label (10).pdf`) — and can be dragged. A **batch date** picker names the output, so a batch prepared for the 20th still produces `Label_merged_20-08-2026.pdf` when merged on the 22nd.

**Why pdf-lib and not jsPDF.** jsPDF would rasterise each page into an image, and a re-rendered **barcode is unreliable under a scanner**. pdf-lib copies page objects intact, so barcodes and text survive untouched. It is loaded lazily, only when the Merge tab is actually used.

Anything the signals cannot place lands in **Unsorted** — never silently dropped. An encrypted or corrupt PDF is marked unreadable and skipped; the rest of the batch still merges.

---

## 🛍️ Myntra Hub

One page (`myntra.html`), seven sections:

| Tab | What it does |
|-----|--------------|
| **Inventory Update** | Generates the `sellerSkuCode,quantity` file Myntra consumes. Takes a configurable % of each colour's stock above the gap threshold, and optionally adds usable Returns & RTO stock on top. A SKU switched off in Mapping is sent as **0** (locked), so Myntra shows it out of stock. |
| **Mapping** | SellerSkuCode, Style ID, ZM code, colour, Item No., today's stock, Kuntal Selling Price, Myntra MRP and ISP, with the live status toggle. Bulk activate / deactivate. |
| **Pricing** | Upload `Myntra Pricing.xlsx`, or edit it by hand — any cell, many rows at once, add or remove a style. Flags mapped styles that have no price (those cannot be billed). |
| **Purchase** | Cart → GST bill → PDF. Saved, auto-numbered, re-downloadable. Also GR credit notes, short-receive, and the per-bill note. |
| **Returns & RTO** | Register of goods coming back, with a stock summary. A label can be filled from it, and the inventory update can declare it. |
| **Orders** | A standalone report, not linked to Purchase or Returns & RTO. Drop a label here; every parcel is tracked to its customer by forward tracking ID, with every product in a combo parcel listed. Return recording, fake returns, repeat-returner analytics. |
| **Order Map** | Where orders go: India by state, top cities and PINs, products by state, risky areas, weekly trend, zones, COD vs prepaid. Reads the Orders tab; see **Order Map** above. |

### Including returns in the inventory update

The warehouse part is unchanged: colours at or below the gap threshold generate nothing, everything above generates `floor(qty × take%)`. Tick **Include usable Returns & RTO stock** and usable register pieces are added to that number **at full quantity** — no percentage, no gap rule, because those pieces are already on your shelf and can ship today.

```
quantity = floor(warehouseQty × take%)     only when warehouseQty > gap
         + usableReturnQty                 always, in full
```

A colour with zero warehouse stock and three usable returns now generates **3** instead of **0**, and is marked `returns only` so the number is never mistaken for warehouse stock. Every boosted row reports how much came from returns. Damaged and Missing are excluded — `availableReturnStock()` already holds them back.

The toggle is off by default and remembered. **Declaring is not consuming**: generating the file never touches the register.

### Returns & RTO file

The upload accepts the register's own export straight back in:

| Type | SellerSkuCode | ZM Code | Kuntal Code | Colour | Qty | Date | Condition | Reason | Notes |
|---|---|---|---|---|---|---|---|---|---|
| RTO | ZM-10-Pink | ZM-10 | 4144 | Pink | 1 | 20-08-2026 | good | | |

- **Headers are matched however they are written.** Cells are stripped to letters and digits before comparing, so `Kuntal Code`, `KUNTALCODE`, `kuntal_code` and `Item No` all land on the same field, and the columns may be in any order. `Reason` is resolved before `Notes` so "Remark" cannot steal it.
- **Colour spelling is corrected.** The mapping wins for a SKU it knows; otherwise the known-colour list is consulted by Levenshtein distance. Corrections are never silent — the review table shows `↻ rustt` next to the corrected value, and the row can still be unticked.
- **Dates are read day-first.** `20-08-2026`, `20/08/2026`, ISO, and genuine Excel date cells (stored as serial numbers) all work. `01/02/2026` is **1 February**, not 2 January — JavaScript's own date parser is deliberately not used for separator dates. An unreadable date is flagged in the review rather than silently blanked.
- Order ID and AWB are not read or stored.

Rows can be **selected in bulk and deleted**, or **edited** individually through the same form used to add them.

### Stock in Returns & RTO

Above the rows table, a summary of what the register is actually holding — SKUs, colours, ZM codes, total pieces, and **usable** pieces (what a label can pull, so Damaged and Missing excluded) — with a breakdown by ZM code listing each colour and its pieces. It follows the filters above it, and exports to CSV or Excel.

**Excel + Kuntal Price** exports the same breakdown priced for Kuntal: one row per ZM code — ZM Code, Kuntal Code, Colours, Total Pcs, Kuntal Price, Value (pcs × price) — and a **GRAND TOTAL** row of pieces and value. The file is `RTO_Stock_Kuntal_Price_DD-MM-YYYY.xlsx`, dated on the local calendar. A ZM code with no Kuntal price gets a blank price and value, never 0, and a note under the total says how many were left out of the value.

```
 SKUs 24   Colours 31   ZM Codes 18   Total 46   Usable 41   Held Back 5
────────────────────────────────────────────────────────────────────────
 ZM-42   3102   Rani 4 · Black 2 · Red 2      3    8      8
 ZM-43   3095   Chiku 3 · Pyazi 2             2    5      3
```

### Fulfil from label.pdf

Drop the shipping labels into the Purchase tab and the app works out what to send.

1. **Read** — every page is scanned for a SellerSkuCode. **One page = one piece**, so three pages carrying `ZM-11-Purple` means three pieces. Codes are matched against the saved mapping first (longest match wins), which is what lets colours containing spaces — `Parrot Green`, `Off White` — survive intact. A code not in the mapping is still picked up, but flagged.
2. **Split** — Returns and RTO are checked first, oldest piece out first (FIFO). Rows marked **Damaged** or **Missing** are held back; they cannot be shipped again.
3. **Review** — a table shows Need / From RTO / To Buy per SKU. `From RTO` is editable and capped at what actually exists, `To Buy` follows automatically. Rows can be unticked. Nothing is written yet.
4. **Confirm** — produces **two separate documents**:
   - a **Stock Pick Slip** (A5, no rate, no GST) for the pieces taken out of Returns / RTO, and
   - a **purchase bill** for the shortfall, with full CGST/SGST as usual.

   The returns rows are then decremented; a row that reaches zero is removed.

Documents are written *before* stock is touched, so a mid-run failure leaves visible paperwork rather than stock that vanished with nothing to show for it. The register is re-read at confirm time, so a review left open while stock moved cannot over-draw.

A scanned (image-only) label PDF has no text layer and is rejected with a message saying so.

**Add a line by hand.** The review table takes hand-added SKUs and editable `Need` quantities, so an order that never came through a label PDF still gets the same split, the same caps and the same two documents.

**Build by hand.** A mode switch on the panel — *Drop label.pdf* / *Build by hand* — lists the register directly so you can set take quantities and produce a Stock Pick Slip with no label at all. It runs through the same `exportPickSlipPDF` and the same `applyReturnConsumption`: one place makes slips, only the input differs.

> Running a fulfilment does not change the generated `sellerSkuCode,quantity` file. Returns reach that file only when you tick **Include usable Returns & RTO stock**, and even then only as a declared quantity — the register is untouched.

### Myntra Pricing.xlsx

| ZM Code | Kuntal Code | Category | Kuntal Selling Price | Myntra MRP | Myntra MU Price | Myntra ISP |
|---------|-------------|----------|----------------------|------------|-----------------|------------|
| ZM-01 | 4132 | lehnga | 8990 | | 13830.76923 | 13849 |

Zero-padded codes (`ZM-01`) are normalised to match SellerSkuCodes (`ZM-1-Morpichh`) — on labels and return rows too.
A blank Myntra MRP stays blank — it is never coerced to 0.

### Editing pricing by hand

Every cell but **ZM Code** is an input: Kuntal Code, Category, Kuntal Selling Price, Myntra MRP, MU Price, ISP. ZM Code is the key that Mapping, bills and returns join on, so to change one, remove the row and **Add style** again.

- **Nothing is saved as you type.** Changed cells turn amber; a bar shows *N changes · Discard · Save changes*. A cell that is not a number of 0 or more is outlined red, and Save waits until it is fixed. A blank price stays blank.
- **Many rows at once.** Tick rows (or *select all shown*), pick a column and a change — *Set to ₹*, *Increase / Decrease by %*, *Add / Subtract ₹* for prices (whole rupees; MU Price keeps paise; never below 0; a blank price stays blank), or *Set to* for Category and Kuntal Code. Apply only touches ticked rows still shown by the current filter, and it is still pending until Save.
- **Add / remove.** *Add style* adds a blank row (the box suggests mapped styles that have no price yet); the bin marks a row for removal, undone by clicking again.
- **On Save** all changes are written together, and the new figures show at once in Mapping, Purchase, the RTO Kuntal-price export and the Order Map. In an open Purchase cart, a line whose rate came from pricing takes the new price; a rate typed into the cart is kept. **Saved bills never change.**
- Leaving the page, or uploading a pricing file, with unsaved edits asks first.

### Purchase billing

- **From** Kuntal Antique ART → **Bill To** Kuntal Fashion Private Limited (brand: The Third Label). All names, GSTINs, addresses, bank details and terms are editable under **Parties & GST** and saved once.
- Rate per line is the **Kuntal Selling Price**, treated as **GST-exclusive**: `Amount = qty × rate` is the taxable value, CGST and SGST are added on top.
- GST rate comes from the line's category — lehnga 18% (9% + 9%), saree 5% (2.5% + 2.5%) by default. The rate table is editable, any line can be overridden, and lines whose category has no rate are flagged amber.
- Document type is chosen per bill: Tax Invoice / Purchase Order / Proforma Invoice. Numbers are reserved transactionally per type and financial year (`INV/26-27/0042`), and the counter **skips any number already saved** — a number once typed by hand can no longer be reached by the counter and overwritten. Every new bill (Purchase or label fulfilment) is written only if no bill with that number exists; otherwise it is refused, never written over.
- **Adding to a saved bill.** Type a saved bill's number (case and spaces don't matter) and press Save: a dialog shows the saved bill, what is being added and the new total; nothing is written until you confirm. The same SKU at the same rate and GST % adds to its line; at a different rate or GST % it is refused, naming the SKU (receipts are tracked per SKU). The bill keeps its number, date, parties and receipts already recorded; its note is kept unless you type a new one. A PDF of the whole bill is downloaded. Preview and PDF with a saved number show the bill as saving would make it.
- The PDF prints party blocks, an HSN line table, a rate-wise tax summary, round-off, grand total, amount in words, bank details, terms and a signature block. It uses `Rs.` rather than ₹ because jsPDF's built-in fonts have no rupee glyph.
- **Note.** A free-text box prints under Terms on every document type. It pre-fills from a saved default in Parties & GST, can be overridden per bill, and is stored on the document — so a re-download reprints what was actually sent, not today's default. A blank note prints no empty heading.
- **Short receive.** A saved bill opens a **Receive** panel: per line, how many actually arrived. Receipts are stored beside the bill and **never alter the original figures** — the bill still says what you ordered, and the outstanding pieces and value show separately. Over-receiving is refused. This is independent of marking a customer order unfulfillable in Orders, because the two causes are independent.

### Returns & RTO

Stored in their own `myntra_returns` collection. Rows arrive from the Myntra returns report (columns auto-detected, reviewed before saving) or by hand. Recording a return in Orders & Fake Returns does **not** add a row here — the two are deliberately separate.

Pieces leave the register only through a **pick slip** or a **Goods Return**. The inventory update can *declare* them to Myntra when you tick **Include usable Returns & RTO stock** — but generating a file never consumes anything here. Declaring what you hold is not spending it. In the Add Row form a **Kuntal Code** suggests the SellerSkuCodes it covers (one code, many colours) and a SellerSkuCode fills the Kuntal Code back — whichever you type first. The Purchase product search also matches on Kuntal Code, priced or not.

---

## 📊 Excel File Formats

### Lehnga / Saree Stock Files
| Column | Description |
|--------|-------------|
| ITEM NO | SKU code (used as unique identifier) |
| ITEM NAME | Product name |
| SUB LOCATION | Filter: only SALES STUDIO and MAIN GODOWN |
| COLOR | Color breakdown: `(Red * 1)(Blue * 2)` |
| READY STOCK | Total stock quantity |
| BAL PCS | Balance pieces (used for current stock) |

### Zimonza-Kuntal Product Code File
| Column | Description |
|--------|-------------|
| Zimonza Product Code | ZM code (e.g. ZM-1) |
| Kuntal Product Code | Kuntal SKU (matches stock file ITEM NO) |

---

## 🔥 Firestore Data Structure

```
daily_stock/
  {YYYY-MM-DD}/
    lehnga/{sku}        ← { sku, name, category, colors, totalQty, stockLevel }
    saree/{sku}
    meta/summary        ← { newArrivals, sold, restocked, soldOut, ... }

zm_mapping/{kuntalCode} ← { zmCode, kuntalCode }
website_upload_status/{sku} ← { status, notes, updatedAt }
skip_products/{sku}     ← { sku, notes, skippedAt }
history/{YYYY-MM-DD}    ← { lehngaCount, sareeCount, totalSKUs, ... }
reports/{reportId}
settings/general        ← { lowStockThreshold, mediumStockThreshold, theme }

myntra_mapping/{id}     ← { sellerSkuCode, zmCode, colourName, active }
myntra_pricing/{zmCode} ← { category, kuntalCode, kuntalSellingPrice, myntraMrp, ... }
myntra_returns/{id}     ← { type, sellerSkuCode, zmCode, colourName, qty, date,
                            condition, reason, notes, dispatchId }
myntra_sku_status/{id}  ← { active, updatedAt }
purchase_bills/{id}     ← { docType, number, date, lines[], totals, note, receipts[] }
settings/purchase_counters ← reserved transactionally, per doc type and financial year
stock_pick_slips/{id}   ← { number, date, lines[], source }
dispatches/{id}         ← { forwardId, orderId, customer:{ name, address, key, keyType },
                            products[], sellerSkuCode, zmCode, colourName, qty, dispatchDate,
                            destPin, payment, codAmount, paymentGuessed, pinOverride,
                            status, return:{ returnId, type, foundInside, date } | null }
```

`firestore.rules` needs no change for the new collections — the authenticated-user rule already covers them.

---

## 🌐 Deployment

### Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

### GitHub Pages
1. Push to GitHub
2. Go to Repository → Settings → Pages
3. Source: Deploy from branch → `main` → `/ (root)`
4. Visit `https://USERNAME.github.io/zimonza-daily-stock-update`

### Netlify / Vercel
Drag and drop the project folder onto [netlify.com/drop](https://netlify.com/drop) or connect your GitHub repo.

---

## 🧪 Tests

```bash
node tests/run.mjs            # every suite
node tests/run.mjs dispatch   # one suite
```

The runner copies `js/` into a sandbox, rewrites the CDN imports to generated stubs, **parse-checks every module and page script**, then runs each `tests/*.test.js`.

The parse check uses `vm.SourceTextModule`, not `node --check` — under Node 26 `node --check` exits 0 on files it cannot parse, which had already let a real unbalanced paren through. The runner re-execs itself with `--experimental-vm-modules` so no flag is needed at the call site.

Suites cover the Order Map maths (PIN precedence, the seller's PIN never taken, unfulfillable orders left out, combo parcels under a product filter, risky thresholds, Monday weeks, zones, the Excel sheets), the geo data itself (every state name matches between the PIN directory and the outline; known PINs resolve), destination PIN and payment read from real labels, the re-drop fill-in that never touches a returned parcel, the RTO Kuntal-price export, local file dates, ZM-code normalisation, GST maths, day-first and Excel-serial dates, swatch luminance, PDF sorter ordering and conflict confidence, label field extraction, the barcode fallback, offender keys and re-keying, duplicate classification, the write payload that protects a recorded return, return intake, the inventory return boost, and the Orders tab driven end to end through a fake DOM.

---

## 🎨 Design System

See **Midnight Zari** above for the live tokens. Dates are `dd/mm/yyyy` throughout; figures and codes are set in IBM Plex Mono so columns align.

---

## 🔐 Security

- All pages require Firebase Authentication
- Firestore rules restrict all access to authenticated users only
- No API keys are exposed — Firebase web SDK keys are intended to be public (protected by Auth + Firestore rules)

---

## 📦 External Libraries (CDN — no npm required)

| Library | Purpose |
|---------|---------|
| Tailwind CSS CDN | Utility-first CSS |
| Firebase v10 (ESM) | Auth + Firestore + Storage |
| SheetJS (xlsx) | Excel file parsing |
| Chart.js | Dashboard charts |
| Lucide Icons | Icon set |
| Flatpickr | Date picker |
| jsPDF | PDF export |
| ECharts 5.5 | Order Map: India map and weekly trend (loaded on first open of that tab) |

---

Built with ❤️ for Zimonza · v1.0.0
