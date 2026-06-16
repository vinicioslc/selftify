import { describe, it, expect } from "vitest";
import { scoreYouTubeResults, type YoutubeSearchVideo } from "../youtube-ranking";

function makeVideo(overrides: Partial<YoutubeSearchVideo> = {}): YoutubeSearchVideo {
  return { id: "v1", title: "Test Song", duration: { seconds: 240 }, uploader: "Artist", ...overrides };
}

const EXPECTED = { title: "Test Song", artist: "Test Artist", album: "Test Album", duration: 240 };

describe("scoreYouTubeResults", () => {
  it("should always have a numeric score", () => {
    const videos = [makeVideo({ id: "v1", title: "Unrelated" })];
    const result = scoreYouTubeResults(videos, EXPECTED);
    expect(result).toHaveLength(1);
    expect(typeof result[0].breakdown.score).toBe("number");
    expect(Number.isFinite(result[0].breakdown.score)).toBe(true);
  });

  it("should return score 0 for completely unrelated video (different title, artist, duration, no expected duration)", () => {
    const videos = [makeVideo({ id: "v1", title: "Totally Different Video", uploader: "Someone Else" })];
    const result = scoreYouTubeResults(videos, { title: "Test Song", artist: "Test Artist", album: "Test Album" });
    expect(result[0].breakdown.score).toBe(0);
  });

  it("should handle empty video array gracefully", () => {
    const result = scoreYouTubeResults([], EXPECTED);
    expect(result).toEqual([]);
  });

  it("should handle missing artist and album gracefully", () => {
    const videos = [makeVideo()];
    const result = scoreYouTubeResults(videos, { title: "Test Song" });
    expect(result).toHaveLength(1);
    expect(typeof result[0].breakdown.score).toBe("number");
  });

  it("should handle missing duration gracefully", () => {
    const videos = [makeVideo({ duration: undefined })];
    const result = scoreYouTubeResults(videos, { title: "Test Song", artist: "Artist" });
    expect(result).toHaveLength(1);
    expect(typeof result[0].breakdown.score).toBe("number");
  });

  it("should handle duration as number (not object)", () => {
    const videos = [makeVideo({ duration: 240 })];
    const result = scoreYouTubeResults(videos, EXPECTED);
    expect(result[0].breakdown.score).toBeGreaterThan(0);
  });

  it("should handle custom keywords", () => {
    const videos = [makeVideo({ id: "v1", title: "Test Song CD Audio" })];
    const result = scoreYouTubeResults(videos, EXPECTED, {
      title: 1.0,
      artist: 0.5,
      album: 1.0,
      duration: 0.5,
      artistOnChannel: 0.3,
      keywords: [{ term: "CD Audio", weight: 1.0 }],
    });
    expect(result[0].breakdown.keywordScore).toBe(1.0);
    expect(result[0].breakdown.score).toBeGreaterThan(0);
  });

  it("should have score as finite number for every result", () => {
    const videos = [
      makeVideo({ id: "v1", title: "Test Song", uploader: "Test Artist" }),
      makeVideo({ id: "v2", title: "Test Song Album", uploader: "Other" }),
      makeVideo({ id: "v3", title: "Unrelated Video", uploader: "Someone Else" }),
    ];
    const results = scoreYouTubeResults(videos, EXPECTED);
    for (const r of results) {
      expect(typeof r.breakdown.score).toBe("number");
      expect(Number.isFinite(r.breakdown.score)).toBe(true);
    }
  });

  it("should not produce NaN scores", () => {
    const videos = [makeVideo({ duration: undefined })];
    const result = scoreYouTubeResults(videos, { title: "" });
    const score = result[0].breakdown.score;
    expect(Number.isNaN(score)).toBe(false);
  });
});
