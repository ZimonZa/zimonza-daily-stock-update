// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Purchase Bill PDF + on-screen preview
// Hand-drawn jsPDF (A4 portrait, mm) — no autotable plugin.
// ═══════════════════════════════════════════════════════════════

import { PURCHASE_DOC_TYPES } from './constants.js';
import { formatINR, amountInWords, formatDateDisplay } from './utils.js';

// ─── Print palette (light, for paper) ────────────────────────────
const INK        = [15, 23, 42];    // slate-900
const MUTED      = [100, 116, 139]; // slate-500
const FAINT      = [148, 163, 184]; // slate-400
const RULE       = [226, 232, 240]; // slate-200
const ZEBRA      = [248, 250, 252]; // slate-50
const CARD       = [252, 253, 254];
const BRAND      = [16, 185, 129];  // emerald-500
const BRAND_DARK = [6, 95, 70];     // emerald-800
const BRAND_TINT = [236, 253, 245]; // emerald-50

// ─── Page geometry ───────────────────────────────────────────────
const PAGE_W = 210, PAGE_H = 297;
const M = 14;                       // left/right margin
const CONTENT_W = PAGE_W - M * 2;   // 182
const BOTTOM_LIMIT = 262;           // rows must stop above the footer block

// Column layout — widths sum to CONTENT_W
const COLS = [
  { key: 'srNo',       label: 'Sr',      x: 14,  w: 12, align: 'left'  },
  { key: 'kuntalCode', label: 'Kuntal',  x: 26,  w: 26, align: 'left'  },
  { key: 'colourName', label: 'Colour',  x: 52,  w: 44, align: 'left'  },
  { key: 'hsn',        label: 'HSN',     x: 96,  w: 18, align: 'left'  },
  { key: 'qty',        label: 'Qty',     x: 114, w: 14, align: 'right' },
  { key: 'rate',       label: 'Rate',    x: 128, w: 30, align: 'right' },
  { key: 'amount',     label: 'Amount',  x: 158, w: 38, align: 'right' }
];

const docTypeOf = id => PURCHASE_DOC_TYPES.find(t => t.id === id) || PURCHASE_DOC_TYPES[0];

// jsPDF's built-in Helvetica is WinAnsi-encoded and has no ₹ (U+20B9) glyph —
// it prints as a wrong character. Paper uses "Rs."; the HTML preview keeps ₹.
const RS = 'Rs. ';

// ─── Small jsPDF helpers ─────────────────────────────────────────

const setFill = (d, c) => d.setFillColor(c[0], c[1], c[2]);
const setText = (d, c) => d.setTextColor(c[0], c[1], c[2]);
const setDraw = (d, c) => d.setDrawColor(c[0], c[1], c[2]);

function cellText(d, value, col, y) {
  const s = String(value ?? '');
  if (col.align === 'right') d.text(s, col.x + col.w - 2, y, { align: 'right' });
  else d.text(s, col.x + 2, y);
}

/** Truncate to fit a column width at the current font size. */
function fit(d, text, widthMm) {
  let s = String(text ?? '');
  if (d.getTextWidth(s) <= widthMm) return s;
  while (s.length > 1 && d.getTextWidth(s + '…') > widthMm) s = s.slice(0, -1);
  return s + '…';
}

/** Wrap into lines that fit widthMm; returns array of strings. */
const wrap = (d, text, widthMm) => d.splitTextToSize(String(text ?? ''), widthMm);

// ─── Page furniture ──────────────────────────────────────────────

