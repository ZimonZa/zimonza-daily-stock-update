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
│                             purchase billing, returns & RTO
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
│   ├── myntra-labels.js    ← label.pdf reader (one page = one piece)
│   ├── pdf-merge.js        ← PDF sorter & merger (label/invoice grouping)
│   ├── myntra-fulfilment.js← Label → RTO stock first, then purchase
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
├── firestore.rules         ← Firestore security rules
├── firebase.json           ← Firebase Hosting config
└── .env.example            ← Environment variables template
```

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

One page (`myntra.html`), five sections:

| Tab | What it does |
|-----|--------------|
| **Inventory Update** | Generates the `sellerSkuCode,quantity` file Myntra consumes. Takes a configurable % of each colour's stock above the gap threshold. Deactivated SKUs are excluded from the download. |
| **Mapping** | Every SellerSkuCode with its colour, today's stock, live status toggle, and price columns. Bulk activate / deactivate. |
| **Pricing** | Upload `Myntra Pricing.xlsx`. Flags mapped styles that have no price (those cannot be billed). |
| **Purchase** | Cart → GST bill → PDF. Saved, auto-numbered, re-downloadable. |
| **Returns & RTO** | Register of goods coming back, with a stock summary. **Never counted into stock**, but a label can be filled from it. |

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

> Returns remain invisible to the Myntra inventory update. They are stock for **labels**, never stock for **listings** — running a fulfilment does not change the generated `sellerSkuCode,quantity` file at all.

### Myntra Pricing.xlsx

| ZM Code | Kuntal Code | Category | Kuntal Selling Price | Myntra MRP | Myntra MU Price | Myntra ISP |
|---------|-------------|----------|----------------------|------------|-----------------|------------|
| ZM-01 | 4132 | lehnga | 8990 | | 13830.76923 | 13849 |

Zero-padded codes (`ZM-01`) are normalised to match SellerSkuCodes (`ZM-1-Morpichh`) — on labels and return rows too.
A blank Myntra MRP stays blank — it is never coerced to 0.

### Purchase billing

- **From** Kuntal Antique ART → **Bill To** Kuntal Fashion Private Limited (brand: The Third Label). All names, GSTINs, addresses, bank details and terms are editable under **Parties & GST** and saved once.
- Rate per line is the **Kuntal Selling Price**, treated as **GST-exclusive**: `Amount = qty × rate` is the taxable value, CGST and SGST are added on top.
- GST rate comes from the line's category — lehnga 18% (9% + 9%), saree 5% (2.5% + 2.5%) by default. The rate table is editable, any line can be overridden, and lines whose category has no rate are flagged amber.
- Document type is chosen per bill: Tax Invoice / Purchase Order / Proforma Invoice. Numbers are reserved transactionally per type and financial year (`INV/26-27/0042`).
- The PDF prints party blocks, an HSN line table, a rate-wise tax summary, round-off, grand total, amount in words, bank details, terms and a signature block. It uses `Rs.` rather than ₹ because jsPDF's built-in fonts have no rupee glyph.

### Returns & RTO

Stored in their own `myntra_returns` collection. No stock or inventory-update code path reads it, so returned goods can never leak into stock counts. Rows arrive either from the Myntra returns report (columns auto-detected, reviewed before saving) or by hand. In the Add Row form a **Kuntal Code** suggests the SellerSkuCodes it covers (one code, many colours) and a SellerSkuCode fills the Kuntal Code back — whichever you type first. The Purchase product search also matches on Kuntal Code, priced or not.

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
```

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

## 🎨 Design System

| Token | Value |
|-------|-------|
| Primary | Emerald `#10B981` |
| Accent | Gold `#F59E0B` |
| Background | Slate `#0F172A` |
| Font | Inter (Google Fonts) |
| Radius | `rounded-2xl` (16px) |
| Dates | `dd/mm/yyyy` throughout |
| Cards | Glassmorphism + `rgba(255,255,255,0.04)` |

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

---

Built with ❤️ for Zimonza · v1.0.0
