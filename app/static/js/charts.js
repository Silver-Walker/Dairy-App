/* charts.js: draws the dashboard charts using the Chart.js library
   (loaded from /static/vendor/chart.umd.js). Call DairyCharts.render(data). */
window.DairyCharts = (function () {
  'use strict';
  const instances = {};
  const COLORS = {
    MORNING: '#2e7d32', LUNCH: '#f9a825', EVENING: '#5c6bc0',
    sent: '#1e88e5', received: '#43a047',
    TRANSFER: '#1e88e5', SALE: '#43a047', NON_SALE: '#fb8c00',
    revenue: '#2e7d32'
  };

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function hasData(arrays) {
    return arrays.some(function (a) { return a.some(function (n) { return n > 0; }); });
  }

  function draw(canvasId, config, nonEmpty) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (instances[canvasId]) { instances[canvasId].destroy(); delete instances[canvasId]; }
    canvas.parentElement.classList.toggle('no-data', !nonEmpty);
    if (!nonEmpty) return;                      // show the "no data" message instead of an empty chart
    instances[canvasId] = new Chart(canvas.getContext('2d'), config);
  }

  function baseOptions(yTitle, extra) {
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: yTitle } }
      }
    };
    if (extra) Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
    return opts;
  }

  function render(data) {
    if (typeof Chart === 'undefined') {
      document.querySelectorAll('.chart-box').forEach(function (b) {
        b.dataset.empty = 'Charts could not load (Chart.js file missing).';
        b.classList.add('no-data');
      });
      return;
    }
    Chart.defaults.color = cssVar('--muted', '#667267');
    Chart.defaults.borderColor = cssVar('--border', '#dbe2db');
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

    const labels = data.days.map(function (d) { return d.slice(8) + '/' + d.slice(5, 7); }); // dd/mm

    // 1. Production per day, stacked by milking session
    const p = data.production;
    const prodOpts = baseOptions('Litres');
    prodOpts.scales.x.stacked = true;
    prodOpts.scales.y.stacked = true;
    draw('ch-production', {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Morning', data: p.MORNING, backgroundColor: COLORS.MORNING },
          { label: 'Lunch', data: p.LUNCH, backgroundColor: COLORS.LUNCH },
          { label: 'Evening', data: p.EVENING, backgroundColor: COLORS.EVENING }
        ]
      },
      options: prodOpts
    }, hasData([p.MORNING, p.LUNCH, p.EVENING]));

    // 2. Sent to shop vs received at shop
    draw('ch-flow', {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Sent to shop', data: data.sent_to_shop, backgroundColor: COLORS.sent },
          { label: 'Received at shop', data: data.received_at_shop, backgroundColor: COLORS.received }
        ]
      },
      options: baseOptions('Litres')
    }, hasData([data.sent_to_shop, data.received_at_shop]));

    // 3. Dispatch classification (doughnut)
    const t = data.dispatch_by_type;
    draw('ch-types', {
      type: 'doughnut',
      data: {
        labels: ['Transfer to shop', 'External sale', 'Not a sale'],
        datasets: [{ data: [t.TRANSFER, t.SALE, t.NON_SALE],
                     backgroundColor: [COLORS.TRANSFER, COLORS.SALE, COLORS.NON_SALE] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    }, t.TRANSFER + t.SALE + t.NON_SALE > 0);

    // 4. External sales revenue per day
    draw('ch-revenue', {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{ label: 'Revenue (KSh)', data: data.external_sales_revenue, borderColor: COLORS.revenue,
                     backgroundColor: 'rgba(46,125,50,.15)', fill: true, tension: 0.25, pointRadius: 3 }]
      },
      options: baseOptions('KSh')
    }, hasData([data.external_sales_revenue]));
  }

  function renderShopSales(data) {
    if (typeof Chart === 'undefined') return;
    const palette = ['#2e7d32', '#8e24aa', '#ef6c00'];
    const names = Object.keys(data.shop_sales || {});
    const labels = data.days.map(function (d) { return d.slice(8) + '/' + d.slice(5, 7); });
    const opts = baseOptions('KSh');
    opts.scales.x.stacked = true;
    opts.scales.y.stacked = true;
    draw('ch-shop-sales', {
      type: 'bar',
      data: { labels: labels, datasets: names.map(function (n, i) {
        return { label: n, data: data.shop_sales[n], backgroundColor: palette[i % palette.length] };
      }) },
      options: opts
    }, hasData(names.map(function (n) { return data.shop_sales[n]; })));
  }

  function destroyAll() {
    Object.keys(instances).forEach(function (k) { instances[k].destroy(); delete instances[k]; });
  }

  return { render: function (d) { render(d); renderShopSales(d); }, destroyAll: destroyAll };
})();
