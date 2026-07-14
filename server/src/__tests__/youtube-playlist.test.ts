import { describe, it, expect, vi, beforeEach } from "vitest";

const mockYoutubedl = vi.hoisted(() => vi.fn());

vi.mock("youtube-dl-exec", () => ({
  default: mockYoutubedl,
}));

import { resolvePlaylistUrl, extractSource } from "../services/youtube-playlist";

function makePlaylistOutput(entries: any[], meta?: any) {
  return {
    id: meta?.id ?? "PL-test123",
    title: meta?.title ?? "Test Playlist",
    playlist_id: meta?.playlist_id ?? "PL-test123",
    playlist_title: meta?.playlist_title ?? "Test Playlist",
    playlist_thumbnail: meta?.thumbnail ?? null,
    entries,
  };
}

function makeEntry(videoId: string, overrides?: any) {
  return {
    id: videoId,
    title: `Video ${videoId}`,
    uploader: "Test Channel",
    channel: "Test Channel",
    duration: 240,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
    ...overrides,
  };
}

describe("extractSource", () => {
  it("identifies youtube.com", () => {
    expect(extractSource("https://www.youtube.com/watch?v=abc")).toBe("youtube");
  });

  it("identifies youtu.be", () => {
    expect(extractSource("https://youtu.be/abc")).toBe("youtube");
  });

  it("identifies soundcloud", () => {
    expect(extractSource("https://soundcloud.com/artist/track")).toBe("soundcloud");
  });

  it("identifies spotify", () => {
    expect(extractSource("https://open.spotify.com/playlist/abc")).toBe("spotify");
  });

  it("returns hostname for unknown sources", () => {
    expect(extractSource("https://vimeo.com/123")).toBe("vimeo");
  });

  it("returns null for invalid URLs", () => {
    expect(extractSource("not-a-url")).toBeNull();
  });
});

describe("resolvePlaylistUrl", () => {
  beforeEach(() => {
    mockYoutubedl.mockReset();
  });

  it("resolves a playlist with multiple entries", async () => {
    mockYoutubedl.mockResolvedValue(makePlaylistOutput([
      makeEntry("video1"),
      makeEntry("video2"),
      makeEntry("video3"),
    ]));

    const result = await resolvePlaylistUrl("https://www.youtube.com/playlist?list=PLtest123");

    expect(result.name).toBe("Test Playlist");
    expect(result.id).toBe("PL-test123");
    expect(result.source).toBe("youtube");
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].videoId).toBe("video1");
    expect(result.entries[0].position).toBe(1);
    expect(result.entries[1].position).toBe(2);
  });

  it("resolves a single video URL (no entries array)", async () => {
    mockYoutubedl.mockResolvedValue({
      id: "single-video-1",
      title: "Single Track",
      uploader: "Artist Name",
      channel: "Artist Name",
      duration: 180,
      thumbnail: "https://i.ytimg.com/vi/single-video-1/default.jpg",
    });

    const result = await resolvePlaylistUrl("https://www.youtube.com/watch?v=single-video-1");

    expect(result.id).toBe("single-single-video-1");
    expect(result.name).toBe("Single Track");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].videoId).toBe("single-video-1");
    expect(result.entries[0].uploader).toBe("Artist Name");
    expect(result.entries[0].duration).toBe(180);
  });

  it("skips entries without an id", async () => {
    mockYoutubedl.mockResolvedValue(makePlaylistOutput([
      makeEntry("video1"),
      { title: "No ID entry" },
      makeEntry("video3"),
    ]));

    const result = await resolvePlaylistUrl("https://youtube.com/playlist?list=PLx");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].videoId).toBe("video1");
    expect(result.entries[1].videoId).toBe("video3");
  });

  it("handles missing optional fields gracefully", async () => {
    mockYoutubedl.mockResolvedValue(makePlaylistOutput([
      { id: "v1", title: "Minimal Track" },
    ], { title: undefined, playlist_title: undefined, playlist_thumbnail: undefined }));

    const result = await resolvePlaylistUrl("https://youtube.com/playlist?list=PLy");
    expect(result.name).toBe("Imported Playlist");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].title).toBe("Minimal Track");
    expect(result.entries[0].uploader).toBeNull();
    expect(result.entries[0].duration).toBeNull();
    expect(result.imageUrl).toBeNull();
  });

  it("throws on yt-dlp failure", async () => {
    mockYoutubedl.mockRejectedValue(new Error("yt-dlp: HTTP Error 403"));

    await expect(resolvePlaylistUrl("https://youtube.com/watch?v=bad"))
      .rejects.toThrow("Failed to resolve URL: yt-dlp: HTTP Error 403");
  });

  it("handles empty playlist", async () => {
    mockYoutubedl.mockResolvedValue(makePlaylistOutput([]));

    const result = await resolvePlaylistUrl("https://youtube.com/playlist?list=PLe");
    expect(result.entries).toHaveLength(0);
    expect(result.name).toBe("Test Playlist");
  });
});
