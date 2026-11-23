// ═══════════════════════════════════════════════════════════════
// ZIMONZA — "Download sample" files for every Excel upload
//
// Each sample is built in the browser from the same headings its upload
// reads, so it can never drift from what the app expects: sheet 1 has the
// headings and two example rows, sheet 2 ("How to fill") says what each
// column is for and whether it is required. tests/sample-files.test.js
// reads every sample back through the real reader.
// ═══════════════════════════════════════════════════════════════

const R = 'Required', O = 'Optional';
const LOCATIONS = 'SALES STUDIO, MAIN GODOWN, MAIN GODOWN STUDIO or WAREHOUSE';

const stock = (what, rows) => ({
  fileName: `Sample_${what}_Stock.xlsx`,
  headers: ['ITEM NO', 'ITEM NAME', 'SUB LOCATION', 'COLOR', 'READY STOCK', 'SALES PCS', 'BAL PCS'],
  rows,
  help: [
    ['ITEM NO', R, 'Kuntal code of the item (the same code as in your ZM list)', rows[0][0]],
    ['ITEM NAME', O, 'Name of the item', rows[0][1]],
    ['SUB LOCATION', R, `Where the stock is: ${LOCATIONS}. Other locations are ignored.`, rows[0][2]],
    ['COLOR', R, 'Every colour with its pieces, written as (Colour * pieces ) one after another', rows[0][3]],
    ['READY STOCK', O, 'Pieces ready (kept for your records)', rows[0][4]],
    ['SALES PCS', O, 'Pieces sold (kept for your records)', rows[0][5]],
    ['BAL PCS', R, 'Pieces in hand — must equal the total of the COLOR pieces', rows[0][6]]
  ]
});

