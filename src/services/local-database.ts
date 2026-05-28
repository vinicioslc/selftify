import Database from "@tauri-apps/plugin-sql";

const DB_NAME = "sqlite:ytmusic.db";

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load(DB_NAME);
    await initSchema(dbInstance);
  }
  return dbInstance;
}

async function initSchema(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      artist_name TEXT NOT NULL DEFAULT 'Unknown Artist',
      album_name TEXT,
      album_artist TEXT,
      track_number INTEGER,
      disc_number INTEGER,
      duration REAL,
      bitrate INTEGER,
      sample_rate INTEGER,
      genre TEXT,
      year INTEGER,
      file_size INTEGER,
      file_extension TEXT,
      last_modified INTEGER,
      added_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_name)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album_name)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_songs_path ON songs(path)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scan_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      root_folder TEXT NOT NULL DEFAULT '',
      scan_status TEXT NOT NULL DEFAULT 'idle',
      total_files INTEGER DEFAULT 0,
      scanned_files INTEGER DEFAULT 0,
      current_dir TEXT DEFAULT '',
      last_scanned_at INTEGER,
      watcher_enabled INTEGER DEFAULT 0
    )
  `);

  const row: unknown[] = await db.select("SELECT id FROM scan_state WHERE id = 1");
  if (row.length === 0) {
    await db.execute("INSERT INTO scan_state (id, root_folder, scan_status) VALUES (1, '', 'idle')");
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scan_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

// Song types
export type DbSong = {
  id: string;
  path: string;
  name: string;
  artist_name: string;
  album_name: string | null;
  album_artist: string | null;
  track_number: number | null;
  disc_number: number | null;
  duration: number | null;
  bitrate: number | null;
  sample_rate: number | null;
  genre: string | null;
  year: number | null;
  file_size: number | null;
  file_extension: string | null;
  last_modified: number | null;
  added_at: number;
  updated_at: number;
};

export type ScanState = {
  root_folder: string;
  scan_status: string;
  total_files: number;
  scanned_files: number;
  current_dir: string;
  last_scanned_at: number | null;
  watcher_enabled: number;
};

// CRUD operations
export async function insertSong(song: Omit<DbSong, "updated_at">) {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO songs
      (id, path, name, artist_name, album_name, album_artist, track_number,
       disc_number, duration, bitrate, sample_rate, genre, year, file_size,
       file_extension, last_modified, added_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      song.id, song.path, song.name, song.artist_name, song.album_name,
      song.album_artist, song.track_number, song.disc_number, song.duration,
      song.bitrate, song.sample_rate, song.genre, song.year, song.file_size,
      song.file_extension, song.last_modified, song.added_at, Date.now(),
    ]
  );
}

export async function batchInsertSongs(songs: Omit<DbSong, "updated_at">[]) {
  const db = await getDb();
  const now = Date.now();
  for (const song of songs) {
    await db.execute(
      `INSERT OR REPLACE INTO songs
        (id, path, name, artist_name, album_name, album_artist, track_number,
         disc_number, duration, bitrate, sample_rate, genre, year, file_size,
         file_extension, last_modified, added_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        song.id, song.path, song.name, song.artist_name, song.album_name,
        song.album_artist, song.track_number, song.disc_number, song.duration,
        song.bitrate, song.sample_rate, song.genre, song.year, song.file_size,
        song.file_extension, song.last_modified, song.added_at, now,
      ]
    );
  }
}

export async function getAllSongs(): Promise<DbSong[]> {
  const db = await getDb();
  return db.select("SELECT * FROM songs ORDER BY artist_name, album_name, track_number");
}

export async function searchSongs(query: string, limit = 200): Promise<DbSong[]> {
  const db = await getDb();
  const q = `%${query}%`;
  return db.select(
    `SELECT * FROM songs
     WHERE name LIKE $1 OR artist_name LIKE $2 OR album_name LIKE $3
     ORDER BY artist_name, album_name, track_number
     LIMIT $4`,
    [q, q, q, limit]
  );
}

export async function getSongById(id: string): Promise<DbSong | null> {
  const db = await getDb();
  const rows: DbSong[] = await db.select("SELECT * FROM songs WHERE id = $1", [id]);
  return rows[0] || null;
}

