import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertArtist,
  getArtistByName,
  getArtistByMbid,
  getAllArtists,
  getIndexedArtistCount,
  deleteArtist,
} from "../local-database";

/** Helper to seed a known artist */
async function seedArtist(overrides: Record<string, unknown> = {}) {
  await upsertArtist({
    id: "test-artist-1",
    name: "Test Artist",
    mbz_artist_id: "mbid-111",
    biography: "A test artist",
    image_url: null,
    genres: JSON.stringify(["rock", "alternative"]),
    country: "US",
    type: "Person",
    disambiguation: "test artist for unit tests",
    ...overrides,
  });
}

describe("Artist CRUD", () => {
  beforeEach(async () => {
    // Clean all artists between tests
    const all = await getAllArtists();
    for (const a of all) {
      await deleteArtist(a.id);
    }
  });

  describe("upsertArtist", () => {
    it("should insert a new artist", async () => {
      await seedArtist();
      const count = await getIndexedArtistCount();
      expect(count).toBe(1);
    });

    it("should update an existing artist with same id", async () => {
      await seedArtist();
      await upsertArtist({
        id: "test-artist-1",
        name: "Test Artist Updated",
        mbz_artist_id: "mbid-111",
        biography: "Updated biography",
        image_url: null,
        genres: null,
        country: "GB",
        type: "Person",
        disambiguation: null,
      });

      const updated = await getArtistByName("Test Artist Updated");
      expect(updated).not.toBeNull();
      expect(updated!.country).toBe("GB");
      expect(updated!.biography).toBe("Updated biography");
    });

    it("should set updated_at automatically", async () => {
      await seedArtist();
      const artist = await getArtistByName("Test Artist");
      expect(artist).not.toBeNull();
      expect(artist!.updated_at).toBeGreaterThan(0);
    });
  });

  describe("getArtistByName", () => {
    it("should return null for non-existent artist", async () => {
      const result = await getArtistByName("Non Existent");
      expect(result).toBeNull();
    });

    it("should find artist by exact name", async () => {
      await seedArtist();
      const result = await getArtistByName("Test Artist");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Test Artist");
      expect(result!.mbz_artist_id).toBe("mbid-111");
    });

    it("should be case-sensitive", async () => {
      await seedArtist();
      const result = await getArtistByName("test artist");
      // Dexie's `equals` is case-sensitive by default
      expect(result).toBeNull();
    });
  });

  describe("getArtistByMbid", () => {
    it("should return null for non-existent mbid", async () => {
      const result = await getArtistByMbid("no-such-mbid");
      expect(result).toBeNull();
    });

    it("should find artist by mbid", async () => {
      await seedArtist();
      const result = await getArtistByMbid("mbid-111");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Test Artist");
    });
  });

  describe("getAllArtists", () => {
    it("should return empty array when no artists", async () => {
      const all = await getAllArtists();
      expect(all).toEqual([]);
    });

    it("should return all seeded artists", async () => {
      await seedArtist();
      await upsertArtist({
        id: "test-artist-2",
        name: "Second Artist",
        mbz_artist_id: "mbid-222",
        biography: null,
        image_url: null,
        genres: null,
        country: null,
        type: null,
        disambiguation: null,
      });

      const all = await getAllArtists();
      expect(all.length).toBe(2);
      expect(all.map((a) => a.name).sort()).toEqual([
        "Second Artist",
        "Test Artist",
      ]);
    });
  });

  describe("getIndexedArtistCount", () => {
    it("should return 0 when empty", async () => {
      expect(await getIndexedArtistCount()).toBe(0);
    });

    it("should return correct count", async () => {
      await seedArtist();
      expect(await getIndexedArtistCount()).toBe(1);
      await upsertArtist({
        id: "another",
        name: "Another Artist",
        mbz_artist_id: null,
        biography: null,
        image_url: null,
        genres: null,
        country: null,
        type: null,
        disambiguation: null,
      });
      expect(await getIndexedArtistCount()).toBe(2);
    });
  });

  describe("deleteArtist", () => {
    it("should delete an existing artist", async () => {
      await seedArtist();
      expect(await getIndexedArtistCount()).toBe(1);
      await deleteArtist("test-artist-1");
      expect(await getIndexedArtistCount()).toBe(0);
      expect(await getArtistByName("Test Artist")).toBeNull();
    });

    it("should not throw when deleting non-existent artist", async () => {
      await expect(deleteArtist("no-such-id")).resolves.not.toThrow();
    });
  });
});
