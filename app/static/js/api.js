/* api.js: the only place that talks to the server.
   Every other file calls API.get(...) or API.post(...). */
window.API = (function () {
  'use strict';
  let onUnauthorized = null;
  let onPasswordChange = null;
  let sessionToken = null;

  function setSessionToken(token) {
    sessionToken = token;
  }

  async function request(method, url, body) {
    const isLogin = url === '/auth/login' || url === '/auth/setup';
    const opts = { method: method, headers: { Accept: 'application/json' }, credentials: 'omit' };
    if (sessionToken && !isLogin) opts.headers['X-Tab-Session'] = sessionToken;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      const err = new Error('Cannot reach the server. Check your connection and try again.');
      err.network = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no JSON body */ }
    if (res.ok && data && data.session_token) setSessionToken(data.session_token);
    if (isLogin && !res.ok) setSessionToken(null);
    if (isLogin && res.ok && (!data || typeof data.session_token !== 'string' || !data.session_token)) {
      setSessionToken(null);
      throw new Error('The server did not issue a tab sign-in token. Stop and restart the app server, then refresh this page.');
    }
    if (url === '/auth/logout') setSessionToken(null);
    if (res.status === 401 && url.indexOf('/auth/login') !== 0 && onUnauthorized) onUnauthorized();
    if (res.status === 403 && data && data.code === 'PASSWORD_CHANGE_REQUIRED' && onPasswordChange) onPasswordChange();
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* A unique id for each form submission. If the same submission is sent twice
     (double tap, bad network retry) the server recognises the id and saves only once. */
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  return {
    get: function (url) { return request('GET', url); },
    post: function (url, body) { return request('POST', url, body === undefined ? {} : body); },
    uuid: uuid,
    setUnauthorizedHandler: function (fn) { onUnauthorized = fn; },
    setPasswordChangeHandler: function (fn) { onPasswordChange = fn; }
  };
})();