export async function getSongByPath(path: string): Promise<DbSong | null> {
  const db = await getDb();
  const rows: DbSong[] = await db.select("SELECT * FROM songs WHERE path = $1", [path]);
  return rows[0] || null;
}

export async function deleteSong(id: string) {
  const db = await getDb();
  await db.execute("DELETE FROM songs WHERE id = $1", [id]);
}

export async function deleteAllSongs() {
  const db = await getDb();
  await db.execute("DELETE FROM songs");
}

export async function getSongCount(): Promise<number> {
  const db = await getDb();
  const rows: { count: number }[] = await db.select("SELECT COUNT(*) as count FROM songs");
  return rows[0]?.count || 0;
}

export async function getArtistCount(): Promise<number> {
  const db = await getDb();
  const rows: { count: number }[] = await db.select("SELECT COUNT(DISTINCT artist_name) as count FROM songs");
  return rows[0]?.count || 0;
}

export async function getAlbumCount(): Promise<number> {
  const db = await getDb();
  const rows: { count: number }[] = await db.select("SELECT COUNT(DISTINCT album_name) as count FROM songs WHERE album_name IS NOT NULL");
  return rows[0]?.count || 0;
}

export async function getAllPaths(): Promise<string[]> {
  const db = await getDb();
  const rows: { path: string }[] = await db.select("SELECT path FROM songs");
  return rows.map((r) => r.path);
}

// Scan state
export async function getScanState(): Promise<ScanState | null> {
  const db = await getDb();
  const rows: ScanState[] = await db.select("SELECT * FROM scan_state WHERE id = 1");
  return rows[0] || null;
}

export async function updateScanState(updates: Partial<ScanState>) {
  const db = await getDb();
  const fields = Object.keys(updates)
    .map((k) => `${k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())} = $${Object.keys(updates).indexOf(k) + 1}`)
    .join(", ");
  const values = Object.values(updates);
  if (fields) {
    await db.execute(`UPDATE scan_state SET ${fields} WHERE id = 1`, values);
  }
}

export async function resetDb() {
  const db = await getDb();
  await db.execute("DELETE FROM songs");
  await db.execute("DELETE FROM scan_queue");
  await db.execute("UPDATE scan_state SET scan_status = 'idle', total_files = 0, scanned_files = 0, current_dir = '', last_scanned_at = NULL WHERE id = 1");
}

// Scan queue
export async function enqueueScan(paths: { type: string; path: string }[]) {
  const db = await getDb();
  const now = Date.now();
  for (const p of paths) {
    await db.execute(
      "INSERT INTO scan_queue (type, path, created_at) VALUES ($1, $2, $3)",
      [p.type, p.path, now]
    );
  }
}

export async function dequeueScan(): Promise<{ id: number; type: string; path: string } | null> {
  const db = await getDb();
  const rows: { id: number; type: string; path: string }[] = await db.select(
    "SELECT id, type, path FROM scan_queue ORDER BY id ASC LIMIT 1"
  );
  if (rows[0]) {
    await db.execute("DELETE FROM scan_queue WHERE id = $1", [rows[0].id]);
  }
  return rows[0] || null;
}

export async function getQueueCount(): Promise<number> {
  const db = await getDb();
  const rows: { count: number }[] = await db.select("SELECT COUNT(*) as count FROM scan_queue");
  return rows[0]?.count || 0;
}

export async function clearQueue() {
  const db = await getDb();
  await db.execute("DELETE FROM scan_queue");
}

export async function getDistinctGenres(): Promise<string[]> {
  const db = await getDb();
  const rows: { genre: string }[] = await db.select(
    "SELECT DISTINCT genre FROM songs WHERE genre IS NOT NULL AND genre != '' ORDER BY genre"
  );
  return rows.map((r) => r.genre);
}

export async function getSongsByGenre(genre: string, limit = 200): Promise<DbSong[]> {
  const db = await getDb();
  return db.select(
    "SELECT * FROM songs WHERE genre = $1 ORDER BY artist_name, album_name, track_number LIMIT $2",
    [genre, limit]
  );
}
