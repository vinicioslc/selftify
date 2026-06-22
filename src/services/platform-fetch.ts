// Platform-aware fetch wrapper: Electron IPC → CapacitorHttp → globalThis.fetch
// Avoids CORS issues by routing through platform-native HTTP clients
//
// All responses are cached in SQLite (request_cache table) with a 30-minute TTL.
// Cache key = base64(method|url|bodyHash). Only 2xx responses are cached.
// If the database isn't ready, caching is skipped silently.

import {
  getCachedRequest,
  setCachedRequest,
} from "./db/repositories/request-cache-repo";

export type PlatformResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<any>;
  text(): Promise<string>;
};

function responseFromBody(
  status: number,
  headers: Record<string, string>,
  data: Uint8Array,
): PlatformResponse {
  const ok = status >= 200 && status < 300;
  const blob = new Blob([data as unknown as Blob], { type: headers["content-type"] || "application/octet-stream" });
  return {
    ok,
    status,
    statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "",
    headers,
    blob: () => Promise.resolve(blob),
    arrayBuffer: () => Promise.resolve(data.buffer as ArrayBuffer),
    json: () => {
      const text = new TextDecoder().decode(data);
      return Promise.resolve(JSON.parse(text));
    },
    text: () => Promise.resolve(new TextDecoder().decode(data)),
  };
}

// ── Cache helpers ────────────────────────────────────────────────

function serializeBody(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return Array.from(body).join(",");
  if (body instanceof Blob) return "[blob]";
  if (typeof body === "object" && "toString" in body) return String(body);
  return "";
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function computeCacheKey(method: string, url: string, body?: unknown): string {
  const bodyStr = serializeBody(body);
  const bodyHash = bodyStr ? simpleHash(bodyStr) : "";
  const raw = `${method}|${url}|${bodyHash}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Fetch backends ──────────────────────────────────────────────

function electronFetch(url: string, init?: RequestInit): Promise<PlatformResponse> | null {
  const api = (window as any).electronApi;
  if (!api) return null;
  let body: string | number[] | undefined;
  if (init?.body != null) {
    if (typeof init.body === 'string') {
      body = init.body;
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString();
    } else if (init.body instanceof Uint8Array) {
      body = Array.from(init.body);
    } else if (typeof init.body === 'object' && 'toString' in init.body) {
      body = String(init.body);
    }
  }
  const pf = api.platformFetch || api.imageFetch;
  if (!pf) return null;
  return pf(url, {
    method: init?.method || "GET",
    headers: init?.headers as Record<string, string> | undefined,
    body,
  }).then((resp: { status: number; headers: Record<string, string>; body: number[] }) => {
    return responseFromBody(resp.status, resp.headers, new Uint8Array(resp.body));
  });
}

async function capacitorFetch(url: string, init?: RequestInit): Promise<PlatformResponse> {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) throw new Error("not native");

  const { CapacitorHttp } = await import("@capacitor/core");
  const resp = await CapacitorHttp.request({
    url,
    method: (init?.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH") || "GET",
    headers: (init?.headers as Record<string, string>) || {},
    responseType: "arraybuffer",
  });

  // CapacitorHttp returns data as base64 string when responseType is arraybuffer (Android) or
  // as a string (iOS/web). Convert to Uint8Array.
  const dataStr = typeof resp.data === "string" ? resp.data : "";
  const binaryStr = atob(dataStr);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  return responseFromBody(resp.status || 200, (resp.headers as Record<string, string>) || {}, bytes);
}

class NoCorsError extends Error {
  constructor() {
    super("no-cors-fetch: no platform-native HTTP client available (Electron IPC or Capacitor)");
    this.name = "NoCorsError";
  }
}

export async function noCorsFetch(url: string, init?: RequestInit): Promise<PlatformResponse> {
  const electronResp = electronFetch(url, init);
  if (electronResp) return electronResp;

  try {
    return await capacitorFetch(url, init);
  } catch {
    throw new NoCorsError();
  }
}

export async function platformFetch(url: string, init?: RequestInit): Promise<PlatformResponse> {
  const method = init?.method || "GET";
  const cacheKey = computeCacheKey(method, url, init?.body);

  // 1. Try cache
  try {
    const cached = getCachedRequest(cacheKey);
    if (cached) {
      console.debug(`[Selftify] cache HIT ${method} ${url.slice(0, 120)}`);
      return responseFromBody(cached.status, cached.headers, cached.body);
    }
  } catch {
    // DB not ready — skip cache
  }

  // 2. Perform the actual fetch
  let rawStatus: number;
  let rawStatusText: string;
  let rawHeaders: Record<string, string>;
  let rawBody: Uint8Array;

  try {
    const pfResp = await noCorsFetch(url, init);
    rawStatus = pfResp.status;
    rawStatusText = pfResp.statusText;
    rawHeaders = pfResp.headers;
    rawBody = new Uint8Array(await pfResp.arrayBuffer());
  } catch (err) {
    if (!(err instanceof NoCorsError)) throw err;

    // Web fallback (may have CORS)
    const webResp = await fetch(url, init);
    rawStatus = webResp.status;
    rawStatusText = webResp.statusText;
    rawHeaders = Object.fromEntries(webResp.headers.entries());
    rawBody = new Uint8Array(await webResp.arrayBuffer());
  }

  // 3. Cache if successful
  if (rawStatus >= 200 && rawStatus < 300) {
    try {
      setCachedRequest(cacheKey, url, method, rawStatus, rawHeaders, rawBody);
      console.debug(`[Selftify] cache SET ${method} ${url.slice(0, 120)}`);
    } catch {
      // DB not ready — skip cache silently
    }
  }

  // 4. Return response
  return responseFromBody(rawStatus, rawHeaders, rawBody);
}
