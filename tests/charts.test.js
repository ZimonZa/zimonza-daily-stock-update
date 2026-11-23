// Charts can be drawn again on the same canvas (Dashboard period buttons,
// date changes). Chart.js refuses a canvas that still holds a chart.

const inUse = new Set();
globalThis.Chart = class {
  constructor(ctx) {
    if (inUse.has(ctx.canvas.id)) throw new Error(`Canvas is already in use (${ctx.canvas.id})`);
    inUse.add(ctx.canvas.id);
    this.id = ctx.canvas.id;
  }
  destroy() { inUse.delete(this.id); }
};
const canvases = {};
globalThis.document = {
  getElementById: (id) => (canvases[id] ||= {
    id,
    getContext() { return { canvas: this, createLinearGradient: () => ({ addColorStop() {} }) }; }
  })
};

const charts = await import('./charts.js');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${x}`); } };
const twice = (name, fn) => {
  try { fn(); fn(); ok(name, true); } catch (e) { ok(name, false, e.message); }
};

twice('sales trend redraws', () => charts.renderSalesTrendChart('c1', ['11-20', '11-21'], [0, 116], [0, 149]));
twice('stock health redraws', () => charts.renderStockHealthChart('c2', { high: 1, medium: 1, low: 1, soldOut: 0 }));
twice('category split redraws', () => charts.renderCategoryChart('c3', 358, 788));
twice('top sold redraws', () => charts.renderTopSoldChart('c4', [{ sku: '1259', name: 'x', totalSold: 6 }]));
twice('upload coverage redraws', () => charts.renderUploadCoverageChart('c5', ['11-20'], [true]));
twice('restock trend redraws', () => charts.renderRestockTrendChart('c6', ['11-20'], [149]));
ok('one chart left per canvas', inUse.size === 6, `in use: ${inUse.size}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