function drawHeader(d, bill, s, continued) {
  // Top accent band
  setFill(d, BRAND);
  d.rect(0, 0, PAGE_W, 4, 'F');

  // Seller name + GSTIN
  setText(d, INK);
  d.setFont('helvetica', 'bold');
  d.setFontSize(17);
  d.text(fit(d, s.sellerName || 'Supplier', 110).toUpperCase(), M, 16);

  d.setFont('helvetica', 'normal');
  d.setFontSize(8);
  setText(d, MUTED);
  let sy = 21;
  if (s.sellerGstin) { d.text(`GSTIN: ${s.sellerGstin}`, M, sy); sy += 4; }
  if (s.sellerState) d.text(`State: ${s.sellerState}`, M, sy);

  // Document title pill (right)
  const type = docTypeOf(bill.docType);
  const title = (continued ? `${type.label} (contd.)` : type.label).toUpperCase();
  d.setFont('helvetica', 'bold');
  d.setFontSize(11);
  const tw = d.getTextWidth(title) + 12;
  setFill(d, BRAND_TINT);
  setDraw(d, BRAND);
  d.setLineWidth(0.3);
  d.roundedRect(PAGE_W - M - tw, 9, tw, 10, 2, 2, 'FD');
  setText(d, BRAND_DARK);
  d.text(title, PAGE_W - M - tw / 2, 15.8, { align: 'center' });

  setDraw(d, RULE);
  d.setLineWidth(0.3);
  d.line(M, 27, PAGE_W - M, 27);
}

function drawParties(d, bill, s) {
  const cardW = (CONTENT_W - 6) / 2;
  const top = 32, h = 30;

  const card = (x, heading, lines) => {
    setFill(d, CARD);
    setDraw(d, RULE);
    d.setLineWidth(0.3);
    d.roundedRect(x, top, cardW, h, 2, 2, 'FD');
    // heading strip
    d.setFont('helvetica', 'bold');
    d.setFontSize(6.5);
    setText(d, BRAND_DARK);
    d.text(heading, x + 4, top + 5.5);
    let y = top + 11;
    for (const [text, bold, color] of lines) {
      if (y > top + h - 2) break;
      d.setFont('helvetica', bold ? 'bold' : 'normal');
      d.setFontSize(bold ? 9.5 : 7.5);
      setText(d, color);
      for (const line of wrap(d, text, cardW - 8)) {
        if (y > top + h - 2) break;
        d.text(line, x + 4, y);
        y += bold ? 4.6 : 3.6;
      }
    }
  };

  card(M, 'FROM (SUPPLIER)', [
    [s.sellerName || '—', true, INK],
    [s.sellerAddress || '', false, MUTED],
    [s.sellerGstin ? `GSTIN: ${s.sellerGstin}` : '', false, MUTED]
  ].filter(l => l[0]));

  card(M + cardW + 6, 'BILL TO (BUYER)', [
    [s.buyerName || '—', true, INK],
    [s.buyerBrand ? `Brand: ${s.buyerBrand}` : '', false, BRAND_DARK],
    [s.buyerAddress || '', false, MUTED],
    [s.buyerGstin ? `GSTIN: ${s.buyerGstin}` : '', false, MUTED]
  ].filter(l => l[0]));

  // Meta strip
  const my = top + h + 5;
  setFill(d, ZEBRA);
  setDraw(d, RULE);
  d.roundedRect(M, my, CONTENT_W, 9, 1.5, 1.5, 'FD');
  d.setFontSize(7.5);
  const meta = [
    ['No', bill.billNo],
    ['Date', formatDateDisplay(bill.billDate) || bill.billDate],
    ['Place of Supply', bill.placeOfSupply || '—'],
    ['Items', String(bill.lines.length)]
  ];
  let mx = M + 4;
  for (const [label, value] of meta) {
    d.setFont('helvetica', 'normal');
    setText(d, FAINT);
    d.text(`${label}:`, mx, my + 5.8);
    mx += d.getTextWidth(`${label}:`) + 1.5;
    d.setFont('helvetica', 'bold');
    setText(d, INK);
    d.text(String(value ?? '—'), mx, my + 5.8);
    mx += d.getTextWidth(String(value ?? '—')) + 7;
  }

  return my + 15;
}

