import type { DbSong, ScanState } from "./local-database-types";

const DB_NAME = "ytmusic.db";

let dbInstance: any = null;
let dbIsIpc = false;

async function initSchema(db: any) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      artist_name TEXT NOT NULL DEFAULT 'Unknown Artist', album_name TEXT,
      album_artist TEXT, track_number INTEGER, disc_number INTEGER,
      duration REAL, bitrate INTEGER, sample_rate INTEGER, genre TEXT,
      year INTEGER, file_size INTEGER, file_extension TEXT,
      last_modified INTEGER, added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_name)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album_name)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_songs_path ON songs(path)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre)");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS scan_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      root_folder TEXT NOT NULL DEFAULT '',
      scan_status TEXT NOT NULL DEFAULT 'idle',
      total_files INTEGER DEFAULT 0, scanned_files INTEGER DEFAULT 0,
      current_dir TEXT DEFAULT '', last_scanned_at INTEGER,
      watcher_enabled INTEGER DEFAULT 0
    )
  `);

  const rows = db.prepare("SELECT id FROM scan_state WHERE id = 1").all();
  if (rows.length === 0) {
    db.prepare("INSERT INTO scan_state (id, root_folder, scan_status) VALUES (1, '', 'idle')").run();
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS scan_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL
    )
  `);
}

async function getDb(): Promise<{ db: any; isIpc: boolean }> {
  if (dbInstance) return { db: dbInstance, isIpc: dbIsIpc };

  try {
    const api = (window as any).electronApi;
    if (api?.db) {
      dbInstance = { api: api.db, isIpc: true };
      dbIsIpc = true;
      return { db: dbInstance, isIpc: true };
    }
  } catch {}

  try {
    const mod = await import("@tauri-apps/plugin-sql");
    const Database = mod.default || mod;
    const db = await Database.load(`sqlite:${DB_NAME}`);
    await initSchema(db);
    dbInstance = db;
    dbIsIpc = false;
    return { db, isIpc: false };
  } catch {
    const mock = createMockDb();
    dbInstance = mock;
    dbIsIpc = false;
    return { db: mock, isIpc: false };
  }
}

function createMockDb() {
  const store = new Map<string, any[]>();
  const scanQueueStore: any[] = [];
  return {
    prepare: (sql: string) => ({
      run: (...params: any[]) => {},
      all: (...params: any[]) => (store.get(sql) || []),
      get: (...params: any[]) => null,
    }),
    exec: async () => {},
    select: async (sql: string, params?: any[]) => {
      if (sql.startsWith("SELECT COUNT")) return [{ count: 0 }];
      if (sql.startsWith("SELECT DISTINCT genre")) return [];
      if (sql.includes("FROM scan_queue") && sql.startsWith("SELECT")) {
        if (sql.includes("COUNT")) return [{ count: scanQueueStore.length }];
        return scanQueueStore.splice(0, 1);
      }
      if (sql.startsWith("SELECT * FROM scan_queue")) return scanQueueStore.splice(0, 1);
      if (sql.startsWith("SELECT path FROM songs")) return [];
      if (sql.startsWith("SELECT album_name")) return [];
      if (sql.startsWith("SELECT artist_name")) return [];
      return [];
    },
    execute: async () => {},
    close: () => {},
  };
}

// ── Song CRUD ──

export async function insertSong(song: Omit<DbSong, "updated_at">) {
  const { db, isIpc } = await getDb();
  if (isIpc) {
    return (db as any).api.songCacheSet(`song:${song.id}`, JSON.stringify(song));
  }
  await db.execute(
    `INSERT OR REPLACE INTO songs (id, path, name, artist_name, album_name, album_artist, track_number, disc_number, duration, bitrate, sample_rate, genre, year, file_size, file_extension, last_modified, added_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [song.id, song.path, song.name, song.artist_name, song.album_name, song.album_artist, song.track_number, song.disc_number, song.duration, song.bitrate, song.sample_rate, song.genre, song.year, song.file_size, song.file_extension, song.last_modified, song.added_at, Date.now()]
  );
}

export async function batchInsertSongs(songs: Omit<DbSong, "updated_at">[]) {
  const { db, isIpc } = await getDb();
  if (isIpc) {
    for (const s of songs) {
      await (db as any).api.songCacheSet(`song:${s.id}`, JSON.stringify(s));
    }
    return;
  }
  for (const song of songs) {
    await db.execute(
      `INSERT OR REPLACE INTO songs (id, path, name, artist_name, album_name, album_artist, track_number, disc_number, duration, bitrate, sample_rate, genre, year, file_size, file_extension, last_modified, added_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [song.id, song.path, song.name, song.artist_name, song.album_name, song.album_artist, song.track_number, song.disc_number, song.duration, song.bitrate, song.sample_rate, song.genre, song.year, song.file_size, song.file_extension, song.last_modified, song.added_at, Date.now()]
    );
  }
}

export async function deleteAllSongs() {
  const { db, isIpc } = await getDb();
  if (isIpc) return;
  try { await db.execute("DELETE FROM songs"); } catch {}
}

export async function deleteSong(id: string) {
  const { db, isIpc } = await getDb();
  if (isIpc) return;
  try { await db.execute("DELETE FROM songs WHERE id = $1", [id]); } catch {}
}

export async function getAllSongs(): Promise<DbSong[]> {
  const { db, isIpc } = await getDb();
  if (isIpc) return [];
  try { return (await db.select("SELECT * FROM songs")) as any; }
  catch { return []; }
}

export async function getSongById(id: string): Promise<DbSong | null> {
  const { db, isIpc } = await getDb();
  if (isIpc) return null;
  try {
    const rows = await db.select("SELECT * FROM songs WHERE id = $1", [id]);
    return (rows[0] as any) || null;
  } catch { return null; }
}

