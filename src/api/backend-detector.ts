import type { BackendConfig } from "../stores/backend.store";

export type DetectedBackend = {
  type: "selftify" | "subsonic";
  url: string;
  features?: string[];
};

const SELFTIFY_MARKER = "/api/selftify/capabilities";

export async function detectBackend(url: string, timeoutMs = 4000): Promise<DetectedBackend> {
  const base = url.replace(/\/+$/, "");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(`${base}${SELFTIFY_MARKER}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data = (await resp.json()) as { type?: string; features?: string[] } | null;
      if (data?.type === "selftify") {
        return { type: "selftify", url: base, features: data.features ?? [] };
      }
    }
  } catch {
    /* not a Selftify server — fall through to Subsonic assumption */
  }
  return { type: "subsonic", url: base };
}

export async function verifyConnection(config: BackendConfig): Promise<boolean> {
  const base = config.url.replace(/\/+$/, "");
  try {
    if (config.type === "selftify") {
      const resp = await fetch(`${base}${SELFTIFY_MARKER}`);
      return resp.ok;
    }
    const params = new URLSearchParams({
      u: config.user,
      p: config.password,
      v: "1.16.1",
      c: "selftify-web",
      f: "json",
    });
    const resp = await fetch(`${base}/rest/ping?${params.toString()}`);
    if (!resp.ok) return false;
    const json = (await resp.json()) as
      | { "subsonic-response"?: { status?: string } }
      | null;
    return json?.["subsonic-response"]?.status === "ok";
  } catch {
    return false;
  }
}
