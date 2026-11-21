/* =========================================================================
 * OFFLINE STORAGE MANAGER (IndexedDB: Outbox Queue + Feature Layer Cache)
 * ========================================================================= */

(function (global) {
  const DB_NAME = "field_app_offline_v1";
  const DB_VERSION = 1;
  const STORE_OUTBOX = "outbox";
  const STORE_CACHE = "layerCache";

  let dbPromise = null;

  function isSupported() {
    return typeof indexedDB !== "undefined";
  }

  function openDb() {
    if (!isSupported()) {
      return Promise.reject(new Error("IndexedDB is not supported in this browser."));
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          const outboxStore = db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
          outboxStore.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE, { keyPath: "key" });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error("Failed to open IndexedDB."));
      };
    });

    return dbPromise;
  }

  function runTx(storeName, mode, callback) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          let result;

          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
          tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));

          try {
            const maybeReq = callback(store, (val) => {
              result = val;
            });
            if (maybeReq && typeof maybeReq.onsuccess !== "undefined") {
              maybeReq.onsuccess = (e) => {
                result = e.target.result;
              };
            }
          } catch (err) {
            reject(err);
          }
        })
    );
  }

  function makeOutboxId(layerUrl, objectId) {
    const cleanLayer = String(layerUrl || "default").replace(/\/+$/, "").toLowerCase();
    return `${cleanLayer}::${objectId}`;
  }

  async function serializePhotos(photos) {
    if (!Array.isArray(photos) || photos.length === 0) return [];
    const serialized = [];
    for (const p of photos) {
      if (p.buffer instanceof ArrayBuffer) {
        serialized.push({
          filename: p.filename || "field_photo.jpg",
          type: p.type || "image/jpeg",
          size: p.size || p.buffer.byteLength,
          buffer: p.buffer
        });
      } else if (p.blob) {
        const buffer = await p.blob.arrayBuffer();
        serialized.push({
          filename: p.filename || "field_photo.jpg",
          type: p.blob.type || "image/jpeg",
          size: p.size || buffer.byteLength,
          buffer
        });
      }
    }
    return serialized;
  }

  async function saveOrMergeOutboxItem(itemInput) {
    const id = itemInput.id || makeOutboxId(itemInput.layerUrl, itemInput.objectId);
    const existing = await getOutboxItem(id).catch(() => null);
    const newSerializedPhotos = await serializePhotos(itemInput.photos || []);

    const existingDeletes = Array.isArray(existing?.deleteAttachmentIds)
      ? existing.deleteAttachmentIds
      : [];
    const incomingDeletes = Array.isArray(itemInput.deleteAttachmentIds)
      ? itemInput.deleteAttachmentIds
      : [];
    const mergedDeletes = itemInput.replaceDeletes
      ? Array.from(new Set(incomingDeletes))
      : Array.from(new Set([...existingDeletes, ...incomingDeletes]));

    const combinedPhotos = itemInput.replacePhotos
      ? newSerializedPhotos
      : [...(existing?.photos || []), ...newSerializedPhotos];

    const record = {
      id,
      mode: itemInput.mode || existing?.mode || "handover",
      objectId: itemInput.objectId,
      layerUrl: itemInput.layerUrl || "",
      orderVal: itemInput.orderVal ?? "--",
      pointCode: itemInput.pointCode || "",
      district: itemInput.district || "",
      streetName: itemInput.streetName || "",
      attributes: { ...(existing?.attributes || {}), ...(itemInput.attributes || {}) },
      photos: combinedPhotos,
      deleteAttachmentIds: mergedDeletes,
      skipAttributeEdit: Boolean(existing?.skipAttributeEdit && itemInput.skipAttributeEdit),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      status: "pending",
      lastError: ""
    };

    if (itemInput.skipAttributeEdit && !existing) {
      record.skipAttributeEdit = true;
    }

    await runTx(STORE_OUTBOX, "readwrite", (store) => store.put(record));
    return record;
  }

  async function putOutboxItem(record) {
    await runTx(STORE_OUTBOX, "readwrite", (store) => store.put(record));
    return record;
  }

  async function getOutboxItem(id) {
    if (!isSupported()) return null;
    return runTx(STORE_OUTBOX, "readonly", (store) => store.get(id));
  }

  async function getAllOutbox() {
    if (!isSupported()) return [];
    const items = await runTx(STORE_OUTBOX, "readonly", (store) => store.getAll());
    return (items || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async function deleteOutboxItem(id) {
    if (!isSupported()) return;
    await runTx(STORE_OUTBOX, "readwrite", (store) => store.delete(id));
  }

  async function saveLayerCache(key, data) {
    if (!isSupported()) return;
    await runTx(STORE_CACHE, "readwrite", (store) =>
      store.put({ key, updatedAt: Date.now(), ...data })
    );
  }

  async function getLayerCache(key) {
    if (!isSupported()) return null;
    return runTx(STORE_CACHE, "readonly", (store) => store.get(key));
  }

  async function deleteLayerCache(key) {
    if (!isSupported()) return;
    await runTx(STORE_CACHE, "readwrite", (store) => store.delete(key));
  }

  global.FieldOfflineDB = {
    isSupported,
    makeOutboxId,
    saveOrMergeOutboxItem,
    putOutboxItem,
    getOutboxItem,
    getAllOutbox,
    deleteOutboxItem,
    saveLayerCache,
    getLayerCache,
    deleteLayerCache
  };
})(window);
