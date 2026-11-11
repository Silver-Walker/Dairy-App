/* app.js: screens and buttons. Reads top to bottom:
   1) small helpers  2) login/logout  3) navigation  4) each screen  5) start-up */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 1) helpers */
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  const state = { me: null, loc: null, view: null, dashToken: 0, pollTimer: null };

  // Escape text before putting it into HTML, so typed notes can never run as code.
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtL(v) {
    if (v === null || v === undefined) return '—';
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  function fmtSigned(v) {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    const cls = n < 0 ? 'neg' : (n > 0 ? 'pos' : '');
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + fmtL(n) + '</span>';
  }
  function fmtMoney(v) {
    if (v === null || v === undefined) return '—';
    return 'KSh ' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDT(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(isoDate) {
    const p = isoDate.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowLocalValue() { const d = new Date(); return todayStr(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function toIso(localValue) {                       // browser local time -> UTC ISO string
    const d = new Date(localValue);
    if (isNaN(d.getTime())) throw new Error('Please enter a valid date and time.');
    return d.toISOString();
  }

  function toast(text, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' error' : '');
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'error' ? 6000 : 3000);
  }
  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
    el.hidden = !text;
  }
  function renderTable(table, columns, rows, emptyText) {
    if (!rows.length) { table.innerHTML = '<tbody><tr><td class="empty">' + esc(emptyText) + '</td></tr></tbody>'; return; }
    const head = '<thead><tr>' + columns.map(function (c) {
      return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.h) + '</th>';
    }).join('') + '</tr></thead>';
    const body = '<tbody>' + rows.map(function (r) {
      return '<tr>' + columns.map(function (c) {
        return '<td' + (c.num ? ' class="num"' : '') + '>' + c.f(r) + '</td>';   // c.f must return safe HTML
      }).join('') + '</tr>';
    }).join('') + '</tbody>';
    table.innerHTML = head + body;
  }
  function fillSelect(select, items, valueKey, labelKey) {
    select.innerHTML = items.map(function (i) {
      return '<option value="' + esc(i[valueKey]) + '">' + esc(i[labelKey]) + '</option>';
    }).join('');
  }
  function hasRole() {
    const wanted = Array.prototype.slice.call(arguments);
    const mine = state.me ? state.me.roles : [];
    return mine.indexOf('OWNER') !== -1 || wanted.some(function (r) { return mine.indexOf(r) !== -1; });
  }
  // Run a loader and show any error as a toast instead of breaking the page.
  async function safe(fn) {
    try { return await fn(); } catch (e) { if (e.status !== 401) toast(e.message, 'error'); return null; }
  }

  const TYPE_LABEL = { TRANSFER: 'Transfer to shop', SALE: 'External sale', NON_SALE: 'Not a sale' };
  function statusTag(s) {
    if (s === 'MATCHED') return '<span class="tag">Matched</span>';
    if (s === 'DISCREPANCY') return '<span class="tag bad">Discrepancy</span>';
    if (s === 'NOT_RECEIVED') return '<span class="tag warn">Awaiting receipt</span>';
    return '—';
  }

  /* ------------------------------------------------------------------ 2) login / logout */
  function showLogin() {
    state.me = null;
    clearInterval(state.pollTimer);
    if (window.DairyCharts) DairyCharts.destroyAll();
    // wipe every table/list so the next person to log in on this device never sees the previous user's data
    $$('#kpis, #alerts-list, #close-result, .stock-list, table').forEach(function (el) { el.innerHTML = ''; });
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    refreshLoginMode();
  }
  // On a brand-new installation there is no account yet: show the "create owner" form instead of the login form.
  async function refreshLoginMode() {
    let setup = false;
    try { setup = (await API.get('/auth/setup-status')).needs_setup; } catch (e) { /* show normal login */ }
    $('#setup-form').hidden = !setup;
    $('#login-form').hidden = setup;
  }

  async function startApp(me) {
    state.me = me;
    $('#owner-direct-sale').hidden = !hasRole('OWNER');
    $('#who').textContent = me.user + ' (' + me.roles.map(function (r) { return r.replace('_', ' ').toLowerCase(); }).join(', ') + ')';
    $('#biz-name').textContent = me.business;
    if (me.must_change_password) {
      state.loc = { farms: [], shops: [] };            // nothing else is allowed until the password is changed
    } else {
      state.loc = await API.get('/api/locations');
      setupForms();
    }
    buildNav();
    $('#login-view').hidden = true;        // show the app only once it is fully ready
    $('#app-view').hidden = false;
    if (!me.must_change_password) refreshBadge();
    clearInterval(state.pollTimer);
    if (!me.must_change_password) state.pollTimer = setInterval(refreshBadge, 60000);
    routeFromHash(true);
  }

  async function syncSession() {
    if (!state.me) return false;
    const me = await API.get('/auth/me');
    const sameUser = me.username === state.me.username &&
      me.business_id === state.me.business_id &&
      me.roles.join(',') === state.me.roles.join(',');
    if (!sameUser) {
      await startApp(me);
      return false;
    }
    return true;
  }
  window.addEventListener('focus', function () {
    syncSession().catch(function (e) {
      if (e.status === 401) showLogin();
      else toast(e.message, 'error');
    });
  });

  $('#login-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const form = ev.target, err = $('#login-error'), btn = $('button[type=submit]', form);
    setMsg(err, '');
    btn.disabled = true;
    try {
      await API.post('/auth/login', { username: form.elements.username.value.trim(), password: form.elements.password.value });
      form.elements.password.value = '';
      await startApp(await API.get('/auth/me'));
    } catch (e) {
      setMsg(err, e.message, 'error');
    } finally { btn.disabled = false; }
  });

  $('#logout').addEventListener('click', async function () {
    await safe(function () { return API.post('/auth/logout'); });
    location.hash = '';
    showLogin();
  });

  /* ------------------------------------------------------------------ 3) navigation */
  const VIEWS = [
    { id: 'dashboard',  label: 'Dashboard',    roles: [],                  load: loadDashboard },
    { id: 'production', label: 'Production',   roles: ['MILKER'],          load: loadProduction },
    { id: 'dispatch',   label: 'Dispatch',     roles: ['MILKER'],          load: loadDispatch },
    { id: 'receipts',   label: 'Receive milk', roles: ['SHOP_ATTENDANT'],  load: loadReceipts },
    { id: 'processing', label: 'Processing',   roles: ['SHOP_ATTENDANT'],  load: loadProcessing },
    { id: 'sales',      label: 'Sales',        roles: ['SHOP_ATTENDANT'],  load: loadSales },
    { id: 'losses',     label: 'Losses',       roles: ['SHOP_ATTENDANT'],  load: loadLosses },
    { id: 'closing',    label: 'Daily closing', roles: ['SHOP_ATTENDANT'], load: loadClosing },
    { id: 'prices',     label: 'Prices',       roles: [],                  load: loadPrices },
    { id: 'opening',    label: 'Opening stock', roles: [],                 load: loadOpening },
    { id: 'users',      label: 'Users',        roles: [],                  load: loadUsers },
    { id: 'activity',   label: 'Activity',     roles: [],                  load: loadActivity },
    { id: 'alerts',     label: 'Alerts',       roles: ['MILKER', 'SHOP_ATTENDANT'], load: loadAlerts },
    { id: 'account',    label: 'Account',      roles: ['MILKER', 'SHOP_ATTENDANT'], load: loadAccount }
  ];
  const OWNER_HIDDEN_VIEWS = ['production', 'dispatch', 'receipts', 'processing', 'closing', 'opening'];
  function allowedViews() {
    // roles: [] means owner only (hasRole always lets OWNER through)
    if (state.me && state.me.must_change_password) return VIEWS.filter(function (v) { return v.id === 'account'; });
    return VIEWS.filter(function (v) {
      return hasRole.apply(null, v.roles) &&
        (!hasRole('OWNER') || OWNER_HIDDEN_VIEWS.indexOf(v.id) === -1);
    });
  }
  function buildNav() {
    const nav = $('#nav');
    nav.innerHTML = allowedViews().map(function (v) {
      return '<button class="tab" data-view="' + v.id + '">' + esc(v.label) + '</button>';
    }).join('');
  }
  $('#nav').addEventListener('click', function (ev) {
    const b = ev.target.closest('.tab');
    if (b) showView(b.dataset.view);
  });
  $('#bell').addEventListener('click', function () { showView('alerts'); });

  function showView(id) {
    const v = allowedViews().filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    state.view = id;
    $$('.view').forEach(function (s) { s.hidden = s.id !== 'view-' + id; });
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === id); });
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    safe(v.load);
  }
  function routeFromHash(first) {
    const wanted = location.hash.replace('#', '');
    const views = allowedViews();
    const ok = views.some(function (v) { return v.id === wanted; });
    if (ok) return showView(wanted);
    if (first) showView(views[0].id);
  }
  window.addEventListener('hashchange', function () { if (state.me) routeFromHash(false); });

  /* ------------------------------------------------------------------ 4) screens */

  /* ---- shared: stock boxes ---- */
  async function loadStock(targetEl, kind, id) {
    const data = await API.get('/api/stock?' + kind + '_id=' + encodeURIComponent(id));
    const items = kind === 'farm'
      ? data.items.filter(function (i) { return i.type === 'FRESH_MILK'; })
      : data.items;
    targetEl.innerHTML = items.map(function (i) {
      const way = Number(i.in_transit_litres) > 0 ? ' <span class="muted">(+' + fmtL(i.in_transit_litres) + ' L on the way)</span>' : '';
      return '<div class="stock-row"><span>' + esc(i.product) + way + '</span><strong>' + fmtL(i.balance_litres) + ' L</strong></div>';
    }).join('') || '<p class="muted">No stock recorded yet.</p>';
  }

  /* ---- generic form wiring (save, show errors, avoid double-saves) ---- */
  function bindForm(form, opts) {
    form.dataset.uuid = API.uuid();
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const btn = $('button[type=submit]', form), msg = $('.msg', form);
      if (btn.disabled) return;
      setMsg(msg, '');
      try {
        if (!(await syncSession())) {
          toast('Your signed-in account changed. Check the account shown and submit again.');
          return;
        }
      } catch (e) {
        if (e.status === 401) showLogin();
        else setMsg(msg, e.message, 'error');
        return;
      }
      let payload;
      try { payload = opts.build(form); } catch (e) { setMsg(msg, e.message, 'error'); return; }
      payload.client_uuid = form.dataset.uuid;      // same id on retry => never saved twice
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const res = await API.post(opts.url, payload);
        toast(res.created === false ? 'This was already saved earlier (no duplicate created).' : 'Saved ✓');
        form.dataset.uuid = API.uuid();
        opts.reset(form);
        await opts.after(res);
        if (res.warnings && res.warnings.length) setMsg(msg, res.warnings.join(' '), 'warn');
      } catch (e) {
        setMsg(msg, e.message, 'error');
      } finally { btn.disabled = form.dataset.locked === '1'; btn.textContent = label; }
    });
  }

  /* ---- set up all forms once, after we know the farms and shops ---- */
  let formsReady = false;
  function setupForms() {
    const farms = state.loc.farms, shops = state.loc.shops;
    [$('#prod-form [name=farm_id]'), $('#disp-form [name=farm_id]')].forEach(function (s) { fillSelect(s, farms, 'id', 'name'); });
    fillSelect($('#direct-sale-form [name=farm_id]'), farms, 'id', 'name');
    fillSelect($('#farm-use-form [name=farm_id]'), farms, 'id', 'name');
    fillSelect($('#disp-form [name=destination_shop_id]'), shops, 'id', 'name');
    fillSelect($('#rec-form [name=shop_id]'), shops, 'id', 'name');
    // With only one farm / shop (first release) hide the pointless drop-downs.
    $('#prod-farm-wrap').hidden = farms.length < 2;
    $('#disp-farm-wrap').hidden = farms.length < 2;
    $('#rec-shop-wrap').hidden = shops.length < 2;
    $('#direct-sale-farm-wrap').hidden = farms.length < 2;
    $('#farm-use-farm-wrap').hidden = farms.length < 2;
    resetProd(); resetDisp(); resetRec();
    resetDirectSale(); resetFarmUse();
    fillShopSelects(); resetProc(); resetSale(); resetLoss(); resetClose();
    if (formsReady) return;
    formsReady = true;
    setupShopForms();

    bindForm($('#prod-form'), {
      url: '/api/production', reset: resetProd, after: loadProduction,
      build: function (f) {
        return { farm_id: Number(f.elements.farm_id.value), production_date: f.elements.production_date.value, session: f.elements.session.value,
                 quantity_litres: f.elements.quantity_litres.value, notes: f.elements.notes.value.trim() || null };
      }
    });

    bindForm($('#disp-form'), {
      url: '/api/dispatches', reset: resetDisp, after: loadDispatch,
      build: function (f) {
        const external = f.elements.destination_type.value === 'EXTERNAL';
        const p = { farm_id: Number(f.elements.farm_id.value), destination_type: f.elements.destination_type.value,
                    quantity_litres: f.elements.quantity_litres.value, dispatched_at: toIso(f.elements.dispatched_at.value),
                    notes: f.elements.notes.value.trim() || null };
        if (!external) { p.destination_shop_id = Number(f.elements.destination_shop_id.value); return p; }
        p.destination_name = f.elements.destination_name.value.trim();
        if (f.elements.is_sale.value === 'yes') {
          p.dispatch_type = 'SALE';
        } else {
          p.dispatch_type = 'NON_SALE';
          const detail = f.elements.reason_detail.value.trim();
          p.non_sale_reason = f.elements.reason_kind.value + (detail ? ': ' + detail : '');
        }
        return p;
      }
    });

    bindForm($('#rec-form'), {
      url: '/api/receipts', reset: resetRec, after: loadReceipts,
      build: function (f) {
        if (!f.elements.dispatch_id.value) throw new Error('Please choose which dispatch you are receiving.');
        const p = { shop_id: Number(f.elements.shop_id.value), quantity_litres: f.elements.quantity_litres.value,
                    received_at: toIso(f.elements.received_at.value), notes: f.elements.notes.value.trim() || null };
        if (f.elements.dispatch_id.value !== 'none') p.dispatch_id = Number(f.elements.dispatch_id.value);
        return p;
      }
    });

    // dispatch form: show/hide the parts that depend on earlier answers
    $$('#disp-form [name=destination_type], #disp-form [name=is_sale]').forEach(function (r) {
      r.addEventListener('change', syncDispatchUI);
    });
    // receipt form: show the difference between dispatched and received as you type
    $('#rec-dispatch').addEventListener('change', onReceiptDispatchChange);
    $('#rec-form [name=quantity_litres]').addEventListener('input', updateReceiptDiff);
  }

  function resetProd() {
    const f = $('#prod-form');
    f.elements.quantity_litres.value = ''; f.elements.notes.value = ''; f.elements.production_date.value = todayStr();
  }
  function resetDisp() {
    const f = $('#disp-form');
    f.elements.quantity_litres.value = ''; f.elements.notes.value = ''; f.elements.destination_name.value = '';
    f.elements.reason_detail.value = ''; f.elements.dispatched_at.value = nowLocalValue();
    syncDispatchUI();
  }
  function resetRec() {
    const f = $('#rec-form');
    f.elements.quantity_litres.value = ''; f.elements.notes.value = ''; f.elements.received_at.value = nowLocalValue();
    $('#rec-diff').hidden = true;
  }
  function resetDirectSale() {
    const f = $('#direct-sale-form');
    f.elements.destination_name.value = '';
    f.elements.quantity_litres.value = '';
    f.elements.price_per_litre.value = '';
    f.elements.payment_status.value = 'UNPAID';
    f.elements.dispatched_at.value = nowLocalValue();
    f.elements.notes.value = '';
    updateDirectSaleTotal();
  }
  function resetFarmUse() {
    const f = $('#farm-use-form');
    f.elements.quantity_litres.value = '';
    f.elements.dispatched_at.value = nowLocalValue();
    f.elements.notes.value = '';
  }

  function syncDispatchUI() {
    const f = $('#disp-form');
    const external = f.elements.destination_type.value === 'EXTERNAL';
    $('#disp-shop-box').hidden = external;
    $('#disp-ext-box').hidden = !external;
    $('#disp-sale-box').hidden = f.elements.is_sale.value !== 'yes';
    $('#disp-nonsale-box').hidden = f.elements.is_sale.value === 'yes';
  }

  /* ---- Production ---- */
  async function loadProduction() {
    const farmId = $('#prod-form [name=farm_id]').value;
    const [list] = await Promise.all([
      API.get('/api/production'),
      farmId ? loadStock($('#farm-stock'), 'farm', farmId) : null
    ]);
    renderTable($('#tbl-prod'), [
      { h: 'Date', f: function (r) { return esc(fmtDate(r.date)); } },
      { h: 'Session', f: function (r) { return esc(r.session.charAt(0) + r.session.slice(1).toLowerCase()); } },
      { h: 'Litres', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Recorded by', f: function (r) { return esc(r.recorded_by); } },
      { h: 'Notes', f: function (r) { return esc(r.notes || ''); } }
    ], list.items, 'No production recorded yet.');
  }

  /* ---- Dispatch ---- */
  async function loadDispatch() {
    const farmId = $('#disp-form [name=farm_id]').value;
    const [list] = await Promise.all([
      API.get('/api/dispatches'),
      farmId ? loadStock($('#disp-farm-stock'), 'farm', farmId) : null
    ]);
    renderTable($('#tbl-disp'), dispatchColumns(), list.items, 'No dispatches recorded yet.');
  }
  function dispatchColumns() {
    return [
      { h: 'Reference', f: function (r) { return esc(r.reference); } },
      { h: 'When', f: function (r) { return esc(fmtDT(r.dispatched_at)); } },
      { h: 'Destination', f: function (r) { return esc(r.destination || ''); } },
      { h: 'Type', f: function (r) { return esc(TYPE_LABEL[r.type] || r.type); } },
      { h: 'Litres', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Revenue', num: true, f: function (r) { return r.revenue === null ? '—' : esc(fmtMoney(r.revenue)); } },
      { h: 'Status', f: function (r) { return r.status ? statusTag(r.status) : (r.non_sale_reason ? esc(r.non_sale_reason) : '—'); } }
    ];
  }

  /* ---- Receive milk ---- */
  let pending = [];
  async function loadReceipts() {
    const shopId = $('#rec-form [name=shop_id]').value;
    const [pend, list] = await Promise.all([
      API.get('/api/dispatches/pending'),
      API.get('/api/receipts'),
      shopId ? loadStock($('#shop-stock'), 'shop', shopId) : null
    ]);
    pending = pend.items;
    const sel = $('#rec-dispatch');
    sel.innerHTML = '<option value="" disabled selected>Choose the dispatch you are receiving…</option>' +
      pending.map(function (d) {
        return '<option value="' + d.id + '">' + esc(d.reference + ' · ' + fmtL(d.quantity_litres) + ' L · ' + fmtDT(d.dispatched_at)) + '</option>';
      }).join('') + '<option value="none">Milk that is not from a recorded dispatch</option>';
    renderTable($('#tbl-rec'), [
      { h: 'Received', f: function (r) { return esc(fmtDT(r.received_at)); } },
      { h: 'Dispatch', f: function (r) { return esc(r.reference || '—'); } },
      { h: 'Dispatched (L)', num: true, f: function (r) { return fmtL(r.dispatched_litres); } },
      { h: 'Received (L)', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Difference (L)', num: true, f: function (r) { return fmtSigned(r.difference); } },
      { h: 'Recorded by', f: function (r) { return esc(r.recorded_by); } }
    ], list.items, 'No milk received yet.');
  }
  function selectedPending() {
    const id = $('#rec-dispatch').value;
    return pending.filter(function (d) { return String(d.id) === id; })[0] || null;
  }
  function onReceiptDispatchChange() {
    const d = selectedPending(), q = $('#rec-form [name=quantity_litres]');
    if (d && !q.value) q.value = d.quantity_litres;     // suggest the dispatched amount; change it if less arrived
    updateReceiptDiff();
  }
  function updateReceiptDiff() {
    const d = selectedPending(), q = parseFloat($('#rec-form [name=quantity_litres]').value), el = $('#rec-diff');
    if (!d || isNaN(q)) { el.hidden = true; return; }
    const diff = Math.round((q - Number(d.quantity_litres)) * 1000) / 1000;
    el.hidden = false;
    el.textContent = diff === 0 ? 'Matches the dispatched ' + fmtL(d.quantity_litres) + ' L.'
      : 'Dispatched ' + fmtL(d.quantity_litres) + ' L, you entered ' + fmtL(q) + ' L (difference ' + (diff > 0 ? '+' : '') + fmtL(diff) + ' L). The owner will be notified.';
  }

  /* ================================================================ shop screens */
  const PRODUCTS = [['FRESH_MILK', 'Fresh milk'], ['YOGHURT', 'Yoghurt'], ['MAZIWA_MALA', 'Maziwa mala']];
  let listPrices = {};                                   // product_type -> list price (string)

  function shopId() { return $('#proc-form [name=shop_id]').value; }
  function fillShopSelects() {
    const shops = state.loc.shops;
    ['#proc-form', '#sale-form', '#loss-form', '#close-form'].forEach(function (f) {
      fillSelect($(f + ' [name=shop_id]'), shops, 'id', 'name');
    });
    ['#proc-shop-wrap', '#sale-shop-wrap', '#loss-shop-wrap', '#close-shop-wrap'].forEach(function (id) {
      $(id).hidden = shops.length < 2;
    });
  }
  function resetProc() {
    const f = $('#proc-form');
    f.elements.input_litres.value = ''; f.elements.output_litres.value = ''; f.elements.notes.value = '';
    f.elements.processed_at.value = nowLocalValue();
  }
  function resetLoss() {
    const f = $('#loss-form');
    f.elements.quantity_litres.value = ''; f.elements.notes.value = ''; f.elements.occurred_at.value = nowLocalValue();
  }
  function resetClose() {
    const f = $('#close-form');
    ['FRESH_MILK', 'YOGHURT', 'MAZIWA_MALA'].forEach(function (t) { f.elements['count_' + t].value = ''; });
    f.elements.notes.value = '';
  }

  /* ---- sale lines ---- */
  function addSaleLine() {
    const row = document.createElement('div');
    row.className = 'sale-line';
    row.innerHTML =
      '<label>Product<select class="sl-product">' + PRODUCTS.map(function (p) { return '<option value="' + p[0] + '">' + esc(p[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Litres<input class="sl-qty" type="number" step="0.001" min="0.001" inputmode="decimal"></label>' +
      '<label>Price per litre<input class="sl-price" type="number" step="0.01" min="0.01" inputmode="decimal"></label>' +
      '<button type="button" class="btn small sl-remove" aria-label="Remove this line">✕</button>';
    $('#sale-lines').appendChild(row);
    refreshSaleLine(row);
    return row;
  }
  function refreshSaleLine(row) {
    const t = $('.sl-product', row).value, lp = listPrices[t];
    $('.sl-price', row).placeholder = lp ? 'List: ' + Number(lp).toFixed(2) : 'No list price';
    updateSaleTotal();
  }
  function updateSaleTotal() {
    let total = 0;
    $$('#sale-lines .sale-line').forEach(function (row) {
      const q = parseFloat($('.sl-qty', row).value) || 0;
      const typed = parseFloat($('.sl-price', row).value);
      const price = isNaN(typed) ? (parseFloat(listPrices[$('.sl-product', row).value]) || 0) : typed;
      total += q * price;
    });
    $('#sale-total').textContent = fmtMoney(Math.round(total * 100) / 100);
  }
  function updateDirectSaleTotal() {
    const f = $('#direct-sale-form');
    const quantity = parseFloat(f.elements.quantity_litres.value) || 0;
    const price = parseFloat(f.elements.price_per_litre.value) || 0;
    $('#direct-sale-total').textContent = fmtMoney(Math.round(quantity * price * 100) / 100);
  }
  function resetSale() {
    const f = $('#sale-form');
    f.elements.sale_date.value = todayStr(); f.elements.notes.value = '';
    $('#sale-lines').innerHTML = '';
    addSaleLine();
  }

  function setupShopForms() {
    bindForm($('#proc-form'), {
      url: '/api/processing', reset: resetProc, after: loadProcessing,
      build: function (f) {
        const e = f.elements;
        return { shop_id: Number(e.shop_id.value), product_type: e.product_type.value, input_litres: e.input_litres.value,
                 output_litres: e.output_litres.value, processed_at: toIso(e.processed_at.value), notes: e.notes.value.trim() || null };
      }
    });
    bindForm($('#sale-form'), {
      url: '/api/sales', reset: resetSale, after: loadSales,
      build: function (f) {
        const items = $$('#sale-lines .sale-line').map(function (row) {
          const it = { product_type: $('.sl-product', row).value, quantity_litres: $('.sl-qty', row).value };
          const price = $('.sl-price', row).value;
          if (price !== '') it.unit_price = price;
          return it;
        }).filter(function (it) { return it.quantity_litres !== ''; });
        if (!items.length) throw new Error('Enter the litres sold for at least one product.');
        return { shop_id: Number(f.elements.shop_id.value), sale_date: f.elements.sale_date.value, items: items,
                 notes: f.elements.notes.value.trim() || null };
      }
    });
    bindForm($('#direct-sale-form'), {
      url: '/api/direct-sales', reset: resetDirectSale, after: loadSales,
      build: function (f) {
        return { farm_id: Number(f.elements.farm_id.value),
                 destination_name: f.elements.destination_name.value.trim(),
                 quantity_litres: f.elements.quantity_litres.value,
                 price_per_litre: f.elements.price_per_litre.value,
                 payment_status: f.elements.payment_status.value,
                 dispatched_at: toIso(f.elements.dispatched_at.value),
                 notes: f.elements.notes.value.trim() || null };
      }
    });
    bindForm($('#farm-use-form'), {
      url: '/api/farm-withdrawals', reset: resetFarmUse, after: loadSales,
      build: function (f) {
        return { farm_id: Number(f.elements.farm_id.value),
                 quantity_litres: f.elements.quantity_litres.value,
                 dispatched_at: toIso(f.elements.dispatched_at.value),
                 notes: f.elements.notes.value.trim() || null };
      }
    });
    bindForm($('#loss-form'), {
      url: '/api/losses', reset: resetLoss, after: loadLosses,
      build: function (f) {
        const e = f.elements;
        return { shop_id: Number(e.shop_id.value), product_type: e.product_type.value, quantity_litres: e.quantity_litres.value,
                 loss_reason: e.loss_reason.value, occurred_at: toIso(e.occurred_at.value), notes: e.notes.value.trim() || null };
      }
    });
    bindForm($('#close-form'), {
      url: '/api/closings', reset: resetClose,
      after: async function (res) { renderCloseResult(res.record); await loadClosing(); },
      build: function (f) {
        const e = f.elements;
        return { shop_id: Number(e.shop_id.value), closing_date: e.closing_date.value, notes: e.notes.value.trim() || null,
                 counts: { FRESH_MILK: e.count_FRESH_MILK.value, YOGHURT: e.count_YOGHURT.value, MAZIWA_MALA: e.count_MAZIWA_MALA.value } };
      }
    });
    bindForm($('#price-form'), {
      url: '/api/prices', reset: function (f) { f.elements.selling_price.value = ''; }, after: loadPrices,
      build: function (f) { return { product_type: f.elements.product_type.value, selling_price: f.elements.selling_price.value }; }
    });

    $('#sale-add').addEventListener('click', addSaleLine);
    $('#sale-lines').addEventListener('click', function (ev) {
      const b = ev.target.closest('.sl-remove');
      if (!b) return;
      if ($$('#sale-lines .sale-line').length > 1) { b.closest('.sale-line').remove(); updateSaleTotal(); }
    });
    $('#sale-lines').addEventListener('input', updateSaleTotal);
    $('#sale-lines').addEventListener('change', function (ev) {
      const row = ev.target.closest('.sale-line');
      if (row) refreshSaleLine(row);
    });
    $('#direct-sale-form').addEventListener('input', updateDirectSaleTotal);
    $('#tbl-direct-sales').addEventListener('click', onDirectSalePaymentClick);
    $('#tbl-closings').addEventListener('click', onReviewClick);
    $('#tbl-review').addEventListener('click', onReviewClick);
  }

  /* ---- Processing ---- */
  async function loadProcessing() {
    const [list] = await Promise.all([API.get('/api/processing'), loadStock($('#proc-stock'), 'shop', shopId())]);
    renderTable($('#tbl-proc'), [
      { h: 'When', f: function (r) { return esc(fmtDT(r.processed_at)); } },
      { h: 'Made', f: function (r) { return esc(r.product); } },
      { h: 'Milk used (L)', num: true, f: function (r) { return fmtL(r.milk_used); } },
      { h: 'Produced (L)', num: true, f: function (r) { return fmtL(r.produced); } },
      { h: 'Recorded by', f: function (r) { return esc(r.recorded_by); } },
      { h: 'Notes', f: function (r) { return esc(r.notes || ''); } }
    ], list.items, 'Nothing processed yet.');
  }

  /* ---- Sales ---- */
  async function loadSales() {
    const [pr, list, , buyerSales, farmUse] = await Promise.all([
      API.get('/api/prices'), API.get('/api/sales'), loadStock($('#sale-stock'), 'shop', shopId()),
      hasRole('OWNER') ? API.get('/api/direct-sales') : Promise.resolve({ items: [] }),
      hasRole('OWNER') ? API.get('/api/farm-withdrawals') : Promise.resolve({ items: [] })
    ]);
    listPrices = {};
    pr.items.forEach(function (p) { listPrices[p.product_type] = p.selling_price; });
    const directPrice = $('#direct-sale-form [name=price_per_litre]');
    if (hasRole('OWNER') && !directPrice.value && listPrices.FRESH_MILK) {
      directPrice.value = listPrices.FRESH_MILK;
    }
    updateDirectSaleTotal();
    $$('#sale-lines .sale-line').forEach(refreshSaleLine);
    renderTable($('#tbl-sales'), [
      { h: 'Date', f: function (r) { return esc(fmtDate(r.sale_date)); } },
      { h: 'Items', f: function (r) {
          return r.items.map(function (i) { return esc(i.product + ' ' + fmtL(i.quantity_litres) + ' L @ ' + Number(i.unit_price).toFixed(2)); }).join('<br>'); } },
      { h: 'Total', num: true, f: function (r) { return esc(fmtMoney(r.total)); } },
      { h: 'Recorded by', f: function (r) { return esc(r.recorded_by); } }
    ], list.items, 'No sales recorded yet.');
    renderTable($('#tbl-direct-sales'), [
      { h: 'Reference', f: function (r) { return esc(r.reference); } },
      { h: 'Buyer', f: function (r) { return esc(r.buyer || ''); } },
      { h: 'When', f: function (r) { return esc(fmtDT(r.sold_at)); } },
      { h: 'Litres', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Price/L', num: true, f: function (r) { return r.price_per_litre === null ? '—' : esc(fmtMoney(r.price_per_litre)); } },
      { h: 'Total', num: true, f: function (r) { return r.total === null ? '—' : esc(fmtMoney(r.total)); } },
      { h: 'Payment', f: function (r) { return esc(r.payment_status); } },
      { h: 'Action', f: function (r) {
        return '<button class="btn tiny" data-payment="' + (r.payment_status === 'PAID' ? 'UNPAID' : 'PAID') +
          '" data-id="' + r.id + '">' + (r.payment_status === 'PAID' ? 'Mark unpaid' : 'Mark paid') + '</button>';
      } }
    ], buyerSales.items, 'No buyer sales yet.');
    renderTable($('#tbl-farm-use'), [
      { h: 'Reference', f: function (r) { return esc(r.reference); } },
      { h: 'When', f: function (r) { return esc(fmtDT(r.taken_at)); } },
      { h: 'Litres', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Notes', f: function (r) { return esc(r.notes || ''); } }
    ], farmUse.items, 'No personal-use withdrawals yet.');
  }
  async function onDirectSalePaymentClick(ev) {
    const b = ev.target.closest('button[data-payment]');
    if (!b) return;
    b.disabled = true;
    try {
      await API.post('/api/direct-sales/' + b.dataset.id + '/payment', { payment_status: b.dataset.payment });
      toast('Buyer payment status updated.');
      await loadSales();
    } catch (e) {
      toast(e.message, 'error');
      b.disabled = false;
    }
  }

  /* ---- Losses ---- */
  async function loadLosses() {
    const [list] = await Promise.all([API.get('/api/losses'), loadStock($('#loss-stock'), 'shop', shopId())]);
    renderTable($('#tbl-loss'), [
      { h: 'When', f: function (r) { return esc(fmtDT(r.occurred_at)); } },
      { h: 'Product', f: function (r) { return esc(r.product); } },
      { h: 'Litres', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Reason', f: function (r) { return esc(r.reason.charAt(0) + r.reason.slice(1).toLowerCase()); } },
      { h: 'Recorded by', f: function (r) { return esc(r.recorded_by); } },
      { h: 'Notes', f: function (r) { return esc(r.notes || ''); } }
    ], list.items, 'No losses recorded.');
  }

  /* ---- Daily closing ---- */
  function closingTag(c) {
    const t = c.status === 'REVIEW_REQUIRED' ? '<span class="tag bad">Needs review</span>'
      : c.status === 'REVIEWED' ? '<span class="tag">Reviewed</span>' : '<span class="tag">Submitted</span>';
    return t + (c.is_late ? ' <span class="tag warn">Late</span>' : '');
  }
  function closingDiffs(c) {
    const d = c.items.filter(function (i) { return Number(i.variance) !== 0; });
    return d.length ? d.map(function (i) { return esc(i.product) + ' ' + fmtSigned(i.variance) + ' L'; }).join('<br>') : 'None';
  }
  function closingColumns(withActions) {
    const cols = [
      { h: 'Day', f: function (c) { return esc(fmtDate(c.closing_date)); } },
      { h: 'Status', f: closingTag },
      { h: 'Differences', f: closingDiffs },
      { h: 'Closed by', f: function (c) { return esc(c.submitted_by || ''); } }
    ];
    if (withActions) cols.push({ h: 'Your decision', f: function (c) {
      if (c.status !== 'REVIEW_REQUIRED' || !hasRole()) return '';
      return '<button class="btn tiny primary" data-act="accept" data-id="' + c.id + '">Accept count &amp; adjust stock</button>' +
             '<button class="btn tiny" data-act="note" data-id="' + c.id + '">Mark reviewed</button>';
    } });
    return cols;
  }
  async function onReviewClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const adjust = b.dataset.act === 'accept';
    const msg = adjust ? 'Accept the counted quantities and adjust the system stock to match? This cannot be undone.'
                       : 'Mark this closing as reviewed without changing the stock figures?';
    if (!window.confirm(msg)) return;
    b.disabled = true;
    try {
      await API.post('/api/closings/' + b.dataset.id + '/review', { adjust: adjust });
      toast('Closing reviewed ✓');
      if (state.view === 'dashboard') await loadDashboard(); else await loadClosing();
    } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  }
  function renderCloseResult(c) {
    const rows = c.items.map(function (i) {
      return '<tr><td>' + esc(i.product) + '</td><td class="num">' + fmtL(i.expected) + '</td><td class="num">' + fmtL(i.physical) +
             '</td><td class="num">' + fmtSigned(i.variance) + '</td></tr>';
    }).join('');
    const bad = c.status === 'REVIEW_REQUIRED';
    $('#close-result').className = '';
    $('#close-result').innerHTML =
      '<p class="msg ' + (bad ? 'warn' : 'ok') + '">' + (bad ? 'Closing saved. There are differences; the owner has been notified.' : 'Closing saved. Everything matches. ✓') + '</p>' +
      '<div class="table-wrap"><table class="result-table"><thead><tr><th>Product</th><th class="num">Expected (L)</th><th class="num">You counted (L)</th><th class="num">Difference (L)</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  async function loadClosing() {
    const f = $('#close-form'), btn = $('button[type=submit]', f), banner = $('#closing-banner');
    const [st, list] = await Promise.all([API.get('/api/closings/status?shop_id=' + shopId()), API.get('/api/closings')]);
    const date = f.elements.closing_date;
    date.max = st.today;
    f.dataset.locked = st.up_to_date ? '1' : '';
    btn.disabled = st.up_to_date;
    if (st.first_closing) {
      date.readOnly = false; date.value = date.value || st.suggested_date;
      setMsg(banner, 'This is the first stock closing for this shop. Choose the day you are closing; later closings must follow in order.', 'ok');
    } else if (st.up_to_date) {
      date.readOnly = true; date.value = '';
      setMsg(banner, 'All days are closed up to ' + fmtDate(st.last_closed) + '. The next closing opens when today ends.', 'ok');
    } else {
      date.readOnly = true; date.value = st.next_date;
      if (st.overdue.length) {
        setMsg(banner, 'Overdue: ' + st.overdue.map(fmtDate).join(', ') + ' should have been closed by ' + st.deadline_time +
                       ' the following day. Close the days in order starting with ' + fmtDate(st.next_date) +
                       '. You can keep recording sales meanwhile; stock figures stay provisional until then.', 'error');
      } else if (st.outstanding.length) {
        setMsg(banner, 'Please close ' + st.outstanding.map(fmtDate).join(', ') + ' (due by ' + st.deadline_time + ' the following day).', 'warn');
      } else {
        setMsg(banner, 'Today’s closing: count the stock at the end of the day. Deadline for each day is ' + st.deadline_time + ' the next morning.', 'ok');
      }
    }
    renderTable($('#tbl-closings'), closingColumns(true), list.items, 'No closings yet.');
  }

  /* ---- Prices (owner) ---- */
  async function loadPrices() {
    const data = await API.get('/api/prices');
    renderTable($('#tbl-prices'), [
      { h: 'Product', f: function (r) { return esc(r.product); } },
      { h: 'Price per litre', num: true, f: function (r) { return r.selling_price === null ? '<span class="tag warn">Not set</span>' : esc(fmtMoney(r.selling_price)); } }
    ], data.items, 'No products.');
  }

  /* ================================================================ account, people, opening stock, activity */
  function bindAccountForms() {
    // first-run setup (only visible on a brand-new installation)
    $('#setup-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const f = ev.target, e = f.elements, err = $('#setup-error'), btn = $('button[type=submit]', f);
      setMsg(err, '');
      if (e.password.value !== e.password2.value) { setMsg(err, 'The two passwords do not match.', 'error'); return; }
      btn.disabled = true;
      try {
        await API.post('/auth/setup', { business_name: e.business_name.value.trim(), farm_name: e.farm_name.value.trim(),
          shop_name: e.shop_name.value.trim(), full_name: e.full_name.value.trim(), username: e.username.value.trim(),
          password: e.password.value });
        f.reset();
        await startApp(await API.get('/auth/me'));
        toast('Welcome! Your owner account is ready.');
      } catch (x) { setMsg(err, x.message, 'error'); } finally { btn.disabled = false; }
    });

    bindForm($('#pw-form'), {
      url: '/auth/change-password', reset: function (f) { f.reset(); },
      build: function (f) {
        const e = f.elements;
        if (e.new_password.value !== e.new_password2.value) throw new Error('The two new passwords do not match.');
        return { current_password: e.current_password.value, new_password: e.new_password.value };
      },
      after: async function () {
        location.hash = '';
        await startApp(await API.get('/auth/me'));      // reloads everything now that the password is permanent
      }
    });

    bindForm($('#user-form'), {
      url: '/api/users', reset: function (f) { f.reset(); }, after: loadUsers,
      build: function (f) {
        const e = f.elements;
        return { full_name: e.full_name.value.trim(), username: e.username.value.trim(), role: e.role.value, password: e.password.value };
      }
    });
    $('#tbl-users').addEventListener('click', onUserAction);

    bindForm($('#open-form'), {
      url: '/api/opening-stock', after: loadOpening,
      reset: function (f) { ['FRESH_MILK', 'YOGHURT', 'MAZIWA_MALA'].forEach(function (k) { f.elements[k].value = ''; }); f.elements.as_of.value = nowLocalValue(); },
      build: function (f) {
        const e = f.elements, parts = e.location.value.split(':');
        const items = { FRESH_MILK: e.FRESH_MILK.value };
        if (parts[0] === 'shop') { items.YOGHURT = e.YOGHURT.value; items.MAZIWA_MALA = e.MAZIWA_MALA.value; }
        return { location_type: parts[0].toUpperCase(), location_id: Number(parts[1]), items: items, as_of: toIso(e.as_of.value) };
      }
    });
    $('#open-form [name=location]').addEventListener('change', syncOpeningUI);
  }
  function syncOpeningUI() {
    const isShop = $('#open-form [name=location]').value.split(':')[0] === 'shop';
    $('#open-shop-fields').hidden = !isShop;
  }

  async function loadAccount() {
    const me = state.me;
    $('#pw-banner').hidden = !me.must_change_password;
    $('#account-info').innerHTML = [['Name', me.user], ['Username', me.username || ''], ['Business', me.business],
      ['Role', me.roles.map(function (r) { return r.replace('_', ' ').toLowerCase(); }).join(', ')]].map(function (r) {
      return '<div class="stock-row"><span>' + esc(r[0]) + '</span><strong>' + esc(r[1]) + '</strong></div>';
    }).join('');
  }

  async function loadUsers() {
    const data = await API.get('/api/users');
    renderTable($('#tbl-users'), [
      { h: 'Name', f: function (u) { return esc(u.full_name); } },
      { h: 'Username', f: function (u) { return esc(u.username); } },
      { h: 'Role', f: function (u) { return esc(u.roles.map(function (r) { return r.replace('_', ' ').toLowerCase(); }).join(', ')); } },
      { h: 'Status', f: function (u) {
          return (u.active ? '<span class="tag">Active</span>' : '<span class="tag bad">Deactivated</span>') +
                 (u.locked ? ' <span class="tag bad">Locked</span>' : '') +
                 (u.must_change_password ? ' <span class="tag warn">Temporary password</span>' : ''); } },
      { h: 'Last sign-in', f: function (u) { return esc(u.last_login_at ? fmtDT(u.last_login_at) : 'Never'); } },
      { h: 'Actions', f: function (u) {
          const own = state.me && u.username === state.me.username;
          const attrs = ' data-id="' + u.id + '" data-name="' + esc(u.full_name) + '"';
          return (own ? '' : '<button class="btn tiny" data-act="toggle" data-active="' + (u.active ? '1' : '0') + '"' + attrs + '>' + (u.active ? 'Deactivate' : 'Reactivate') + '</button>') +
                 '<button class="btn tiny" data-act="reset"' + attrs + '>Reset password</button>' +
                 (u.locked ? '<button class="btn tiny primary" data-act="unlock"' + attrs + '>Unlock</button>' : ''); } }
    ], data.items, 'No users.');
  }
  async function onUserAction(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id, name = b.dataset.name;
    try {
      if (b.dataset.act === 'toggle') {
        const makeActive = b.dataset.active === '0';
        if (!makeActive && !window.confirm('Deactivate ' + name + '? They will be signed out and unable to sign in.')) return;
        await API.post('/api/users/' + id + '/active', { active: makeActive });
        toast(name + (makeActive ? ' can sign in again.' : ' has been deactivated.'));
      } else if (b.dataset.act === 'reset') {
        const pw = window.prompt('Type a temporary password for ' + name + ' (at least 8 characters). They must change it when they next sign in.');
        if (!pw) return;
        await API.post('/api/users/' + id + '/reset-password', { password: pw });
        toast('Password reset. Tell ' + name + ' the temporary password.');
      } else if (b.dataset.act === 'unlock') {
        await API.post('/api/users/' + id + '/unlock');
        toast(name + ' is unlocked.');
      }
      await loadUsers();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadOpening() {
    const f = $('#open-form'), sel = f.elements.location, keep = sel.value;
    sel.innerHTML = state.loc.farms.map(function (x) { return '<option value="farm:' + x.id + '">Farm: ' + esc(x.name) + '</option>'; }).join('') +
                    state.loc.shops.map(function (x) { return '<option value="shop:' + x.id + '">Shop: ' + esc(x.name) + '</option>'; }).join('');
    if (keep) sel.value = keep;
    if (!f.elements.as_of.value) f.elements.as_of.value = nowLocalValue();
    syncOpeningUI();
    const data = await API.get('/api/opening-stock');
    renderTable($('#tbl-opening'), [
      { h: 'Where', f: function (r) { return esc(r.location); } },
      { h: 'Product', f: function (r) { return esc(r.product); } },
      { h: 'Litres', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Counted on', f: function (r) { return esc(fmtDT(r.as_of)); } }
    ], data.items, 'No opening stock entered yet.');
  }

  async function loadActivity() {
    const data = await API.get('/api/audit?limit=150');
    const detail = function (d) {
      if (!d) return '';
      return Object.keys(d).map(function (k) {
        const v = d[k];
        return k.replace(/_/g, ' ') + ': ' + (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
      }).join('; ');
    };
    renderTable($('#tbl-activity'), [
      { h: 'When', f: function (r) { return esc(fmtDT(r.at)); } },
      { h: 'Who', f: function (r) { return esc(r.user || 'System'); } },
      { h: 'Action', f: function (r) { return esc(r.action.replace(/_/g, ' ').toLowerCase()); } },
      { h: 'What', f: function (r) { return esc(r.record_type.replace(/_/g, ' ').toLowerCase() + (r.record_id ? ' #' + r.record_id : '')); } },
      { h: 'Details', f: function (r) { return '<span class="muted">' + esc(detail(r.details)) + '</span>'; } }
    ], data.items, 'No activity yet.');
  }

  /* ---- Alerts ---- */
  async function loadAlerts() {
    const data = await API.get('/api/notifications');
    const box = $('#alerts-list');
    box.innerHTML = data.items.map(function (n) {
      return '<div class="alert-item' + (n.is_read ? '' : ' unread') + '" data-id="' + n.id + '">' +
        '<div><div class="a-title">' + esc(n.title) + '</div><div>' + esc(n.message) + '</div></div></div>';
    }).join('') || '<p class="muted">No alerts.</p>';
    updateBadge(data.items.filter(function (n) { return !n.is_read; }).length);
  }
  $('#alerts-list').addEventListener('click', async function (ev) {
    const item = ev.target.closest('.alert-item');
    if (!item || !item.classList.contains('unread')) return;
    await safe(function () { return API.post('/api/notifications/' + item.dataset.id + '/read'); });
    loadAlerts();
  });
  $('#read-all').addEventListener('click', async function () {
    await safe(function () { return API.post('/api/notifications/read-all'); });
    loadAlerts();
  });
  function updateBadge(n) {
    const b = $('#bell-badge');
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = n === 0;
  }
  async function refreshBadge() {
    try {
      const data = await API.get('/api/notifications');
      updateBadge(data.items.filter(function (n) { return !n.is_read; }).length);
    } catch (e) { /* ignore: badge refresh is best-effort */ }
  }

  /* ---- Owner dashboard ---- */
  function setRange(days) {
    const to = new Date(), from = new Date();
    from.setDate(to.getDate() - (days - 1));
    $('#d-from').value = todayStr(from);
    $('#d-to').value = todayStr(to);
  }
  $$('.chip').forEach(function (c) {
    c.addEventListener('click', function () { setRange(Number(c.dataset.days)); loadDashboard(); });
  });
  $('#d-apply').addEventListener('click', function () { safe(loadDashboard); });

  async function loadDashboard() {
    if (!$('#d-from').value || !$('#d-to').value) setRange(14);
    const from = $('#d-from').value, to = $('#d-to').value;
    if (from > to) { toast('"From" must not be after "To".', 'error'); return; }
    const token = ++state.dashToken;                 // ignore slow, out-of-date responses
    const data = await API.get('/api/dashboard/summary?from=' + from + '&to=' + to);
    if (token !== state.dashToken) return;

    const t = data.totals;
    const kpis = [
      { l: 'Milk produced', v: fmtL(t.produced) + ' L' },
      { l: 'Sent to shop', v: fmtL(t.sent_to_shop) + ' L' },
      { l: 'Received at shop', v: fmtL(t.received_at_shop) + ' L' },
      { l: 'External sales', v: fmtMoney(t.external_sales_revenue) },
      { l: 'Total sales', v: fmtMoney(t.total_sales) },
      { l: 'On the way to shop', v: fmtL(t.in_transit_litres) + ' L' },
      { l: 'Awaiting receipt', v: String(t.awaiting_receipt), bad: t.awaiting_receipt > 0 },
      { l: 'Discrepancies', v: String(t.discrepancies), bad: t.discrepancies > 0 },
      { l: 'Shop sales', v: fmtMoney(t.shop_sales_revenue) },
      { l: 'Stock lost', v: fmtL(t.losses_litres) + ' L' },
      { l: 'Closings overdue', v: String(t.closings_overdue), bad: t.closings_overdue > 0 },
      { l: 'Closings to review', v: String(t.closings_to_review), bad: t.closings_to_review > 0 }
    ];
    $('#kpis').innerHTML = kpis.map(function (k) {
      return '<div class="kpi' + (k.bad ? ' bad' : '') + '"><div class="k-label">' + esc(k.l) + '</div><div class="k-value">' + esc(k.v) + '</div></div>';
    }).join('');

    DairyCharts.render(data);                          // charts.js draws the 4 charts

    renderTable($('#tbl-issues'), [
      { h: 'Reference', f: function (r) { return esc(r.reference); } },
      { h: 'Sent', f: function (r) { return esc(fmtDT(r.dispatched_at)); } },
      { h: 'Destination', f: function (r) { return esc(r.destination || ''); } },
      { h: 'Dispatched (L)', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Received (L)', num: true, f: function (r) { return fmtL(r.received_litres); } },
      { h: 'Difference (L)', num: true, f: function (r) { return fmtSigned(r.difference); } },
      { h: 'Status', f: function (r) { return statusTag(r.status); } }
    ], data.issues, 'Nothing needs attention in this period. ✓');

    const closings = await API.get('/api/closings');
    if (token !== state.dashToken) return;
    renderTable($('#tbl-review'), closingColumns(true),
      closings.items.filter(function (c) { return c.status === 'REVIEW_REQUIRED'; }), 'No closings are waiting for review. ✓');

    renderTable($('#tbl-stock'), [
      { h: 'Location', f: function (r) { return esc(r.kind + ': ' + r.location); } },
      { h: 'Product', f: function (r) { return esc(r.product); } },
      { h: 'Litres', num: true, f: function (r) { return fmtL(r.balance_litres); } }
    ], data.stock, 'No stock yet.');
  }

  /* ------------------------------------------------------------------ 5) start-up */
  API.setUnauthorizedHandler(function () { if (state.me) { toast('Your session ended. Please sign in again.', 'error'); showLogin(); } });
  API.setPasswordChangeHandler(function () {            // the server says: change your temporary password first
    if (state.me && !state.me.must_change_password) { state.me.must_change_password = true; buildNav(); showView('account'); }
  });
  bindAccountForms();
  (async function init() {
    try { await startApp(await API.get('/auth/me')); }
    catch (e) { showLogin(); }
  })();
})();
