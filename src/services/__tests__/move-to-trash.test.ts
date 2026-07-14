import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Origin } from "../../types/domain-types";
import { useStatusStore } from "../../stores/status.store";

const mockPlatform = {
  isElectron: true,
  fileExists: vi.fn(),
  createDirectory: vi.fn(),
  renameFile: vi.fn(),
};

vi.mock("../platform/factory", () => ({
  getPlatformService: () => mockPlatform,
}));

import { moveSongToTrash } from "../move-to-trash";

function makeOrigin(overrides: Partial<Origin> = {}): Origin {
  return {
    id: "local-1",
    name: "Local Music",
    type: "local" as any,
    folderPath: "/home/user/Music",
    ...overrides,
  };
}

describe("moveSongToTrash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStatusStore.setState({ messages: [] });

    mockPlatform.fileExists.mockImplementation((path: string) => {
      if (path === "/home/user/Music/.trash") return Promise.resolve(true);
      if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
      return Promise.resolve(true);
    });
    mockPlatform.createDirectory.mockResolvedValue(true);
    mockPlatform.renameFile.mockResolvedValue(true);
  });

  describe("file exists on disk", () => {
    it("should rename file to .trash without touching DB", async () => {
      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/Album/song.mp3", origin);

      expect(ok).toBe(true);
      expect(mockPlatform.renameFile).toHaveBeenCalledWith(
        "/home/user/Music/Artist/Album/song.mp3",
        "/home/user/Music/.trash/song.mp3",
      );
    });

    it("should handle absolute file paths", async () => {
      const origin = makeOrigin();
      const ok = await moveSongToTrash("/home/user/Music/Artist/Album/song.mp3", origin);

      expect(ok).toBe(true);
      expect(mockPlatform.renameFile).toHaveBeenCalledWith(
        "/home/user/Music/Artist/Album/song.mp3",
        "/home/user/Music/.trash/song.mp3",
      );
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
    it("should succeed without rename when source file is missing", async () => {
      mockPlatform.fileExists.mockImplementation((path: string) => {
        if (path === "/home/user/Music/.trash") return Promise.resolve(true);
        if (path.startsWith("/home/user/Music/.trash/")) return Promise.resolve(false);
        return Promise.resolve(false);
      });

      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/Album/Gone.mp3", origin);

      expect(ok).toBe(true);
      expect(mockPlatform.renameFile).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should return false when origin has no folderPath", async () => {
      const origin = makeOrigin({ folderPath: undefined });
      const ok = await moveSongToTrash("Artist/song.mp3", origin);

      expect(ok).toBe(false);
      expect(mockPlatform.renameFile).not.toHaveBeenCalled();
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
    });

    it("should return false when renameFile throws", async () => {
      mockPlatform.renameFile.mockRejectedValue(new Error("EPERM"));
      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/song.mp3", origin);

      expect(ok).toBe(false);
    });

    it("should return false when renameFile returns false", async () => {
      mockPlatform.renameFile.mockResolvedValue(false);
      const origin = makeOrigin();
      const ok = await moveSongToTrash("Artist/Album/song.mp3", origin);

      expect(ok).toBe(false);
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
