import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getDownloadPlatform,
  resetDownloadPlatform,
  type DownloadPlatform,
} from "../download-platform";

describe("DownloadPlatform", () => {
  afterEach(() => {
    resetDownloadPlatform();
    delete (window as any).electronApi;
  });

  describe("getDownloadPlatform", () => {
    it("should return WebDownloadPlatform when no electronApi", () => {
      const platform = getDownloadPlatform();
      expect(platform.supportsAudioConversion).toBe(false);
      expect(platform.supportsCoverEmbedding).toBe(false);
    });

    it("should return ElectronDownloadPlatform when electronApi is present", () => {
      (window as any).electronApi = {
        yt: {
          downloadMp3: vi.fn(),
          processCover: vi.fn(),
          embedArtwork: vi.fn(),
        },
        fs: {
          deleteFile: vi.fn(),
          fileExists: vi.fn(),
        },
      };

      const platform = getDownloadPlatform();
      expect(platform.supportsAudioConversion).toBe(true);
      expect(platform.supportsCoverEmbedding).toBe(true);
    });

    it("should return cached instance on subsequent calls", () => {
      const p1 = getDownloadPlatform();
      const p2 = getDownloadPlatform();
      expect(p1).toBe(p2);
    });

    it("should create new instance after resetDownloadPlatform", () => {
      const p1 = getDownloadPlatform();
      resetDownloadPlatform();
      const p2 = getDownloadPlatform();
      expect(p1).not.toBe(p2);
    });
  });

  describe("WebDownloadPlatform", () => {
    let platform: DownloadPlatform;

    beforeEach(() => {
      resetDownloadPlatform();
      platform = getDownloadPlatform();
    });

    it("should throw on downloadAudio", async () => {
      await expect(
        platform.downloadAudio({
          videoId: "abc123",
          songName: "Test",
          artistName: "Artist",
          downloadFolder: "/tmp",
        }),
      ).rejects.toThrow("not supported");
    });

    it("should return null on processCover", async () => {
      const result = await platform.processCover({
        imageData: [1, 2, 3],
        outputDir: "/tmp",
      });
      expect(result).toBeNull();
    });

    it("should no-op on embedCover", async () => {
      await expect(
        platform.embedCover({ audioPath: "/a.mp3", coverPath: "/c.jpg" }),
      ).resolves.toBeUndefined();
    });

    it("should return false on deleteFile", async () => {
      expect(await platform.deleteFile("/tmp/file")).toBe(false);
    });

    it("should return false on fileExists", async () => {
      expect(await platform.fileExists("/tmp/file")).toBe(false);
    });
  });

  describe("ElectronDownloadPlatform", () => {
    let platform: DownloadPlatform;
    let mockApi: any;

    beforeEach(() => {
      mockApi = {
        yt: {
          downloadMp3: vi.fn().mockResolvedValue("/tmp/output.mp3"),
          processCover: vi.fn().mockResolvedValue("/tmp/cover.jpg"),
          embedArtwork: vi.fn().mockResolvedValue(undefined),
        },
        fs: {
          deleteFile: vi.fn().mockResolvedValue(true),
          fileExists: vi.fn().mockResolvedValue(true),
        },
      };
      (window as any).electronApi = mockApi;
      resetDownloadPlatform();
      platform = getDownloadPlatform();
    });

    describe("downloadAudio", () => {
      it("should call electronApi.yt.downloadMp3 with correct params", async () => {
        const result = await platform.downloadAudio({
          videoId: "vid123",
          songName: "My Song",
          artistName: "My Artist",
          albumName: "My Album",
          trackNumber: 3,
          releaseYear: 2024,
          genres: ["Rock"],
          downloadFolder: "/music",
        });

        expect(mockApi.yt.downloadMp3).toHaveBeenCalledWith({
          videoId: "vid123",
          downloadFolder: "/music",
          metadata: {
            title: "My Song",
            artist: "My Artist",
            album: "My Album",
            trackNumber: 3,
            releaseYear: 2024,
            genres: ["Rock"],
          },
        });
        expect(result).toBe("/tmp/output.mp3");
      });

      it("should pass undefined for optional params when not provided", async () => {
        await platform.downloadAudio({
          videoId: "vid123",
          songName: "Song",
          artistName: "Artist",
          downloadFolder: "/music",
        });

        expect(mockApi.yt.downloadMp3).toHaveBeenCalledWith({
          videoId: "vid123",
          downloadFolder: "/music",
          metadata: {
            title: "Song",
            artist: "Artist",
            album: undefined,
            trackNumber: undefined,
            releaseYear: undefined,
            genres: undefined,
          },
        });
      });
    });

    describe("processCover", () => {
      it("should call electronApi.yt.processCover", async () => {
        const bytes = [0xff, 0xd8, 0xff];
        const result = await platform.processCover({
          imageData: bytes,
          outputDir: "/tmp/output",
        });

        expect(mockApi.yt.processCover).toHaveBeenCalledWith({
          imageData: bytes,
          outputDir: "/tmp/output",
        });
        expect(result).toBe("/tmp/cover.jpg");
      });
    });

    describe("embedCover", () => {
      it("should call electronApi.yt.embedArtwork", async () => {
        await platform.embedCover({
          audioPath: "/tmp/song.mp3",
          coverPath: "/tmp/cover.jpg",
        });

        expect(mockApi.yt.embedArtwork).toHaveBeenCalledWith({
          audioPath: "/tmp/song.mp3",
          coverPath: "/tmp/cover.jpg",
        });
      });
    });

    describe("deleteFile", () => {
      it("should call electronApi.fs.deleteFile", async () => {
        const result = await platform.deleteFile("/tmp/file.mp3");
        expect(mockApi.fs.deleteFile).toHaveBeenCalledWith("/tmp/file.mp3");
        expect(result).toBe(true);
      });
    });

    describe("fileExists", () => {
      it("should call electronApi.fs.fileExists", async () => {
        const result = await platform.fileExists("/tmp/file.mp3");
        expect(mockApi.fs.fileExists).toHaveBeenCalledWith("/tmp/file.mp3");
        expect(result).toBe(true);
      });
    });
  });
});