function drawTableHead(d, y) {
  setFill(d, INK);
  d.rect(M, y - 5, CONTENT_W, 8, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(7.5);
  setText(d, [255, 255, 255]);
  for (const col of COLS) cellText(d, col.label, col, y);
  return y + 7;
}

function drawFooter(d, page, pageCount, s) {
  setDraw(d, RULE);
  d.setLineWidth(0.3);
  d.line(M, PAGE_H - 14, PAGE_W - M, PAGE_H - 14);
  d.setFont('helvetica', 'normal');
  d.setFontSize(6.5);
  setText(d, FAINT);
  d.text(`${s.buyerBrand || 'Zimonza'} · generated ${formatDateDisplay(new Date().toISOString().slice(0, 10))}`, M, PAGE_H - 9);
  d.text(`Page ${page} of ${pageCount}`, PAGE_W - M, PAGE_H - 9, { align: 'right' });
}

// ─── Main export ─────────────────────────────────────────────────

/**
 * Render a bill to PDF and trigger the download.
 * @param {object} bill     { docType, billNo, billDate, placeOfSupply, lines, totals, rateSummary }
 * @param {object} settings purchase settings (parties, bank, terms)
 */
export function exportBillPDF(bill, settings) {
  if (!window.jspdf) throw new Error('jsPDF not loaded');
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ unit: 'mm', format: 'a4' });
  const s = settings || {};

  drawHeader(d, bill, s, false);
  let y = drawParties(d, bill, s);
  y = drawTableHead(d, y);

  d.setFont('helvetica', 'normal');
  d.setFontSize(7.5);

  bill.lines.forEach((line, i) => {
    if (y > BOTTOM_LIMIT) {
      d.setFont('helvetica', 'italic');
      d.setFontSize(6.5);
      setText(d, FAINT);
      d.text('continued on next page…', PAGE_W - M, y + 2, { align: 'right' });
      d.addPage();
      drawHeader(d, bill, s, true);
      y = drawTableHead(d, 34);
      d.setFont('helvetica', 'normal');
      d.setFontSize(7.5);
    }

    if (i % 2 === 0) {
      setFill(d, ZEBRA);
      d.rect(M, y - 4, CONTENT_W, 6.5, 'F');
    }
    setText(d, INK);
    const values = {
      srNo: line.srNo,
      kuntalCode: fit(d, line.kuntalCode || '—', COLS[1].w - 4),
      colourName: fit(d, line.colourName || '—', COLS[2].w - 4),
      hsn: fit(d, line.hsn || '—', COLS[3].w - 4),
      qty: line.qty,
      rate: formatINR(line.rate),
      amount: formatINR(line.taxable)
    };
    for (const col of COLS) cellText(d, values[col.key], col, y);
    y += 6.5;
  });

  setDraw(d, RULE);
  d.setLineWidth(0.3);
  d.line(M, y - 2, PAGE_W - M, y - 2);
  y += 4;

  // Totals block must not be split across pages
  const totalsHeight = 58 + bill.rateSummary.length * 5;
  if (y + totalsHeight > BOTTOM_LIMIT + 12) {
    d.addPage();
    drawHeader(d, bill, s, true);
    y = 34;
  }

  y = drawTotals(d, bill, y);
  drawClosing(d, bill, s, y);

  const pageCount = d.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    d.setPage(p);
    drawFooter(d, p, pageCount, s);
  }

  d.save(`${String(bill.billNo).replace(/[\/\\\s]+/g, '_')}_${bill.billDate}.pdf`);
}