export const SAMPLES = {
  lehnga: stock('Lehnga', [
    ['4132', 'RANI LEHENGA CHOLI', 'MAIN GODOWN', '(Rani * 2 )( Black * 1 )', 3, 0, 3],
    ['4136', 'PISTA LEHENGA CHOLI', 'SALES STUDIO', '(Pista * 1 )', 1, 0, 1]
  ]),
  saree: stock('Saree', [
    ['9551', 'SAREE 9551', 'MAIN GODOWN', '(Pink * 2 )( Firozi * 1 )', 3, 0, 3],
    ['1008', 'SAREE 1008', 'WAREHOUSE', '(Rani * 1 )', 1, 0, 1]
  ]),
  zm: {
    fileName: 'Sample_ZM_Codes.xlsx',
    headers: ['Zimonza Product Code', 'Kuntal Product Code', 'Category'],
    rows: [['ZM-1', '4132', 'Lehnga'], ['ZM-38', '9551', 'Saree']],
    help: [
      ['Zimonza Product Code', R, 'Your ZM code. Keep this heading exactly — the upload checks it.', 'ZM-1'],
      ['Kuntal Product Code', R, 'The Kuntal code (ITEM NO in the stock files). Write (UNST) for an unstitched blouse.', '4132'],
      ['Category', O, 'Lehnga or Saree — only needed when the same Kuntal code is in both stock files. Leave blank otherwise.', 'Lehnga']
    ]
  },
  colours: {
    fileName: 'Sample_Colour_List.xlsx',
    headers: ['Colour'],
    rows: [['Morpichh'], ['Firozi']],
    help: [['Colour', R, 'One colour name per row, in column A', 'Morpichh']]
  },
  myntraInventory: {
    fileName: 'Sample_Myntra_Inventory.xlsx',
    headers: ['sellerSkuCode', 'quantity'],
    rows: [['ZM-1-Rani', 3], ['ZM-38-Pink', 2]],
    help: [
      ['sellerSkuCode', R, 'Myntra SellerSkuCode: ZM code, then the colour — ZM-<number>-<Colour>', 'ZM-1-Rani'],
      ['quantity', O, 'Ignored on upload — the app works the quantity out from today\'s stock', '3']
    ]
  },
  myntraMapping: {
    fileName: 'Sample_Myntra_Mapping.xlsx',
    headers: ['Style Id', 'Article Type', 'Colour', 'SellerSkuCode'],
    rows: [['33445511', 'Lehenga Choli', 'Rani', 'ZM-1-Rani'], ['33445512', 'Saree', 'Pink', 'ZM-38-Pink']],
    help: [
      ['Style Id', O, 'Myntra Style ID', '33445511'],
      ['Article Type', O, 'Myntra article type', 'Lehenga Choli'],
      ['Colour', O, 'Colour as listed on Myntra', 'Rani'],
      ['SellerSkuCode', R, 'ZM code, then the colour — ZM-<number>-<Colour>. The colour must match the stock file\'s colour name.', 'ZM-1-Rani']
    ]
  },
  myntraPricing: {
    fileName: 'Sample_Myntra_Pricing.xlsx',
    headers: ['ZM Code', 'Kuntal Code', 'Category', 'Kuntal Selling Price', 'Myntra MRP', 'Myntra MU Price', 'Myntra ISP'],
    rows: [['ZM-01', '4132', 'lehnga', 8990, 24999, 13830.77, 13849], ['ZM-38', '9551', 'saree', 2400, 6999, 3692.31, 3699]],
    help: [
      ['ZM Code', R, 'ZM code (ZM-01 and ZM-1 are the same)', 'ZM-01'],
      ['Kuntal Code', O, 'Kuntal code of the style', '4132'],
      ['Category', O, 'lehnga or saree — decides the GST rate on purchase bills', 'lehnga'],
      ['Kuntal Selling Price', R, 'The rate you buy at (before GST). A style without it cannot be billed.', '8990'],
      ['Myntra MRP', O, 'MRP on Myntra. Leave blank if not set — it stays blank, never 0.', '24999'],
      ['Myntra MU Price', O, 'Mark-up price', '13830.77'],
      ['Myntra ISP', O, 'Selling price on Myntra', '13849']
    ]
  },
  myntraReturns: {
    fileName: 'Sample_Returns_RTO.xlsx',
    headers: ['Type', 'SellerSkuCode', 'ZM Code', 'Kuntal Code', 'Colour', 'Qty', 'Date', 'Condition', 'Reason', 'Notes'],
    rows: [
      ['RTO', 'ZM-1-Rani', 'ZM-1', '4132', 'Rani', 1, '20-11-2026', 'good', '', ''],
      ['Customer Return', 'ZM-38-Pink', 'ZM-38', '9551', 'Pink', 1, '21-11-2026', 'damaged', 'Torn', 'Stitching open']
    ],
    help: [
      ['Type', R, 'RTO or Customer Return', 'RTO'],
      ['SellerSkuCode', R, 'ZM-<number>-<Colour>. Rows without it are skipped.', 'ZM-1-Rani'],
      ['ZM Code', O, 'Filled from the SellerSkuCode if blank', 'ZM-1'],
      ['Kuntal Code', O, 'Filled from pricing / ZM list if blank', '4132'],
      ['Colour', O, 'Filled from the SellerSkuCode if blank; spelling is corrected', 'Rani'],
      ['Qty', R, 'Pieces that came back', '1'],
      ['Date', O, 'Day it came back, day first: DD-MM-YYYY', '20-11-2026'],
      ['Condition', O, 'good, damaged or missing (blank = good)', 'good'],
      ['Reason', O, 'Why it came back', 'Torn'],
      ['Notes', O, 'Anything else', 'Stitching open']
    ]
  }
};

/** The two sheets of a sample, as rows. PURE — no Excel library needed. */
export function sampleSheets(key) {
  const s = SAMPLES[key];
  if (!s) throw new Error(`No sample named ${key}`);
  return {
    data: [s.headers, ...s.rows.map(r => [...r])],
    help: [['Column', 'Required?', 'What to put', 'Example'], ...s.help.map(r => [...r])]
  };
}

/** Build the workbook and download it. Needs the page's SheetJS (window.XLSX). */
export function downloadSample(key) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error('Excel library not loaded');
  const { data, help } = sampleSheets(key);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = data[0].map(h => ({ wch: Math.max(14, String(h).length + 4) }));
  const hs = XLSX.utils.aoa_to_sheet(help);
  hs['!cols'] = [{ wch: 22 }, { wch: 11 }, { wch: 70 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Sample');
  XLSX.utils.book_append_sheet(wb, hs, 'How to fill');
  XLSX.writeFile(wb, SAMPLES[key].fileName);
}

/**
 * Wire every `[data-sample]` link on the page. A link sits inside a drop
 * zone, so the click must not also open the file picker.
 */
export function bindSampleLinks(root = document) {
  root.querySelectorAll('[data-sample]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      try { downloadSample(a.dataset.sample); }
      catch (err) { console.error(err); alert('Could not make the sample file: ' + err.message); }
    });
  });
}

/** The link markup to put under a drop zone's hint text. */
export const sampleLinkHTML = (key) =>
  `<a href="#" data-sample="${key}" class="zm-sample-link" title="Excel file with the right headings, two example rows and a How to fill sheet">⤓ Download sample</a>`;
