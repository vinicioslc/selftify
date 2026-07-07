import { describe, it, expect, beforeAll } from "vitest";
import initSqlJs, { Database as SqlJsDatabase } from "sql.js";

const CREATE_TRACKS_TABLE = `
  CREATE TABLE IF NOT EXISTS tracks (
    id                TEXT PRIMARY KEY,
    album_id          TEXT NOT NULL,
    path              TEXT NOT NULL,
    name              TEXT NOT NULL,
    artist_name       TEXT NOT NULL,
    album_name        TEXT,
    track_number      INTEGER,
    disc_number       INTEGER,
    duration          INTEGER,
    bitrate           INTEGER,
    genre             TEXT,
    mbz_recording_id  TEXT,
    mbz_track_id      TEXT
  )`;

function insertTrack(db: SqlJsDatabase, path: string, albumId: string, name: string, artist: string): void {
  const id = `${albumId}/${path}`;
  db.run(
    "INSERT INTO tracks (id, album_id, path, name, artist_name) VALUES (?, ?, ?, ?, ?)",
    [id, albumId, path, name, artist],
  );
}

function countTracks(db: SqlJsDatabase): number {
  return (db.exec("SELECT COUNT(*) as c FROM tracks")[0].values[0][0] as number);
}

function findTrack(db: SqlJsDatabase, path: string): boolean {
  const stmt = db.prepare("SELECT 1 FROM tracks WHERE path = ?");
  stmt.bind([path]);
  const found = stmt.step();
  stmt.free();
  return found;
}

describe("deleteTrack SQL contract", () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  function createDb(): SqlJsDatabase {
    const db = new SQL.Database();
    db.run(CREATE_TRACKS_TABLE);
    return db;
  }

  it("should remove a track by path", () => {
    const db = createDb();
    insertTrack(db, "Artist/Album/song1.mp3", "Artist/Album", "Song 1", "Artist");
    insertTrack(db, "Artist/Album/song2.mp3", "Artist/Album", "Song 2", "Artist");
    insertTrack(db, "Other/Best Of/song3.mp3", "Other/Best Of", "Song 3", "Other");

    expect(countTracks(db)).toBe(3);

    db.run("DELETE FROM tracks WHERE path = ?", ["Artist/Album/song1.mp3"]);

    expect(countTracks(db)).toBe(2);
    expect(findTrack(db, "Artist/Album/song1.mp3")).toBe(false);
    expect(findTrack(db, "Artist/Album/song2.mp3")).toBe(true);
    expect(findTrack(db, "Other/Best Of/song3.mp3")).toBe(true);
  });

  it("should be a no-op when path does not exist", () => {
    const db = createDb();
    insertTrack(db, "Artist/song.mp3", "Artist/Album", "Song", "Artist");

    db.run("DELETE FROM tracks WHERE path = ?", ["NonExistent/song.mp3"]);

    expect(countTracks(db)).toBe(1);
    expect(findTrack(db, "Artist/song.mp3")).toBe(true);
  });

  it("should not affect other rows when deleting one track", () => {
    const db = createDb();
    insertTrack(db, "A/1.mp3", "A/Album", "1", "A");
    insertTrack(db, "A/2.mp3", "A/Album", "2", "A");
    insertTrack(db, "B/3.mp3", "B/Album", "3", "B");

    db.run("DELETE FROM tracks WHERE path = ?", ["A/1.mp3"]);

    const stmt = db.prepare("SELECT path, name FROM tracks ORDER BY name");
    const rows: Array<{ path: string; name: string }> = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as any);
    }
    stmt.free();

    expect(rows).toEqual([
      { path: "A/2.mp3", name: "2" },
      { path: "B/3.mp3", name: "3" },
    ]);
  });
});