function drawTotals(d, bill, yStart) {
  const t = bill.totals;
  const rightW = 78;
  const rightX = PAGE_W - M - rightW;
  let y = yStart;

  // ── Rate-wise tax summary (left) ──
  d.setFont('helvetica', 'bold');
  d.setFontSize(7);
  setText(d, MUTED);
  d.text('TAX RATE SUMMARY', M, y + 2);

  let ry = y + 6;
  d.setFontSize(6.5);
  setText(d, FAINT);
  d.text('Rate', M, ry);
  d.text('Taxable', M + 24, ry, { align: 'right' });
  d.text('CGST', M + 46, ry, { align: 'right' });
  d.text('SGST', M + 68, ry, { align: 'right' });
  ry += 1.5;
  setDraw(d, RULE);
  d.line(M, ry, M + 68, ry);
  ry += 4;

  d.setFont('helvetica', 'normal');
  setText(d, INK);
  for (const r of bill.rateSummary) {
    d.text(`${r.gstRate}%`, M, ry);
    d.text(formatINR(r.taxable), M + 24, ry, { align: 'right' });
    d.text(formatINR(r.cgst), M + 46, ry, { align: 'right' });
    d.text(formatINR(r.sgst), M + 68, ry, { align: 'right' });
    ry += 5;
  }

  // ── Totals (right) ──
  const row = (label, value, opts = {}) => {
    d.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    d.setFontSize(opts.bold ? 8.5 : 8);
    setText(d, opts.color || (opts.bold ? INK : MUTED));
    d.text(label, rightX + 3, y + 4.6);
    setText(d, opts.color || INK);
    d.text(value, PAGE_W - M - 3, y + 4.6, { align: 'right' });
    y += opts.gap || 6;
  };

  setFill(d, ZEBRA);
  setDraw(d, RULE);
  d.setLineWidth(0.3);
  d.roundedRect(rightX, y, rightW, 26, 1.5, 1.5, 'FD');
  y += 1;
  row('Taxable Value', formatINR(t.subTotal));
  row(`CGST`, formatINR(t.cgstTotal));
  row(`SGST`, formatINR(t.sgstTotal));
  row('Round Off', (t.roundOff < 0 ? '(' + formatINR(Math.abs(t.roundOff)) + ')' : formatINR(t.roundOff)), { gap: 5 });

  // Grand total bar
  setFill(d, INK);
  d.roundedRect(rightX, y + 1, rightW, 11, 1.5, 1.5, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  setText(d, [255, 255, 255]);
  d.text('GRAND TOTAL', rightX + 3, y + 8);
  d.setFontSize(11);
  d.text(`${RS}${formatINR(t.grandRounded, 0)}`, PAGE_W - M - 3, y + 8.3, { align: 'right' });
  y += 16;

  const bottom = Math.max(y, ry + 2);

  // ── Amount in words (full width) ──
  setFill(d, BRAND_TINT);
  setDraw(d, RULE);
  d.roundedRect(M, bottom, CONTENT_W, 9, 1.5, 1.5, 'FD');
  d.setFont('helvetica', 'bold');
  d.setFontSize(6.5);
  setText(d, BRAND_DARK);
  d.text('AMOUNT IN WORDS', M + 3, bottom + 3.8);
  d.setFont('helvetica', 'italic');
  d.setFontSize(8);
  setText(d, INK);
  d.text(fit(d, amountInWords(t.grandRounded), CONTENT_W - 8), M + 3, bottom + 7.5);

  return bottom + 14;
}

function drawClosing(d, bill, s, yStart) {
  let y = yStart;
  const colW = (CONTENT_W - 8) / 2;

  // Bank + terms (left)
  d.setFont('helvetica', 'bold');
  d.setFontSize(6.5);
  setText(d, MUTED);
  if (s.bankName || s.bankAccount || s.bankIfsc) {
    d.text('BANK DETAILS', M, y);
    d.setFont('helvetica', 'normal');
    d.setFontSize(7.5);
    setText(d, INK);
    let by = y + 4;
    for (const line of [s.bankName, s.bankAccount ? `A/c: ${s.bankAccount}` : '', s.bankIfsc ? `IFSC: ${s.bankIfsc}` : ''].filter(Boolean)) {
      d.text(fit(d, line, colW), M, by);
      by += 3.8;
    }
    y = by + 3;
  }

  if (s.terms) {
    d.setFont('helvetica', 'bold');
    d.setFontSize(6.5);
    setText(d, MUTED);
    d.text('TERMS & CONDITIONS', M, y);
    d.setFont('helvetica', 'normal');
    d.setFontSize(6.8);
    setText(d, FAINT);
    let ty = y + 4;
    for (const line of wrap(d, s.terms, colW)) {
      if (ty > PAGE_H - 20) break;
      d.text(line, M, ty);
      ty += 3.2;
    }
  }

  // Signature (right)
  const sx = PAGE_W - M;
  d.setFont('helvetica', 'bold');
  d.setFontSize(7.5);
  setText(d, INK);
  d.text(fit(d, `For ${s.sellerName || 'Supplier'}`, colW), sx, yStart, { align: 'right' });
  setDraw(d, RULE);
  d.setLineWidth(0.3);
  d.line(sx - 52, yStart + 18, sx, yStart + 18);
  d.setFont('helvetica', 'normal');
  d.setFontSize(6.5);
  setText(d, MUTED);
  d.text('Authorised Signatory', sx, yStart + 22, { align: 'right' });
}

// ═══════════════════ Stock pick slip (A5) ═══════════════════
// Goods coming back OUT of Returns / RTO to fill a label. This is an
// internal stock movement, not a purchase — deliberately no rate, no GST,
// no money anywhere on the page.

const SLIP_W = 148, SLIP_H = 210;   // A5 portrait, mm
const SM = 10;                       // slip margin
const SLIP_CONTENT_W = SLIP_W - SM * 2;

const SLIP_COLS = [
  { key: 'srNo',          label: 'Sr',        x: 10,  w: 9,  align: 'left'  },
  { key: 'kuntalCode',    label: 'Kuntal',    x: 19,  w: 20, align: 'left'  },
  { key: 'colourName',    label: 'Colour',    x: 39,  w: 28, align: 'left'  },
  { key: 'sellerSkuCode', label: 'SellerSku', x: 67,  w: 40, align: 'left'  },
  { key: 'src',           label: 'Src',       x: 107, w: 16, align: 'left'  },
  { key: 'qty',           label: 'Qty',       x: 123, w: 15, align: 'right' }
];

const srcLabel = (type) => (type === 'rto' ? 'RTO' : 'RET');

/**
 * Render a pick slip to PDF and download it.
 * @param {object} slip     { slipNo, date, sourceFile, lines[], totalPcs }
 * @param {object} settings purchase settings (for the brand name only)
 */
export function exportPickSlipPDF(slip, settings) {
  if (!window.jspdf) throw new Error('jsPDF not loaded');
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ unit: 'mm', format: 'a5' });
  const s = settings || {};

  // Header
  setFill(d, BRAND);
  d.rect(0, 0, SLIP_W, 3.5, 'F');

  setText(d, INK);
  d.setFont('helvetica', 'bold');
  d.setFontSize(13);
  d.text(fit(d, s.buyerBrand || s.buyerName || 'Stock', SLIP_CONTENT_W).toUpperCase(), SM, 13);

  d.setFontSize(10);
  setText(d, BRAND_DARK);
  d.text('STOCK PICK SLIP', SM, 19.5);
  d.setFont('helvetica', 'normal');
  d.setFontSize(7);
  setText(d, MUTED);
  d.text('from Customer Returns / RTO — internal stock movement', SM, 24);

  setDraw(d, RULE);
  d.setLineWidth(0.3);
  d.line(SM, 27, SLIP_W - SM, 27);

  // Meta strip
  let y = 31;
  setFill(d, ZEBRA);
  setDraw(d, RULE);
  d.roundedRect(SM, y, SLIP_CONTENT_W, 12, 1.5, 1.5, 'FD');
  d.setFontSize(7);
  const meta = [
    ['Slip No', slip.slipNo],
    ['Date', formatDateDisplay(slip.date) || slip.date],
    ['Total Pcs', String(slip.totalPcs)]
  ];
  let mx = SM + 3;
  for (const [label, value] of meta) {
    d.setFont('helvetica', 'normal');
    setText(d, FAINT);
    d.text(`${label}:`, mx, y + 5);
    mx += d.getTextWidth(`${label}:`) + 1.2;
    d.setFont('helvetica', 'bold');
    setText(d, INK);
    d.text(String(value ?? '—'), mx, y + 5);
    mx += d.getTextWidth(String(value ?? '—')) + 5;
  }
  if (slip.sourceFile) {
    d.setFont('helvetica', 'normal');
    d.setFontSize(6.5);
    setText(d, FAINT);
    d.text(fit(d, `Label file: ${slip.sourceFile}`, SLIP_CONTENT_W - 6), SM + 3, y + 9.5);
  }
  y += 18;

  // Table head
  const drawSlipHead = (yy) => {
    setFill(d, INK);
    d.rect(SM, yy - 4.5, SLIP_CONTENT_W, 7, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(6.8);
    setText(d, [255, 255, 255]);
    for (const col of SLIP_COLS) cellText(d, col.label, col, yy);
    return yy + 6.5;
  };
  y = drawSlipHead(y);

  d.setFont('helvetica', 'normal');
  d.setFontSize(7);
  slip.lines.forEach((line, i) => {
    if (y > SLIP_H - 52) {
      d.addPage();
      setFill(d, BRAND);
      d.rect(0, 0, SLIP_W, 3.5, 'F');
      y = drawSlipHead(14);
      d.setFont('helvetica', 'normal');
      d.setFontSize(7);
    }
    if (i % 2 === 0) {
      setFill(d, ZEBRA);
      d.rect(SM, y - 3.6, SLIP_CONTENT_W, 5.8, 'F');
    }
    setText(d, INK);
    const values = {
      srNo: line.srNo,
      kuntalCode: fit(d, line.kuntalCode || '—', SLIP_COLS[1].w - 3),
      colourName: fit(d, line.colourName || '—', SLIP_COLS[2].w - 3),
      sellerSkuCode: fit(d, line.sellerSkuCode || '—', SLIP_COLS[3].w - 3),
      src: srcLabel(line.type),
      qty: line.qty
    };
    for (const col of SLIP_COLS) cellText(d, values[col.key], col, y);
    y += 5.8;
  });

  setDraw(d, RULE);
  d.line(SM, y - 1.5, SLIP_W - SM, y - 1.5);
  y += 3;

  // Total pcs bar — the only total on the page
  setFill(d, INK);
  d.roundedRect(SLIP_W - SM - 52, y, 52, 9, 1.5, 1.5, 'F');
  d.setFont('helvetica', 'bold');
  d.setFontSize(7);
  setText(d, [255, 255, 255]);
  d.text('TOTAL PCS', SLIP_W - SM - 49, y + 5.8);
  d.setFontSize(10);
  d.text(String(slip.totalPcs), SLIP_W - SM - 3, y + 6, { align: 'right' });
  y += 15;

  d.setFont('helvetica', 'italic');
  d.setFontSize(6.3);
  setText(d, FAINT);
  for (const line of wrap(d, 'This slip records stock taken from the returns register to fill a label. It is not a purchase — no payment is due against it.', SLIP_CONTENT_W)) {
    d.text(line, SM, y);
    y += 3;
  }

  // Signatures
  const sy = Math.max(y + 12, SLIP_H - 26);
  setDraw(d, RULE);
  d.line(SM, sy, SM + 42, sy);
  d.line(SLIP_W - SM - 42, sy, SLIP_W - SM, sy);
  d.setFont('helvetica', 'normal');
  d.setFontSize(6.3);
  setText(d, MUTED);
  d.text('Picked by', SM, sy + 3.5);
  d.text('Checked by', SLIP_W - SM, sy + 3.5, { align: 'right' });

  // Footer
  const pageCount = d.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    d.setPage(p);
    d.setFont('helvetica', 'normal');
    d.setFontSize(6);
    setText(d, FAINT);
    d.text(`${slip.slipNo} · Page ${p} of ${pageCount}`, SM, SLIP_H - 7);
  }

  d.save(`${String(slip.slipNo).replace(/[\/\\\s]+/g, '_')}_${slip.date}.pdf`);
}

