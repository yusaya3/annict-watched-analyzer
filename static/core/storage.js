(function (root) {
  'use strict';

  const DB_NAME = 'AnnictAnalyzerDB_v3';
  const DB_VERSION = 1;
  const LEGACY_DB_NAME = 'AnnictAnalyzerDB';
  const STORES = {
    META: 'meta',
    USER_WATCHES: 'user_watches',
    WORK_GENRES: 'work_genres',
    ASSET_CACHE: 'asset_cache'
  };

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        dbPromise = null;
        return resolve(null);
      }
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          Object.values(STORES).forEach(name => {
            if (!db.objectStoreNames.contains(name)) {
              db.createObjectStore(name);
            }
          });
        };
        req.onblocked = () => {
          dbPromise = null;
          resolve(null);
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          db.onversionchange = () => {
            try { db.close(); } catch (err) {}
            dbPromise = null;
          };
          db.onclose = () => { dbPromise = null; };
          resolve(db);
        };
        req.onerror = () => {
          dbPromise = null;
          resolve(null);
        };
      } catch (e) {
        dbPromise = null;
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function idbGet(storeName, key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function idbPut(storeName, key, value) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function idbDelete(storeName, key) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function idbGetAllEntries(storeName) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.openCursor();
        const result = {};
        let count = 0;
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            result[cursor.key] = cursor.value;
            count++;
            cursor.continue();
          } else {
            resolve(count > 0 ? result : null);
          }
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * 旧DB (v2) が存在する場合のみ1回限り安全に引き継ぐ（空DBを新規作成しない）
   */
  async function migrateLegacyUserWatches() {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    const alreadyDone = await idbGet(STORES.META, 'legacyMigrated');
    if (alreadyDone) return null;

    if (typeof window.indexedDB.databases === 'function') {
      try {
        const dbs = await window.indexedDB.databases();
        if (!dbs.some(d => d.name === LEGACY_DB_NAME)) {
          await idbPut(STORES.META, 'legacyMigrated', true);
          return null;
        }
      } catch (e) {}
    } else {
      // databases() 非対応環境では旧DBを新規生成しないようスキップ
      await idbPut(STORES.META, 'legacyMigrated', true);
      return null;
    }

    return new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(LEGACY_DB_NAME);
        req.onsuccess = async (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('user_watches')) {
            db.close();
            await idbPut(STORES.META, 'legacyMigrated', true);
            return resolve(null);
          }
          try {
            const tx = db.transaction('user_watches', 'readonly');
            const cursorReq = tx.objectStore('user_watches').openCursor();
            const result = {};
            let count = 0;
            cursorReq.onsuccess = async (ev) => {
              const cursor = ev.target.result;
              if (cursor) {
                result[cursor.key] = cursor.value;
                count++;
                cursor.continue();
              } else {
                db.close();
                await idbPut(STORES.META, 'legacyMigrated', true);
                resolve(count > 0 ? result : null);
              }
            };
            cursorReq.onerror = () => { db.close(); resolve(null); };
          } catch (err) {
            db.close();
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  const LS_USERS = 'annict_saved_users_v2';
  const LS_ENABLED = 'annict_enabled_users_v1';
  const LS_COLLAPSED = 'annict_sidebar_collapsed';

  function loadUsersFromLS() {
    try {
      const raw = localStorage.getItem(LS_USERS);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
    } catch (e) { return null; }
  }

  function saveUsersToLS(users) {
    try {
      if (Array.isArray(users)) {
        if (users.length > 0) {
          localStorage.setItem(LS_USERS, JSON.stringify(users));
        } else {
          localStorage.removeItem(LS_USERS);
        }
      }
    } catch (e) {}
  }

  function loadEnabledUsersFromLS() {
    try {
      const raw = localStorage.getItem(LS_ENABLED);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) { return null; }
  }

  function saveEnabledUsersToLS(users) {
    try {
      if (Array.isArray(users)) {
        localStorage.setItem(LS_ENABLED, JSON.stringify(users));
      }
    } catch (e) {}
  }

  root.AppStorage = {
    STORES,
    LS_COLLAPSED,
    saveUserWatched: (username, animes) => idbPut(STORES.USER_WATCHES, String(username).toLowerCase(), animes),
    loadAllUserWatches: () => idbGetAllEntries(STORES.USER_WATCHES),
    deleteUserWatched: (username) => idbDelete(STORES.USER_WATCHES, String(username).toLowerCase()),
    saveWorkGenres: (genreMap) => idbPut(STORES.WORK_GENRES, 'all', genreMap),
    loadWorkGenres: () => idbGet(STORES.WORK_GENRES, 'all'),
    saveAssetCache: (key, data) => idbPut(STORES.ASSET_CACHE, key, data),
    loadAssetCache: (key) => idbGet(STORES.ASSET_CACHE, key),
    saveMeta: (key, val) => idbPut(STORES.META, key, val),
    loadMeta: (key) => idbGet(STORES.META, key),
    migrateLegacyUserWatches,
    loadUsersFromLS,
    saveUsersToLS,
    loadEnabledUsersFromLS,
    saveEnabledUsersToLS
  };
}(window));
