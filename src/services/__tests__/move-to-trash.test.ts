import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Origin } from "../../types/domain-types";
import { useStatusStore } from "../../stores/status.store";

// ── Mocks ──

const mockPlatform = {
  fileExists: vi.fn(),
  createDirectory: vi.fn(),
  renameFile: vi.fn(),
};

vi.mock("../platform/factory", () => ({
  getPlatformService: () => mockPlatform,
}));

const mockDeleteTrack = vi.fn();

vi.mock("../db/repositories/track-repo", () => ({
  deleteTrack: (...args: any[]) => mockDeleteTrack(...args),
}));

// ── Subject ──

import { moveSongToTrash } from "../move-to-trash";

// ── Helpers ──

function makeOrigin(overrides: Partial<Origin> = {}): Origin {
  return {
    id: "local-1",
    name: "Local Music",
    type: "local" as any,
    folderPath: "/home/user/Music",
    ...overrides,
  };
}

// ── Tests ──

describe("moveSongToTrash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStatusStore.setState({ messages: [] });

    // Default: .trash dir exists, no collision in trash, source exists on disk
    mockPlatform.fileExists.mockImplementation((path: string) => {
      if (path === "/home/user/Music/.trash") return Promise.resolve(true);
      if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
      return Promise.resolve(true);
    });
    mockPlatform.createDirectory.mockResolvedValue(true);
    mockPlatform.renameFile.mockResolvedValue(true);
    mockDeleteTrack.mockReturnValue(undefined);
  });

  describe("file exists on disk", () => {
    it("should rename file to .trash and delete from DB", async () => {
      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/Album/song.mp3", origin);

      expect(ok).toBe(true);
      expect(mockPlatform.renameFile).toHaveBeenCalledWith(
        "/home/user/Music/Artist/Album/song.mp3",
        "/home/user/Music/.trash/song.mp3",
      );
      expect(mockDeleteTrack).toHaveBeenCalledWith("Artist/Album/song.mp3");
    });

    it("should handle absolute file paths", async () => {
      const origin = makeOrigin();
      const ok = await moveSongToTrash("/home/user/Music/Artist/Album/song.mp3", origin);

      expect(ok).toBe(true);
      expect(mockPlatform.renameFile).toHaveBeenCalledWith(
        "/home/user/Music/Artist/Album/song.mp3",
        "/home/user/Music/.trash/song.mp3",
      );
      expect(mockDeleteTrack).toHaveBeenCalledWith("Artist/Album/song.mp3");
    });

    it("should append timestamp when trash already has same filename", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(true);
        if (path === "/home/user/Music/.trash/song.mp3") return Promise.resolve(true);
        return Promise.resolve(true);
      });

      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/Album/song.mp3", origin);

      expect(ok).toBe(true);
      const renameArg = (mockPlatform.renameFile.mock.calls[0][1] as string);
      expect(renameArg).toMatch(/^\/home\/user\/Music\/\.trash\/song_\d+\.mp3$/);
    });

    it("should create .trash directory if it does not exist", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(false);
        if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
        return Promise.resolve(true);
      });

      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/song.mp3", origin);

      expect(ok).toBe(true);
      expect(mockPlatform.createDirectory).toHaveBeenCalledWith(
        "/home/user/Music/.trash",
      );
    });
  });

  describe("file does not exist on disk", () => {
    it("should still delete from DB when source file is missing", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(true);
        if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/Album/Gone.mp3", origin);

      expect(ok).toBe(true);
      expect(mockPlatform.renameFile).not.toHaveBeenCalled();
      expect(mockDeleteTrack).toHaveBeenCalledWith("Artist/Album/Gone.mp3");
    });

    it("should show removed-from-library message instead of trash message", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(true);
        if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      const addMsg = vi.spyOn(useStatusStore.getState(), "addMessage");
      const origin = makeOrigin();
      await moveSongToTrash("Artist/Album/Gone.mp3", origin);

      expect(addMsg).toHaveBeenCalledWith(
        "Removed from library: Gone.mp3",
        "success",
        "Library",
      );
    });

    it("should not attempt to create .trash when source is missing", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(false);
        if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      const origin = makeOrigin();
      await moveSongToTrash("Artist/Album/Gone.mp3", origin);

      expect(mockPlatform.createDirectory).toHaveBeenCalled();
      expect(mockPlatform.renameFile).not.toHaveBeenCalled();
      expect(mockDeleteTrack).toHaveBeenCalledWith("Artist/Album/Gone.mp3");
    });

    it("should still succeed even if DB delete fails when file is missing", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(true);
        if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
        return Promise.resolve(false);
      });
      mockDeleteTrack.mockImplementation(() => { throw new Error("DB error"); });

      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/Album/Gone.mp3", origin);

      expect(ok).toBe(true);
    });
  });

  describe("database deletion", () => {
    it("should still return true if rename succeeded but DB delete fails", async () => {
      mockDeleteTrack.mockImplementation(() => {
        throw new Error("DB error");
      });
      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/song.mp3", origin);

      expect(ok).toBe(true);
      expect(mockPlatform.renameFile).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should return false when origin has no folderPath", async () => {
      const origin = makeOrigin({ folderPath: undefined });
      const ok = await moveSongToTrash("Artist/song.mp3", origin);

      expect(ok).toBe(false);
      expect(mockPlatform.renameFile).not.toHaveBeenCalled();
      expect(mockDeleteTrack).not.toHaveBeenCalled();
    });

    it("should return false when creating .trash fails", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(false);
        if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
        return Promise.resolve(true);
      });
      mockPlatform.createDirectory.mockResolvedValue(false);

      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/song.mp3", origin);

      expect(ok).toBe(false);
      expect(mockPlatform.renameFile).not.toHaveBeenCalled();
      expect(mockDeleteTrack).not.toHaveBeenCalled();
    });

    it("should return false when renameFile throws", async () => {
      mockPlatform.renameFile.mockRejectedValue(new Error("EPERM"));
      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/song.mp3", origin);

      expect(ok).toBe(false);
      expect(mockDeleteTrack).not.toHaveBeenCalled();
    });

    it("should return false when renameFile returns false", async () => {
      mockPlatform.renameFile.mockResolvedValue(false);
      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/Album/song.mp3", origin);

      expect(ok).toBe(false);
      expect(mockDeleteTrack).not.toHaveBeenCalled();
    });
  });

  describe("status messages", () => {
    it("should show trash message when file existed", async () => {
      const addMsg = vi.spyOn(useStatusStore.getState(), "addMessage");
      const origin = makeOrigin();
      await moveSongToTrash("Artist/song.mp3", origin);

      expect(addMsg).toHaveBeenCalledWith(
        "Moved to trash: song.mp3",
        "success",
        "Library",
      );
    });

    it("should show remove message when file was missing", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(true);
        if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      const addMsg = vi.spyOn(useStatusStore.getState(), "addMessage");
      const origin = makeOrigin();
      await moveSongToTrash("Artist/song.mp3", origin);

      expect(addMsg).toHaveBeenCalledWith(
        "Removed from library: song.mp3",
        "success",
        "Library",
      );
    });

    it("should show danger message when rename fails", async () => {
      mockPlatform.renameFile.mockResolvedValue(false);
      const addMsg = vi.spyOn(useStatusStore.getState(), "addMessage");
      const origin = makeOrigin();
      await moveSongToTrash("Artist/song.mp3", origin);

      expect(addMsg).toHaveBeenCalledWith(
        "Cannot delete: file move failed",
        "danger",
        "Library",
      );
    });
  });
});
