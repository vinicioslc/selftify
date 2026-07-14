import path from "path";
import fs from "fs";
import os from "os";
import Database from "better-sqlite3";
import { config } from "../config";
import { CREATE_TABLES } from "./schema";

let db: Database.Database | null = null;

// The backend DB is the single source of truth and lives at a FIXED location,
// independent of `libraryRoot`. `libraryRoot` is only the directory scanned for
// music files; it is stored as a config row inside this DB. Keeping the DB
// location fixed avoids a chicken-and-egg problem where the DB path would
// depend on a value (libraryRoot) that only exists inside the DB.
export function getDbPath(): string {
  if (process.env.SELFTIFY_DB_PATH) return process.env.SELFTIFY_DB_PATH;
  return path.join(os.homedir(), ".selftify", "library.db");
}

export function initDb(): void {
  if (db) return;
  const dbPath = getDbPath();
  console.log(`[Selftify] Database location: ${dbPath}`);
  // Ensure the parent (.selftify) directory exists before opening.
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch (err) {
    console.warn("[db] cannot create database directory:", (err as Error).message);
  }
  const opts = config.dbReadonly
    ? { readonly: true, fileMustExist: true }
    : {};
  try {
    db = new Database(dbPath, opts);
  } catch (err) {
    // Non-fatal: the server still starts and answers capabilities/ping/auth.
    // Library endpoints will error until a valid LIBRARY_ROOT is configured.
    console.warn(
      `[db] could not open database at ${dbPath} — library endpoints unavailable. ` +
        `Set LIBRARY_ROOT to a writable directory. (${(err as Error).message})`,
    );
    db = null;
    return;
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Schema principal da biblioteca (artists/albums/tracks/...). O servidor é
  // o dono do banco em modo client-server e cria as tabelas se faltarem.
  for (const sql of CREATE_TABLES) {
    db.exec(sql);
  }

  // Tabelas de playlist são de propriedade do servidor (não existem no schema
  // compartilhado do frontend). Criadas aqui no modo client-server.
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      owner       TEXT NOT NULL DEFAULT 'selftify',
      comment     TEXT,
      public      INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id    TEXT NOT NULL,
      position    INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);

    CREATE TABLE IF NOT EXISTS imported_playlists (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      source      TEXT,
      image_url   TEXT,
      song_count  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS imported_playlist_tracks (
      playlist_id TEXT NOT NULL REFERENCES imported_playlists(id) ON DELETE CASCADE,
      video_id    TEXT NOT NULL,
      title       TEXT NOT NULL,
      uploader    TEXT,
      duration    INTEGER,
      thumbnail   TEXT,
      position    INTEGER NOT NULL,
      downloaded  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (playlist_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_imported_playlist_tracks_playlist ON imported_playlist_tracks(playlist_id);
  `);
}

export function isDbReady(): boolean {
  return db !== null;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