/** HTML mirror of the pick slip, for the preview modal. */
export function renderSlipPreviewHTML(slip, settings) {
  const s = settings || {};
  return `
  <div class="bill-sheet" style="max-width:560px">
    <div class="bill-accent"></div>
    <div class="bill-head">
      <div>
        <h2 class="bill-seller" style="font-size:17px">${esc(s.buyerBrand || s.buyerName || 'Stock')}</h2>
        <p class="bill-sub">from Customer Returns / RTO — internal stock movement</p>
      </div>
      <span class="bill-title-pill">Stock Pick Slip</span>
    </div>

    <div class="bill-meta">
      <span><b>Slip No:</b> ${esc(slip.slipNo)}</span>
      <span><b>Date:</b> ${esc(formatDateDisplay(slip.date) || slip.date)}</span>
      <span><b>Total Pcs:</b> ${slip.totalPcs}</span>
      ${slip.sourceFile ? `<span><b>Label:</b> ${esc(slip.sourceFile)}</span>` : ''}
    </div>

    <table class="bill-table">
      <thead><tr>
        <th>Sr</th><th>Kuntal</th><th>Colour</th><th>SellerSku</th><th>Src</th><th class="r">Qty</th>
      </tr></thead>
      <tbody>${slip.lines.map(l => `<tr>
        <td>${l.srNo}</td>
        <td>${esc(l.kuntalCode) || '—'}</td>
        <td>${esc(l.colourName) || '—'}</td>
        <td>${esc(l.sellerSkuCode) || '—'}</td>
        <td>${srcLabel(l.type)}</td>
        <td class="r">${l.qty}</td>
      </tr>`).join('')}</tbody>
    </table>

    <div class="bill-bottom">
      <div class="bill-ratesum">
        <p class="bill-terms" style="max-width:100%">This slip records stock taken from the returns register to fill a label.
        It is not a purchase — no payment is due against it.</p>
      </div>
      <div class="bill-totals" style="flex:0 0 190px">
        <div class="bill-grand" style="margin-top:0"><span>TOTAL PCS</span><span>${slip.totalPcs}</span></div>
      </div>
    </div>

    <div class="bill-close">
      <div class="bill-sign" style="text-align:left"><div class="bill-sign-line" style="margin-top:26px"></div><p class="bill-sub">Picked by</p></div>
      <div class="bill-sign"><div class="bill-sign-line" style="margin-top:26px"></div><p class="bill-sub">Checked by</p></div>
    </div>
  </div>`;
}

