import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchImageAsBlobUrl, clearImageCaches, fetchCoverArt, fetchAlbumCover } from "../image-fetch";

const blobUrlMap = new Map<string, string>();
let blobCounter = 0;

function mockBlobUrl(obj: Blob | MediaSource): string {
  const url = `blob:mock-${blobCounter++}`;
  if (obj instanceof Blob) blobUrlMap.set(url, obj.type);
  return url;
}

beforeEach(async () => {
  blobCounter = 0;
  blobUrlMap.clear();

  vi.spyOn(URL, "createObjectURL").mockImplementation(mockBlobUrl);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    blobUrlMap.delete(url);
  });
});

afterEach(async () => {
  await clearImageCaches();
  vi.restoreAllMocks();
  await new Promise((r) => setTimeout(r, 0));
});

describe("fetchImageAsBlobUrl", () => {
  it("returns null on HTTP 502 (gateway error simulates network failure)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 502 }),
    );

    const result = await fetchImageAsBlobUrl("https://coverartarchive.org/release-group/abc-123/front-120.jpg");

    expect(result).toBeNull();
  });

  it("returns null on HTTP 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404, statusText: "Not Found" }),
    );

    const result = await fetchImageAsBlobUrl("https://coverartarchive.org/release-group/abc-123/front-120.jpg");

    expect(result).toBeNull();
  });

  it("returns null on HTTP 403 (server refuses)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403, statusText: "Forbidden" }),
    );

    const result = await fetchImageAsBlobUrl("https://coverartarchive.org/release-group/abc-123/front-120.jpg");

    expect(result).toBeNull();
  });

  it("returns a blob URL on successful fetch", async () => {
    const fakeBlob = new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(fakeBlob, { status: 200, headers: { "Content-Type": "image/jpeg" } }),
    );

    const result = await fetchImageAsBlobUrl("https://coverartarchive.org/release-group/abc-123/front-120.jpg");

    expect(result).toMatch(/^blob:/);
  });

  it("deduplicates concurrent requests for the same URL", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(new Blob(["data"], { type: "image/jpeg" }), { status: 200 });
    });

    const [r1, r2, r3] = await Promise.all([
      fetchImageAsBlobUrl("https://example.com/dupe.jpg"),
      fetchImageAsBlobUrl("https://example.com/dupe.jpg"),
      fetchImageAsBlobUrl("https://example.com/dupe.jpg"),
    ]);

    expect(r1).toMatch(/^blob:/);
    expect(r2).toMatch(/^blob:/);
    expect(r3).toMatch(/^blob:/);
    expect(callCount).toBe(1);
  });

  it("returns in-memory cached result on second call", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(new Blob(["data"], { type: "image/jpeg" }), { status: 200 });
    });

    const r1 = await fetchImageAsBlobUrl("https://example.com/cached.jpg");
    const r2 = await fetchImageAsBlobUrl("https://example.com/cached.jpg");

    expect(r1).toMatch(/^blob:/);
    expect(r2).toBe(r1);
    expect(callCount).toBe(1);
  });

  it("recovers after a failed fetch and fetches again", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }));
    const r1 = await fetchImageAsBlobUrl("https://example.com/retry.jpg");
    expect(r1).toBeNull();

    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(["data"], { type: "image/jpeg" }), { status: 200 }),
    );
    const r2 = await fetchImageAsBlobUrl("https://example.com/retry.jpg");

    expect(r2).toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchCoverArt", () => {
  it("constructs release-group URL and returns blob URL on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["img"], { type: "image/jpeg" }), { status: 200 }),
    );

    const result = await fetchCoverArt("rg-abc-123", "release-group");

    expect(result).toMatch(/^blob:/);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://coverartarchive.org/release-group/rg-abc-123/front-250.jpg",
      expect.objectContaining({ cache: "force-cache" }),
    );
  });

  it("constructs release URL when type is release", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["img"], { type: "image/jpeg" }), { status: 200 }),
    );

    const result = await fetchCoverArt("rel-xyz-789", "release");

    expect(result).toMatch(/^blob:/);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://coverartarchive.org/release/rel-xyz-789/front-250.jpg",
      expect.objectContaining({ cache: "force-cache" }),
    );
  });

  it("returns null when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );

    const result = await fetchCoverArt("missing-id");

    expect(result).toBeNull();
  });
});

describe("fetchAlbumCover", () => {
  it("tries release-group first, returns on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["rg-img"], { type: "image/jpeg" }), { status: 200 }),
    );

    const result = await fetchAlbumCover("rg-111", "rel-222");

    expect(result).toMatch(/^blob:/);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://coverartarchive.org/release-group/rg-111/front-250.jpg",
      expect.anything(),
    );
  });

  it("falls back to release when release-group returns 404", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(new Blob(["rel-img"], { type: "image/jpeg" }), { status: 200 }),
      );

    const result = await fetchAlbumCover("rg-111", "rel-222");

    expect(result).toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://coverartarchive.org/release/rel-222/front-250.jpg",
      expect.anything(),
    );
  });

  it("returns null when both release-group and release fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );

    const result = await fetchAlbumCover("rg-111", "rel-222");

    expect(result).toBeNull();
  });

  it("returns null when releaseGroupId is null and no releaseId", async () => {
    const result = await fetchAlbumCover(null, null);

    expect(result).toBeNull();
  });

  it("tries only release when releaseGroupId is null", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["rel-img"], { type: "image/jpeg" }), { status: 200 }),
    );

    const result = await fetchAlbumCover(null, "rel-333");

    expect(result).toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://coverartarchive.org/release/rel-333/front-250.jpg",
      expect.anything(),
    );
  });
});
