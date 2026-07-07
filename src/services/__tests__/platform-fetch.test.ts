import { describe, it, expect, vi } from "vitest";
import { platformFetch } from "../platform-fetch";
import { fetchImageAsBlobUrl } from "../image-fetch";

describe("platformFetch with blob: and data: URLs", () => {
  it("fetches blob: URLs directly via native fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("blob-data", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await platformFetch("blob:http://localhost/test/abc123");

    expect(globalThis.fetch).toHaveBeenCalledWith("blob:http://localhost/test/abc123", undefined);
    expect(result.ok).toBe(true);
    expect(await result.text()).toBe("blob-data");
  });

  it("fetches data: URLs directly via native fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data-content", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await platformFetch("data:text/plain;base64,SGVsbG8=");

    expect(globalThis.fetch).toHaveBeenCalledWith("data:text/plain;base64,SGVsbG8=", undefined);
    expect(result.ok).toBe(true);
    expect(await result.text()).toBe("data-content");
  });

  it("passes through init options for blob URLs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    await platformFetch("blob:http://localhost/test", {
      method: "POST",
      headers: { "X-Custom": "value" },
      body: "payload",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "blob:http://localhost/test",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Custom": "value" },
        body: "payload",
      }),
    );
  });

  it("returns non-200 status for a failing blob URL fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404, statusText: "Not Found" }),
    );

    const result = await platformFetch("blob:http://localhost/test/missing");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("skips electronApi for blob URLs even when electronApi exists", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("direct", { status: 200 }),
    );

    (globalThis as any).electronApi = {
      platformFetch: vi.fn().mockResolvedValue({ status: 200, headers: {}, body: [1, 2, 3] }),
    };

    await platformFetch("blob:http://localhost/test/skip-ipc");

    expect(fetchSpy).toHaveBeenCalledWith("blob:http://localhost/test/skip-ipc", undefined);
    expect((globalThis as any).electronApi.platformFetch).not.toHaveBeenCalled();

    delete (globalThis as any).electronApi;
  });
});

describe("image-fetch doFetch guard for blob URLs", () => {
  it("returns blob URL directly without network call", async () => {
    const blobUrl = "blob:http://localhost/test/short-circuit";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("should not be called", { status: 200 }),
    );

    const result = await fetchImageAsBlobUrl(blobUrl);

    expect(result).toBe(blobUrl);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
