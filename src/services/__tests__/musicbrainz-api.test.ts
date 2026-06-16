import { describe, it, expect } from "vitest";
import {
  hashSearchQuery,
  buildQuery,
  buildSearchRecordingsEndpoint,
  buildSearchReleasesEndpoint,
  buildSearchArtistsEndpoint,
  buildReleaseDetailEndpoint,
  buildReleaseByReleaseGroupEndpoint,
  buildRecordingDetailEndpoint,
  buildArtistReleaseGroupsEndpoint,
  buildArtistDetailEndpoint,
  buildFullUrl,
  normalizeReleaseGroupResponse,
  parseJsonResponse,
} from "../musicbrainz-api";

describe("hashSearchQuery", () => {
  it("should produce deterministic hash for same params", () => {
    const params = { type: "artist", artist: "The Beatles", limit: 25 };
    const a = hashSearchQuery(params);
    const b = hashSearchQuery(params);
    expect(a).toBe(b);
  });

  it("should produce different hash for different params", () => {
    const a = hashSearchQuery({ type: "artist", artist: "The Beatles" });
    const b = hashSearchQuery({ type: "artist", artist: "The Rolling Stones" });
    expect(a).not.toBe(b);
  });

  it("should handle empty params", () => {
    const result = hashSearchQuery({});
    expect(result).toBe("q_0");
  });

  it("should ignore key order", () => {
    const a = hashSearchQuery({ a: "1", b: "2" });
    const b = hashSearchQuery({ b: "2", a: "1" });
    expect(a).toBe(b);
  });

  it("should return only safe characters (alphanumeric + underscore)", () => {
    const result = hashSearchQuery({ type: "recording", query: "special chars: !@#$%" });
    expect(result).toMatch(/^q_[a-z0-9_]+$/);
  });
});

describe("buildQuery", () => {
  it("should build simple single-term query", () => {
    const result = buildQuery({ artist: "The Beatles" });
    expect(result).toBe('artist:"The Beatles"');
  });

  it("should build multi-term AND query", () => {
    const result = buildQuery({ artist: "Queen", recording: "Bohemian Rhapsody" });
    expect(result).toBe('artist:"Queen" AND recording:"Bohemian Rhapsody"');
  });

  it("should filter out empty terms", () => {
    const result = buildQuery({ artist: "Nirvana", recording: "" });
    expect(result).toBe('artist:"Nirvana"');
  });

  it("should escape double quotes inside values", () => {
    const result = buildQuery({ artist: 'The "King"' });
    expect(result).toBe('artist:"The King"');
  });

  it("should handle numeric values as strings", () => {
    const result = buildQuery({ artist: "1984" });
    expect(result).toBe('artist:"1984"');
  });

  it("should handle empty input", () => {
    const result = buildQuery({});
    expect(result).toBe("");
  });
});

