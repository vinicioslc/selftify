import { query, exec, isReady, initDatabase } from "../database";

export type CoverCacheRow = {
  id: string;
  artist_name: string;
  album_name: string;
  hash: string;
  format: string;
  source_url: string | null;
  created_at: number;
};

export async function ensureDb(root: string): Promise<boolean> {
  if (!isReady()) {
    try {
      await initDatabase(root);
    } catch {
      return false;
    }
  }
  return isReady();
}

export function upsertCoverCache(
  artistName: string,
  albumName: string,
  hash: string,
  format: string,
  sourceUrl?: string,
): void {
  const id = `${artistName.toLowerCase().trim()}|${albumName.toLowerCase().trim()}`;
  exec(
    `INSERT OR REPLACE INTO cover_cache (id, artist_name, album_name, hash, format, source_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, artistName, albumName, hash, format, sourceUrl || null, Date.now()],
  );
}

export function findCoverCache(artistName: string, albumName: string): CoverCacheRow | null {
  const rows = query<CoverCacheRow>(
    `SELECT * FROM cover_cache WHERE artist_name COLLATE NOCASE = ? AND album_name COLLATE NOCASE = ? LIMIT 1`,
    [artistName, albumName],
  );
  return rows.length > 0 ? rows[0] : null;
}
