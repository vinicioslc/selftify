import { md5Hash, storeImage, clearImageStore } from "./image-store";
import { useSettingsStore } from "../stores/settings.store";
import { useStatusStore } from "../stores/status.store";
import { platformFetch } from "./platform-fetch";

const blobCache = new Map<string, string>();
const inflightFetches = new Map<string, Promise<string | null>>();
const pendingMeta = new Map<string, ImageFetchMeta>();

const requestQueue: Promise<void>[] = [];
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
let lastFetchTime = 0;
let cancelled = false;

let lastCoverArtRequestAt = 0;

const GLOBAL_RATE_LIMIT_MS = 1000;
const COVER_ART_RATE_LIMIT_MS = 1200;

function logImage(level: "info" | "success" | "warn" | "danger", message: string, error?: unknown): void {
  const prefix = `[img] ${message}`;
  if (level === "danger") {
    console.error(prefix, error ?? "");
  } else if (level === "warn") {
    console.warn(prefix, error ?? "");
  } else {
    console.debug(prefix);
  }
  useStatusStore.getState().addMessage(message, level, "Images");
}

function isCoverArtArchiveUrl(url: string): boolean {
  return url.startsWith("https://coverartarchive.org/");
}

async function waitForGlobalRateLimit(): Promise<void> {
  const prev = requestQueue[requestQueue.length - 1] || Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    requestQueue.push(
      prev.then(
        () =>
          new Promise<void>((resolve2) => {
            if (cancelled) { resolve2(); resolve(); return; }
            const elapsed = Date.now() - lastFetchTime;
            const delay = Math.max(0, GLOBAL_RATE_LIMIT_MS - elapsed);
            const timerId = setTimeout(() => {
              pendingTimeouts.delete(timerId);
              if (cancelled) { resolve2(); resolve(); return; }
              lastFetchTime = Date.now();
              resolve2();
              resolve();
            }, delay);
            pendingTimeouts.add(timerId);
          }),
      ),
    );
  });
}

async function waitForCoverArtRateLimit(url: string): Promise<void> {
  if (!isCoverArtArchiveUrl(url)) return;
  const elapsed = Date.now() - lastCoverArtRequestAt;
  const waitMs = Math.max(0, COVER_ART_RATE_LIMIT_MS - elapsed);
  if (waitMs > 0) {
    logImage("info", `Waiting ${waitMs}ms before CoverArtArchive request`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastCoverArtRequestAt = Date.now();
}

export interface ImageFetchMeta {
  artistName?: string;
  albumName?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzReleaseId?: string;
}

export async function tagImageSource(sourceUrl: string, meta: ImageFetchMeta): Promise<void> {
  pendingMeta.set(sourceUrl, meta);
}

export function clearImageQueue(): void {
  inflightFetches.clear();
  pendingMeta.clear();
}

export async function clearImageCaches(): Promise<void> {
  cancelled = true;
  for (const timerId of pendingTimeouts) {
    clearTimeout(timerId);
  }
  pendingTimeouts.clear();
  for (const blobUrl of blobCache.values()) {
    try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
  }
  blobCache.clear();
  inflightFetches.clear();
  pendingMeta.clear();
  requestQueue.length = 0;
  lastFetchTime = 0;
  cancelled = false;
  await clearImageStore();
  logImage("success", "Image cache cleared");
}

export function cacheBlobUrl(url: string, blobUrl: string): void {
  blobCache.set(url, blobUrl);
}

export function getBlobUrlFromCache(url: string): string | undefined {
  return blobCache.get(url);
}

async function doFetch(url: string, init: RequestInit): Promise<string | null> {
  // blob: URLs are already in-memory — return directly
  if (url.startsWith("blob:")) return url;

  try {
    await waitForGlobalRateLimit();
    await waitForCoverArtRateLimit(url);
    const timeoutMs = useSettingsStore.getState().imageFetchTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const initWithSignal = { ...init, signal: controller.signal };
    logImage("info", `Fetching image ${url}`);
    const response = await platformFetch(url, initWithSignal);
    clearTimeout(timeout);
    if (!response.ok) {
      logImage("warn", `Image fetch failed HTTP ${response.status}: ${url}`);
      return null;
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobCache.set(url, blobUrl);
    logImage("success", `Image loaded ${url}`);

    try {
      const buf = await blob.arrayBuffer();
      const hash = await md5Hash(buf);
      const meta = pendingMeta.get(url);
      const record = {
        md5: hash,
        blob: buf,
        format: blob.type || "image/jpeg",
        size: buf.byteLength,
        createdAt: Date.now(),
        sourceUrl: url,
        artistName: meta?.artistName,
        albumName: meta?.albumName,
        mbzArtistId: meta?.mbzArtistId,
        mbzReleaseGroupId: meta?.mbzReleaseGroupId,
        mbzReleaseId: meta?.mbzReleaseId,
      };

      await storeImage(record);
      console.debug(`[img] cached image ${url} (${buf.byteLength} bytes)`);
      if (meta) pendingMeta.delete(url);
    } catch (err) {
      logImage("warn", `Image cache store failed: ${url}`, err);
    }

    return blobUrl;
  } catch (err) {
    logImage("danger", `Image fetch error: ${url}`, err);
    return null;
  }
}

export async function fetchImageAsBlobUrl(
  url: string,
  init: RequestInit = {},
): Promise<string | null> {
  if (!url || !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("blob:")) {
    logImage("warn", `Skipping invalid image URL: "${url}"`);
    return null;
  }

  const cached = blobCache.get(url);
  if (cached) {
    console.debug(`[img] memory cache hit ${url}`);
    return cached;
  }

  const inflight = inflightFetches.get(url);
  if (inflight) {
    console.debug(`[img] joined in-flight fetch ${url}`);
    return inflight;
  }

  const promise = doFetch(url, init);

  inflightFetches.set(url, promise);
  promise.finally(() => inflightFetches.delete(url));

  return promise;
}

export async function fetchCoverArt(
  mbzId: string,
  type: "release" | "release-group" = "release-group",
): Promise<string | null> {
  const url = `https://coverartarchive.org/${type}/${mbzId}/front-250.jpg`;
  logImage("info", `CoverArtArchive ${type} ${mbzId}: ${url}`);
  return fetchImageAsBlobUrl(url);
}

export async function fetchAlbumCover(
  releaseGroupId: string | null | undefined,
  releaseId?: string | null,
  artist?: string | null,
  album?: string | null,
): Promise<string | null> {
  const label = album ? `"${artist} — ${album}"` : `rg=${releaseGroupId} rel=${releaseId}`;
  console.debug(`[img] fetchAlbumCover for ${label}`);

  if (releaseGroupId) {
    logImage("info", `⏩ Trying release-group ${releaseGroupId} for ${label}`);
    const url = await fetchCoverArt(releaseGroupId, "release-group");
    if (url) {
      logImage("success", `✅ Got cover from release-group ${releaseGroupId} for ${label}`);
      return url;
    }
    logImage("info", `⚠ release-group ${releaseGroupId} returned nothing for ${label}`);
  }

  if (releaseId) {
    logImage("info", `⏩ Falling back to release ${releaseId} for ${label}`);
    const url = await fetchCoverArt(releaseId, "release");
    if (url) {
      logImage("success", `✅ Got cover from release ${releaseId} for ${label}`);
      return url;
    }
    logImage("info", `⚠ release ${releaseId} also returned nothing for ${label}`);
  }

  logImage("warn", `❌ No cover found for ${label} (neither release-group nor release)`);
  return null;
}
