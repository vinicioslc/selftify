import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { initDb, closeDb, getDb } from "../db/connection";
import { config } from "../config";
import { getAlbumList2, getArtist } from "../db/queries";

let tmpDir: string;

beforeAll(() => {
  closeDb();
  config.libraryRoot = tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-dedup-test-"));
  process.env.SELFTIFY_DB_PATH = path.join(tmpDir, ".selftify", "test-queries.db");
  initDb();
});

afterAll(() => {
  closeDb();
  delete process.env.SELFTIFY_DB_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("album dedup in queries", () => {
  it("getAlbumList2 does not return duplicate rows", () => {
    const db = getDb();

    // Insert artist
    db.prepare(`INSERT OR IGNORE INTO artists (id, name, updated_at) VALUES (?, ?, ?)`)
      .run("ar_test", "TestArtist", Date.now());

    // Insert two competing rows for the same logical album (same artist_name + name)
    db.prepare(
      `INSERT OR IGNORE INTO albums (id, artist_id, name, artist_name, release_year, genres, images, song_count, duration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("al_old", "ar_test", "DedupAlbum", "TestArtist", 2020, "[]", "[]", 5, 1000, Date.now() - 100000);

    db.prepare(
      `INSERT OR IGNORE INTO albums (id, artist_id, name, artist_name, release_year, genres, images, song_count, duration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("al_new", "ar_test", "DedupAlbum", "TestArtist", 2021, "[]", "[]", 5, 1000, Date.now());

    const results = getAlbumList2("alphabeticalByName", 50, 0);
    expect(results).toHaveLength(1);
    // Should return the one with the later updated_at (al_new's release_year)
    expect(results[0].id).toBe("al_new");
    expect(results[0].year).toBe(2021);
  });

  it("getAlbumList2 returns distinct albums when names differ", () => {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO albums (id, artist_id, name, artist_name, genres, images, song_count, duration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("al_distinct_1", "ar_test", "AlbumOne", "TestArtist", "[]", "[]", 3, 600, Date.now());

    db.prepare(
      `INSERT OR IGNORE INTO albums (id, artist_id, name, artist_name, genres, images, song_count, duration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("al_distinct_2", "ar_test", "AlbumTwo", "TestArtist", "[]", "[]", 7, 1400, Date.now());

    const results = getAlbumList2("alphabeticalByName", 50, 0);
    // 2 new + DedupAlbum from previous test
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.name).sort()).toEqual(["AlbumOne", "AlbumTwo", "DedupAlbum"]);
  });

  it("getAlbumList2 filters soft-deleted albums", () => {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO albums (id, artist_id, name, artist_name, genres, images, song_count, duration, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("al_deleted", "ar_test", "DeletedAlbum", "TestArtist", "[]", "[]", 2, 400, Date.now(), 1000);

    const results = getAlbumList2("alphabeticalByName", 50, 0);
    const names = results.map((r) => r.name);
    expect(names).not.toContain("DeletedAlbum");
  });

  it("getAlbumList2 dedup handles same album across different artists", () => {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO artists (id, name, updated_at) VALUES (?, ?, ?)`)
      .run("ar_other", "OtherArtist", Date.now());

    db.prepare(
      `INSERT OR IGNORE INTO albums (id, artist_id, name, artist_name, genres, images, song_count, duration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("al_other", "ar_other", "SameName", "OtherArtist", "[]", "[]", 4, 800, Date.now());

    // TestArtist already has a "DedupAlbum" from the first test
    const results = getAlbumList2("alphabeticalByName", 50, 0);
    const names = results.map((r) => r.name);
    expect(names).toContain("DedupAlbum");
    expect(names).toContain("AlbumOne");
    expect(names).toContain("AlbumTwo");
    expect(names).toContain("SameName");
  });

  it("getArtist does not return soft-deleted albums", () => {
    const artist = getArtist("ar_test");
    expect(artist).not.toBeNull();
    const albumNames = artist!.albums.map((a) => a.name);
    expect(albumNames).not.toContain("DeletedAlbum");
    expect(albumNames).toContain("DedupAlbum");
    expect(albumNames).toContain("AlbumOne");
    expect(albumNames).toContain("AlbumTwo");
  });
});
