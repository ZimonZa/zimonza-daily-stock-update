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
│   ├── custom.css          ← Core styles, layout, glassmorphism
│   ├── animations.css      ← Framer-like animations
│   └── theme.css           ← Dark/light mode, badges, chips
│
├── js/
│   ├── firebase-config.js  ← ⚙️ YOUR FIREBASE CREDENTIALS GO HERE
│   ├── auth.js             ← Authentication module
│   ├── firestore-service.js← All Firestore read/write operations
│   ├── excel-parser.js     ← SheetJS-powered Excel processor
│   ├── stock-analyzer.js   ← Comparison engine (sold/restock/new)
│   ├── zm-mapper.js        ← ZM product code logic
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
