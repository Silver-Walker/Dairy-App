/* Local operational queue and scoped read snapshots for offline use. */
window.DairyOffline = (function () {
  'use strict';
  const DB_NAME = 'dairy-offline';
  const DB_VERSION = 2;
  const PIN_ITERATIONS = 310000;
  const CACHEABLE = [
    '/api/locations', '/api/stock', '/api/production', '/api/dispatches',
    '/api/dispatches/pending', '/api/receipts', '/api/prices', '/api/processing',
    '/api/sales', '/api/losses', '/api/closings', '/api/closings/status'
  ];
  const QUEUEABLE = [
    '/api/production', '/api/dispatches', '/api/receipts', '/api/processing',
    '/api/sales', '/api/losses', '/api/closings'
  ];
  let scope = null;
  let databasePromise = null;

  function openDatabase() {
    if (!window.indexedDB) return Promise.reject(new Error('Offline storage is not available in this browser.'));
    if (!databasePromise) {
      databasePromise = new Promise(function (resolve, reject) {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function () {
          const db = request.result;
          if (!db.objectStoreNames.contains('queue')) {
            const queue = db.createObjectStore('queue', { keyPath: 'id' });
            queue.createIndex('scope', 'scope', { unique: false });
          }
          if (!db.objectStoreNames.contains('snapshots')) {
            db.createObjectStore('snapshots', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('profiles')) {
            const profiles = db.createObjectStore('profiles', { keyPath: 'username' });
            profiles.createIndex('scope', 'scope', { unique: true });
          }
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () {
          databasePromise = null;
          reject(new Error('Could not open offline storage: ' + request.error.message));
        };
        request.onblocked = function () {
          databasePromise = null;
          reject(new Error('Offline storage is blocked by another open app tab. Close older tabs and try again.'));
        };
      });
    }
    return databasePromise;
  }

  function transaction(storeName, mode, action) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try { result = action(store); }
        catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(result && result.result); };
        tx.onerror = tx.onabort = function () {
          reject(new Error('Could not save offline data: ' + (tx.error && tx.error.message || 'storage error')));
        };
      });
    });
  }

  function setScope(value) { scope = value; }
  function getScope() { return scope; }
  function cacheable(url) {
    const path = url.split('?')[0];
    return CACHEABLE.indexOf(path) !== -1;
  }
  function queueable(url) { return QUEUEABLE.indexOf(url) !== -1; }
  function encode(bytes) {
    let binary = '';
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }
  function decode(value) {
    return Uint8Array.from(atob(value), function (character) { return character.charCodeAt(0); });
  }
  async function pinVerifier(pin, salt) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Offline PINs require a secure connection (HTTPS) or localhost.');
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2', salt: salt, iterations: PIN_ITERATIONS, hash: 'SHA-256'
    }, key, 256);
    return new Uint8Array(bits);
  }
  function profileByScope(store, profileScope) {
    return store.index('scope').get(profileScope);
  }

  return {
    setScope: setScope,
    getScope: getScope,
    queueable: queueable,
    saveProfile: function (me, locations) {
      const username = String(me.username || '').toLowerCase();
      const profileScope = String(me.business_id) + ':' + username;
      if (!username) return Promise.reject(new Error('Cannot prepare offline access without a username.'));
      return openDatabase().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction('profiles', 'readwrite');
          const store = tx.objectStore('profiles');
          const request = store.get(username);
          let saved;
          request.onsuccess = function () {
            saved = Object.assign({}, request.result || {}, {
              username: username, scope: profileScope,
              me: me, locations: locations, savedAt: new Date().toISOString()
            });
            store.put(saved);
          };
          request.onerror = function () { reject(new Error('Could not prepare your offline profile.')); };
          tx.oncomplete = function () { resolve(saved); };
          tx.onerror = tx.onabort = function () {
            reject(new Error('Could not save your offline profile: ' + (tx.error && tx.error.message || 'storage error')));
          };
        });
      });
    },
    getProfile: function (username) {
      const key = String(username || '').trim().toLowerCase();
      if (!key) return Promise.resolve(null);
      return transaction('profiles', 'readonly', function (store) { return store.get(key); })
        .then(function (profile) { return profile || null; });
    },
    hasPin: function (profileScope) {
      return openDatabase().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction('profiles', 'readonly');
          const request = profileByScope(tx.objectStore('profiles'), profileScope);
          request.onsuccess = function () { resolve(!!(request.result && request.result.pinSalt && request.result.pinVerifier)); };
          request.onerror = function () { reject(new Error('Could not read the offline PIN status.')); };
        });
      });
    },
    setPin: async function (profileScope, pin) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const verifier = encode(await pinVerifier(pin, salt));
      return openDatabase().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction('profiles', 'readwrite');
          const store = tx.objectStore('profiles');
          const request = profileByScope(store, profileScope);
          request.onsuccess = function () {
            const profile = request.result;
            if (!profile) {
              tx.abort();
              reject(new Error('Sign in online once on this device before setting an offline PIN.'));
              return;
            }
            profile.pinSalt = encode(salt);
            profile.pinVerifier = verifier;
            profile.pinIterations = PIN_ITERATIONS;
            store.put(profile);
          };
          tx.oncomplete = function () { resolve(); };
          tx.onerror = tx.onabort = function () {
            reject(new Error('Could not save the offline PIN: ' + (tx.error && tx.error.message || 'storage error')));
          };
        });
      });
    },
    removePin: function (profileScope) {
      return openDatabase().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction('profiles', 'readwrite');
          const store = tx.objectStore('profiles');
          const request = profileByScope(store, profileScope);
          request.onsuccess = function () {
            if (request.result) {
              delete request.result.pinSalt;
              delete request.result.pinVerifier;
              delete request.result.pinIterations;
              store.put(request.result);
            }
          };
          tx.oncomplete = function () { resolve(); };
          tx.onerror = tx.onabort = function () {
            reject(new Error('Could not remove the offline PIN.'));
          };
        });
      });
    },
    verifyPin: async function (username, pin) {
      const profile = await this.getProfile(username);
      if (!profile || !profile.pinSalt || !profile.pinVerifier ||
          !profile.pinIterations || profile.pinIterations !== PIN_ITERATIONS) return null;
      const actual = await pinVerifier(pin, decode(profile.pinSalt));
      const expected = decode(profile.pinVerifier);
      let difference = actual.length ^ expected.length;
      for (let i = 0; i < Math.min(actual.length, expected.length); i++) difference |= actual[i] ^ expected[i];
      return difference === 0 ? profile : null;
    },
    enqueue: function (record) {
      if (!scope) return Promise.reject(new Error('Sign in before saving an offline entry.'));
      if (!record || !queueable(record.url) || !record.payload ||
          record.id !== record.payload.client_uuid) {
        return Promise.reject(new Error('This entry cannot be saved to the offline queue.'));
      }
      const saved = Object.assign({}, record, { scope: scope });
      return openDatabase().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction('queue', 'readwrite');
          const store = tx.objectStore('queue');
          const existing = store.get(saved.id);
          existing.onsuccess = function () {
            if (existing.result) {
              if (existing.result.scope !== scope) reject(new Error('Offline entry ID collision; entry was not changed.'));
              else resolve(existing.result);
              return;
            }
            store.add(saved);
          };
          existing.onerror = function () { reject(new Error('Could not check the offline queue.')); };
          tx.oncomplete = function () { resolve(saved); };
          tx.onerror = tx.onabort = function () {
            reject(new Error('Could not save offline entry: ' + (tx.error && tx.error.message || 'storage may be full')));
          };
        });
      });
    },
    list: function () {
      if (!scope) return Promise.resolve([]);
      return transaction('queue', 'readonly', function (store) { return store.getAll(); })
        .then(function (rows) {
          return rows.filter(function (row) { return row.scope === scope; })
              .sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
        });
    },
    remove: function (id) {
      return transaction('queue', 'readwrite', function (store) { return store.delete(id); });
    },
    markError: function (id, message) {
      return openDatabase().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction('queue', 'readwrite');
          const store = tx.objectStore('queue');
          const request = store.get(id);
          request.onsuccess = function () {
            if (request.result) {
              request.result.lastError = message;
              store.put(request.result);
            }
          };
          tx.oncomplete = function () { resolve(); };
          tx.onerror = tx.onabort = function () {
            reject(new Error('Could not update the offline entry status.'));
          };
        });
      });
    },
    saveSnapshot: function (url, data) {
      if (!scope || !cacheable(url)) return Promise.resolve();
      const key = scope + '|' + url;
      return transaction('snapshots', 'readwrite', function (store) {
        return store.put({ key: key, data: data, savedAt: new Date().toISOString() });
      });
    },
    readSnapshot: function (url) {
      if (!scope || !cacheable(url)) return Promise.resolve(null);
      const key = scope + '|' + url;
      return transaction('snapshots', 'readonly', function (store) { return store.get(key); })
        .then(function (record) { return record ? record.data : null; });
    }
  };
})();
