import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Song } from "../../types/domain-types";

const mockSearch = vi.fn();
const mockGetStreamUrl = vi.fn();
const mockGetVideoInfo = vi.fn();
const mockDownload = vi.fn();

const mockScoreYouTubeResults = vi.fn();
const mockPersistRanking = vi.fn();

const mockGetMbzYtMapping = vi.fn();
const mockSetMbzYtMapping = vi.fn();
const mockDeleteMbzYtMapping = vi.fn();
const mockRecordRanking = vi.fn();

vi.mock("../sqlite-db/sqlite-db-mappings", () => ({
  getMbzYtMapping: (...args: any[]) => mockGetMbzYtMapping(...args),
  setMbzYtMapping: (...args: any[]) => mockSetMbzYtMapping(...args),
  deleteMbzYtMapping: (...args: any[]) => mockDeleteMbzYtMapping(...args),
}));

vi.mock("../sqlite-db/sqlite-db-ranking-log", () => ({
  recordRanking: (...args: any[]) => mockRecordRanking(...args),
}));

vi.mock("../youtube-ranking", () => ({
  scoreYouTubeResults: (...args: any[]) => mockScoreYouTubeResults(...args),
  persistRanking: (...args: any[]) => mockPersistRanking(...args),
}));

vi.mock("../../stores/settings.store", () => ({
  useSettingsStore: {
    getState: () => ({
      rankingWeights: { title: 1.0, artist: 0.5, album: 1.0, duration: 0.5, keywords: [] },
    }),
  },
}));

vi.mock("../../stores/auth.store", () => ({
  useAuthStore: {
    getState: () => ({
      currentOrigin: { youtubeMusicHeaders: null, type: "local" },
      origins: [{ id: "test", type: "local", folderPath: "/tmp/selftify-test", name: "Test" }],
    }),
  },
}));

vi.mock("../../stores/status.store", () => ({
  useStatusStore: {
    getState: () => ({
      addMessage: vi.fn(),
    }),
  },
}));


import {
  searchAndRank,
  searchAndRankAll,
  researchSong,
  getStreamUrl,
  downloadAndGetPath,
  fetchCustomVideoInfo,
  getSavedSelectedVideoId,
} from "../youtube-download-service";

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    originId: "origin-1",
    originType: "local" as any,
    name: "Test Song",
    artistName: "Test Artist",
    albumName: "Test Album",
    duration: 240,
    imageUrl: null,
    ...overrides,
  };
}

