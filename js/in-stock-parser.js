// ═══════════════════════════════════════════════════════════════
// ZIMONZA — In-Stock Analysis Parser
// Standalone module: no Firebase, no auth, no existing parser deps.
// Accepts any stock Excel file, auto-detects the data table,
// groups by ITEM NO + COLOR, and validates BAL PCS.
// ═══════════════════════════════════════════════════════════════

const COL_ALIASES = {
  ITEM_NO:      ['ITEM NO', 'ITEM NUMBER', 'ITEMNO', 'SKU'],
  ITEM_NAME:    ['ITEM NAME', 'PRODUCT NAME', 'DESCRIPTION', 'ITEM DESC'],
  SUB_LOCATION: ['SUB LOCATION', 'SUB LOC', 'SUBLOCATION', 'LOCATION'],
  COLOR:        ['COLOR', 'COLOUR'],
  READY_STOCK:  ['READY STOCK', 'READY STK', 'READYSTOCK', 'OPENING STOCK', 'READY'],
  SALES_PCS:    ['SALES PCS', 'SOLD PCS', 'SALES', 'SOLD', 'SALE PCS'],
  BAL_PCS:      ['BAL PCS', 'BAL. PCS', 'BAL PCS.', 'BALANCE PCS', 'BALANCE', 'BAL'],
};

function readRawRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const ws = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        resolve(rows);
      } catch (err) {
        reject(new Error('Failed to parse Excel file: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    if (row && row.some(cell => String(cell || '').trim().toUpperCase() === 'ITEM NO')) {
      return i;
    }
  }
  return -1;
}

function buildColMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((cell, idx) => {
    if (cell == null) return;
    const val = String(cell).trim().toUpperCase();
    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      if (map[key] == null && aliases.some(a => val === a || val.includes(a) || (val.length >= 4 && a.includes(val)))) {
        map[key] = idx;
      }
    }
  });
  return map;
}

function parseDataRows(rows, headerRowIdx, colMap) {
  const dataRows = rows.slice(headerRowIdx + 1);
  const records = [];

  for (const row of dataRows) {
    if (!row || row.every(c => c == null || String(c).trim() === '')) continue;

    const rawItemNo = row[colMap.ITEM_NO];
    if (rawItemNo == null || String(rawItemNo).trim() === '') continue;

    const itemNo = String(rawItemNo).trim().toUpperCase();
    if (itemNo === 'ITEM NO' || itemNo === 'SUB LOCATION') continue;

    const itemName = String(row[colMap.ITEM_NAME] ?? '').trim();
    const subLocation = String(row[colMap.SUB_LOCATION] ?? '').trim().toUpperCase();
    const color = String(row[colMap.COLOR] ?? '').trim();
    const readyStock = Number(row[colMap.READY_STOCK] ?? 0) || 0;
    const salesPcs = Number(row[colMap.SALES_PCS] ?? 0) || 0;
    const balPcs = Number(row[colMap.BAL_PCS] ?? 0) || 0;

    records.push({ itemNo, itemName, subLocation, color, readyStock, salesPcs, balPcs });
  }

  return records;
}

function normColor(c) {
  return String(c ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function consolidateByItemColor(rawRecords) {
  const groups = new Map();

  for (const rec of rawRecords) {
    const key = `${rec.itemNo}||${normColor(rec.color)}`;

    if (!groups.has(key)) {
      groups.set(key, {
        itemNo: rec.itemNo,
        itemName: rec.itemName || '',
        color: rec.color,
        subLocations: [],
        totalReadyStock: 0,
        totalSalesPcs: 0,
        totalBalPcs: 0,
        balCorrected: false,
        originalBalPcs: null,
      });
    }

    const g = groups.get(key);

    if (!g.itemName && rec.itemName) g.itemName = rec.itemName;

    if (rec.subLocation && !g.subLocations.includes(rec.subLocation)) {
      g.subLocations.push(rec.subLocation);
    }

    g.totalReadyStock += rec.readyStock;
    g.totalSalesPcs += rec.salesPcs;
    g.totalBalPcs += rec.balPcs;
  }

  const consolidated = [];
  const corrections = [];

  for (const record of groups.values()) {
    const expected = record.totalReadyStock - record.totalSalesPcs;
    if (record.totalBalPcs !== expected) {
      record.originalBalPcs = record.totalBalPcs;
      record.totalBalPcs = expected;
      record.balCorrected = true;
      corrections.push({
        itemNo: record.itemNo,
        itemName: record.itemName,
        color: record.color,
        originalBalPcs: record.originalBalPcs,
        correctedBalPcs: expected,
        diff: record.originalBalPcs - expected,
      });
    }
    consolidated.push(record);
  }

  consolidated.sort((a, b) =>
    String(a.itemNo).localeCompare(String(b.itemNo), undefined, { numeric: true })
  );

  corrections.sort((a, b) =>
    String(a.itemNo).localeCompare(String(b.itemNo), undefined, { numeric: true })
  );

  return { consolidated, corrections };
}

export async function parseInStockFile(file) {
  const rows = await readRawRows(file);
  const headerRowIdx = findHeaderRow(rows);

  if (headerRowIdx === -1) {
    throw new Error('Could not find the stock table header. Make sure the file contains an "ITEM NO" column.');
  }

  const colMap = buildColMap(rows[headerRowIdx]);

  const KEY_LABELS = {
    ITEM_NO: 'ITEM NO', ITEM_NAME: 'ITEM NAME', SUB_LOCATION: 'SUB LOCATION',
    COLOR: 'COLOR', READY_STOCK: 'READY STOCK', SALES_PCS: 'SALES PCS', BAL_PCS: 'BAL PCS',
  };
  const missingColumns = Object.keys(COL_ALIASES)
    .filter(key => colMap[key] == null)
    .map(key => KEY_LABELS[key] ?? key);

  const rawRecords = parseDataRows(rows, headerRowIdx, colMap);
  const { consolidated, corrections } = consolidateByItemColor(rawRecords);

  return {
    consolidated,
    corrections,
    missingColumns,
    rawRowCount: rawRecords.length,
  };
}