describe("endpoint builders", () => {
  describe("buildSearchRecordingsEndpoint", () => {
    it("should encode query params", () => {
      const result = buildSearchRecordingsEndpoint('artist:"Queen" AND recording:"Bohemian Rhapsody"', 10, 0);
      expect(result).toContain("query=");
      expect(result).toContain("limit=10");
      expect(result).toContain("offset=0");
      expect(result).toContain("fmt=json");
      expect(result).toContain("inc=releases+artist-credits");
    });

    it("should URL-encode special characters", () => {
      const result = buildSearchRecordingsEndpoint("artist: Caetano Veloso", 5, 0);
      expect(result).toContain(encodeURIComponent("Caetano Veloso"));
      expect(result).not.toContain(" ");
    });
  });

  describe("buildSearchReleasesEndpoint", () => {
    it("should include release-groups inc", () => {
      const result = buildSearchReleasesEndpoint('artist:"Pink Floyd"', 20, 10);
      expect(result).toContain("inc=release-groups");
      expect(result).toContain("limit=20");
      expect(result).toContain("offset=10");
    });
  });

  describe("buildSearchArtistsEndpoint", () => {
    it("should build basic search endpoint without inc param", () => {
      const result = buildSearchArtistsEndpoint('artist:"Miles Davis"', 25, 0);
      expect(result).toContain('query=artist%3A%22Miles%20Davis%22');
      expect(result).not.toContain("inc=");
    });
  });

  describe("buildReleaseDetailEndpoint", () => {
    it("should include release MBID in path", () => {
      const result = buildReleaseDetailEndpoint("a1b2c3d4-1234-5678-9012-abcdef123456");
      expect(result).toContain("/release/a1b2c3d4-1234-5678-9012-abcdef123456");
      expect(result).toContain("inc=artist-credits+recordings+media");
    });
  });

  describe("buildReleaseByReleaseGroupEndpoint", () => {
    it("should include release-group param", () => {
      const result = buildReleaseByReleaseGroupEndpoint("rg-12345");
      expect(result).toContain("release-group=rg-12345");
      expect(result).toContain("limit=1");
    });
  });

  describe("buildRecordingDetailEndpoint", () => {
    it("should include recording MBID and inc", () => {
      const result = buildRecordingDetailEndpoint("rec-abc-def");
      expect(result).toContain("/recording/rec-abc-def");
      expect(result).toContain("inc=artist-credits+releases");
    });
  });

  describe("buildArtistReleaseGroupsEndpoint", () => {
    it("should build with artist MBID", () => {
      const result = buildArtistReleaseGroupsEndpoint("artist-abc", 50, 0);
      expect(result).toContain("artist=artist-abc");
      expect(result).toContain("limit=50");
      expect(result).toContain("offset=0");
    });
  });

  describe("buildArtistDetailEndpoint", () => {
    it("should include artist MBID and tags inc", () => {
      const result = buildArtistDetailEndpoint("art-xyz-789");
      expect(result).toContain("/artist/art-xyz-789");
      expect(result).toContain("inc=tags");
    });
  });
});

describe("buildFullUrl", () => {
  it("should prepend base MusicBrainz URL", () => {
    const result = buildFullUrl("/artist/abc?fmt=json");
    expect(result).toBe("https://musicbrainz.org/ws/2/artist/abc?fmt=json");
  });

  it("should handle empty endpoint", () => {
    const result = buildFullUrl("");
    expect(result).toBe("https://musicbrainz.org/ws/2");
  });
});

describe("normalizeReleaseGroupResponse", () => {
  it("should extract groups and total count", () => {
    const groups = [
      { id: "rg-1", title: "Album 1", "primary-type": "Album" as const, "first-release-date": "2000" },
    ];
    const result = normalizeReleaseGroupResponse({ created: "2024-01-01", count: 1, offset: 0, "release-groups": groups });
    expect(result.groups).toEqual(groups);
    expect(result.total).toBe(1);
  });

  it("should return empty arrays when response has no groups", () => {
    const result = normalizeReleaseGroupResponse({ created: "2024-01-01", count: 0, offset: 0, "release-groups": [] });
    expect(result.groups).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("should handle empty groups", () => {
    const result = normalizeReleaseGroupResponse({ created: "2024-01-01", count: 0, offset: 0, "release-groups": undefined });
    expect(result.groups).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("parseJsonResponse", () => {
  it("should parse successful response", async () => {
    const response = new Response(JSON.stringify({ name: "test" }), { status: 200 });
    const result = await parseJsonResponse<{ name: string }>(response);
    expect(result).toEqual({ name: "test" });
  });

  it("should throw on non-ok response", async () => {
    const response = new Response("Not Found", { status: 404 });
    await expect(parseJsonResponse(response)).rejects.toThrow("MusicBrainz API error: 404");
  });

  it("should throw on server error", async () => {
    const response = new Response("Server Error", { status: 503 });
    await expect(parseJsonResponse(response)).rejects.toThrow("MusicBrainz API error: 503");
  });

  it("should reject malformed JSON", async () => {
    const response = new Response("not json", { status: 200 });
    await expect(parseJsonResponse(response)).rejects.toThrow();
  });
});
