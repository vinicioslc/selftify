import Database from 'better-sqlite3';
import { app, ipcMain } from 'electron';
import path from 'path';

const dbPath = path.join(app.getPath('userData'), 'yt-music-player.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS song_cache (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      cached_at INTEGER DEFAULT (unixepoch())
    );
  `);
}

ipcMain.handle('db:get', (_e, key: string): string | null => {
  const r = getDb().prepare('SELECT value FROM cache WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())').get(key) as any;
  return r?.value ?? null;
});

ipcMain.handle('db:set', (_e, key: string, value: string, expiresAt?: number): void => {
  getDb().prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)').run(key, value, expiresAt ?? null);
});

ipcMain.handle('db:delete', (_e, key: string): void => {
  getDb().prepare('DELETE FROM cache WHERE key = ?').run(key);
});

ipcMain.handle('db:queue-save', (_e, data: string): void => {
  getDb().prepare('DELETE FROM queue').run();
  getDb().prepare('INSERT INTO queue (data) VALUES (?)').run(data);
});

ipcMain.handle('db:queue-load', (): string | null => {
  const r = getDb().prepare('SELECT data FROM queue ORDER BY id DESC LIMIT 1').get() as any;
  return r?.data ?? null;
});

ipcMain.handle('db:song-cache-get', (_e, id: string): string | null => {
  const r = getDb().prepare('SELECT data FROM song_cache WHERE id = ?').get(id) as any;
  return r?.data ?? null;
});

ipcMain.handle('db:song-cache-set', (_e, id: string, data: string): void => {
  getDb().prepare('INSERT OR REPLACE INTO song_cache (id, data, cached_at) VALUES (?, ?, unixepoch())').run(id, data);
});

app.on('before-quit', () => {
  if (db) { db.close(); db = null; }
});
