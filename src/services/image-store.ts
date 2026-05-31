const DB_NAME = "selftify-images-v2";
const DB_VERSION = 2;
const CACHE_VERSION_KEY = "selftify-cache-version";
const CACHE_VERSION = 2;
const STORE = "images";
const INDEX_ARTIST = "by_artist";
const INDEX_ALBUM = "by_album";
const INDEX_MBZ = "by_mbz";
const INDEX_URL = "by_url";
const INDEX_RG = "by_rg";

export type ImageRecord = {
  md5: string;
  blob: ArrayBuffer;
  format: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: number;
  artistName?: string;
  albumName?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzReleaseId?: string;
  sourceUrl?: string;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function md5Hash(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(new Uint8Array(digest));
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "md5" });
        store.createIndex(INDEX_ARTIST, "artistName", { unique: false });
        store.createIndex(INDEX_ALBUM, "albumName", { unique: false });
        store.createIndex(INDEX_MBZ, "mbzArtistId", { unique: false });
        store.createIndex(INDEX_URL, "sourceUrl", { unique: false });
        store.createIndex(INDEX_RG, "mbzReleaseGroupId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getDb(): Promise<IDBDatabase> {
  return openDb();
}

export async function storeImage(record: ImageRecord): Promise<void> {
  const db = await getDb();
  const existing = await new Promise<ImageRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(record.md5);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (existing) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateImageMeta(
  md5: string,
  meta: Partial<Pick<ImageRecord, "artistName" | "albumName" | "mbzArtistId" | "mbzReleaseGroupId" | "mbzReleaseId">>,
): Promise<void> {
  const db = await getDb();
  const existing = await new Promise<ImageRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(md5);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!existing) return;
  const updated: ImageRecord = { ...existing, ...meta };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getImageByMd5(hash: string): Promise<ImageRecord | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(hash);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function getImageBySourceUrl(url: string): Promise<ImageRecord | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index(INDEX_URL);
    const req = index.get(url);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function getImageByArtist(artistName: string): Promise<ImageRecord | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index(INDEX_ARTIST);
    const req = index.get(artistName);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function findImages(
  query: Partial<Pick<ImageRecord, "artistName" | "albumName" | "mbzArtistId" | "mbzReleaseGroupId" | "mbzReleaseId">>,
): Promise<ImageRecord[]> {
  const db = await getDb();
  const results: ImageRecord[] = [];
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);

  return new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const record = cursor.value as ImageRecord;
        let match = true;
        for (const [key, val] of Object.entries(query)) {
          if (record[key as keyof ImageRecord] !== val) {
            match = false;
            break;
          }
        }
        if (match) results.push(record);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function recordToBlobUrl(record: ImageRecord): Promise<string> {
  const blob = new Blob([record.blob], { type: record.format });
  return URL.createObjectURL(blob);
}

export async function getBlobUrlByMd5(hash: string): Promise<string | null> {
  const record = await getImageByMd5(hash);
  if (!record) return null;
  return recordToBlobUrl(record);
}

export async function clearImageStore(): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function checkCacheVersion(): Promise<void> {
  const stored = localStorage.getItem(CACHE_VERSION_KEY);
  if (stored !== String(CACHE_VERSION)) {
    try {
      await clearImageStore();
    } catch {
      // storage unavailable
    }
    localStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION));
  }
}
