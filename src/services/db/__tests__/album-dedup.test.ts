import { describe, it, expect, beforeAll } from "vitest";
import initSqlJs, { Database as SqlJsDatabase } from "sql.js";

const CREATE_ALBUMS_TABLE = `
  CREATE TABLE IF NOT EXISTS albums (
    id              TEXT PRIMARY KEY,
    artist_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    artist_name     TEXT NOT NULL,
    album_artist    TEXT,
    release_year    INTEGER,
    mbz_id          TEXT,
    mbz_release_group_id TEXT,
    genres          TEXT DEFAULT '[]',
    images          TEXT DEFAULT '[]',
    song_count      INTEGER DEFAULT 0,
    duration        INTEGER DEFAULT 0,
    updated_at      INTEGER NOT NULL,
    enriched_at     INTEGER,
    deleted_at      INTEGER
  )`;

function insertAlbum(
  db: SqlJsDatabase,
  id: string,
  artistId: string,
  name: string,
  artistName: string,
  updatedAt: number,
  releaseYear?: number | null,
  deletedAt?: number | null,
): void {
  db.run(
    `INSERT OR IGNORE INTO albums (id, artist_id, name, artist_name, release_year, genres, images, song_count, duration, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, artistId, name, artistName, releaseYear ?? null, "[]", "[]", 0, 0, updatedAt, deletedAt ?? null],
  );
}

function getAllAlbumsRaw(db: SqlJsDatabase, includeDeleted = false): { id: string; artist_name: string; name: string }[] {
  const deletedClause = includeDeleted ? "" : "WHERE deleted_at IS NULL";
  const sql = includeDeleted
    ? `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY artist_name, name
           ORDER BY updated_at DESC
         ) AS rn
         FROM albums
       )
       WHERE rn = 1
       ORDER BY name COLLATE NOCASE`
    : `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY artist_name, name
           ORDER BY updated_at DESC
         ) AS rn
         FROM albums
         ${deletedClause}
       )
       WHERE rn = 1
       ORDER BY name COLLATE NOCASE`;
  const stmt = db.prepare(sql);
  const rows: { id: string; artist_name: string; name: string }[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as any);
  }
  stmt.free();
  return rows;
}

describe("getAllAlbums dedup query (ROW_NUMBER)", () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  it("should return single row for duplicate album entries", () => {
    const db = new SQL.Database();
    db.run(CREATE_ALBUMS_TABLE);

    insertAlbum(db, "al_old", "ar_test", "DedupAlbum", "TestArtist", Date.now() - 100000, 2020);
    insertAlbum(db, "al_new", "ar_test", "DedupAlbum", "TestArtist", Date.now(), 2021);

    const results = getAllAlbumsRaw(db);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("al_new");
  });

  it("should return distinct rows for different albums", () => {
    const db = new SQL.Database();
    db.run(CREATE_ALBUMS_TABLE);

    insertAlbum(db, "al_1", "ar_test", "AlbumOne", "TestArtist", Date.now());
    insertAlbum(db, "al_2", "ar_test", "AlbumTwo", "TestArtist", Date.now());
    insertAlbum(db, "al_3", "ar_test", "AlbumThree", "TestArtist", Date.now());

    const results = getAllAlbumsRaw(db);
    expect(results).toHaveLength(3);
  });

  it("should separate same-named albums by different artists", () => {
    const db = new SQL.Database();
    db.run(CREATE_ALBUMS_TABLE);

    insertAlbum(db, "al_a", "ar_a", "GreatestHits", "ArtistA", Date.now());
    insertAlbum(db, "al_b", "ar_b", "GreatestHits", "ArtistB", Date.now());

    const results = getAllAlbumsRaw(db);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.artist_name).sort()).toEqual(["ArtistA", "ArtistB"]);
  });

  it("should exclude soft-deleted albums", () => {
    const db = new SQL.Database();
    db.run(CREATE_ALBUMS_TABLE);

    insertAlbum(db, "al_active", "ar_test", "ActiveAlbum", "TestArtist", Date.now());
    insertAlbum(db, "al_deleted", "ar_test", "DeletedAlbum", "TestArtist", Date.now(), null, 1000);

    const results = getAllAlbumsRaw(db, false);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("ActiveAlbum");
  });

  it("should include soft-deleted albums when asked", () => {
    const db = new SQL.Database();
    db.run(CREATE_ALBUMS_TABLE);

    insertAlbum(db, "al_active", "ar_test", "ActiveAlbum", "TestArtist", Date.now());
    insertAlbum(db, "al_deleted", "ar_test", "DeletedAlbum", "TestArtist", Date.now(), null, 1000);

    const results = getAllAlbumsRaw(db, true);
    expect(results).toHaveLength(2);
  });

  it("should handle same-name + same-artist duplicates with one deleted", () => {
    const db = new SQL.Database();
    db.run(CREATE_ALBUMS_TABLE);

    insertAlbum(db, "al_active", "ar_test", "SameName", "TestArtist", Date.now());
    insertAlbum(db, "al_deleted", "ar_test", "SameName", "TestArtist", Date.now() - 1000, null, 500);

    // With deleted excluded: only the active one
    const active = getAllAlbumsRaw(db, false);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("al_active");

    // With deleted included: should dedup to the most recent (al_active)
    const all = getAllAlbumsRaw(db, true);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("al_active");
  });

  it("should return empty for only deleted albums when not including them", () => {
    const db = new SQL.Database();
    db.run(CREATE_ALBUMS_TABLE);

    insertAlbum(db, "al_1", "ar_test", "GoneAlbum", "TestArtist", Date.now(), null, 500);

    const results = getAllAlbumsRaw(db, false);
    expect(results).toHaveLength(0);
  });
});
