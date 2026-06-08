// Platform-aware fetch wrapper: Electron IPC → CapacitorHttp → globalThis.fetch
// Avoids CORS issues by routing through platform-native HTTP clients

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

function electronFetch(url: string, init?: RequestInit): Promise<PlatformResponse> | null {
  const api = (window as any).electronApi?.imageFetch;
  if (!api) return null;
  let body: string | undefined;
  if (init?.body != null) {
    if (typeof init.body === 'string') {
      body = init.body;
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString();
    } else if (typeof init.body === 'object' && 'toString' in init.body) {
      body = String(init.body);
    }
  }
  return api(url, {
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
  try {
    return await noCorsFetch(url, init);
  } catch (err) {
    if (!(err instanceof NoCorsError)) throw err;
  }

  // Web fallback (may have CORS)
  const resp = await fetch(url, init);
  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    headers: Object.fromEntries(resp.headers.entries()),
    blob: () => resp.blob(),
    arrayBuffer: () => resp.arrayBuffer(),
    json: () => resp.json(),
    text: () => resp.text(),
  };
}
