import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useAuthStore } from "../../stores/auth.store";
import type { Origin } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";

// We'll test the file-based playlist service logic by mocking the platform
const mockFs = new Map<string, Uint8Array>();

function makeMockPlatform() {
  return {
    isElectron: false,
    isAndroid: false,
    isWeb: true,
    openFolderPicker: async () => null,
    openFilePicker: async () => null,
    readFile: async (path: string) => mockFs.get(path) ?? null,
    readDirectory: async (path: string) => {
      const entries: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }> = [];
      for (const key of mockFs.keys()) {
        if (key.startsWith(path + "/")) {
          const name = key.slice(path.length + 1);
          if (!name.includes("/")) {
            entries.push({
              name,
              path: key,
              isDirectory: false,
              isFile: true,
            });
          }
        }
      }
      // Also include the directory itself if it exists as a key
      if (mockFs.has(path)) {
        // path is a directory marker
      }
      return entries;
    },
    fileExists: async (path: string) => mockFs.has(path),
    getFileStats: async (path: string) => {
      if (mockFs.has(path)) {
        return { size: mockFs.get(path)!.length, modifiedAt: Date.now() };
      }
      return null;
    },
    writeFile: async (path: string, data: Uint8Array) => {
      mockFs.set(path, data);
      return true;
    },
    deleteFile: async (path: string) => {
      mockFs.delete(path);
      return true;
    },
    createDirectory: async (path: string) => {
      mockFs.set(path, new Uint8Array(0));
      return true;
    },
    renameFile: async (oldPath: string, newPath: string) => {
      const data = mockFs.get(oldPath);
      if (data) {
        mockFs.set(newPath, data);
        mockFs.delete(oldPath);
        return true;
      }
      return false;
    },
    getSetting: async () => null,
    setSetting: async () => {},
  };
}

vi.mock("../platform/factory", () => ({
  getPlatformService: () => Promise.resolve(makeMockPlatform()),
}));

const TEST_ORIGIN: Origin = {
  id: "origin-1",
  name: "Test Origin",
  type: OriginType.LOCAL,
  folderPath: "/tmp/test-music",
};

const TEST_ORIGIN_ID = "origin-1";

