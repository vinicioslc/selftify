import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MbzYtMapping, SearchResults } from "../backend-state";

// Track all fetch calls
const fetchCalls: { url: string; options?: RequestInit }[] = [];

const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
  fetchCalls.push({ url, options });
  return {
    ok: true,
    json: async () => ({}),
  } as Response;
});
vi.stubGlobal("fetch", mockFetch);

// Must import after fetch is mocked
const bs = await import("../backend-state");

function lastFetch(): { url: string; options?: RequestInit } | undefined {
  return fetchCalls[fetchCalls.length - 1];
}

describe("backend-state.ts — all data goes to backend via HTTP", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
  });

  it("getMbzYtMapping calls GET /api/mbz/mapping", async () => {
    await bs.getMbzYtMapping("mbz-123");
    expect(lastFetch()?.url).toContain("/api/mbz/mapping?recordingId=mbz-123");
  });

  it("setMbzYtMapping calls PUT /api/mbz/mapping with body", async () => {
    const mapping: MbzYtMapping = {
      mbzRecordingId: "mbz-123",
      songName: "Test",
      artistName: "Artist",
      candidates: [],
      createdAt: 0,
      updatedAt: 0,
    };
    await bs.setMbzYtMapping(mapping);
    const call = lastFetch()!;
    expect(call.url).toContain("/api/mbz/mapping");
    expect(call.options?.method).toBe("PUT");
    expect(call.options?.body).toBe(JSON.stringify(mapping));
  });

  it("deleteMbzYtMapping calls DELETE /api/mbz/mapping", async () => {
    await bs.deleteMbzYtMapping("mbz-123");
    const call = lastFetch()!;
    expect(call.url).toContain("/api/mbz/mapping?recordingId=mbz-123");
    expect(call.options?.method).toBe("DELETE");
  });

  it("getAllMbzYtMappings calls GET /api/mbz/mapping/all", async () => {
    await bs.getAllMbzYtMappings();
    expect(lastFetch()?.url).toContain("/api/mbz/mapping/all");
  });

  it("clearAllMbzYtMappings calls DELETE /api/mbz/mapping/all", async () => {
    await bs.clearAllMbzYtMappings();
    const call = lastFetch()!;
    expect(call.url).toContain("/api/mbz/mapping/all");
    expect(call.options?.method).toBe("DELETE");
  });

  it("recordRanking calls POST /api/ranking/log", async () => {
    await bs.recordRanking({
      query: "test",
      winnerId: "vid1",
      winnerTitle: "Title",
      winnerUploader: "Uploader",
      score: 0.9,
      scores: "{}",
      candidates: 5,
    });
    const call = lastFetch()!;
    expect(call.url).toContain("/api/ranking/log");
    expect(call.options?.method).toBe("POST");
  });

  it("getRecentRankings calls GET /api/ranking/log", async () => {
    await bs.getRecentRankings(10);
    expect(lastFetch()?.url).toContain("/api/ranking/log?limit=10");
  });

  it("clearRankingLog calls DELETE /api/ranking/log", async () => {
    await bs.clearRankingLog();
    const call = lastFetch()!;
    expect(call.url).toContain("/api/ranking/log");
    expect(call.options?.method).toBe("DELETE");
  });

  it("getSearchCache calls GET /api/cache/search", async () => {
    await bs.getSearchCache("musicbrainz", "test query");
    const url = lastFetch()?.url ?? "";
    expect(url).toContain("/api/cache/search");
    expect(url).toContain("provider=musicbrainz");
    expect(url).toContain("query=test%20query");
  });

  it("setSearchCache calls PUT /api/cache/search with body", async () => {
    const results = { songs: [], albums: [], albumArtists: [] } as SearchResults;
    await bs.setSearchCache("youtube", "q", results);
    const call = lastFetch()!;
    expect(call.url).toContain("/api/cache/search");
    expect(call.options?.method).toBe("PUT");
    expect(call.options?.body).toContain("youtube");
  });

  it("getAllSearchCacheEntries calls GET /api/cache/search/all", async () => {
    await bs.getAllSearchCacheEntries();
    expect(lastFetch()?.url).toContain("/api/cache/search/all");
  });

  it("getCachedQuery calls GET /api/cache/query", async () => {
    await bs.getCachedQuery("musicbrainz", "hello");
    const url = lastFetch()?.url ?? "";
    expect(url).toContain("/api/cache/query");
    expect(url).toContain("platform=musicbrainz");
    expect(url).toContain("query=hello");
  });

  it("setCachedQuery calls PUT /api/cache/query with body", async () => {
    await bs.setCachedQuery("youtube", "q", { items: [] }, "origin-1");
    const call = lastFetch()!;
    expect(call.url).toContain("/api/cache/query");
    expect(call.options?.method).toBe("PUT");
  });

  it("hashQuery is pure local (no fetch)", async () => {
    const len = fetchCalls.length;
    const hash = await bs.hashQuery("test query");
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(64);
    // No fetch call was made
    expect(fetchCalls.length).toBe(len);
  });

  it("pruneExpiredCache does nothing (returns undefined, no fetch)", async () => {
    const len = fetchCalls.length;
    const result = await bs.pruneExpiredCache();
    expect(result).toBeUndefined();
    expect(fetchCalls.length).toBe(len);
  });
});
