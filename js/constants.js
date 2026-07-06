// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Constants & Configuration
// ═══════════════════════════════════════════════════════════════

export const APP_NAME = 'Zimonza Daily Stock Update';
export const APP_VERSION = '1.0.0';

// Stock level thresholds (adjustable in Settings)
export const STOCK_LEVELS = {
  LOW: { min: 1, max: 2, label: 'Low', color: 'red', class: 'badge-danger' },
  MEDIUM: { min: 3, max: 5, label: 'Medium', color: 'amber', class: 'badge-warning' },
  HIGH: { min: 6, max: Infinity, label: 'High', color: 'emerald', class: 'badge-success' },
  ZERO: { min: 0, max: 0, label: 'Sold Out', color: 'slate', class: 'badge-neutral' }
};

// Valid Sub Locations to process
export const VALID_LOCATIONS = ['SALES STUDIO', 'MAIN GODOWN', 'MAIN GODOWN STUDIO', 'WAREHOUSE'];

// Category types
export const CATEGORIES = {
  LEHNGA: 'lehnga',
  SAREE: 'saree'
};

// Excel column mappings (0-based column index)
export const SAREE_COLS = {
  ITEM_NO: 2,    // Col 3 → index 2
  ITEM_NAME: 4,  // Col 5 → index 4
  SUB_LOCATION: 6, // Col 7 → index 6
  COLOR: 7,      // Col 8 → index 7
  READY_STOCK: 10, // Col 11 → index 10
  SALES_PCS: 11,  // Col 12 → index 11
  BAL_PCS: 12     // Col 13 → index 12
};

export const LEHNGA_COLS = {
  ITEM_NO: 2,    // Col 3 → index 2
  ITEM_NAME: 6,  // Col 7 → index 6
  SUB_LOCATION: 9, // Col 10 → index 9
  COLOR: 12,     // Col 13 → index 12
  READY_STOCK: 18, // Col 19 → index 18
  SALES_PCS: 19,  // Col 20 → index 19
  BAL_PCS: 20     // Col 21 → index 20
};

export const ZM_COLS = {
  ZM_CODE: 0,     // Col 1 → index 0
  KUNTAL_CODE: 1  // Col 2 → index 1
};

// Firestore collection paths
export const COLLECTIONS = {
  DAILY_STOCK: 'daily_stock',
  ZM_MAPPING: 'zm_mapping',
  MYNTRA_MAPPING: 'myntra_mapping',
  WEBSITE_STATUS: 'website_upload_status',
  SKIP_PRODUCTS: 'skip_products',
  HISTORY: 'history',
  REPORTS: 'reports',
  SETTINGS: 'settings'
};

// Upload status options
export const UPLOAD_STATUS = {
  UPLOADED: 'uploaded',
  PARTIAL: 'partial',
  NOT_UPLOADED: 'not_uploaded',
  SKIPPED: 'skipped',
  PENDING: 'pending'
};

// Change types from comparison
export const CHANGE_TYPES = {
  NEW_ARRIVAL: 'new_arrival',
  SOLD: 'sold',
  RESTOCKED: 'restocked',
  SOLD_OUT: 'sold_out',
  UNCHANGED: 'unchanged'
};

// Known colour names for spelling validation
export const KNOWN_COLOURS = [
  // Standard
  'Red','Blue','Green','Black','White','Yellow','Orange','Pink','Purple',
  'Brown','Grey','Gray','Maroon','Navy','Cyan','Magenta','Violet','Indigo',
  // Pastels / neutrals
  'Cream','Ivory','Beige','Peach','Coral','Mint','Lavender','Rose','Mauve',
  'Lilac','Blush','Nude','Champagne','Taupe','Khaki','Sand',
  // Rich tones
  'Burgundy','Wine','Rust','Copper','Bronze','Gold','Silver','Teal',
  'Turquoise','Mustard','Olive','Lime','Sage','Charcoal','Slate',
  // Indian textile specific
  'Morpichh','Rani','Mehendi','Saffron','Terracotta','Sandalwood','Brick',
  'Firozi','Pista','Parrot Green','Bottle Green',
  // Compound / common combos
  'Sky Blue','Royal Blue','Off White','Light Blue','Dark Blue',
  'Dark Green','Light Green','Light Pink','Hot Pink','Baby Pink',
  'Dark Red','Blood Red','Deep Red','Lemon Yellow','Multi','Multicolor'
];

// Date format
export const DATE_FORMAT = 'YYYY-MM-DD';

// Theme
export const THEMES = { DARK: 'dark', LIGHT: 'light' };

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: 'dashboard.html' },
  { id: 'upload', label: 'Upload Center', icon: 'upload-cloud', href: 'upload.html' },
  { id: 'stock-analysis', label: 'Stock Analysis', icon: 'bar-chart-2', href: 'stock-analysis.html' },
  { id: 'pdf-to-excel', label: 'PDF → Excel', icon: 'file-spreadsheet', href: 'pdf-to-excel.html' },
  { id: 'zm-panel', label: 'ZM Panel', icon: 'tag', href: 'zm-panel.html' },
  { id: 'myntra', label: 'Myntra', icon: 'shopping-bag', href: 'myntra.html' },
  { id: 'new-arrivals', label: 'New Arrivals', icon: 'sparkles', href: 'new-arrivals.html' },
  { id: 'sold-items', label: 'Sold Items', icon: 'trending-down', href: 'sold-items.html' },
  { id: 'restocked', label: 'Restocked', icon: 'refresh-cw', href: 'restocked.html' },
  { id: 'sold-out', label: 'Sold Out', icon: 'x-circle', href: 'sold-out.html' },
  { id: 'low-stock', label: 'Low Stock', icon: 'alert-triangle', href: 'low-stock.html' },
  { id: 'skip-panel', label: 'Skip Panel', icon: 'skip-forward', href: 'skip-panel.html' },
  { id: 'history', label: 'History', icon: 'calendar', href: 'history.html' },
  { id: 'reports', label: 'Reports', icon: 'file-text', href: 'reports.html' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: 'settings.html' }
];
