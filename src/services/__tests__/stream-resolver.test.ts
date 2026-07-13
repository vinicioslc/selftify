import { describe, it, expect, vi, beforeEach } from "vitest";
import { useBackendStore } from "../../stores/backend.store";
import type { Song } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";

const mockGetStreamUrl = vi.fn<(id: string) => Promise<string | null>>();

vi.mock("../../api/controller", () => ({
  getController: async () => ({
    getStreamUrl: mockGetStreamUrl,
    getImageUrl: async () => null,
  }),
}));

function backendSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    originId: "selftify-server",
    originType: OriginType.LOCAL,
    name: "Track",
    artistName: "Artist",
    albumName: "Album",
    duration: 180,
    imageUrl: null,
    path: "Artist/Album/Track.mp3",
    ...overrides,
  };
}

describe("stream-resolver — backend songs", () => {
  let resolveSong: (song: Song) => Promise<{ song: Song; source: "local" | "youtube" | "none" }>;

  beforeEach(async () => {
    mockGetStreamUrl.mockReset();
    useBackendStore.setState({
      config: { type: "selftify", url: "http://backend:6189", user: "admin", password: "admin" },
      capabilities: [],
    });
    const module = await import("../stream-resolver");
    resolveSong = module.resolveSong;
  });

  it("resolves a backend song's server-relative path into a stream URL", async () => {
    const streamUrl = "http://backend:6189/rest/stream.view?id=song-1&u=admin&p=admin";
    mockGetStreamUrl.mockResolvedValue(streamUrl);

    const result = await resolveSong(backendSong());

    expect(mockGetStreamUrl).toHaveBeenCalledWith("song-1");
    expect(result.song.path).toBe(streamUrl);
    expect(result.song.path?.startsWith("http")).toBe(true);
    expect(result.source).toBe("local");
  });

  it("does NOT return the raw relative path (would 404 against the dev server)", async () => {
    const streamUrl = "http://backend:6189/rest/stream.view?id=song-1&u=admin&p=admin";
    mockGetStreamUrl.mockResolvedValue(streamUrl);

    const result = await resolveSong(backendSong());

    expect(result.song.path).not.toBe("Artist/Album/Track.mp3");
  });

  it("uses an already-resolved http stream URL directly without re-fetching", async () => {
    const existing = "http://backend:6189/rest/stream.view?id=song-1";

    const result = await resolveSong(backendSong({ path: existing }));

    expect(mockGetStreamUrl).not.toHaveBeenCalled();
    expect(result.song.path).toBe(existing);
  });

  it("falls back to source 'none' when backend returns no stream url", async () => {
    mockGetStreamUrl.mockResolvedValueOnce(null);

    const result = await resolveSong(backendSong());

    expect(result.song.path).toBe("Artist/Album/Track.mp3");
    expect(result.source).toBe("none");
  });
});