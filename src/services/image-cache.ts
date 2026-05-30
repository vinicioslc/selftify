const DB_NAME = "ytmusic-images";
const DB_VERSION = 1;
const STORE_IMAGES = "images";
const STORE_TAGS = "tags";
const TAG_INDEX = "by_tag";
const HASH_INDEX = "by_hash";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const blobUrlCache = new Map<string, string>();

type StoredImage = {
  hash: string;
  blob: ArrayBuffer;
  format: string;
  size: number;
  created_at: number;
};

type ImageTagRow = {
  id?: number;
  hash: string;
  tag: string;
};

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: "hash" });
      }

      if (!db.objectStoreNames.contains(STORE_TAGS)) {
        const tagStore = db.createObjectStore(STORE_TAGS, {
          keyPath: "id",
          autoIncrement: true,
        });
        tagStore.createIndex(TAG_INDEX, "tag", { unique: false });
        tagStore.createIndex(HASH_INDEX, "hash", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getDb(): Promise<IDBDatabase> {
  return openDb();
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const hexParts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    hexParts.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return hexParts.join("");
}

export async function getHash(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large: ${buffer.byteLength} bytes (max ${MAX_IMAGE_BYTES})`
    );
  }

  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return arrayBufferToHex(digest);
}

export async function storeImage(
  blob: Blob,
  format: string,
  tags: string[]
): Promise<string> {
  const db = await getDb();

  const buffer = await blob.arrayBuffer();
  const hash = await getHash(blob);

  const existing = await new Promise<StoredImage | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, "readonly");
    const store = tx.objectStore(STORE_IMAGES);
    const req = store.get(hash);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!existing) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_IMAGES, "readwrite");
      const store = tx.objectStore(STORE_IMAGES);
      const req = store.put({
        hash,
        blob: buffer,
        format,
        size: buffer.byteLength,
        created_at: Date.now(),
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  for (const tag of tags) {
    const normalizedTag = tag.toLowerCase().trim();
    if (!normalizedTag) continue;

    const existingTag = await new Promise<ImageTagRow | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_TAGS, "readonly");
        const store = tx.objectStore(STORE_TAGS);
        const index = store.index(HASH_INDEX);
        const req = index.openCursor(hash);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(undefined);
          const row = cursor.value as ImageTagRow;
          if (row.tag === normalizedTag) {
            resolve(row);
          } else {
            cursor.continue();
          }
        };
        req.onerror = () => reject(req.error);
      }
    );

    if (!existingTag) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_TAGS, "readwrite");
        const store = tx.objectStore(STORE_TAGS);
        const req = store.add({ hash, tag: normalizedTag });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }

  return hash;
}

function blobUrlFromArrayBuffer(buffer: ArrayBuffer, hash: string, format: string): string {
  const cached = blobUrlCache.get(hash);
  if (cached) return cached;

  const blob = new Blob([buffer], { type: format });
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(hash, url);
  return url;
}

export async function getImageUrlByTag(tag: string): Promise<string | null> {
  const db = await getDb();
  const normalizedTag = tag.toLowerCase().trim();

  const tagRow = await new Promise<ImageTagRow | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_TAGS, "readonly");
    const store = tx.objectStore(STORE_TAGS);
    const index = store.index(TAG_INDEX);
    const req = index.get(normalizedTag);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!tagRow) return null;

  const image = await new Promise<StoredImage | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, "readonly");
    const store = tx.objectStore(STORE_IMAGES);
    const req = store.get(tagRow.hash);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!image) return null;

  return blobUrlFromArrayBuffer(image.blob, image.hash, image.format);
}

export async function getImageUrlsByTagPrefix(
  prefix: string
): Promise<string[]> {
  const db = await getDb();
  const normalizedPrefix = prefix.toLowerCase().trim();

  const rows = await new Promise<ImageTagRow[]>((resolve, reject) => {
    const tx = db.transaction(STORE_TAGS, "readonly");
    const store = tx.objectStore(STORE_TAGS);
    const index = store.index(TAG_INDEX);
    const range = IDBKeyRange.bound(
      normalizedPrefix,
      normalizedPrefix + "\uffff"
    );
    const results: ImageTagRow[] = [];
    const req = index.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });

  const seenHashes = new Set<string>();
  const urls: string[] = [];

  for (const row of rows) {
    if (seenHashes.has(row.hash)) continue;
    seenHashes.add(row.hash);

    const image = await new Promise<StoredImage | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_IMAGES, "readonly");
        const store = tx.objectStore(STORE_IMAGES);
        const req = store.get(row.hash);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }
    );

    if (image) {
      urls.push(blobUrlFromArrayBuffer(image.blob, image.hash, image.format));
    }
  }

  return urls;
}

export async function clear(): Promise<void> {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();

  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_TAGS], "readwrite");
    tx.objectStore(STORE_IMAGES).clear();
    tx.objectStore(STORE_TAGS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeTagsForPath(path: string): Promise<void> {
  const db = await getDb();
  const songId = path.replace(/[^a-zA-Z0-9]/g, "_");

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TAGS, "readwrite");
    const store = tx.objectStore(STORE_TAGS);
    const index = store.index(TAG_INDEX);
    const getReq = index.getAll(`song/${songId.toLowerCase()}`);
    getReq.onsuccess = () => {
      const rows = getReq.result;
      for (const row of rows) {
        store.delete(row.id!);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
