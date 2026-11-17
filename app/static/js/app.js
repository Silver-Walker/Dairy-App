/* app.js: screens and buttons. Reads top to bottom:
   1) small helpers  2) login/logout  3) navigation  4) each screen  5) start-up */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 1) helpers */
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  const state = {
    me: null, loc: null, view: null, dashToken: 0, pollTimer: null,
    offlineOnly: false, connectionAvailable: navigator.onLine, syncRunning: false, syncPromise: null,
    saleStock: null, offlineScope: null
  };
  const THEME_KEY = 'dairy-theme';
  const PROFILE_COLORS = ['teal', 'blue', 'purple', 'red', 'orange', 'slate'];
  const PROFILE_SIZES = [36, 40, 44, 48, 52, 56, 60, 64];

  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const toggle = $('#theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
      toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }
    if (window.DairyCharts && typeof DairyCharts.refreshTheme === 'function') DairyCharts.refreshTheme();
  }

  function profilePreferenceKey(me) {
    return 'dairy-profile:' + String(me.business_id) + ':' + String(me.username).toLowerCase();
  }
  function applyProfilePreferences(me) {
    const avatar = $('#profile-avatar');
    let preferences = {};
    try {
      const saved = JSON.parse(localStorage.getItem(profilePreferenceKey(me)) || '{}');
      preferences = saved && typeof saved === 'object' ? saved : {};
    } catch (e) {
      console.error('Unable to load profile button preferences.', e);
    }
    const color = PROFILE_COLORS.indexOf(preferences.color) >= 0 ? preferences.color : 'teal';
    const size = PROFILE_SIZES.indexOf(Number(preferences.size)) >= 0 ? Number(preferences.size) : 48;
    avatar.dataset.avatarColor = color;
    avatar.dataset.avatarSize = String(size);
    $('#profile-initial').textContent = (String(me.user || '').trim().charAt(0) || '?').toLocaleUpperCase();
    $('#who').textContent = me.user;
    $('#profile-toggle').setAttribute('aria-label', 'Open profile menu for ' + me.user);
    $$('.avatar-color').forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.color === color ? 'true' : 'false');
    });
    $('#profile-size').value = String(size);
    $('#profile-size-value').textContent = size + ' px';
  }
  function saveProfilePreferences() {
    const preferences = {
      color: $('#profile-avatar').dataset.avatarColor,
      size: Number($('#profile-avatar').dataset.avatarSize)
    };
    try {
      localStorage.setItem(profilePreferenceKey(state.me), JSON.stringify(preferences));
    } catch (e) {
      console.error('Unable to save profile button preferences.', e);
      toast('Profile button settings could not be saved on this device.', 'error');
    }
  }
  function setProfileMenuOpen(open) {
    $('#profile-panel').hidden = !open;
    $('#profile-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  $('#profile-toggle').addEventListener('click', function () {
    setProfileMenuOpen($('#profile-panel').hidden);
  });
  $('#profile-close').addEventListener('click', function () {
    setProfileMenuOpen(false);
    $('#profile-toggle').focus();
  });
  $('#profile-colors').addEventListener('click', function (ev) {
    const button = ev.target.closest('button[data-color]');
    if (!button || PROFILE_COLORS.indexOf(button.dataset.color) < 0) return;
    $('#profile-avatar').dataset.avatarColor = button.dataset.color;
    $$('.avatar-color').forEach(function (item) {
      item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
    });
    saveProfilePreferences();
  });
  $('#profile-size').addEventListener('input', function (ev) {
    const size = Number(ev.target.value);
    if (PROFILE_SIZES.indexOf(size) < 0) return;
    $('#profile-avatar').dataset.avatarSize = String(size);
    $('#profile-size-value').textContent = size + ' px';
    saveProfilePreferences();
  });
  document.addEventListener('click', function (ev) {
    if (!$('#profile-menu').contains(ev.target)) setProfileMenuOpen(false);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#profile-panel').hidden) {
      setProfileMenuOpen(false);
      $('#profile-toggle').focus();
    }
  });

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
  function roleLabel(role) {
    const text = String(role || '').replace(/_/g, ' ').toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  // Run a loader and show any error as a toast instead of breaking the page.
  async function safe(fn) {
    try { return await fn(); }
    catch (e) { if (e.status !== 401 && !e.network) toast(e.message, 'error'); return null; }
  }
  async function updateOfflineBanner() {
    const banner = $('#offline-banner'), message = $('#offline-message'), button = $('#offline-sync');
    if (state.offlineOnly && navigator.onLine) state.connectionAvailable = true;
    let rows = [];
    try { rows = await DairyOffline.list(); }
    catch (e) { message.textContent = e.message; banner.hidden = false; button.hidden = true; return; }
    const count = rows.length;
    if (!state.connectionAvailable) {
      message.textContent = count
        ? 'Offline — ' + count + ' record(s) saved on this phone, will upload when internet returns.'
        : 'Offline. Production, dispatch, milk receipt, processing, sales, losses, and daily closing can be saved on this phone.';
    } else if (state.offlineOnly) {
      message.textContent = 'Connection restored. Sign in again to sync records saved on this phone.';
    } else if (count && state.syncRunning) {
      message.textContent = 'Syncing ' + count + ' saved record(s)…';
    } else if (count && !state.me) {
      message.textContent = count + ' saved record(s) remain on this phone. Sign in with the same account to sync.';
    } else if (count) {
      const failed = rows.filter(function (row) { return row.lastError; })[0];
      message.textContent = failed
        ? count + ' saved record(s) need attention: ' + failed.lastError
        : count + ' saved record(s) are waiting to sync.';
    } else {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    button.hidden = !navigator.onLine ||
      !(state.offlineOnly || (state.me && count && !state.syncRunning));
    button.textContent = state.offlineOnly ? 'Sign in online' : 'Sync now';
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
    setProfileMenuOpen(false);
    state.offlineOnly = false;
    state.offlineScope = null;
    API.setOfflineScope(null);
    clearInterval(state.pollTimer);
    if (window.DairyCharts) DairyCharts.destroyAll();
    // wipe every table/list so the next person to log in on this device never sees the previous user's data
    $$('#kpis, #alerts-list, #close-result, .stock-list, table').forEach(function (el) { el.innerHTML = ''; });
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    $('#offline-login-form').hidden = true;
    refreshLoginMode();
  }
  function showOfflineLogin() {
    state.me = null;
    setProfileMenuOpen(false);
    state.offlineOnly = false;
    state.connectionAvailable = false;
    state.offlineScope = null;
    API.setOfflineScope(null);
    clearInterval(state.pollTimer);
    if (window.DairyCharts) DairyCharts.destroyAll();
    $$('#kpis, #alerts-list, #close-result, .stock-list, table').forEach(function (el) { el.innerHTML = ''; });
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    $('#login-form').hidden = true;
    $('#setup-form').hidden = true;
    $('#offline-login-form').hidden = false;
    setMsg($('#offline-login-error'), '');
  }
  // On a brand-new installation there is no account yet: show the "create owner" form instead of the login form.
  async function refreshLoginMode() {
    let setup = false;
    try { setup = (await API.get('/auth/setup-status')).needs_setup; } catch (e) { /* show normal login */ }
    $('#setup-form').hidden = !setup;
    $('#login-form').hidden = setup;
  }

  async function startApp(me, offlineOptions) {
    offlineOptions = offlineOptions || {};
    state.me = me;
    setProfileMenuOpen(false);
    state.offlineOnly = !!offlineOptions.offlineOnly;
    state.offlineScope = String(me.business_id) + ':' + String(me.username).toLowerCase();
    API.setOfflineScope(state.offlineScope);
    applyProfilePreferences(me);
    updateProductionGreeting();
    $('#dashboard-user').textContent = me.user.split(' ')[0] || 'there';
    $('#owner-direct-sale').hidden = !hasRole('OWNER');
    $('#biz-name').textContent = me.business;
    if (me.must_change_password) {
      state.loc = { farms: [], shops: [] };            // nothing else is allowed until the password is changed
    } else {
      state.loc = state.offlineOnly ? offlineOptions.locations : await API.get('/api/locations');
      setupForms();
      if (!state.offlineOnly) {
        try {
          await DairyOffline.saveProfile(me, state.loc);
        } catch (e) {
          console.error('Unable to prepare offline sign-in for this device.', e);
          toast('Offline sign-in could not be prepared on this device: ' + e.message, 'error');
        }
      }
    }
    await safe(loadAccount);
    buildNav();
    $('#login-view').hidden = true;        // show the app only once it is fully ready
    $('#app-view').hidden = false;
    if (!me.must_change_password && !state.offlineOnly) refreshBadge();
    clearInterval(state.pollTimer);
    if (!me.must_change_password && !state.offlineOnly) {
      state.pollTimer = setInterval(function () {
        refreshBadge();
        updateProductionGreeting();
        updateAttendantPageHeading();
      }, 60000);
    } else if (state.offlineOnly) {
      state.pollTimer = setInterval(async function () {
        try {
          await API.get('/auth/setup-status');
          showLogin();
        } catch (e) {
          if (!e.network) console.error('Unable to check whether the app is online.', e);
        }
      }, 30000);
    }
    routeFromHash(true);
    if (me.must_change_password) {
      setProfileMenuOpen(true);
      $('#pw-form [name=current_password]').focus();
    }
    await updateOfflineBanner();
    if (!state.offlineOnly) syncOfflineQueue();
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
    if (state.offlineOnly || !state.me) return;
    syncSession().catch(function (e) {
      if (e.status === 401) showLogin();
      else if (!e.network) toast(e.message, 'error');
    });
  });

  function syncOfflineQueue() {
    if (state.syncRunning) return state.syncPromise;
    if (state.offlineOnly || !state.me || !state.connectionAvailable) return Promise.resolve();
    state.syncRunning = true;
    state.syncPromise = (async function () {
      try {
        let rows = await DairyOffline.list();
        await updateOfflineBanner();
        for (const row of rows) {
          try {
            if (!DairyOffline.queueable(row.url) || !row.payload ||
                row.payload.client_uuid !== row.id) {
              await DairyOffline.markError(row.id, 'Invalid offline entry; it was retained and not sent.');
              break;
            }
            await API.post(row.url, row.payload);
            await DairyOffline.remove(row.id);
          } catch (e) {
            if (!e.network && e.status !== 401) await DairyOffline.markError(row.id, e.message);
            break;
          }
        }
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        state.syncRunning = false;
        await updateOfflineBanner();
        if (state.me && state.connectionAvailable && !state.offlineOnly) {
          const current = VIEWS.filter(function (v) { return v.id === state.view; })[0];
          if (current) safe(current.load);
        }
      }
    })();
    return state.syncPromise;
  }

  window.addEventListener('offline', function () {
    state.connectionAvailable = false;
    updateOfflineBanner();
  });
  window.addEventListener('online', function () {
    state.connectionAvailable = true;
    if (state.offlineOnly) showLogin();
    else syncOfflineQueue();
    updateOfflineBanner();
  });
  window.addEventListener('dairy:network-error', function () {
    state.connectionAvailable = false;
    updateOfflineBanner();
  });
  window.addEventListener('dairy:network-restored', function () {
    const wasOffline = !state.connectionAvailable;
    state.connectionAvailable = true;
    if (state.offlineOnly) {
      showLogin();
      return;
    }
    updateOfflineBanner();
    if (wasOffline && !state.offlineOnly) syncOfflineQueue();
  });
  $('#offline-sync').addEventListener('click', function () {
    state.connectionAvailable = navigator.onLine;
    if (state.offlineOnly) showLogin();
    else syncOfflineQueue();
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

  $('#offline-login-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const form = ev.target, error = $('#offline-login-error'), button = $('button[type=submit]', form);
    const username = form.elements.username.value.trim();
    const pin = form.elements.pin.value;
    setMsg(error, '');
    button.disabled = true;
    try {
      const profile = await DairyOffline.verifyPin(username, pin);
      const savedAt = profile ? Date.parse(profile.savedAt) : NaN;
      if (!profile || !Number.isFinite(savedAt) || savedAt > Date.now() ||
          Date.now() - savedAt > 30 * 24 * 60 * 60 * 1000) {
        throw new Error('Username or offline PIN is incorrect, or offline access needs to be set up again while online.');
      }
      form.elements.pin.value = '';
      state.connectionAvailable = false;
      await startApp(profile.me, { offlineOnly: true, locations: profile.locations });
    } catch (e) {
      setMsg(error, e.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
  $('#online-login-link').addEventListener('click', showLogin);

  $('#logout').addEventListener('click', async function () {
    let queued;
    try { queued = await DairyOffline.list(); }
    catch (e) { toast(e.message, 'error'); return; }
    if (queued.length && !window.confirm(
      queued.length + ' offline record(s) are still saved on this phone. They will remain here, but you must sign in with the same account to sync them. Log out?'
    )) return;
    await safe(function () { return API.post('/auth/logout'); });
    state.offlineScope = null;
    state.offlineOnly = false;
    API.setOfflineScope(null);
    location.hash = '';
    showLogin();
  });
  $('#theme-toggle').addEventListener('click', function () {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* theme still works for this page */ }
    applyTheme(next);
  });
  applyTheme((function () {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  })());

  /* ------------------------------------------------------------------ 3) navigation */
  const VIEWS = [
    { id: 'dashboard',  label: 'Dashboard',    roles: [],                  load: loadDashboard },
    { id: 'production', label: 'Production',   roles: ['MILKER'],          load: loadProduction },
    { id: 'dispatch',   label: 'Dispatch',     roles: ['MILKER'],          load: loadDispatch },
    { id: 'receipts',   label: 'Receive milk', roles: ['SHOP_ATTENDANT'],  load: loadReceipts },
    { id: 'processing', label: 'Processing',   roles: ['SHOP_ATTENDANT'],  load: loadProcessing },
    { id: 'sales',      label: 'Sales',        roles: ['SHOP_ATTENDANT'],  load: loadSales },
    { id: 'expenses',   label: 'Expenses',     roles: [],                  load: loadExpenses },
    { id: 'losses',     label: 'Losses',       roles: ['SHOP_ATTENDANT'],  load: loadLosses },
    { id: 'closing',    label: 'Daily closing', roles: ['SHOP_ATTENDANT'], load: loadClosing },
    { id: 'prices',     label: 'Prices',       roles: [],                  load: loadPrices },
    { id: 'opening',    label: 'Opening stock', roles: [],                 load: loadOpening },
    { id: 'users',      label: 'Users',        roles: [],                  load: loadUsers },
    { id: 'activity',   label: 'Activity',     roles: [],                  load: loadActivity },
    { id: 'alerts',     label: 'Alerts',       roles: ['MILKER', 'SHOP_ATTENDANT'], load: loadAlerts }
  ];
  const OWNER_HIDDEN_VIEWS = ['production', 'dispatch', 'receipts', 'processing', 'closing', 'opening'];
  function allowedViews() {
    // roles: [] means owner only (hasRole always lets OWNER through)
    if (state.me && state.me.must_change_password) return VIEWS.filter(function (v) { return v.id === 'users'; });
    return VIEWS.filter(function (v) {
      return hasRole.apply(null, v.roles) &&
        (!hasRole('OWNER') || OWNER_HIDDEN_VIEWS.indexOf(v.id) === -1);
    });
  }
  function buildNav() {
    const nav = $('#nav');
    nav.innerHTML = '<span class="nav-indicator" aria-hidden="true"></span>' + allowedViews()
      .filter(function (v) { return v.id !== 'alerts'; }).map(function (v) {
      return '<button class="tab" data-view="' + v.id + '">' + esc(v.label) + '</button>';
    }).join('');
    positionActiveTab(false);
  }
  function positionActiveTab(animate) {
    const nav = $('#nav');
    const active = $('.tab.active', nav);
    const indicator = $('.nav-indicator', nav);
    if (!indicator) return;
    if (!active) {
      indicator.hidden = true;
      return;
    }
    indicator.hidden = false;
    if (!animate) indicator.classList.add('no-transition');
    indicator.style.width = active.offsetWidth + 'px';
    indicator.style.height = active.offsetHeight + 'px';
    indicator.style.transform = 'translate(' + active.offsetLeft + 'px, ' + active.offsetTop + 'px)';
    if (!animate) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { indicator.classList.remove('no-transition'); });
      });
    }
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
    updateAttendantPageHeading(id);
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === id); });
    positionActiveTab(true);
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    safe(v.load);
  }
  window.addEventListener('resize', function () { positionActiveTab(false); });
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
  function renderStock(targetEl, data, kind) {
    const items = kind === 'farm'
      ? data.items.filter(function (i) { return i.type === 'FRESH_MILK'; })
      : data.items;
    targetEl.innerHTML = items.map(function (i) {
      const way = Number(i.in_transit_litres) > 0 ? ' <span class="muted">(+' + fmtL(i.in_transit_litres) + ' L on the way)</span>' : '';
      return '<div class="stock-row"><span>' + esc(i.product) + way + '</span><strong>' + fmtL(i.balance_litres) + ' L</strong></div>';
    }).join('') || '<p class="muted">No stock recorded yet.</p>';
  }

  async function loadStock(targetEl, kind, id) {
    const data = await API.get('/api/stock?' + kind + '_id=' + encodeURIComponent(id));
    renderStock(targetEl, data, kind);
    return data;
  }

  /* ---- generic form wiring (save, show errors, avoid double-saves) ---- */
  function bindForm(form, opts) {
    form.dataset.uuid = API.uuid();
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const btn = $('button[type=submit]', form), msg = $('.msg', form);
      if (btn.disabled) return;
      setMsg(msg, '');
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      async function queueLocally(payload) {
        payload.entered_at = payload.entered_at || new Date().toISOString();
        await DairyOffline.enqueue({
          id: payload.client_uuid, url: opts.url, payload: payload,
          createdAt: payload.entered_at, lastError: null
        });
        form.dataset.uuid = API.uuid();
        opts.reset(form);
        $$('details.optional-note', form).forEach(function (details) { details.open = false; });
        toast('Saved on this phone, will upload when internet returns.');
        await updateOfflineBanner();
      }
      try {
        let saveOffline = !!opts.offlineQueue && (!state.connectionAvailable || state.offlineOnly);
        if (!saveOffline) {
          try {
            if (!(await syncSession())) {
              toast('Your signed-in account changed. Check the account shown and submit again.');
              return;
            }
          } catch (e) {
            if (opts.offlineQueue && e.network) {
              state.connectionAvailable = false;
              saveOffline = true;
            } else {
              if (e.status === 401) showLogin();
              else setMsg(msg, e.message, 'error');
              return;
            }
          }
        }
        if (opts.offlineQueue && !saveOffline) {
          const waiting = await DairyOffline.list();
          if (waiting.length) {
            await syncOfflineQueue();
            if ((await DairyOffline.list()).length) {
              setMsg(msg, 'An earlier offline entry needs attention before new entries can be saved.', 'error');
              return;
            }
          }
        }
        let payload;
        try { payload = opts.build(form); } catch (e) { setMsg(msg, e.message, 'error'); return; }
        if (opts.beforeSubmit) {
          if ((await opts.beforeSubmit(payload, form, msg)) === false) return;
        }
        payload.client_uuid = form.dataset.uuid;      // same id on retry => never saved twice
        if (saveOffline) {
          await queueLocally(payload);
          return;
        }
        let res;
        try {
          res = await API.post(opts.url, payload);
        } catch (e) {
          if (opts.offlineQueue && e.network) {
            state.connectionAvailable = false;
            await queueLocally(payload);
            return;
          }
          throw e;
        }
        toast(res.created === false ? 'This was already saved earlier (no duplicate created).' : 'Saved ✓');
        form.dataset.uuid = API.uuid();
        opts.reset(form);
        $$('details.optional-note', form).forEach(function (details) { details.open = false; });
        await opts.after(res);
        if (res.warnings && res.warnings.length) setMsg(msg, res.warnings.join(' '), 'warn');
      } catch (e) {
        setMsg(msg, e.message, 'error');
      } finally {
        btn.disabled = form.dataset.locked === '1';
        btn.textContent = label;
      }
    });
  }

  /* ---- set up all forms once, after we know the farms and shops ---- */
  let formsReady = false;
  let productionDateRecords = [];
  let productionRecentRecords = [];
  let productionLoadToken = 0;
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
    $$('.optional-note').forEach(function (details) {
      details.addEventListener('toggle', function () {
        $('summary', details).textContent = details.open ? '− Hide note' : '+ Add note';
      });
    });
    setupShopForms();

    updateProductionGreeting();
    $('#prod-form [name=farm_id]').addEventListener('change', function () { safe(loadProduction); });
    $('#prod-form [name=production_date]').addEventListener('change', function () { safe(loadProduction); });
    $('.production-session-buttons').addEventListener('click', function (ev) {
      const button = ev.target.closest('[data-production-session]');
      if (!button) return;
      $('#prod-form [name=session]').value = button.dataset.productionSession;
      updateProductionSessionButtons();
      updateProductionSummary(productionDateRecords, $('#prod-form [name=production_date]').value);
      updateProductionExistingRecord(productionDateRecords, $('#prod-form [name=production_date]').value);
      updateProductionUsual($('#prod-form [name=session]').value,
        $('#prod-form [name=production_date]').value,
        $('#prod-form [name=farm_id]').value, productionRecentRecords);
    });
    $('.production-quantity').addEventListener('click', function (ev) {
      const button = ev.target.closest('[data-production-step]');
      if (!button) return;
      const input = $('#prod-quantity');
      const current = parseFloat(input.value) || 0;
      input.value = String(Math.max(0, Math.round((current + Number(button.dataset.productionStep)) * 1000) / 1000));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    bindForm($('#prod-form'), {
      url: '/api/production', reset: resetProd, after: loadProduction, offlineQueue: true,
      build: function (f) {
        return { farm_id: Number(f.elements.farm_id.value), production_date: f.elements.production_date.value, session: f.elements.session.value,
                 quantity_litres: f.elements.quantity_litres.value, notes: f.elements.notes.value.trim() || null };
      }
    });

    bindForm($('#disp-form'), {
      url: '/api/dispatches', reset: resetDisp, after: loadDispatch, offlineQueue: true,
      build: function (f) {
        const destination = f.elements.destination_type.value;
        const p = { farm_id: Number(f.elements.farm_id.value), destination_type: destination === 'HOME' ? 'EXTERNAL' : destination,
                    quantity_litres: f.elements.quantity_litres.value, dispatched_at: toIso(f.elements.dispatched_at.value),
                    notes: f.elements.notes.value.trim() || null };
        if (destination === 'SHOP') { p.destination_shop_id = Number(f.elements.destination_shop_id.value); return p; }
        if (destination === 'HOME') {
          p.destination_name = 'Home use';
          p.dispatch_type = 'NON_SALE';
          p.non_sale_reason = 'Household consumption';
          return p;
        }
        p.destination_name = f.elements.destination_name.value.trim();
        p.price_per_litre = f.elements.price_per_litre.value;
        p.payment_status = f.elements.payment_status.value;
        if (p.payment_status === 'PARTIAL') p.amount_paid = f.elements.amount_paid.value;
        if (f.elements.is_sale.value === 'yes') {
          p.dispatch_type = 'SALE';
        } else {
          p.dispatch_type = 'NON_SALE';
          p.non_sale_reason = 'Customer dispatch';
        }
        return p;
      }
    });

    bindForm($('#rec-form'), {
      url: '/api/receipts', reset: resetRec, after: loadReceipts, offlineQueue: true,
      build: function (f) {
        if (!f.elements.dispatch_id.value) throw new Error('Please choose which dispatch you are receiving.');
        const p = { shop_id: Number(f.elements.shop_id.value), quantity_litres: f.elements.quantity_litres.value,
                    received_at: toIso(f.elements.received_at.value), notes: f.elements.notes.value.trim() || null };
        if (f.elements.dispatch_id.value !== 'none') p.dispatch_id = Number(f.elements.dispatch_id.value);
        return p;
      }
    });

    // dispatch form: show/hide the parts that depend on earlier answers
    $$('#disp-form [name=destination_type], #disp-form [name=is_sale], #disp-form [name=payment_status]').forEach(function (r) {
      r.addEventListener('change', syncDispatchUI);
    });
    $('#disp-form [name=quantity_litres]').addEventListener('input', updateDispatchPaymentSummary);
    $('#disp-form [name=price_per_litre]').addEventListener('input', updateDispatchPaymentSummary);
    $('#disp-form [name=amount_paid]').addEventListener('input', updateDispatchPaymentSummary);
    $$('#disp-form [data-qty]').forEach(function (button) {
      button.addEventListener('click', function () {
        const input = $('#disp-form [name=quantity_litres]');
        const next = Math.max(0, (Number(input.value) || 0) + Number(button.dataset.qty));
        input.value = String(next);
        updateDispatchPaymentSummary();
      });
    });
    $('#dispatch-now').addEventListener('click', function () {
      $('#disp-form [name=dispatched_at]').value = nowLocalValue();
    });
    // receipt form: show the difference between dispatched and received as you type
    $('#rec-dispatch').addEventListener('change', onReceiptDispatchChange);
    $('#rec-form [name=quantity_litres]').addEventListener('input', updateReceiptDiff);
  }

  function resetProd() {
    const f = $('#prod-form');
    f.elements.quantity_litres.value = '0'; f.elements.notes.value = ''; f.elements.production_date.value = todayStr();
    f.elements.session.value = suggestedProductionSession();
    updateProductionSessionButtons();
  }
  function resetDisp() {
    const f = $('#disp-form');
    f.elements.quantity_litres.value = '0';
    f.elements.notes.value = '';
    if (f.elements.destination_name) f.elements.destination_name.value = '';
    f.elements.payment_status.value = 'PAID';
    f.elements.amount_paid.value = '';
    if (f.elements.price_per_litre) f.elements.price_per_litre.value = '60';
    f.elements.dispatched_at.value = nowLocalValue();
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
    const destination = f.elements.destination_type.value;
    $('#disp-shop-box').hidden = destination !== 'SHOP';
    $('#disp-ext-box').hidden = destination !== 'EXTERNAL';
    const saleBox = $('#disp-sale-box');
    const nonsaleBox = $('#disp-nonsale-box');
    if (saleBox) saleBox.hidden = f.elements.is_sale.value !== 'yes';
    if (nonsaleBox) nonsaleBox.hidden = f.elements.is_sale.value === 'yes';
    const partial = f.elements.payment_status.value === 'PARTIAL';
    $('#dispatch-partial-payment').hidden = !partial;
    f.elements.amount_paid.required = partial;
    updateDispatchPaymentSummary();
  }

  function updateDispatchPaymentSummary() {
    const f = $('#disp-form');
    const status = f.elements.payment_status.value;
    const total = Math.round((Number(f.elements.quantity_litres.value) || 0) *
      (Number(f.elements.price_per_litre.value) || 0) * 100) / 100;
    const paid = status === 'PAID' ? total :
      status === 'PARTIAL' ? (Number(f.elements.amount_paid.value) || 0) : 0;
    const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
    f.elements.amount_paid.max = (status === 'PARTIAL' ? total - 0.01 : total).toFixed(2);
    $('#dispatch-payment-balance').textContent = fmtMoney(balance);
    $('#dispatch-payment-balance-row').classList.toggle('paid', balance === 0);
  }

  /* ---- Production ---- */
  const ATTENDANT_VIEWS = ['receipts', 'processing', 'sales', 'expenses', 'losses', 'closing', 'alerts'];
  const ATTENDANT_PAGE_COPY = {
    receipts: ['Receive milk', 'Record deliveries and review milk received at the shop.'],
    processing: ['Processing', 'Record milk used to make yoghurt or maziwa mala.'],
    sales: ['Sales', 'Record daily sales and review recent transactions.'],
    expenses: ['Expenses', 'Track farm and shop spending across selected periods.'],
    losses: ['Losses', 'Record spoiled stock and review recent losses.'],
    closing: ['Daily closing', 'Count shop stock and compare it with expected balances.'],
    alerts: ['Alerts', 'Review important updates for your shop.']
  };
  function updateAttendantPageHeading(viewId) {
    const heading = $('#attendant-page-heading');
    if (!heading) return;
    const currentView = viewId || state.view;
    const show = hasRole('SHOP_ATTENDANT') && ATTENDANT_VIEWS.indexOf(currentView) !== -1 &&
      currentView !== 'expenses';
    heading.hidden = !show;
    if (!show) return;
    const copy = ATTENDANT_PAGE_COPY[currentView];
    if (!copy) return;
    $('#attendant-greeting').textContent = copy[0];
    $('#attendant-date').textContent = copy[1];
  }

  function updateProductionGreeting() {
    const heading = $('#production-greeting');
    const dateLabel = $('#production-today-date');
    if (!heading || !dateLabel) return;
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = state.me && String(state.me.user || '').trim().split(/\s+/)[0];
    heading.textContent = greeting + ', ' + (name || 'there');
    dateLabel.textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function suggestedProductionSession() {
    const hour = new Date().getHours();
    return hour < 11 ? 'MORNING' : hour < 16 ? 'LUNCH' : 'EVENING';
  }

  function updateProductionSessionButtons() {
    const selected = $('#prod-form [name=session]').value;
    $$('.production-session').forEach(function (button) {
      const active = button.dataset.productionSession === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateProductionSummary(records, selectedDate) {
    const isToday = selectedDate === todayStr();
    $('#production-today-title').textContent = isToday ? 'Today' : 'Production on ' + fmtDate(selectedDate);
    const sessions = ['MORNING', 'LUNCH', 'EVENING'];
    let total = 0;
    sessions.forEach(function (session) {
      const record = records.filter(function (row) { return row.session === session; })[0];
      const card = $('.production-session-stat[data-session-stat="' + session + '"]');
      const amount = $('strong', card);
      const status = $('small', card);
      if (record) {
        const litres = Number(record.quantity_litres);
        total += litres;
        amount.textContent = fmtL(litres) + ' L';
        status.textContent = 'Recorded';
        status.className = 'recorded';
      } else {
        amount.textContent = '—';
        status.className = '';
        const upcoming = isToday && new Date().getHours() < { MORNING: 11, LUNCH: 16, EVENING: 24 }[session];
        status.textContent = upcoming ? 'Later' : 'Not recorded';
      }
    });
    $('#production-today-total').textContent = fmtL(total) + ' L recorded so far';
  }

  function updateProductionExistingRecord(records, selectedDate) {
    const session = $('#prod-form [name=session]').value;
    const existing = records.filter(function (row) {
      return row.session === session && row.date === selectedDate;
    })[0];
    const notice = $('#production-existing');
    notice.hidden = !existing;
    notice.textContent = existing
      ? session.charAt(0) + session.slice(1).toLowerCase() + ' is already recorded: ' +
        fmtL(existing.quantity_litres) + ' L by ' + existing.recorded_by +
        '. Duplicate entries are blocked; contact the owner to request a correction.'
      : '';
  }

  function updateProductionUsual(session, selectedDate, farmId, recent) {
    const previous = recent.filter(function (row) {
      return productionFarmMatches(row, farmId) && row.session === session && row.date < selectedDate;
    });
    const usual = $('#production-usual');
    if (!previous.length) {
      usual.textContent = 'No earlier ' + session.toLowerCase() + ' records to estimate a usual amount.';
      return;
    }
    const average = previous.reduce(function (sum, row) {
      return sum + Number(row.quantity_litres);
    }, 0) / previous.length;
    usual.textContent = 'Recent ' + session.charAt(0) + session.slice(1).toLowerCase() +
      ' average: about ' + fmtL(average) + ' L (' + previous.length + ' records).';
  }

  function productionDispatchLabel(iso) {
    if (!iso) return 'No dispatches yet';
    const date = new Date(iso);
    const dateText = todayStr(date) === todayStr() ? 'Today' :
      todayStr(date) === todayStr(new Date(Date.now() - 86400000)) ? 'Yesterday' :
        date.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return dateText + ', ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function productionFarmMatches(row, farmId) {
    return Number(row.farm_id) === Number(farmId) ||
      (row.farm_id === undefined && state.loc.farms.length === 1 &&
       Number(state.loc.farms[0].id) === Number(farmId));
  }

  async function loadProductionDispatches(farmId) {
    if (!farmId) return { items: [] };
    try {
      return await API.get('/api/dispatches?limit=200');
    } catch (e) {
      if (!e.network) throw e;
      try {
        return await API.get('/api/dispatches');
      } catch (cachedError) {
        if (!cachedError.network) throw cachedError;
        return null;
      }
    }
  }

  async function loadProduction() {
    const farmId = $('#prod-form [name=farm_id]').value;
    const selectedDate = $('#prod-form [name=production_date]').value || todayStr();
    const token = ++productionLoadToken;
    updateProductionGreeting();
    const [list, stock, dispatches] = await Promise.all([
      API.get('/api/production'),
      farmId ? API.get('/api/stock?farm_id=' + encodeURIComponent(farmId)) : null,
      loadProductionDispatches(farmId)
    ]);
    if (token !== productionLoadToken) return;
    if (stock) renderStock($('#farm-stock'), stock, 'farm');
    else $('#farm-stock').innerHTML = '<p class="muted">No farm selected.</p>';
    productionRecentRecords = list.items;
    let dateItems = list.items.filter(function (row) {
      return row.date === selectedDate && productionFarmMatches(row, farmId);
    });
    if (farmId && !state.offlineOnly) {
      try {
        const daily = await API.get('/api/production?date=' + encodeURIComponent(selectedDate) +
          '&farm_id=' + encodeURIComponent(farmId) + '&limit=200');
        dateItems = daily.items;
      } catch (e) {
        if (!e.network) throw e;
      }
    }
    if (token !== productionLoadToken) return;
    productionDateRecords = dateItems;
    updateProductionSummary(dateItems, selectedDate);
    updateProductionSessionButtons();
    updateProductionExistingRecord(dateItems, selectedDate);
    updateProductionUsual($('#prod-form [name=session]').value, selectedDate, farmId, list.items);
    const latestDispatch = dispatches && dispatches.items.filter(function (dispatch) {
      return productionFarmMatches(dispatch, farmId);
    })[0];
    $('#production-last-dispatch').textContent = dispatches
      ? productionDispatchLabel(latestDispatch && latestDispatch.dispatched_at)
      : 'Unavailable offline';
    if (!stock && farmId) throw new Error('Farm stock could not be loaded.');
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
    const [list, stock, price] = await Promise.all([
      API.get('/api/dispatches'),
      farmId ? loadStock($('#disp-farm-stock'), 'farm', farmId) : null,
      API.get('/api/dispatches/price')
    ]);
    if (price.selling_price !== null) $('#disp-form [name=price_per_litre]').value = price.selling_price;
    updateDispatchPaymentSummary();
    renderTable($('#tbl-disp'), dispatchColumns(), list.items, 'No dispatches recorded yet.');
    updateDispatchSummary(list.items, stock, farmId);
  }
  function updateDispatchSummary(items, stock, farmId) {
    let available = 0;
    if (stock && stock.items) {
      stock.items.forEach(function (item) {
        if (item.type === 'FRESH_MILK' && (!farmId || item.farm_id == null || Number(item.farm_id) === Number(farmId))) {
          available += Number(item.balance_litres) || 0;
        }
      });
    }
    $('#dispatch-farm-total').textContent = fmtL(available) + ' L';
    $('#dispatch-farm-available').textContent = fmtL(available) + ' L';

    const today = todayStr();
    let shop = 0, sold = 0, home = 0;
    items.forEach(function (item) {
      if (!item.dispatched_at || todayStr(new Date(item.dispatched_at)) !== today) return;
      const litres = Number(item.quantity_litres) || 0;
      if (item.type === 'SALE') sold += litres;
      else if (item.type === 'NON_SALE') home += litres;
      else shop += litres;
    });
    $('#dispatch-shop-today').textContent = fmtL(shop) + ' L';
    $('#dispatch-sold-today').textContent = fmtL(sold) + ' L';
    $('#dispatch-home-today').textContent = fmtL(home) + ' L';
  }
  function dispatchColumns() {
    return [
      { h: 'Reference', f: function (r) { return esc(r.reference); } },
      { h: 'When', f: function (r) { return esc(fmtDT(r.dispatched_at)); } },
      { h: 'Destination', f: function (r) {
        const shop = state.loc.shops.find(function (item) { return String(item.id) === String(r.destination); });
        return esc(shop ? shop.name : (r.destination || ''));
      } },
      { h: 'Type', f: function (r) { return esc(TYPE_LABEL[r.type] || r.type); } },
      { h: 'Litres', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Amount', num: true, f: function (r) { return r.revenue === null ? '—' : esc(fmtMoney(r.revenue)); } },
      { h: 'Status', f: function (r) {
        if (r.type === 'SALE' && r.payment_status) {
          const label = r.payment_status === 'PARTIAL' ? 'Partly paid' :
            r.payment_status === 'PAID' ? 'Paid' : 'Unpaid';
          const balance = Number(r.remaining_balance) || 0;
          return balance > 0
            ? '<span class="tag warn">' + label + ' · ' + esc(fmtMoney(balance)) + ' due</span>'
            : '<span class="tag">' + label + '</span>';
        }
        return r.status ? statusTag(r.status) : (r.non_sale_reason ? esc(r.non_sale_reason) : '—');
      } }
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
      { h: 'Recorded by', f: function (r) { return esc(r.recorded_by); } },
      { h: 'Received', f: function (r) { return esc(fmtDT(r.received_at)); } },
      { h: 'Dispatch', f: function (r) { return esc(r.reference || '—'); } },
      { h: 'Dispatched (L)', num: true, f: function (r) { return fmtL(r.dispatched_litres); } },
      { h: 'Received (L)', num: true, f: function (r) { return fmtL(r.quantity_litres); } },
      { h: 'Difference (L)', num: true, f: function (r) { return fmtSigned(r.difference); } }
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
  let expensePeriod = 'month';
  let expenseArea = 'TOTALS';
  let expenseDateRange = null;
  let expenseTrendGrain = 'day';
  let expensePrintState = null;
  let expenseLoadToken = 0;
  let expenseReportReady = false;

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
      url: '/api/processing', reset: resetProc, after: loadProcessing, offlineQueue: true,
      build: function (f) {
        const e = f.elements;
        return { shop_id: Number(e.shop_id.value), product_type: e.product_type.value, input_litres: e.input_litres.value,
                 output_litres: e.output_litres.value, processed_at: toIso(e.processed_at.value), notes: e.notes.value.trim() || null };
      }
    });
    bindForm($('#sale-form'), {
      url: '/api/sales', reset: resetSale, after: loadSales, offlineQueue: true,
      beforeSubmit: confirmSaleWithinStock,
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
      url: '/api/losses', reset: resetLoss, after: loadLosses, offlineQueue: true,
      build: function (f) {
        const e = f.elements;
        return { shop_id: Number(e.shop_id.value), product_type: e.product_type.value, quantity_litres: e.quantity_litres.value,
                 loss_reason: e.loss_reason.value, occurred_at: toIso(e.occurred_at.value), notes: e.notes.value.trim() || null };
      }
    });
    bindForm($('#close-form'), {
      url: '/api/closings', reset: resetClose, offlineQueue: true,
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
    bindForm($('#expense-form'), {
      url: '/api/expenses',
      reset: function (f) { f.elements.area.value = ''; f.elements.expense_date.value = todayStr(); f.elements.amount.value = ''; f.elements.description.value = ''; f.elements.payment_status.value = 'UNPAID'; },
      after: loadExpenses,
      build: function (f) {
        return { area: f.elements.area.value,
                 expense_date: f.elements.expense_date.value,
                 category_id: Number(f.elements.category_id.value),
                 amount: f.elements.amount.value,
                 payment_status: f.elements.payment_status.value,
                 description: f.elements.description.value.trim() || null };
      }
    });
    $('#expense-form [name=category_id]').addEventListener('change', syncExpenseDescription);
    $('#bills-to-pay-list').addEventListener('click', function (ev) {
      const button = ev.target.closest('[data-pay-expense]');
      if (!button) return;
      button.disabled = true;
      safe(async function () {
        await API.post('/api/expenses/' + button.dataset.payExpense + '/pay');
        toast('Expense marked paid.');
        await loadExpenses();
      }).finally(function () { button.disabled = false; });
    });
    $('#expense-date-filter').addEventListener('submit', function (ev) {
      ev.preventDefault();
      const form = ev.currentTarget;
      const from = form.elements.date_from.value;
      const to = form.elements.date_to.value;
      if (!from || !to) {
        toast('Choose both a start date and an end date.', 'error');
        return;
      }
      if (from > to) {
        toast('The start date must be on or before the end date.', 'error');
        return;
      }
      expenseDateRange = { from: from, to: to };
      $$('#expense-periods [data-expense-period]').forEach(function (button) {
        button.classList.remove('active');
      });
      safe(loadExpenses);
    });
    $('#expense-export').addEventListener('click', exportExpenseReport);
    window.addEventListener('afterprint', restoreAfterExpensePrint);

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
    $('#tbl-sales').addEventListener('click', onSaleReceiptClick);
    $('#expense-periods').addEventListener('click', function (ev) {
      const b = ev.target.closest('[data-expense-period]');
      if (!b) return;
      expensePeriod = b.dataset.expensePeriod;
      expenseDateRange = null;
      $$('#expense-periods [data-expense-period]').forEach(function (button) {
        button.classList.toggle('active', button === b);
      });
      safe(loadExpenses);
    });
    $('#expense-trend-grain').addEventListener('change', function (ev) {
      expenseTrendGrain = ev.target.value;
      safe(loadExpenses);
    });
    $('#expense-areas').addEventListener('click', function (ev) {
      const b = ev.target.closest('[data-expense-area]');
      if (!b) return;
      expenseArea = b.dataset.expenseArea;
      $$('#expense-areas [data-expense-area]').forEach(function (button) {
        button.classList.toggle('active', button === b);
      });
      safe(loadExpenses);
    });
    $('#sale-receipt-print').addEventListener('click', function () { window.print(); });
    $('#sale-receipt-close').addEventListener('click', function () { $('#sale-receipt-dialog').close(); });
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
    const [pr, list, stock, buyerSales, farmUse] = await Promise.all([
      API.get('/api/prices'), API.get('/api/sales'), loadStock($('#sale-stock'), 'shop', shopId()),
      hasRole('OWNER') ? API.get('/api/direct-sales') : Promise.resolve({ items: [] }),
      hasRole('OWNER') ? API.get('/api/farm-withdrawals') : Promise.resolve({ items: [] })
    ]);
    setSaleStock(stock);
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
      { h: 'Shop', f: function (r) { return esc(r.shop || ''); } },
      { h: 'Items', f: function (r) {
          return r.items.map(function (i) { return esc(i.product + ' ' + fmtL(i.quantity_litres) + ' L @ ' + Number(i.unit_price).toFixed(2)); }).join('<br>'); } },
      { h: 'Total', num: true, f: function (r) { return esc(fmtMoney(r.total)); } },
      { h: 'Recorded by', f: function (r) { return esc(r.recorded_by); } },
      { h: 'Receipt', f: function (r) { return '<button class="btn small" type="button" data-sale-receipt="' + r.id + '">View / Print</button>'; } }
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

  function setSaleStock(data) {
    const stock = {};
    data.items.forEach(function (item) {
      stock[item.type] = Number(item.balance_litres);
    });
    state.saleStock = stock;
  }

  async function confirmSaleWithinStock(payload, form, msg) {
    try {
      const stockData = await loadStock($('#sale-stock'), 'shop', payload.shop_id);
      setSaleStock(stockData);
    } catch (e) {
      if (!e.network) throw e;
      state.connectionAvailable = false;
      if (!state.saleStock) {
        const warning = 'Current stock could not be checked while offline. The sale will be checked when it syncs. Continue?';
        setMsg(msg, warning, 'warn');
        return window.confirm(warning);
      }
    }
    const requested = {};
    payload.items.forEach(function (item) {
      requested[item.product_type] = (requested[item.product_type] || 0) + Number(item.quantity_litres);
    });
    const shortages = PRODUCTS.filter(function (product) {
      return requested[product[0]] > (state.saleStock[product[0]] || 0);
    }).map(function (product) {
      const available = state.saleStock[product[0]] || 0;
      const quantity = requested[product[0]];
      return product[1] + ': selling ' + fmtL(quantity) + ' L, stock shown ' +
        fmtL(available) + ' L (short by ' + fmtL(quantity - available) + ' L)';
    });
    const offlineWarning = state.connectionAvailable ? '' : 'You are offline; the stock snapshot may be out of date. ';
    if (!shortages.length && !offlineWarning) return true;

    const warning = offlineWarning + (shortages.length
      ? 'Warning: the sale exceeds current shop stock. ' + shortages.join('; ') +
        '. Check your quantities and stock. You can continue only if this is intentional.'
      : 'Check the saved stock snapshot before continuing.');
    setMsg(msg, warning, 'warn');
    if (!window.confirm(warning + '\n\nContinue and save this sale anyway?')) return false;
    setMsg(msg, '');
    return true;
  }

  async function onSaleReceiptClick(ev) {
    const button = ev.target.closest('[data-sale-receipt]');
    if (!button) return;
    button.disabled = true;
    try {
      const result = await API.get('/api/sales/' + encodeURIComponent(button.dataset.saleReceipt));
      const sale = result.record;
      $('#sale-receipt-content').innerHTML =
        '<h1 id="sale-receipt-title">' + esc(state.me.business || 'Dairy Farm Manager') + '</h1>' +
        '<p class="receipt-subtitle">Sales receipt</p>' +
        '<dl class="receipt-meta">' +
          '<div><dt>Receipt no.</dt><dd>SALE-' + String(sale.id).padStart(6, '0') + '</dd></div>' +
          '<div><dt>Date</dt><dd>' + esc(fmtDate(sale.sale_date)) + '</dd></div>' +
          '<div><dt>Shop</dt><dd>' + esc(sale.shop) + '</dd></div>' +
          '<div><dt>Recorded by</dt><dd>' + esc(sale.recorded_by || '—') + '</dd></div>' +
        '</dl>' +
        '<div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">Quantity</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>' +
        '<tbody>' + sale.items.map(function (item) {
          return '<tr><td>' + esc(item.product) + '</td><td class="num">' + esc(fmtL(item.quantity_litres)) + ' L</td>' +
            '<td class="num">' + esc(fmtMoney(item.unit_price)) + '</td><td class="num">' + esc(fmtMoney(item.line_total)) + '</td></tr>';
        }).join('') + '</tbody><tfoot><tr><th colspan="3">Total</th><th class="num">' + esc(fmtMoney(sale.total)) + '</th></tr></tfoot></table></div>';
      $('#sale-receipt-dialog').showModal();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function loadExpenses() {
    const token = ++expenseLoadToken;
    expenseReportReady = false;
    const billsRequest = API.get('/api/expenses/unpaid').then(function (bills) {
      return { bills: bills };
    }).catch(function (error) {
      if (error.status !== 404) throw error;
      return { unavailable: true };
    });
    const [categories, billsResult] = await Promise.all([
      API.get('/api/expense-categories'), billsRequest
    ]);
    if (billsResult.bills) renderBillsToPay(billsResult.bills);
    else {
      $('#bills-to-pay-total').textContent = '';
      $('#bills-to-pay-list').innerHTML =
        '<p class="msg warn" role="status">Bills to pay is unavailable because the server has not loaded this feature yet. Restart the app server to enable it.</p>';
    }
    const select = $('#expense-form [name=category_id]');
    const selected = select.value;
    const categoryChanged = categories.items.length !== select.options.length - 1 ||
      categories.items.some(function (category, i) {
        const option = select.options[i + 1];
        return !option || option.value !== String(category.id);
      });
    if (categoryChanged) {
      select.innerHTML = '<option value="">Choose category</option>';
      categories.items.forEach(function (category) {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        select.appendChild(option);
      });
    }
    if (categories.items.some(function (category) { return String(category.id) === selected; })) {
      select.value = selected;
    }
    syncExpenseDescription();
    const dateParams = expenseDateRange
      ? '&date_from=' + encodeURIComponent(expenseDateRange.from) +
        '&date_to=' + encodeURIComponent(expenseDateRange.to)
      : '&period=' + encodeURIComponent(expensePeriod);
    const result = await API.get('/api/expenses?area=' + encodeURIComponent(expenseArea) + dateParams);
    if (token !== expenseLoadToken) return;
    const labels = { week: 'Past week', month: 'Past month', '3months': 'Past 3 months', '6months': 'Past 6 months', year: 'Past year', custom: 'Custom dates' };
    $('#expense-range').textContent = labels[result.period] + ' · ' + fmtDate(result.start_date) + ' – ' + fmtDate(result.end_date);
    $('#expense-total').textContent = fmtMoney(result.total);
    const trendAvailable = Array.isArray(result.daily) && result.previous_period &&
      result.revenue !== undefined && result.previous_period.revenue !== undefined &&
      result.previous_period.expenses !== undefined;
    const trendStatus = $('#expense-trend-status');
    trendStatus.hidden = trendAvailable;
    trendStatus.textContent = trendAvailable ? '' :
      'Trend and period comparison need a refreshed online report. Expense list and category totals are from the last saved report.';
    const previous = result.previous_period;
    const comparisons = {
      week: 'previous 7 days', month: 'previous 30 days', '3months': 'previous 90 days',
      '6months': 'previous 180 days', year: 'previous 365 days', custom: 'previous period'
    };
    const comparisonLabel = comparisons[result.period] || 'previous period';
    const compare = function (current, prior) {
      current = Number(current);
      prior = Number(prior);
      if (prior === 0) return current === 0 ? 'No change vs ' + comparisonLabel : 'New vs ' + comparisonLabel;
      const percent = Math.round(((current - prior) / prior) * 100);
      return (percent > 0 ? '+' : '') + percent + '% vs ' + comparisonLabel;
    };
    const revenue = trendAvailable ? Number(result.revenue) : null;
    const expenses = Number(result.total);
    $('#expense-revenue-total').textContent = revenue === null ? 'Unavailable offline' : fmtMoney(revenue);
    $('#expense-revenue-comparison').textContent = trendAvailable
      ? compare(revenue, previous.revenue) : 'Unavailable offline';
    $('#expense-revenue-comparison').title = trendAvailable
      ? fmtDate(previous.start_date) + ' – ' + fmtDate(previous.end_date) : '';
    $('#expense-comparison').textContent = trendAvailable
      ? compare(expenses, previous.expenses) : 'Unavailable offline';
    $('#expense-comparison').title = trendAvailable
      ? fmtDate(previous.start_date) + ' – ' + fmtDate(previous.end_date) : '';
    $('#expense-net-total').textContent = revenue === null ? 'Unavailable offline' : fmtMoney(revenue - expenses);
    $('#expense-net-total').classList.toggle('negative', revenue !== null && revenue < expenses);
    if (window.DairyCharts) DairyCharts.renderExpenseTrend(
      trendAvailable ? result.daily : [], expenseTrendGrain, result.area || expenseArea
    );
    $('#expense-area-totals').innerHTML = expenseArea === 'TOTALS'
      ? Object.keys(result.totals_by_area).filter(function (area) { return area !== 'UNASSIGNED'; }).map(function (area) {
          return '<div class="expense-category-total"><span>' + (area === 'FARM' ? 'On farm' : 'On shop') +
            '</span><strong>' + esc(fmtMoney(result.totals_by_area[area])) + '</strong></div>';
        }).join('')
      : '';
    if (window.DairyCharts) DairyCharts.renderExpenses(result.by_category, result.total);
    renderTable($('#tbl-expenses'), [
      { h: 'Area', f: function (r) { return esc(r.area === 'FARM' ? 'On farm' : r.area === 'SHOP' ? 'On shop' : 'Unassigned'); } },
      { h: 'Date', f: function (r) { return esc(fmtDate(r.expense_date)); } },
      { h: 'Category', f: function (r) { return esc(r.category); } },
      { h: 'Description', f: function (r) { return esc(r.description || ''); } },
      { h: 'Amount', num: true, f: function (r) { return esc(fmtMoney(r.amount)); } },
      { h: 'Paid', num: true, f: function (r) { return esc(fmtMoney(r.amount_paid)); } },
      { h: 'Payment status', f: function (r) {
          const status = r.payment_status;
          const label = status.replace('_', ' ');
          const cls = status === 'PAID' ? 'tag payment-paid' :
            status === 'UNPAID' ? 'tag bad payment-unpaid' : 'tag warn payment-partial';
          return '<span class="' + cls + '">' + esc(label) + '</span>';
        } },
      { h: 'Recorded by', f: function (r) { return esc(r.recorded_by); } }
    ], result.items, 'No expenses recorded in this period.');
    expenseReportReady = true;
  }

  function exportExpenseReport() {
    if (!state.me || !hasRole('OWNER') || state.view !== 'expenses') {
      toast('Open the Expenses page as the owner before exporting a report.', 'error');
      return;
    }
    if (!expenseReportReady) {
      toast('Wait for the current expense report to finish loading before exporting.', 'error');
      return;
    }
    const areaLabels = { FARM: 'On farm', SHOP: 'On shop', TOTALS: 'All areas' };
    const grainLabels = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
    const now = new Date();
    $('#expense-report-business').textContent = state.me.business || 'Dairy Farm Manager';
    $('#expense-report-period').textContent = $('#expense-range').textContent || 'Current selected period';
    $('#expense-report-area').textContent = areaLabels[expenseArea] || 'All areas';
    $('#expense-report-grouping').textContent = grainLabels[expenseTrendGrain] || 'Daily';
    $('#expense-report-prepared-by').textContent = state.me.user || state.me.username || 'Owner';
    $('#expense-report-generated').textContent = now.toLocaleString([], {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    expensePrintState = {
      title: document.title,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    };
    document.title = (state.me.business || 'Dairy Farm Manager') + ' - Expense Report';
    document.body.classList.add('expense-report-print');
    if (expensePrintState.theme === 'dark') applyTheme('light');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { window.print(); });
    });
  }

  function restoreAfterExpensePrint() {
    if (!expensePrintState) return;
    document.body.classList.remove('expense-report-print');
    document.title = expensePrintState.title;
    if (expensePrintState.theme === 'dark') applyTheme('dark');
    expensePrintState = null;
  }

  function renderBillsToPay(bills) {
    $('#bills-to-pay-total').textContent = bills.items.length ? fmtMoney(bills.total_due) + ' due' : '';
    $('#bills-to-pay-list').innerHTML = bills.items.length
      ? bills.items.map(function (bill) {
          const age = Number(bill.days_old);
          const ageLabel = age === 0 ? 'Today' : age + ' ' + (age === 1 ? 'day' : 'days') + ' old';
          const area = bill.area === 'FARM' ? 'Farm' : bill.area === 'SHOP' ? 'Shop' : 'Unassigned';
          return '<div class="bill-row"><div class="bill-description"><strong>' + esc(bill.category) +
            '</strong><span>' + esc(bill.description || area) + '</span><small class="' +
            (age >= 10 ? 'bill-age overdue' : 'bill-age') + '">' + esc(ageLabel) + '</small></div>' +
            '<div class="bill-payment"><strong>' + esc(fmtMoney(bill.amount_due)) + '</strong>' +
            '<button type="button" class="btn small bill-pay-button" data-pay-expense="' + esc(bill.id) +
            '">Mark paid</button></div></div>';
        }).join('')
      : '<p class="muted bills-empty">No unpaid expenses.</p>';
  }

  function syncExpenseDescription() {
    const f = $('#expense-form');
    const equipment = f.elements.category_id.selectedOptions[0] &&
      f.elements.category_id.selectedOptions[0].textContent === 'Equipment';
    f.elements.description.required = Boolean(equipment);
    $('#expense-description-title').textContent = equipment
      ? 'Specific equipment purchased / maintained (required)'
      : 'Description / notes (optional)';
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
    date.max = state.offlineOnly ? todayStr() : st.today;
    f.dataset.locked = st.up_to_date && !state.offlineOnly ? '1' : '';
    btn.disabled = st.up_to_date && !state.offlineOnly;
    if (st.first_closing) {
      date.readOnly = false; date.value = date.value || st.suggested_date;
      setMsg(banner, 'This is the first stock closing for this shop. Choose the day you are closing; later closings must follow in order.', 'ok');
    } else if (st.up_to_date) {
      if (state.offlineOnly) {
        date.readOnly = false; date.value = todayStr();
        setMsg(banner, 'Offline: the saved closing status may be out of date. Confirm the closing date before saving; the server will validate it when synced.', 'warn');
      } else {
        date.readOnly = true; date.value = '';
        setMsg(banner, 'All days are closed up to ' + fmtDate(st.last_closed) + '. The next closing opens when today ends.', 'ok');
      }
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

    $('#offline-pin-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const form = ev.target, error = $('.msg', form), button = $('button[type=submit]', form);
      setMsg(error, '');
      if (state.offlineOnly || !navigator.onLine || !state.me) {
        setMsg(error, 'Sign in online to set or change this device’s offline PIN.', 'error');
        return;
      }
      if (form.elements.pin.value.length < 8) {
        setMsg(error, 'Use at least 8 characters for the offline PIN.', 'error');
        return;
      }
      if (form.elements.pin.value !== form.elements.pin_confirm.value) {
        setMsg(error, 'The offline PINs do not match.', 'error');
        return;
      }
      button.disabled = true;
      try {
        if (!(await syncSession())) throw new Error('Your account changed. Please check the signed-in user and try again.');
        await DairyOffline.setPin(state.offlineScope, form.elements.pin.value);
        form.reset();
        $('#offline-pin-status').textContent = 'An offline PIN is set for this browser. You can use it after opening the site offline.';
        toast('Offline PIN saved on this device.');
      } catch (e) {
        setMsg(error, e.message, 'error');
      } finally { button.disabled = false; }
    });

    $('#offline-pin-remove').addEventListener('click', async function () {
      if (state.offlineOnly || !navigator.onLine || !state.me) {
        toast('Sign in online to remove this device’s offline PIN.', 'error');
        return;
      }
      if (!window.confirm('Remove offline sign-in from this browser? Already queued records will remain on this device.')) return;
      const button = $('#offline-pin-remove');
      button.disabled = true;
      try {
        if (!(await syncSession())) throw new Error('Your account changed. Please check the signed-in user and try again.');
        await DairyOffline.removePin(state.offlineScope);
        $('#offline-pin-status').textContent = 'No offline PIN is set for this browser.';
        toast('Offline PIN removed from this device.');
      } catch (e) {
        toast(e.message, 'error');
      } finally { button.disabled = false; }
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
    $('#pw-form').hidden = state.offlineOnly;
    const pinForm = $('#offline-pin-form');
    pinForm.hidden = state.offlineOnly || me.must_change_password;
    if (!pinForm.hidden) {
      const pinSet = await DairyOffline.hasPin(state.offlineScope);
      $('#offline-pin-status').textContent = pinSet
        ? 'An offline PIN is set for this browser.'
        : 'No offline PIN is set for this browser yet.';
    }
    $('#account-info').innerHTML = [['Name', me.user], ['Username', me.username || ''], ['Business', me.business],
      ['Role', me.roles.map(roleLabel).join(', ')]].map(function (r) {
      return '<div class="stock-row"><span>' + esc(r[0]) + '</span><strong>' + esc(r[1]) + '</strong></div>';
    }).join('');
  }

  async function loadUsers() {
    const owner = hasRole('OWNER') && !state.me.must_change_password;
    $('#user-form').hidden = !owner;
    $('#users-list-card').hidden = !owner;
    $('#user-password-required').hidden = !state.me.must_change_password;
    if (!owner) return;
    const data = await API.get('/api/users');
    renderTable($('#tbl-users'), [
      { h: 'Name', f: function (u) { return esc(u.full_name); } },
      { h: 'Username', f: function (u) { return esc(u.username); } },
      { h: 'Role', f: function (u) { return esc(u.roles.map(roleLabel).join(', ')); } },
      { h: 'Status', f: function (u) {
          return '<div class="user-status">' +
                 (u.active ? '<span class="tag">Active</span>' : '<span class="tag bad">Deactivated</span>') +
                 (u.locked ? '<span class="tag bad">Locked</span>' : '') +
                 (u.must_change_password ? '<span class="tag warn">Temporary password</span>' : '') +
                 '</div>'; } },
      { h: 'Last sign-in', f: function (u) { return esc(u.last_login_at ? fmtDT(u.last_login_at) : 'Never'); } },
      { h: 'Actions', f: function (u) {
          const own = state.me && u.username === state.me.username;
          const attrs = ' data-id="' + u.id + '" data-name="' + esc(u.full_name) + '"';
          return (own ? '' : '<button class="btn tiny" data-act="toggle" data-active="' + (u.active ? '1' : '0') + '"' + attrs + '>' + (u.active ? 'Deactivate' : 'Reactivate') + '</button>' +
                 '<button class="btn tiny" data-act="role" data-role="' + esc(u.roles[0] || '') + '"' + attrs + '>Change role</button>') +
                 '<button class="btn tiny" data-act="reset"' + attrs + '>Reset password</button>' +
                 (u.locked ? '<button class="btn tiny primary" data-act="unlock"' + attrs + '>Unlock</button>' : ''); } }
    ], data.items, 'No users.');
  }
  async function onUserAction(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id, name = b.dataset.name;
    try {
      if (b.dataset.act === 'role') {
        const dialog = $('#user-role-dialog');
        dialog.dataset.userId = id;
        $('#user-role-name').textContent = 'Change the role for ' + name + '.';
        $('#user-role-form').elements.role.value = b.dataset.role;
        setMsg($('.msg', $('#user-role-form')), '');
        dialog.showModal();
        return;
      } else if (b.dataset.act === 'toggle') {
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
  $('#user-role-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const form = ev.currentTarget, dialog = $('#user-role-dialog');
    const error = $('.msg', form), button = $('button[type=submit]', form);
    setMsg(error, '');
    button.disabled = true;
    try {
      await API.post('/api/users/' + encodeURIComponent(dialog.dataset.userId) + '/role',
        { role: form.elements.role.value });
      dialog.close();
      toast('Role updated.');
      await loadUsers();
    } catch (e) {
      setMsg(error, e.message, 'error');
    } finally { button.disabled = false; }
  });
  $('#user-role-cancel').addEventListener('click', function () {
    $('#user-role-dialog').close();
  });

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
  function shiftDate(value, days) {
    const parts = value.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function sparkline(values) {
    if (!values.length) return '';
    const numbers = values.map(Number);
    const min = Math.min.apply(null, numbers), max = Math.max.apply(null, numbers);
    const spread = max - min || 1;
    const points = numbers.map(function (value, index) {
      const x = numbers.length === 1 ? 60 : index * 120 / (numbers.length - 1);
      const y = 35 - (value - min) / spread * 28;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="kpi-sparkline" viewBox="0 0 120 40" aria-hidden="true"><polyline points="' + points + '"></polyline></svg>';
  }
  function salesChange(current, previous) {
    const now = Number(current), before = Number(previous);
    if (before === 0) {
      return { direction: now > 0 ? 'up' : 'flat', text: now > 0 ? 'New' : '0%' };
    }
    const percent = (now - before) / Math.abs(before) * 100;
    return {
      direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat',
      text: (percent > 0 ? '↑ ' : percent < 0 ? '↓ ' : '') + Math.round(Math.abs(percent)) + '%'
    };
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
    const periodDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    const previousTo = shiftDate(from, -1);
    const previousFrom = shiftDate(previousTo, 1 - periodDays);
    const previous = await API.get('/api/dashboard/summary?from=' + previousFrom + '&to=' + previousTo);
    if (token !== state.dashToken) return;

    const t = data.totals;
    $('#flow-produced').textContent = fmtL(t.produced) + ' L';
    $('#flow-sent').textContent = fmtL(t.sent_to_shop) + ' L';
    $('#flow-transit').textContent = fmtL(t.in_transit_litres) + ' L';
    $('#flow-received').textContent = fmtL(t.received_at_shop) + ' L';
    $('#flow-lost').textContent = fmtL(t.losses_litres) + ' L';
    $('#milk-flow-empty').hidden = Number(t.produced) > 0;

    const shopDaily = data.days.map(function (_, index) {
      return Object.keys(data.shop_sales).reduce(function (sum, product) {
        return sum + Number(data.shop_sales[product][index] || 0);
      }, 0);
    });
    const totalDaily = data.external_sales_revenue.map(function (amount, index) {
      return Number(amount) + shopDaily[index];
    });
    const attention = [
      { id: 'attention-overdue', value: t.closings_overdue },
      { id: 'attention-review', value: t.closings_to_review },
      { id: 'attention-discrepancies', value: t.discrepancies },
      { id: 'attention-receipts', value: t.awaiting_receipt }
    ];
    attention.forEach(function (item) {
      $('#' + item.id).textContent = String(item.value);
    });
    const hasAttention = attention.some(function (item) { return Number(item.value) > 0; });
    $('#attention-status').textContent = hasAttention ? 'Needs review' : '✓ All clear';
    $('#attention-status').classList.toggle('has-issues', hasAttention);

    const kpis = [
      { l: 'Total sales', v: fmtMoney(t.total_sales),
        change: salesChange(t.total_sales, previous.totals.total_sales), trend: totalDaily },
      { l: 'External sales', v: fmtMoney(t.external_sales_revenue),
        change: salesChange(t.external_sales_revenue, previous.totals.external_sales_revenue),
        trend: data.external_sales_revenue },
      { l: 'Shop sales', v: fmtMoney(t.shop_sales_revenue),
        change: salesChange(t.shop_sales_revenue, previous.totals.shop_sales_revenue), trend: shopDaily },
    ];
    $('#kpis').innerHTML = kpis.map(function (k) {
      const detail = k.change
        ? '<div class="kpi-detail"><span class="kpi-change ' + k.change.direction + '">' + esc(k.change.text) +
          ' <span>vs previous period</span></span>' + sparkline(k.trend) + '</div>'
        : '';
      return '<div class="kpi' + (k.bad ? ' bad' : '') + '"><div class="k-label">' + esc(k.l) +
        '</div><div class="k-value">' + esc(k.v) + '</div>' + detail + '</div>';
    }).join('');

    DairyCharts.render(data);

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
  API.setUnauthorizedHandler(function () {
    if (state.me && (!state.offlineOnly || navigator.onLine)) {
      if (!state.offlineOnly) toast('Your session ended. Please sign in again.', 'error');
      showLogin();
    }
  });
  API.setPasswordChangeHandler(function () {            // the server says: change your temporary password first
    if (state.me && !state.me.must_change_password) {
      state.me.must_change_password = true;
      buildNav();
      showView('users');
      safe(loadAccount);
      setProfileMenuOpen(true);
      $('#pw-form [name=current_password]').focus();
    }
  });
  bindAccountForms();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(function (e) {
      console.error('Unable to register offline app support.', e);
    });
  }
  (async function init() {
    try {
      await startApp(await API.get('/auth/me'));
    } catch (e) {
      if (e.network || !navigator.onLine) showOfflineLogin();
      else showLogin();
    }
  })();
})();