// ─── On-screen preview (mirrors the PDF) ─────────────────────────

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML mirror of the PDF, for the preview modal. */
export function renderBillPreviewHTML(bill, settings) {
  const s = settings || {};
  const t = bill.totals;
  const type = docTypeOf(bill.docType);

  const partyCard = (heading, lines) => `
    <div class="bill-party">
      <p class="bill-party-head">${esc(heading)}</p>
      ${lines.filter(Boolean).join('')}
    </div>`;

  return `
  <div class="bill-sheet">
    <div class="bill-accent"></div>
    <div class="bill-head">
      <div>
        <h2 class="bill-seller">${esc(s.sellerName || 'Supplier')}</h2>
        ${s.sellerGstin ? `<p class="bill-sub">GSTIN: ${esc(s.sellerGstin)}</p>` : ''}
        ${s.sellerState ? `<p class="bill-sub">State: ${esc(s.sellerState)}</p>` : ''}
      </div>
      <span class="bill-title-pill">${esc(type.label)}</span>
    </div>

    <div class="bill-parties">
      ${partyCard('FROM (SUPPLIER)', [
        `<p class="bill-party-name">${esc(s.sellerName || '—')}</p>`,
        s.sellerAddress ? `<p class="bill-sub">${esc(s.sellerAddress)}</p>` : '',
        s.sellerGstin ? `<p class="bill-sub">GSTIN: ${esc(s.sellerGstin)}</p>` : ''
      ])}
      ${partyCard('BILL TO (BUYER)', [
        `<p class="bill-party-name">${esc(s.buyerName || '—')}</p>`,
        s.buyerBrand ? `<p class="bill-brand">Brand: ${esc(s.buyerBrand)}</p>` : '',
        s.buyerAddress ? `<p class="bill-sub">${esc(s.buyerAddress)}</p>` : '',
        s.buyerGstin ? `<p class="bill-sub">GSTIN: ${esc(s.buyerGstin)}</p>` : ''
      ])}
    </div>

    <div class="bill-meta">
      <span><b>No:</b> ${esc(bill.billNo)}</span>
      <span><b>Date:</b> ${esc(formatDateDisplay(bill.billDate) || bill.billDate)}</span>
      <span><b>Place of Supply:</b> ${esc(bill.placeOfSupply || '—')}</span>
      <span><b>Items:</b> ${bill.lines.length}</span>
    </div>

    <table class="bill-table">
      <thead><tr>
        <th>Sr</th><th>Kuntal</th><th>Colour</th><th>HSN</th>
        <th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th>
      </tr></thead>
      <tbody>
        ${bill.lines.map(l => `<tr>
          <td>${l.srNo}</td>
          <td>${esc(l.kuntalCode) || '—'}</td>
          <td>${esc(l.colourName) || '—'}</td>
          <td>${esc(l.hsn) || '—'}</td>
          <td class="r">${l.qty}</td>
          <td class="r">${formatINR(l.rate)}</td>
          <td class="r">${formatINR(l.taxable)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="bill-bottom">
      <div class="bill-ratesum">
        <p class="bill-party-head">TAX RATE SUMMARY</p>
        <table>
          <thead><tr><th>Rate</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th></tr></thead>
          <tbody>${bill.rateSummary.map(r => `<tr>
            <td>${r.gstRate}%</td>
            <td class="r">${formatINR(r.taxable)}</td>
            <td class="r">${formatINR(r.cgst)}</td>
            <td class="r">${formatINR(r.sgst)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="bill-totals">
        <div class="bill-total-row"><span>Taxable Value</span><span>${formatINR(t.subTotal)}</span></div>
        <div class="bill-total-row"><span>CGST</span><span>${formatINR(t.cgstTotal)}</span></div>
        <div class="bill-total-row"><span>SGST</span><span>${formatINR(t.sgstTotal)}</span></div>
        <div class="bill-total-row"><span>Round Off</span><span>${t.roundOff < 0 ? '(' + formatINR(Math.abs(t.roundOff)) + ')' : formatINR(t.roundOff)}</span></div>
        <div class="bill-grand"><span>GRAND TOTAL</span><span>₹ ${formatINR(t.grandRounded, 0)}</span></div>
      </div>
    </div>

    <div class="bill-words"><b>AMOUNT IN WORDS</b><em>${esc(amountInWords(t.grandRounded))}</em></div>

    <div class="bill-close">
      <div>
        ${(s.bankName || s.bankAccount || s.bankIfsc) ? `<p class="bill-party-head">BANK DETAILS</p>
          ${s.bankName ? `<p class="bill-sub-dark">${esc(s.bankName)}</p>` : ''}
          ${s.bankAccount ? `<p class="bill-sub-dark">A/c: ${esc(s.bankAccount)}</p>` : ''}
          ${s.bankIfsc ? `<p class="bill-sub-dark">IFSC: ${esc(s.bankIfsc)}</p>` : ''}` : ''}
        ${s.terms ? `<p class="bill-party-head" style="margin-top:10px">TERMS &amp; CONDITIONS</p>
          <p class="bill-terms">${esc(s.terms)}</p>` : ''}
      </div>
      <div class="bill-sign">
        <p class="bill-sub-dark"><b>For ${esc(s.sellerName || 'Supplier')}</b></p>
        <div class="bill-sign-line"></div>
        <p class="bill-sub">Authorised Signatory</p>
      </div>
    </div>
  </div>`;
}
