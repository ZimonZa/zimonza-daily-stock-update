// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Chart.js Wrappers
// ═══════════════════════════════════════════════════════════════

const PALETTE = {
  emerald: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  rose: '#F43F5E',
  teal: '#14B8A6',
  indigo: '#6366F1',
  orange: '#F97316',
  cyan: '#06B6D4'
};

const GRID_COLOR = 'rgba(255,255,255,0.05)';
const TEXT_COLOR = '#94A3B8';
const FONT_FAMILY = "'Inter', sans-serif";

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: TEXT_COLOR,
          font: { family: FONT_FAMILY, size: 11 },
          boxWidth: 10, padding: 16
        }
      },
      tooltip: {
        backgroundColor: 'rgba(15,23,42,0.95)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: '#E2E8F0',
        bodyColor: '#94A3B8',
        padding: 10,
        cornerRadius: 8,
        titleFont: { family: FONT_FAMILY, size: 12, weight: 'bold' },
        bodyFont: { family: FONT_FAMILY, size: 11 }
      }
    },
    scales: {
      x: {
        grid: { color: GRID_COLOR },
        ticks: { color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 10 } },
        border: { color: 'transparent' }
      },
      y: {
        grid: { color: GRID_COLOR },
        ticks: { color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 10 } },
        border: { color: 'transparent' }
      }
    },
    ...extra
  };
}

/** Register a chart instance to destroy it on re-render */
const chartRegistry = new Map();

function registerChart(id, instance) {
  if (chartRegistry.has(id)) chartRegistry.get(id).destroy();
  chartRegistry.set(id, instance);
}

/**
 * Sales Trend Line Chart
 */
export function renderSalesTrendChart(canvasId, labels, soldData, restockedData) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(16,185,129,0.2)');
  gradient.addColorStop(1, 'rgba(16,185,129,0)');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Sold',
          data: soldData,
          borderColor: PALETTE.emerald,
          backgroundColor: gradient,
          borderWidth: 2.5,
          pointBackgroundColor: PALETTE.emerald,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4
        },
        {
          label: 'Restocked',
          data: restockedData,
          borderColor: PALETTE.amber,
          backgroundColor: 'rgba(245,158,11,0.05)',
          borderWidth: 2.5,
          pointBackgroundColor: PALETTE.amber,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: false,
          tension: 0.4
        }
      ]
    },
    options: baseOptions()
  });
  registerChart(canvasId, chart);
}

/**
 * Stock Health Donut Chart
 */
export function renderStockHealthChart(canvasId, health) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['High', 'Medium', 'Low', 'Sold Out'],
      datasets: [{
        data: [health.high || 0, health.medium || 0, health.low || 0, health.soldOut || 0],
        backgroundColor: [PALETTE.emerald, PALETTE.amber, PALETTE.red, '#475569'],
        borderColor: 'rgba(15,23,42,0.8)',
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: TEXT_COLOR,
            font: { family: FONT_FAMILY, size: 11 },
            boxWidth: 10, padding: 12
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#E2E8F0',
          bodyColor: '#94A3B8',
          padding: 10,
          cornerRadius: 8
        }
      }
    }
  });
  registerChart(canvasId, chart);
}

/**
 * Category Distribution Bar Chart
 */
export function renderCategoryChart(canvasId, lehngaCount, sareeCount) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Lehnga', 'Saree'],
      datasets: [{
        label: 'SKUs',
        data: [lehngaCount, sareeCount],
        backgroundColor: [
          'rgba(139,92,246,0.7)',
          'rgba(20,184,166,0.7)'
        ],
        borderColor: [PALETTE.purple, PALETTE.teal],
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      ...baseOptions(),
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 11 } }
        },
        y: {
          grid: { color: GRID_COLOR },
          ticks: { color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 10 } }
        }
      }
    }
  });
  registerChart(canvasId, chart);
}

/**
 * Top Sold SKUs Horizontal Bar
 */
export function renderTopSoldChart(canvasId, items) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const labels = items.map(i => `${i.sku}`);
  const data = items.map(i => i.totalSold || 0);

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Pieces Sold',
        data,
        backgroundColor: 'rgba(16,185,129,0.7)',
        borderColor: PALETTE.emerald,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      ...baseOptions(),
      indexAxis: 'y',
      scales: {
        x: {
          grid: { color: GRID_COLOR },
          ticks: { color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 10 } }
        },
        y: {
          grid: { display: false },
          ticks: { color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 10 } }
        }
      }
    }
  });
  registerChart(canvasId, chart);
}

/**
 * Upload Coverage Chart (last N days)
 */
export function renderUploadCoverageChart(canvasId, dates, uploadedFlags) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [{
        label: 'Upload Status',
        data: uploadedFlags.map(f => f ? 1 : 0),
        backgroundColor: uploadedFlags.map(f => f ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.4)'),
        borderColor: uploadedFlags.map(f => f ? PALETTE.emerald : PALETTE.red),
        borderWidth: 1.5,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      ...baseOptions(),
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: TEXT_COLOR, font: { family: FONT_FAMILY, size: 9 }, maxRotation: 45 }
        },
        y: {
          display: false,
          max: 1.2,
          min: 0
        }
      }
    }
  });
  registerChart(canvasId, chart);
}

/**
 * Restock Trend Chart
 */
export function renderRestockTrendChart(canvasId, labels, data) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Restocked Pcs',
        data,
        backgroundColor: 'rgba(245,158,11,0.6)',
        borderColor: PALETTE.amber,
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: baseOptions()
  });
  registerChart(canvasId, chart);
}

/** Destroy all registered charts */
export function destroyAllCharts() {
  chartRegistry.forEach(c => c.destroy());
  chartRegistry.clear();
}
