/* charts.js: draws the dashboard charts using the Chart.js library
   (loaded from /static/vendor/chart.umd.js). Call DairyCharts.render(data). */
window.DairyCharts = (function () {
  'use strict';
  const instances = {};
  let latestData = null;
  let latestExpenseData = null;
  let latestExpenseTrend = null;
  const COLORS = {
    MORNING: '#2e7d32', LUNCH: '#f9a825', EVENING: '#5c6bc0',
    sent: '#1e88e5', received: '#43a047',
    TRANSFER: '#1e88e5', SALE: '#43a047', NON_SALE: '#fb8c00',
    revenue: '#2e7d32'
  };

  function chartColors() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return {
      MORNING: dark ? '#4acb9a' : COLORS.MORNING,
      LUNCH: dark ? '#f5bc63' : COLORS.LUNCH,
      EVENING: dark ? '#8e94e8' : COLORS.EVENING,
      sent: dark ? '#7198ed' : COLORS.sent,
      received: dark ? '#4acb9a' : COLORS.received,
      TRANSFER: dark ? '#7198ed' : COLORS.TRANSFER,
      SALE: dark ? '#4acb9a' : COLORS.SALE,
      NON_SALE: dark ? '#efa85a' : COLORS.NON_SALE,
      revenue: dark ? '#4acb9a' : COLORS.revenue,
      expenses: dark ? '#f27f9b' : '#c62828',
      grid: cssVar('--chart-grid', 'rgba(37, 47, 57, .1)'),
      text: cssVar('--text', '#171a20'),
      muted: cssVar('--muted', '#7b8088'),
      net: dark ? '#f4f7fb' : '#344054'
    };
  }

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
    const palette = chartColors();
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: { grid: { display: false }, border: { color: palette.grid } },
        y: { beginAtZero: true, title: { display: true, text: yTitle },
             grid: { color: palette.grid }, border: { color: palette.grid } }
      }
    };
    if (extra) Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
    return opts;
  }

  function render(data) {
    latestData = data;
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
    const palette = chartColors();

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
          { label: 'Morning', data: p.MORNING, backgroundColor: palette.MORNING, borderRadius: 7 },
          { label: 'Lunch', data: p.LUNCH, backgroundColor: palette.LUNCH, borderRadius: 7 },
          { label: 'Evening', data: p.EVENING, backgroundColor: palette.EVENING, borderRadius: 7 }
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
          { label: 'Sent to shop', data: data.sent_to_shop, backgroundColor: palette.sent, borderRadius: 7 },
          { label: 'Received at shop', data: data.received_at_shop, backgroundColor: palette.received, borderRadius: 7 }
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
                     backgroundColor: [palette.TRANSFER, palette.SALE, palette.NON_SALE], borderColor: cssVar('--card', '#fff'),
                     borderWidth: 3 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    }, t.TRANSFER + t.SALE + t.NON_SALE > 0);

    // 4. External sales revenue per day
    draw('ch-revenue', {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{ label: 'Revenue (KSh)', data: data.external_sales_revenue, borderColor: palette.revenue,
                     backgroundColor: document.documentElement.dataset.theme === 'dark'
                       ? 'rgba(74,203,154,.16)' : 'rgba(46,125,50,.15)',
                     fill: true, tension: 0.25, pointRadius: 3, pointBackgroundColor: palette.revenue }]
      },
      options: baseOptions('KSh')
    }, hasData([data.external_sales_revenue]));
  }

  function renderShopSales(data) {
    if (typeof Chart === 'undefined') return;
    const dark = document.documentElement.dataset.theme === 'dark';
    const palette = dark ? ['#4acb9a', '#a994ef', '#efa85a'] : ['#2e7d32', '#8e24aa', '#ef6c00'];
    const names = Object.keys(data.shop_sales || {});
    const labels = data.days.map(function (d) { return d.slice(8) + '/' + d.slice(5, 7); });
    const opts = baseOptions('KSh');
    opts.scales.x.stacked = true;
    opts.scales.y.stacked = true;
    draw('ch-shop-sales', {
      type: 'bar',
      data: { labels: labels, datasets: names.map(function (n, i) {
        return { label: n, data: data.shop_sales[n], backgroundColor: palette[i % palette.length], borderRadius: 7 };
      }) },
      options: opts
    }, hasData(names.map(function (n) { return data.shop_sales[n]; })));
  }

  function renderExpenses(categories, reportedTotal) {
    const categoryTotal = categories.reduce(function (sum, row) { return sum + Number(row.total); }, 0);
    const total = reportedTotal === undefined ? categoryTotal : Number(reportedTotal);
    latestExpenseData = { categories: categories, total: total };
    const dark = document.documentElement.dataset.theme === 'dark';
    const palette = dark
      ? ['#4acb9a', '#a994ef', '#efa85a', '#7198ed', '#f27f9b', '#93c878', '#62c7d7']
      : ['#2e7d32', '#8e24aa', '#ef6c00', '#1e88e5', '#d64b68', '#679b30', '#0097a7'];
    const rows = categories.filter(function (row) { return Number(row.total) > 0; });
    const amount = document.getElementById('expense-chart-total-value');
    if (amount) amount.textContent = formatExpenseMoney(total);
    const breakdown = document.getElementById('expense-category-totals');
    if (breakdown) {
      breakdown.innerHTML = rows.map(function (row) {
        const value = Number(row.total);
        const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
        const color = palette[categories.indexOf(row) % palette.length];
        return '<div class="expense-category-total">' +
          '<span class="expense-category-name"><span class="expense-category-swatch" style="--category-color:' + color + '" aria-hidden="true"></span>' +
          '<span>' + escapeChartText(row.category) + '</span></span>' +
          '<span class="expense-category-value"><strong>' + formatExpenseMoney(value) + '</strong><span class="muted">' +
          percentage + '%</span></span></div>';
      }).join('') || '<p class="muted">No category totals for this period.</p>';
    }
    if (typeof Chart === 'undefined') return;
    draw('ch-expenses', {
      type: 'doughnut',
      data: {
        labels: rows.map(function (row) { return row.category; }),
        datasets: [{ data: rows.map(function (row) { return Number(row.total); }),
          backgroundColor: rows.map(function (_, i) { return palette[i % palette.length]; }),
          borderColor: cssVar('--card', '#fff'), borderWidth: 3 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '66%',
        plugins: { legend: { display: false } } }
    }, rows.length > 0);
  }

  function escapeChartText(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function groupExpenseTrend(daily, granularity) {
    const buckets = {};
    daily.forEach(function (row) {
      const parts = row.date.split('-').map(Number);
      const date = new Date(parts[0], parts[1] - 1, parts[2]);
      let key, label;
      if (granularity === 'month') {
        key = row.date.slice(0, 7);
        label = date.toLocaleDateString([], { month: 'short', year: 'numeric' });
      } else if (granularity === 'week') {
        date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' +
          String(date.getDate()).padStart(2, '0');
        label = 'Week of ' + date.toLocaleDateString([], { day: 'numeric', month: 'short' });
      } else {
        key = row.date;
        label = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
      }
      if (!buckets[key]) buckets[key] = { label: label, revenue: 0, expenses: 0 };
      buckets[key].revenue += Number(row.revenue);
      buckets[key].expenses += Number(row.expenses);
    });
    return { buckets: buckets, keys: Object.keys(buckets).sort() };
  }

  function formatExpenseMoney(value) {
    return 'KSh ' + Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  function addExpenseInsight(list, color, title, description) {
    const item = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'insight-dot ' + color;
    dot.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('p');
    detail.textContent = description;
    content.appendChild(heading);
    content.appendChild(detail);
    item.appendChild(dot);
    item.appendChild(content);
    list.appendChild(item);
  }

  function describeTrendChange(current, previous) {
    const difference = current - previous;
    if (difference === 0) return 'no change';
    const direction = difference > 0 ? 'up' : 'down';
    const amount = formatExpenseMoney(Math.abs(difference));
    if (previous === 0) return direction + ' ' + amount + ' from KSh 0.00';
    const percent = Math.round(Math.abs(difference / previous) * 100);
    return direction + ' ' + amount + ' (' + percent + '%)';
  }

  function renderExpenseInsights(daily, grouped, granularity, area) {
    const list = document.getElementById('expense-insights');
    const context = document.getElementById('expense-insights-context');
    if (!list || !context) return;
    const groupNames = { day: 'day', week: 'week', month: 'month' };
    const groupName = groupNames[granularity] || 'period';
    const expenseScope = area === 'FARM' ? 'farm expenses' :
      area === 'SHOP' ? 'shop expenses' : 'expenses across all areas';
    context.textContent = 'Grouped by ' + groupName +
      ' for the selected range. Revenue includes shop and external sales; the chart compares it with ' + expenseScope + '.';
    list.replaceChildren();

    if (!daily.length || !grouped.keys.length) {
      addExpenseInsight(list, 'teal', 'Chart summary unavailable',
        'There is no current trend data to summarize. Refresh the report while online to load this period’s values.');
      return;
    }

    const buckets = grouped.buckets;
    const keys = grouped.keys;
    const totals = keys.reduce(function (sum, key) {
      sum.revenue += buckets[key].revenue;
      sum.expenses += buckets[key].expenses;
      return sum;
    }, { revenue: 0, expenses: 0 });
    const net = totals.revenue - totals.expenses;
    const netDescription = net > 0 ? 'Net surplus' : net < 0 ? 'Net shortfall' : 'Break-even net result';
    let summary = 'Across the selected range, recorded revenue was ' + formatExpenseMoney(totals.revenue) +
      ' and ' + expenseScope + ' were ' + formatExpenseMoney(totals.expenses) +
      ', leaving a ' + netDescription.toLowerCase() + ' of ' + formatExpenseMoney(Math.abs(net)) + '.';
    if (totals.revenue > 0) {
      summary += ' Net margin against this revenue is ' + (net / totals.revenue * 100).toFixed(1) + '%.';
    } else {
      summary += ' Net margin is not available because recorded revenue is zero.';
    }
    addExpenseInsight(list, net >= 0 ? 'green' : 'orange', netDescription, summary);

    if (keys.length > 1) {
      const previous = buckets[keys[keys.length - 2]];
      const latest = buckets[keys[keys.length - 1]];
      const netChange = (latest.revenue - latest.expenses) - (previous.revenue - previous.expenses);
      const netMovementText = netChange > 0 ? 'improved by ' + formatExpenseMoney(netChange) :
        netChange < 0 ? 'fell by ' + formatExpenseMoney(Math.abs(netChange)) : 'did not change';
      addExpenseInsight(list, 'teal', 'Latest ' + groupName + ' vs previous ' + groupName,
        latest.label + ': revenue ' + describeTrendChange(latest.revenue, previous.revenue) +
        ', expenses ' + describeTrendChange(latest.expenses, previous.expenses) +
        '. Net ' + netMovementText + ' compared with ' + previous.label + '.');
    } else {
      addExpenseInsight(list, 'teal', 'Only one ' + groupName + ' in range',
        'The chart contains ' + keys[0] + ' only, so there is no earlier ' + groupName + ' in this selection to compare.');
    }

    const highestRevenueKey = keys.reduce(function (best, key) {
      return buckets[key].revenue > buckets[best].revenue ? key : best;
    }, keys[0]);
    const highestExpenseKey = keys.reduce(function (best, key) {
      return buckets[key].expenses > buckets[best].expenses ? key : best;
    }, keys[0]);
    const highestRevenue = buckets[highestRevenueKey];
    const highestExpense = buckets[highestExpenseKey];
    if (totals.revenue === 0 && totals.expenses === 0) {
      addExpenseInsight(list, 'amber', 'No recorded activity',
        'Every grouped period has zero recorded revenue and expenses, so the net line remains at zero.');
    } else {
      addExpenseInsight(list, 'amber', 'Largest grouped amounts',
        'Highest revenue: ' + highestRevenue.label + ' at ' + formatExpenseMoney(highestRevenue.revenue) +
        '. Highest expenses: ' + highestExpense.label + ' at ' + formatExpenseMoney(highestExpense.expenses) + '.');
    }
  }

  function renderExpenseTrend(daily, granularity, area) {
    latestExpenseTrend = { daily: daily, granularity: granularity, area: area };
    const grouped = groupExpenseTrend(daily, granularity);
    const buckets = grouped.buckets;
    const keys = grouped.keys;
    renderExpenseInsights(daily, grouped, granularity, area);
    if (typeof Chart === 'undefined') return;
    const palette = chartColors();
    const revenueData = keys.map(function (key) { return buckets[key].revenue; });
    const expenseData = keys.map(function (key) { return buckets[key].expenses; });
    const netData = keys.map(function (key) { return buckets[key].revenue - buckets[key].expenses; });
    const options = baseOptions('KSh');
    options.plugins = Object.assign({}, options.plugins, {
      legend: { position: 'bottom', labels: { color: palette.text, usePointStyle: true, boxWidth: 10, boxHeight: 10 } }
    });
    options.scales.x = Object.assign({}, options.scales.x, { grid: { display: false }, ticks: { color: palette.muted }, border: { color: palette.grid } });
    options.scales.y = Object.assign({}, options.scales.y, { ticks: { color: palette.muted }, grid: { color: palette.grid }, border: { color: palette.grid } });
    draw('ch-expense-trend', {
      type: 'bar',
      data: {
        labels: keys.map(function (key) { return buckets[key].label; }),
        datasets: [
          { type: 'bar', label: 'Revenue', data: revenueData,
            backgroundColor: palette.revenue, borderRadius: 5, borderSkipped: false, barPercentage: 0.72, categoryPercentage: 0.68 },
          { type: 'bar', label: 'Expenses', data: expenseData,
            backgroundColor: palette.expenses, borderRadius: 5, borderSkipped: false, barPercentage: 0.72, categoryPercentage: 0.68 },
          { type: 'line', label: 'Net', data: netData,
            borderColor: palette.net, backgroundColor: palette.net, pointBackgroundColor: palette.net,
            pointBorderColor: palette.net, pointRadius: 4, pointHoverRadius: 5, borderWidth: 3, tension: 0.25, fill: false }
        ]
      },
      options: options
    }, keys.some(function (key) { return buckets[key].revenue > 0 || buckets[key].expenses > 0; }));
  }

  function destroyAll() {
    Object.keys(instances).forEach(function (k) { instances[k].destroy(); delete instances[k]; });
    latestData = null;
    latestExpenseData = null;
    latestExpenseTrend = null;
  }

  return {
    render: function (d) { render(d); renderShopSales(d); },
    renderExpenses: renderExpenses,
    renderExpenseTrend: renderExpenseTrend,
    refreshTheme: function () {
      if (latestData) { render(latestData); renderShopSales(latestData); }
      if (latestExpenseData) renderExpenses(latestExpenseData.categories, latestExpenseData.total);
      if (latestExpenseTrend) renderExpenseTrend(latestExpenseTrend.daily, latestExpenseTrend.granularity, latestExpenseTrend.area);
    },
    destroyAll: destroyAll
  };
})();