export async function searchSongs(query: string, limit = 50): Promise<DbSong[]> {
  const { db, isIpc } = await getDb();
  if (isIpc) return [];
  try {
    return (await db.select(
      "SELECT * FROM songs WHERE name LIKE $1 OR artist_name LIKE $1 OR album_name LIKE $1 LIMIT $2",
      [`%${query}%`, limit]
    )) as any;
  } catch { return []; }
}

export async function getAllPaths(): Promise<string[]> {
  const { db, isIpc } = await getDb();
  if (isIpc) return [];
  try {
    const rows = await db.select("SELECT path FROM songs");
    return rows.map((r: any) => r.path);
  } catch { return []; }
}

// ── Aggregations ──

export async function getSongCount(): Promise<number> {
  const { db, isIpc } = await getDb();
  if (isIpc) return 0;
  try {
    const rows = await db.select("SELECT COUNT(*) as count FROM songs");
    return rows[0]?.count || 0;
  } catch { return 0; }
}

export async function getArtistCount(): Promise<number> {
  const { db, isIpc } = await getDb();
  if (isIpc) return 0;
  try {
    const rows = await db.select("SELECT COUNT(DISTINCT artist_name) as count FROM songs");
    return rows[0]?.count || 0;
  } catch { return 0; }
}

export async function getAlbumCount(): Promise<number> {
  const { db, isIpc } = await getDb();
  if (isIpc) return 0;
  try {
    const rows = await db.select("SELECT COUNT(DISTINCT album_name) as count FROM songs WHERE album_name IS NOT NULL");
    return rows[0]?.count || 0;
  } catch { return 0; }
}

export async function getDistinctGenres(): Promise<string[]> {
  const { db, isIpc } = await getDb();
  if (isIpc) return [];
  try {
    const rows = await db.select("SELECT DISTINCT genre FROM songs WHERE genre IS NOT NULL");
    return rows.map((r: any) => r.genre);
  } catch { return []; }
}

// ── Albums / Artists ──

export async function getAlbumsFromSongs(): Promise<Array<{ name: string; artist_name: string; song_count: number; duration: number }>> {
  const { db, isIpc } = await getDb();
  if (isIpc) return [];
  try {
    return (await db.select(
      `SELECT album_name as name, artist_name, COUNT(*) as song_count, COALESCE(SUM(duration), 0) as duration FROM songs WHERE album_name IS NOT NULL GROUP BY album_name, artist_name ORDER BY artist_name, album_name`
    )) as any;
  } catch { return []; }
}

export async function getArtistsFromSongs(): Promise<Array<{ name: string; song_count: number; album_count: number }>> {
  const { db, isIpc } = await getDb();
  if (isIpc) return [];
  try {
    return (await db.select(
      `SELECT artist_name as name, COUNT(*) as song_count, COUNT(DISTINCT album_name) as album_count FROM songs GROUP BY artist_name ORDER BY artist_name`
    )) as any;
  } catch { return []; }
}

export async function getSongsByAlbum(albumArtist: string, album: string): Promise<DbSong[]> {
  const { db, isIpc } = await getDb();
  if (isIpc) return [];
  try {
    return (await db.select(
      `SELECT * FROM songs WHERE (album_artist = $1 OR artist_name = $1) AND album_name = $2 ORDER BY track_number, name`,
      [albumArtist, album]
    )) as any;
  } catch { return []; }
}

export async function getSongsByArtist(artist: string): Promise<DbSong[]> {
  const { db, isIpc } = await getDb();
  if (isIpc) return [];
  try {
    return (await db.select(
      `SELECT * FROM songs WHERE artist_name = $1 ORDER BY album_name, track_number, name`,
      [artist]
    )) as any;
  } catch { return []; }
}

// ── Scan Queue ──

export async function enqueueScan(items: Array<{ type: string; path: string }>) {
  const { db, isIpc } = await getDb();
  if (isIpc) return;
  const now = Date.now();
  for (const item of items) {
    await db.execute(
      "INSERT INTO scan_queue (type, path, created_at) VALUES ($1, $2, $3)",
      [item.type, item.path, now]
    );
  }
}

export async function dequeueScan(): Promise<{ type: string; path: string } | null> {
  const { db, isIpc } = await getDb();
  if (isIpc) return null;
  try {
    const rows = await db.select("SELECT * FROM scan_queue ORDER BY id ASC LIMIT 1");
    if (!rows || rows.length === 0) return null;
    const item = rows[0] as any;
    await db.execute("DELETE FROM scan_queue WHERE id = $1", [item.id]);
    return { type: item.type, path: item.path };
  } catch { return null; }
}

export async function getQueueCount(): Promise<number> {
  const { db, isIpc } = await getDb();
  if (isIpc) return 0;
  try {
    const rows = await db.select("SELECT COUNT(*) as count FROM scan_queue");
    return rows[0]?.count || 0;
  } catch { return 0; }
}

export async function clearQueue() {
  const { db, isIpc } = await getDb();
  if (isIpc) return;
  try { await db.execute("DELETE FROM scan_queue"); } catch {}
}

// ── Scan State ──

export async function getScanState(): Promise<ScanState | null> {
  const { db, isIpc } = await getDb();
  if (isIpc) return null;
  try {
    const rows = await db.select("SELECT * FROM scan_state WHERE id = 1");
    return (rows[0] as any) || null;
  } catch { return null; }
}

export async function updateScanState(state: Partial<ScanState>) {
  const { db, isIpc } = await getDb();
  if (isIpc) return;
  try {
    const keys = Object.keys(state);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.values(state);
    await db.execute(`UPDATE scan_state SET ${setClause} WHERE id = 1`, values);
  } catch {}
}

// Re-export types
export type { DbSong, ScanState };
