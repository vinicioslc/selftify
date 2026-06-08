// Global image cache: Cache API + in-memory blob cache + global rate limiter (1 req/s)
// Inspired by legacy feishin architecture

import { platformFetch, type PlatformResponse } from "./platform-fetch";

const CACHE_NAME = 'selftify-images';

const blobCache = new Map<string, string>();
const pendingFetches = new Map<string, Promise<string>>();

let lastFetchTime = 0;
const requestQueue: Promise<void>[] = [];
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
let cancelled = false;

async function rateLimitedFetch(url: string, init: RequestInit): Promise<{ response: PlatformResponse; blob: Blob }> {
  const prev = requestQueue[requestQueue.length - 1] || Promise.resolve();
  const next = prev.then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (cancelled) { resolve(); return; }
        const elapsed = Date.now() - lastFetchTime;
        const delay = Math.max(0, 1000 - elapsed);
        const timerId = setTimeout(() => {
          pendingTimeouts.delete(timerId);
          if (cancelled) { resolve(); return; }
          lastFetchTime = Date.now();
          resolve();
        }, delay);
        pendingTimeouts.add(timerId);
      }),
  );
  requestQueue.push(next);
  next.finally(() => {
    const idx = requestQueue.indexOf(next);
    if (idx >= 0) requestQueue.splice(idx, 1);
  });
  await next;
  const response = await platformFetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return { response, blob };
}

async function cachedImageFetch(url: string, init: RequestInit): Promise<string> {
  // 1. In-memory cache (fastest)
  const cached = blobCache.get(url);
  if (cached) return cached;

  // 2. Cache API (persists across restarts)
  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(url);
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobCache.set(url, blobUrl);
      return blobUrl;
    }
  } catch {
    // Cache API unavailable — fall through to fetch
  }

  // 3. Dedup concurrent requests
  const pending = pendingFetches.get(url);
  if (pending) return pending;

  const promise = (async () => {
    const { response, blob } = await rateLimitedFetch(url, { ...init, cache: 'force-cache' });

    try {
      const cache = await caches.open(CACHE_NAME);
      cache.put(url, new Response(blob, { headers: response.headers }));
    } catch {
      // Cache API unavailable — proceed without persistence
    }

    const blobUrl = URL.createObjectURL(blob);
    blobCache.set(url, blobUrl);
    return blobUrl;
  })();

  pendingFetches.set(url, promise);
  promise.then(
    () => pendingFetches.delete(url),
    () => pendingFetches.delete(url),
  );
  return promise;
}

export async function fetchImageAsBlobUrl(url: string): Promise<string | null> {
  try {
    return await cachedImageFetch(url, {});
  } catch (err: any) {
    if (err?.message?.startsWith('skip4xx')) {
      const status = err.message.split('|')[1] || '4xx';
      console.warn(`[img] ${status}: ${url}`);
    } else {
      console.error(`[img] fetch failed: ${url}`, err);
    }
    return null;
  }
}

export async function clearImageCaches(): Promise<void> {
  // Cancel all pending operations
  cancelled = true;
  for (const timerId of pendingTimeouts) {
    clearTimeout(timerId);
  }
  pendingTimeouts.clear();
  for (const blobUrl of blobCache.values()) {
    try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
  }
  blobCache.clear();
  pendingFetches.clear();
  requestQueue.length = 0;
  lastFetchTime = 0;
  try {
    await caches.delete(CACHE_NAME);
    console.log('[img] cache cleared');
  } catch (err) {
    console.warn('[img] cache delete failed:', err);
  }
  cancelled = false;
}
