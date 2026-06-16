import type { PlatformResponse } from "../../platform-fetch";

export function mockJsonResponse(data: unknown): PlatformResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    blob: () => Promise.resolve(new Blob()),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

export function mockErrorResponse(status: number): PlatformResponse {
  return {
    ok: false,
    status,
    statusText: status === 404 ? "Not Found" : "Error",
    headers: {},
    json: () => Promise.reject(new Error(`HTTP ${status}`)),
    text: () => Promise.resolve(""),
    blob: () => Promise.resolve(new Blob()),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}
