import { md5Hash } from "./image-store";
import {
  electronStoreImage,
  electronGetImageBySourceUrl,
  electronRecordToBlobUrl,
  electronUpdateImageMeta,
  isElectronImageStore,
} from "./electron-image-store";
import { getImageBySourceUrl as indexDbGetByUrl, storeImage as indexDbStore } from "./image-store";
import { useSettingsStore } from "../stores/settings.store";

let lastFetchTime = 0;
let active = 0;
let processing = false;

const requestQueue: Array<{
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
  url: string;
  init: RequestInit;
}> = [];

const inMemoryCache = new Map<string, string>();
const inflightFetches = new Map<string, Promise<string | null>>();
const pendingMeta = new Map<string, ImageFetchMeta>();

let isElectron: boolean | null = null;

async function getIsElectron(): Promise<boolean> {
  if (isElectron === null) {
    isElectron = await isElectronImageStore();
  }
  return isElectron;
}

async function processQueue() {
  if (processing) return;
  processing = true;
  const { imageFetchRateLimitMs, imageFetchMaxConcurrent } = useSettingsStore.getState();
  while (requestQueue.length > 0 && active < imageFetchMaxConcurrent) {
    const elapsed = Date.now() - lastFetchTime;
    if (imageFetchRateLimitMs > 0 && elapsed < imageFetchRateLimitMs) {
      await new Promise((r) => setTimeout(r, imageFetchRateLimitMs - elapsed));
    }
    const item = requestQueue.shift()!;
    active++;
    lastFetchTime = Date.now();
    fetchItem(item);
  }
  processing = false;
}

async function fetchItem(item: {
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
  url: string;
  init: RequestInit;
}) {
  try {
    const timeoutMs = useSettingsStore.getState().imageFetchTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const initWithSignal = { ...item.init, signal: controller.signal };
    const response = await fetch(item.url, initWithSignal);
    clearTimeout(timeout);
    if (!response.ok) {
      item.reject(new Error(`HTTP ${response.status}`));
      return;
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    inMemoryCache.set(item.url, blobUrl);

    try {
      const buf = await blob.arrayBuffer();
      const hash = await md5Hash(buf);
      const meta = pendingMeta.get(item.url);
      const record = {
        md5: hash,
        blob: buf,
        format: blob.type || "image/jpeg",
        size: buf.byteLength,
        createdAt: Date.now(),
        sourceUrl: item.url,
        artistName: meta?.artistName,
        albumName: meta?.albumName,
        mbzArtistId: meta?.mbzArtistId,
        mbzReleaseGroupId: meta?.mbzReleaseGroupId,
        mbzReleaseId: meta?.mbzReleaseId,
      };

      if (await getIsElectron()) {
        await electronStoreImage(record);
      } else {
        await indexDbStore(record);
      }
      if (meta) pendingMeta.delete(item.url);
    } catch {
      // non-critical
    }

    item.resolve(blobUrl);
  } catch (err) {
    item.reject(err);
  } finally {
    active--;
    processQueue();
  }
}

function enqueueFetch(url: string, init: RequestInit = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    requestQueue.push({ resolve, reject, url, init });
    processQueue();
  });
}

export interface ImageFetchMeta {
  artistName?: string;
  albumName?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzReleaseId?: string;
}

export async function tagImageSource(sourceUrl: string, meta: ImageFetchMeta): Promise<void> {
  // Try to tag existing record
  try {
    let record;
    if (await getIsElectron()) {
      record = await electronGetImageBySourceUrl(sourceUrl);
    } else {
      record = await indexDbGetByUrl(sourceUrl);
    }
    if (record) {
      if (await getIsElectron()) {
        await electronUpdateImageMeta(record.md5, meta);
      } else {
        const { updateImageMeta } = await import("./image-store");
        await updateImageMeta(record.md5, meta);
      }
      return;
    }
  } catch {
    // non-critical
  }
  // Not stored yet — queue it; fetchItem will apply when blob is saved
  pendingMeta.set(sourceUrl, meta);
}

export function clearImageQueue(): void {
  for (const item of requestQueue.splice(0)) {
    item.reject(new Error("Queue cleared"));
  }
  inMemoryCache.clear();
  inflightFetches.clear();
  pendingMeta.clear();
  active = 0;
  processing = false;
}

export async function fetchImageAsBlobUrl(
  url: string,
  init: RequestInit = {},
): Promise<string | null> {
  const cached = inMemoryCache.get(url);
  if (cached) return cached;

  try {
    let existing;
    if (await getIsElectron()) {
      existing = await electronGetImageBySourceUrl(url);
    } else {
      existing = await indexDbGetByUrl(url);
    }
    if (existing) {
      const blobUrl = await electronRecordToBlobUrl(existing);
      inMemoryCache.set(url, blobUrl);
      return blobUrl;
    }
  } catch {
    // store unavailable
  }

  const inflight = inflightFetches.get(url);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      return await enqueueFetch(url, init);
    } catch {
      return null;
    }
  })();

  inflightFetches.set(url, promise);
  promise.finally(() => inflightFetches.delete(url));

  return promise;
}

export async function fetchCoverArt(
  mbzId: string,
  type: "release" | "release-group" = "release-group",
): Promise<string | null> {
  const url = `https://coverartarchive.org/${type}/${mbzId}/front-250.jpg`;
  return fetchImageAsBlobUrl(url);
}
