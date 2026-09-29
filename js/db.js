// IndexedDB を使ったシンプルな保存層。
// stores: 店舗 / visits: 訪問記録 / photos: 写真（Blob）
const DB = (() => {
  const NAME = 'starbucks-log';
  const VERSION = 1;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('stores')) db.createObjectStore('stores', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('visits')) {
          const v = db.createObjectStore('visits', { keyPath: 'id' });
          v.createIndex('storeId', 'storeId');
        }
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(names, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(names, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    getAll: (name) => tx([name], 'readonly', (t) => wrap(t.objectStore(name).getAll())),
    get: (name, id) => tx([name], 'readonly', (t) => wrap(t.objectStore(name).get(id))),
    put: (name, value) => tx([name], 'readwrite', (t) => { t.objectStore(name).put(value); }),
    del: (name, id) => tx([name], 'readwrite', (t) => { t.objectStore(name).delete(id); }),
    putMany: (name, values) => tx([name], 'readwrite', (t) => {
      const s = t.objectStore(name);
      values.forEach((v) => s.put(v));
    }),
    delMany: (name, ids) => tx([name], 'readwrite', (t) => {
      const s = t.objectStore(name);
      ids.forEach((id) => s.delete(id));
    }),
    clearAll: () => tx(['stores', 'visits', 'photos'], 'readwrite', (t) => {
      ['stores', 'visits', 'photos'].forEach((n) => t.objectStore(n).clear());
    }),
  };
})();