describe("Playlist Service (file-based)", () => {
  beforeEach(async () => {
    mockFs.clear();
    useAuthStore.setState({
      currentOrigin: TEST_ORIGIN,
      origins: [TEST_ORIGIN],
    });
  });

  afterEach(() => {
    mockFs.clear();
  });

  describe("createPlaylist", () => {
    it("should create a .selftifylist file with empty array", async () => {
      const { createPlaylist } = await import("../playlist-service");
      const pl = await createPlaylist("My Jams", TEST_ORIGIN_ID);
      expect(pl.name).toBe("My Jams");
      expect(pl.originId).toBe(TEST_ORIGIN_ID);
      expect(pl.songCount).toBe(0);

      // Verify file was created
      const expectedPath = "/tmp/test-music/playlists/My Jams.selftifylist";
      expect(pl.id).toBe(expectedPath);
      expect(mockFs.has(expectedPath)).toBe(true);

      // Verify content is empty array
      const content = JSON.parse(new TextDecoder().decode(mockFs.get(expectedPath)!));
      expect(content).toEqual([]);
    });

    it("should sanitize file names with special characters", async () => {
      const { createPlaylist } = await import("../playlist-service");
      const pl = await createPlaylist("My:Jams/Test", TEST_ORIGIN_ID);
      expect(pl.id).toContain("My_Jams_Test.selftifylist");
    });
  });

  describe("getAllPlaylists", () => {
    it("should return empty array when no playlists directory exists", async () => {
      const { getAllPlaylists } = await import("../playlist-service");
      const all = await getAllPlaylists();
      expect(all).toEqual([]);
    });

    it("should return all created playlists", async () => {
      const { createPlaylist, getAllPlaylists } = await import("../playlist-service");
      await createPlaylist("A", TEST_ORIGIN_ID);
      await createPlaylist("B", TEST_ORIGIN_ID);
      await createPlaylist("C", TEST_ORIGIN_ID);
      const all = await getAllPlaylists();
      expect(all.length).toBe(3);
      const names = all.map((p) => p.name).sort();
      expect(names).toEqual(["A", "B", "C"]);
    });
  });

  describe("getPlaylistById", () => {
    it("should return null for non-existent playlist", async () => {
      const { getPlaylistById } = await import("../playlist-service");
      const result = await getPlaylistById("/nonexistent.selftifylist");
      expect(result).toBeNull();
    });

    it("should return the correct playlist", async () => {
      const { createPlaylist, getPlaylistById } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      const found = await getPlaylistById(pl.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Test");
      expect(found!.id).toBe(pl.id);
    });
  });

  describe("renamePlaylist", () => {
    it("should rename a playlist (rename the file)", async () => {
      const { createPlaylist, renamePlaylist, getAllPlaylists } = await import("../playlist-service");
      const pl = await createPlaylist("Old Name", TEST_ORIGIN_ID);
      await renamePlaylist(pl.id, "New Name");
      const all = await getAllPlaylists();
      expect(all.length).toBe(1);
      expect(all[0].name).toBe("New Name");
      // Old file should not exist
      expect(mockFs.has(pl.id)).toBe(false);
    });
  });

  describe("deletePlaylist", () => {
    it("should delete a playlist file", async () => {
      const { createPlaylist, deletePlaylist, getAllPlaylists } = await import("../playlist-service");
      const pl = await createPlaylist("To Delete", TEST_ORIGIN_ID);
      expect(mockFs.has(pl.id)).toBe(true);
      await deletePlaylist(pl.id);
      expect(mockFs.has(pl.id)).toBe(false);
      const all = await getAllPlaylists();
      expect(all.length).toBe(0);
    });
  });

  describe("addSongToPlaylist", () => {
    it("should add a song (by MBID) to a playlist", async () => {
      const { createPlaylist, addSongToPlaylist, getPlaylistSongIds } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "mbid-rec-123");
      const ids = await getPlaylistSongIds(pl.id);
      expect(ids).toEqual(["mbid-rec-123"]);
    });

    it("should not add duplicate MBIDs", async () => {
      const { createPlaylist, addSongToPlaylist, getPlaylistSongIds } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "mbid-rec-123");
      await addSongToPlaylist(pl.id, "mbid-rec-123");
      const ids = await getPlaylistSongIds(pl.id);
      expect(ids).toEqual(["mbid-rec-123"]);
    });

    it("should maintain insertion order", async () => {
      const { createPlaylist, addSongToPlaylist, getPlaylistSongIds } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "mbid-a");
      await addSongToPlaylist(pl.id, "mbid-b");
      await addSongToPlaylist(pl.id, "mbid-c");
      const ids = await getPlaylistSongIds(pl.id);
      expect(ids).toEqual(["mbid-a", "mbid-b", "mbid-c"]);
    });

    it("should skip empty MBID", async () => {
      const { createPlaylist, addSongToPlaylist, getPlaylistSongIds } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "");
      const ids = await getPlaylistSongIds(pl.id);
      expect(ids).toEqual([]);
    });
  });

  describe("removeSongFromPlaylist", () => {
    it("should remove a song from a playlist by MBID", async () => {
      const { createPlaylist, addSongToPlaylist, removeSongFromPlaylist, getPlaylistSongIds } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "mbid-1");
      await addSongToPlaylist(pl.id, "mbid-2");
      await removeSongFromPlaylist(pl.id, "mbid-1");
      const ids = await getPlaylistSongIds(pl.id);
      expect(ids).toEqual(["mbid-2"]);
    });

    it("should be no-op if MBID not in playlist", async () => {
      const { createPlaylist, addSongToPlaylist, removeSongFromPlaylist, getPlaylistSongIds } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "mbid-1");
      await removeSongFromPlaylist(pl.id, "nonexistent");
      const ids = await getPlaylistSongIds(pl.id);
      expect(ids).toEqual(["mbid-1"]);
    });
  });

  describe("isSongInPlaylist", () => {
    it("should return true when MBID is in playlist", async () => {
      const { createPlaylist, addSongToPlaylist, isSongInPlaylist } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "mbid-1");
      expect(await isSongInPlaylist(pl.id, "mbid-1")).toBe(true);
    });

    it("should return false when MBID is not in playlist", async () => {
      const { createPlaylist, isSongInPlaylist } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      expect(await isSongInPlaylist(pl.id, "mbid-1")).toBe(false);
    });

    it("should return false for empty MBID", async () => {
      const { createPlaylist, isSongInPlaylist } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      expect(await isSongInPlaylist(pl.id, "")).toBe(false);
    });
  });

  describe("getPlaylistSongCount", () => {
    it("should return 0 for empty playlist", async () => {
      const { createPlaylist, getPlaylistSongCount } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      expect(await getPlaylistSongCount(pl.id)).toBe(0);
    });

    it("should return correct count", async () => {
      const { createPlaylist, addSongToPlaylist, getPlaylistSongCount } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "mbid-1");
      await addSongToPlaylist(pl.id, "mbid-2");
      await addSongToPlaylist(pl.id, "mbid-3");
      expect(await getPlaylistSongCount(pl.id)).toBe(3);
    });
  });

  describe("getPlaylistsForSong", () => {
    it("should return empty array when MBID not in any playlist", async () => {
      const { getPlaylistsForSong } = await import("../playlist-service");
      const result = await getPlaylistsForSong("mbid-nonexistent");
      expect(result).toEqual([]);
    });

    it("should return empty array for empty MBID", async () => {
      const { getPlaylistsForSong } = await import("../playlist-service");
      const result = await getPlaylistsForSong("");
      expect(result).toEqual([]);
    });

    it("should return all playlists containing a MBID", async () => {
      const { createPlaylist, addSongToPlaylist, getPlaylistsForSong } = await import("../playlist-service");
      const pl1 = await createPlaylist("Playlist 1", TEST_ORIGIN_ID);
      const pl2 = await createPlaylist("Playlist 2", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl1.id, "mbid-shared");
      await addSongToPlaylist(pl2.id, "mbid-shared");
      const result = await getPlaylistsForSong("mbid-shared");
      expect(result.length).toBe(2);
      expect(result.map((p) => p.name).sort()).toEqual(["Playlist 1", "Playlist 2"]);
    });
  });

  describe("reorderPlaylistSongs", () => {
    it("should reorder MBIDs in a playlist", async () => {
      const { createPlaylist, addSongToPlaylist, reorderPlaylistSongs, getPlaylistSongIds } = await import("../playlist-service");
      const pl = await createPlaylist("Test", TEST_ORIGIN_ID);
      await addSongToPlaylist(pl.id, "mbid-a");
      await addSongToPlaylist(pl.id, "mbid-b");
      await addSongToPlaylist(pl.id, "mbid-c");

      await reorderPlaylistSongs(pl.id, ["mbid-c", "mbid-a", "mbid-b"]);
      const ids = await getPlaylistSongIds(pl.id);
      expect(ids).toEqual(["mbid-c", "mbid-a", "mbid-b"]);
    });
  });
});