describe("youtube-download-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronApi = {
      yt: {
        search: mockSearch,
        download: mockDownload,
        getStreamUrl: mockGetStreamUrl,
        getVideoInfo: mockGetVideoInfo,
      },
    };

    mockGetMbzYtMapping.mockResolvedValue(null);
    mockSetMbzYtMapping.mockResolvedValue(undefined);
    mockDeleteMbzYtMapping.mockResolvedValue(undefined);
    mockRecordRanking.mockResolvedValue(undefined);
    mockPersistRanking.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (window as any).electronApi;
  });

  describe("searchAndRank", () => {
    it("should return null if no electronApi", async () => {
      delete (window as any).electronApi;
      const result = await searchAndRank(makeSong());
      expect(result).toBeNull();
    });

    it("should return null if search returns empty results", async () => {
      mockSearch.mockResolvedValue([]);
      const result = await searchAndRank(makeSong());
      expect(result).toBeNull();
    });

    it("should return null if ranking produces no results", async () => {
      mockSearch.mockResolvedValue([
        { id: "v1", title: "Something", duration: 200, uploader: "User" },
      ]);
      mockScoreYouTubeResults.mockReturnValue([]);

      const result = await searchAndRank(makeSong());
      expect(result).toBeNull();
    });

    it("should return videoId and title of best match", async () => {
      mockSearch.mockResolvedValue([
        { id: "v1", title: "Test Song", duration: 240, uploader: "Artist" },
        { id: "v2", title: "Other", duration: 180, uploader: "Other" },
      ]);
      mockScoreYouTubeResults.mockReturnValue([
        {
          video: { id: "v1", title: "Test Song", duration: { seconds: 240 }, uploader: "Artist" },
          breakdown: { score: 2.5, titleMatch: true, artistMatch: true, albumMatch: false, exactDuration: true, closestDuration: true, keywordScore: 0 },
          diff: 0,
          originalIndex: 0,
        },
      ]);

      const result = await searchAndRank(makeSong());
      expect(result).toEqual({ videoId: "v1", title: "Test Song", channelName: "Artist" });
    });

    it("should use cached mapping if available", async () => {
      const song = makeSong({ mbzRecordingId: "mbz-rec-1" });
      mockGetMbzYtMapping.mockResolvedValue({
        selectedVideoId: "cached-vid",
        candidates: [
          {
            videoId: "cached-vid",
            title: "Cached Song",
            uploader: "Artist",
            score: 2.0,
            titleMatch: true,
            artistMatch: true,
            albumMatch: false,
            exactDuration: false,
            closestDuration: false,
            keywordScore: 0,
            diff: 10,
            source: "ranking" as const,
          },
        ],
      });

      const result = await searchAndRank(song);
      expect(result?.videoId).toBe("cached-vid");
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("should handle cached candidates with null score gracefully", async () => {
      const song = makeSong({ mbzRecordingId: "mbz-null-score" });
      mockGetMbzYtMapping.mockResolvedValue({
        selectedVideoId: "vid-1",
        candidates: [
          {
            videoId: "vid-1",
            title: "Song Title",
            uploader: "Artist",
            score: 0,
            titleMatch: true,
            artistMatch: false,
            albumMatch: false,
            exactDuration: false,
            closestDuration: false,
            keywordScore: 0,
            diff: 10,
            source: "ranking" as const,
          },
          {
            videoId: "vid-2",
            title: "Other Video",
            uploader: "Someone",
            score: 0,
            titleMatch: false,
            artistMatch: false,
            albumMatch: false,
            exactDuration: false,
            closestDuration: false,
            keywordScore: 0,
            diff: 20,
            source: "ranking" as const,
          },
        ],
      });

      const result = await searchAndRank(song);
      expect(result).not.toBeNull();
      expect(result?.videoId).toBe("vid-1");
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("should save mapping after successful search", async () => {
      const song = makeSong({ mbzRecordingId: "mbz-rec-1" });
      mockSearch.mockResolvedValue([
        { id: "v1", title: "Test Song", duration: 240, uploader: "Artist" },
      ]);
      mockScoreYouTubeResults.mockReturnValue([
        {
          video: { id: "v1", title: "Test Song", uploader: "Artist" },
          breakdown: { score: 2.0, titleMatch: true, artistMatch: true, albumMatch: false, exactDuration: false, closestDuration: false, keywordScore: 0 },
          diff: 0,
          originalIndex: 0,
        },
      ]);

      await searchAndRank(song);

      expect(mockSetMbzYtMapping).toHaveBeenCalled();
      const setCallArgs = mockSetMbzYtMapping.mock.calls[0];
      expect(setCallArgs[1]).toEqual(
        expect.objectContaining({
          mbzRecordingId: "mbz-rec-1",
          selectedVideoId: "v1",
          selectedType: "auto",
        }),
      );
    });

    it("should build query from artist + name + album", async () => {
      mockSearch.mockResolvedValue([]);
      await searchAndRank(makeSong({ artistName: "Radiohead", name: "Creep", albumName: "Pablo Honey" }));

      expect(mockSearch).toHaveBeenCalledWith("Radiohead Creep Pablo Honey", null);
    });

    it("should handle search errors gracefully", async () => {
      mockSearch.mockRejectedValue(new Error("Network error"));
      const result = await searchAndRank(makeSong());
      expect(result).toBeNull();
    });
  });

  describe("searchAndRankAll", () => {
    it("should return scored results and selectedIndex", async () => {
      mockSearch.mockResolvedValue([
        { id: "v1", title: "Test Song", duration: 240, uploader: "Artist" },
      ]);
      const scored = [
        {
          video: { id: "v1", title: "Test Song", uploader: "Artist" },
          breakdown: { score: 2.0, titleMatch: true, artistMatch: true, albumMatch: false, exactDuration: false, closestDuration: false, keywordScore: 0 },
          diff: 0,
          originalIndex: 0,
        },
      ];
      mockScoreYouTubeResults.mockReturnValue(scored);

      const result = await searchAndRankAll(makeSong());
      expect(result?.scored).toEqual(scored);
      expect(result?.query).toBe("Test Artist Test Song Test Album");
    });
  });

  describe("researchSong", () => {
    it("should delete cached mapping before searching", async () => {
      const song = makeSong({ mbzRecordingId: "mbz-rec-1" });
      mockSearch.mockResolvedValue([]);

      await researchSong(song);
      expect(mockDeleteMbzYtMapping).toHaveBeenCalled();
      const callArgs = mockDeleteMbzYtMapping.mock.calls[0];
      expect(callArgs[1]).toBe("mbz-rec-1");
    });

    it("should not try to delete mapping if no mbzRecordingId", async () => {
      const song = makeSong({ mbzRecordingId: undefined });
      mockSearch.mockResolvedValue([]);

      await researchSong(song);
      expect(mockDeleteMbzYtMapping).not.toHaveBeenCalled();
    });
  });

  describe("getStreamUrl", () => {
    it("should return null if no electronApi", async () => {
      delete (window as any).electronApi;
      const result = await getStreamUrl(makeSong());
      expect(result).toBeNull();
    });

    it("should use manual videoId when provided", async () => {
      mockGetStreamUrl.mockResolvedValue("https://stream.example.com/audio");

      const result = await getStreamUrl(makeSong(), "manual-vid");
      expect(mockGetStreamUrl).toHaveBeenCalledWith("manual-vid", null);
      expect(result).toBe("https://stream.example.com/audio");
    });

    it("should use saved mapping videoId if available", async () => {
      const song = makeSong({ mbzRecordingId: "mbz-1" });
      mockGetMbzYtMapping.mockResolvedValue({ selectedVideoId: "saved-vid" });
      mockGetStreamUrl.mockResolvedValue("https://stream.example.com/audio");

      await getStreamUrl(song);
      expect(mockGetStreamUrl).toHaveBeenCalledWith("saved-vid", null);
    });

    it("should fall back to searchAndRank if no saved mapping", async () => {
      const song = makeSong();
      mockSearch.mockResolvedValue([
        { id: "auto-vid", title: "Test Song", duration: 240, uploader: "Artist" },
      ]);
      mockScoreYouTubeResults.mockReturnValue([
        {
          video: { id: "auto-vid", title: "Test Song", uploader: "Artist" },
          breakdown: { score: 2.0, titleMatch: true, artistMatch: true, albumMatch: false, exactDuration: false, closestDuration: false, keywordScore: 0 },
          diff: 0,
          originalIndex: 0,
        },
      ]);
      mockGetStreamUrl.mockResolvedValue("https://stream.example.com/audio");

      const result = await getStreamUrl(song);
      expect(result).toBe("https://stream.example.com/audio");
    });

    it("should fall back to auto-ranking if manual videoId fails", async () => {
      const song = makeSong();
      mockGetStreamUrl
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("https://stream.example.com/audio");

      mockSearch.mockResolvedValue([
        { id: "auto-vid", title: "Test Song", duration: 240, uploader: "Artist" },
      ]);
      mockScoreYouTubeResults.mockReturnValue([
        {
          video: { id: "auto-vid", title: "Test Song", uploader: "Artist" },
          breakdown: { score: 2.0, titleMatch: true, artistMatch: true, albumMatch: false, exactDuration: false, closestDuration: false, keywordScore: 0 },
          diff: 0,
          originalIndex: 0,
        },
      ]);

      const result = await getStreamUrl(song, "manual-fail");
      expect(result).toBe("https://stream.example.com/audio");
    });

    it("should return null if stream extraction fails", async () => {
      mockGetStreamUrl.mockRejectedValue(new Error("Failed"));
      const result = await getStreamUrl(makeSong(), "vid-1");
      expect(result).toBeNull();
    });
  });

  describe("downloadAndGetPath", () => {
    it("should return null if no electronApi", async () => {
      delete (window as any).electronApi;
      const result = await downloadAndGetPath(makeSong(), "/tmp");
      expect(result).toBeNull();
    });

    it("should return null if searchAndRank fails", async () => {
      mockSearch.mockResolvedValue([]);
      const result = await downloadAndGetPath(makeSong(), "/tmp");
      expect(result).toBeNull();
    });

    it("should call download with correct metadata", async () => {
      const song = makeSong({
        mbzRecordingId: "rec-1",
        mbzTrackId: "track-1",
        albumArtistName: "Album Artist",
        trackNumber: 3,
        discNumber: 1,
        releaseYear: 2024,
        genres: ["Rock"],
      });

      mockSearch.mockResolvedValue([
        { id: "v1", title: "Test Song", duration: 240, uploader: "Artist" },
      ]);
      mockScoreYouTubeResults.mockReturnValue([
        {
          video: { id: "v1", title: "Test Song", uploader: "Artist" },
          breakdown: { score: 2.0, titleMatch: true, artistMatch: true, albumMatch: false, exactDuration: false, closestDuration: false, keywordScore: 0 },
          diff: 0,
          originalIndex: 0,
        },
      ]);
      mockDownload.mockResolvedValue("/tmp/song.mp3");

      const result = await downloadAndGetPath(song, "/tmp");
      expect(result).toBe("/tmp/song.mp3");
      expect(mockDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          videoId: "v1",
          downloadFolder: "/tmp",
          metadata: expect.objectContaining({
            title: "Test Song",
            artist: "Test Artist",
            album: "Test Album",
            albumArtist: "Album Artist",
            trackNumber: 3,
            discNumber: 1,
            releaseYear: 2024,
            genres: ["Rock"],
            mbzRecordingId: "rec-1",
            mbzTrackId: "track-1",
          }),
        }),
      );
    });

    it("should return null if download throws", async () => {
      mockSearch.mockResolvedValue([
        { id: "v1", title: "Test Song", duration: 240, uploader: "Artist" },
      ]);
      mockScoreYouTubeResults.mockReturnValue([
        {
          video: { id: "v1", title: "Test Song", uploader: "Artist" },
          breakdown: { score: 2.0, titleMatch: true, artistMatch: true, albumMatch: false, exactDuration: false, closestDuration: false, keywordScore: 0 },
          diff: 0,
          originalIndex: 0,
        },
      ]);
      mockDownload.mockRejectedValue(new Error("Download failed"));

      const result = await downloadAndGetPath(makeSong(), "/tmp");
      expect(result).toBeNull();
    });
  });

  describe("fetchCustomVideoInfo", () => {
    it("should return null for invalid video URL", async () => {
      const result = await fetchCustomVideoInfo("not-a-url");
      expect(result).toBeNull();
    });

    it("should extract videoId from youtube.com URL", async () => {
      mockGetVideoInfo.mockResolvedValue({
        title: "Custom Video",
        uploader: "User",
        duration: 300,
        thumbnail: "https://img.example.com/thumb.jpg",
      });

      const result = await fetchCustomVideoInfo("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(result?.videoId).toBe("dQw4w9WgXcQ");
      expect(result?.title).toBe("Custom Video");
      expect(result?.source).toBe("custom");
    });

    it("should extract videoId from youtu.be URL", async () => {
      mockGetVideoInfo.mockResolvedValue({
        title: "Short URL Video",
        uploader: "User",
        duration: 200,
      });

      const result = await fetchCustomVideoInfo("https://youtu.be/dQw4w9WgXcQ");
      expect(result?.videoId).toBe("dQw4w9WgXcQ");
    });

    it("should accept raw 11-char video ID", async () => {
      mockGetVideoInfo.mockResolvedValue({
        title: "Raw ID Video",
        uploader: "User",
        duration: 180,
      });

      const result = await fetchCustomVideoInfo("dQw4w9WgXcQ");
      expect(result?.videoId).toBe("dQw4w9WgXcQ");
    });

    it("should return null if getVideoInfo returns null", async () => {
      mockGetVideoInfo.mockResolvedValue(null);
      const result = await fetchCustomVideoInfo("dQw4w9WgXcQ");
      expect(result).toBeNull();
    });

    it("should return null if getVideoInfo throws", async () => {
      mockGetVideoInfo.mockRejectedValue(new Error("API error"));
      const result = await fetchCustomVideoInfo("dQw4w9WgXcQ");
      expect(result).toBeNull();
    });

    it("should return null if no electronApi", async () => {
      delete (window as any).electronApi;
      const result = await fetchCustomVideoInfo("dQw4w9WgXcQ");
      expect(result).toBeNull();
    });

    it("should set all scoring fields to zero/false for custom source", async () => {
      mockGetVideoInfo.mockResolvedValue({
        title: "Video",
        uploader: "User",
        duration: 200,
        thumbnail: null,
      });

      const result = await fetchCustomVideoInfo("dQw4w9WgXcQ");
      expect(result?.score).toBe(0);
      expect(result?.titleMatch).toBe(false);
      expect(result?.artistMatch).toBe(false);
      expect(result?.albumMatch).toBe(false);
      expect(result?.exactDuration).toBe(false);
      expect(result?.closestDuration).toBe(false);
      expect(result?.keywordScore).toBe(0);
      expect(result?.diff).toBe(0);
      expect(result?.source).toBe("custom");
    });
  });

  describe("getSavedSelectedVideoId", () => {
    it("should return null if song has no mbzRecordingId", async () => {
      const result = await getSavedSelectedVideoId(makeSong({ mbzRecordingId: undefined }));
      expect(result).toBeNull();
      expect(mockGetMbzYtMapping).not.toHaveBeenCalled();
    });

    it("should return saved videoId from mapping", async () => {
      mockGetMbzYtMapping.mockResolvedValue({ selectedVideoId: "saved-vid-123" });

      const result = await getSavedSelectedVideoId(makeSong({ mbzRecordingId: "mbz-1" }));
      expect(result).toBe("saved-vid-123");
    });

    it("should return null if no mapping found", async () => {
      mockGetMbzYtMapping.mockResolvedValue(null);

      const result = await getSavedSelectedVideoId(makeSong({ mbzRecordingId: "mbz-1" }));
      expect(result).toBeNull();
    });
  });
});
