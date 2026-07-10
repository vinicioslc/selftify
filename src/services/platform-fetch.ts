// Simplified platform fetch: thin wrapper around globalThis.fetch
// All platform-specific routing (Electron IPC, Capacitor) removed.

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

export async function platformFetch(url: string, init?: RequestInit): Promise<PlatformResponse> {
  const resp = await fetch(url, init);
  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => { headers[k] = v; });
  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    headers,
    blob: () => resp.blob(),
    arrayBuffer: () => resp.arrayBuffer(),
    json: () => resp.json(),
    text: () => resp.text(),
  };
}
