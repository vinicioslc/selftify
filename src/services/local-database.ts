import Dexie, { type EntityTable } from "dexie";
import type { DbSong, DbArtist, ScanState, MbzMetadataCache, MbzSearchCache } from "./local-database-types";

interface ScanStateRow extends ScanState {
  id: number;
}

interface ScanQueueItem {
  id: number;
  type: string;
  path: string;
  created_at: number;
}

class SelftifyDb extends Dexie {
  songs!: EntityTable<DbSong, "id">;
  artists!: EntityTable<DbArtist, "id">;
  scan_state!: EntityTable<ScanStateRow, "id">;
  scan_queue!: EntityTable<ScanQueueItem, "id">;
  mbz_metadata_cache!: EntityTable<MbzMetadataCache, "key">;
  mbz_search_cache!: EntityTable<MbzSearchCache, "key">;

  constructor() {
    super("selftify");
    this.version(1).stores({
      songs: "id, &path, name, artist_name, album_name, genre",
      scan_state: "id",
      scan_queue: "++id",
    });
    this.version(2).stores({
      songs: "id, &path, name, artist_name, album_name, genre, mbz_album_id, mbz_artist_id, mbz_recording_id",
      scan_state: "id",
      scan_queue: "++id",
    });
    this.version(3).stores({
      songs: "id, &path, name, artist_name, album_name, genre, mbz_album_id, mbz_artist_id, mbz_recording_id",
      scan_state: "id",
      scan_queue: "++id",
      mbz_metadata_cache: "key",
      mbz_search_cache: "key, expires_at",
    });
    this.version(4).stores({
      songs: "id, &path, name, artist_name, album_name, genre, mbz_album_id, mbz_artist_id, mbz_recording_id",
      artists: "id, name, mbz_artist_id",
      scan_state: "id",
      scan_queue: "++id",
      mbz_metadata_cache: "key",
      mbz_search_cache: "key, expires_at",
    });
  }
}

export const db = new SelftifyDb();

// ── Song CRUD ──

export async function insertSong(song: Omit<DbSong, "updated_at">) {
  const full: DbSong = { ...song, updated_at: Date.now() };
  await db.songs.put(full);
}

export async function batchInsertSongs(songs: Omit<DbSong, "updated_at">[]) {
  const now = Date.now();
  const full: DbSong[] = songs.map((s) => ({ ...s, updated_at: now }));
  await db.songs.bulkPut(full);
}

export async function deleteAllSongs() {
  await db.songs.clear();
}

export async function deleteSong(id: string) {
  await db.songs.delete(id);
}

export async function getAllSongs(): Promise<DbSong[]> {
  try {
    return await db.songs.toArray();
  } catch {
    return [];
  }
}

export async function getSongById(id: string): Promise<DbSong | null> {
  try {
    return (await db.songs.get(id)) || null;
  } catch {
    return null;
  }
}

export async function searchSongs(query: string, limit = 50): Promise<DbSong[]> {
  try {
    const q = query.toLowerCase();
    const results: DbSong[] = [];
    await db.songs
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.artist_name.toLowerCase().includes(q) ||
          (s.album_name || "").toLowerCase().includes(q),
      )
      .limit(limit)
      .each((s) => results.push(s));
    return results;
  } catch {
    return [];
  }
}

export async function getAllPaths(): Promise<string[]> {
  try {
    const paths: string[] = [];
    await db.songs.each((s) => paths.push(s.path));
    return paths;
  } catch {
    return [];
  }
}

// ── Aggregations ──

export async function getSongCount(): Promise<number> {
  try {
    return await db.songs.count();
  } catch {
    return 0;
  }
}

export async function getArtistCount(): Promise<number> {
  try {
    const keys = await db.songs.orderBy("artist_name").uniqueKeys();
    return keys.length;
  } catch {
    return 0;
  }
}

export async function getAlbumCount(): Promise<number> {
  try {
    const albums = new Set<string>();
    await db.songs
      .filter((s) => s.album_name != null)
      .each((s) => albums.add(s.album_name as string));
    return albums.size;
  } catch {
    return 0;
  }
}

export async function getDistinctGenres(): Promise<string[]> {
  try {
    const keys = await db.songs.orderBy("genre").uniqueKeys();
    return keys.filter((g): g is string => g != null);
  } catch {
    return [];
  }
}

// ── Albums / Artists ──

export async function getAlbumsFromSongs(): Promise<
  Array<{ name: string; artist_name: string; song_count: number; duration: number }>
> {
  try {
    const all = await db.songs.toArray();
    const groups = new Map<
      string,
      { name: string; artist_name: string; song_count: number; duration: number }
    >();
    for (const s of all) {
      if (!s.album_name) continue;
      const key = `${s.artist_name}|${s.album_name}`;
      const existing = groups.get(key);
      if (existing) {
        existing.song_count++;
        existing.duration += s.duration || 0;
      } else {
        groups.set(key, {
          name: s.album_name,
          artist_name: s.artist_name,
          song_count: 1,
          duration: s.duration || 0,
        });
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) =>
        a.artist_name.localeCompare(b.artist_name) ||
        a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }
}

export async function getArtistsFromSongs(): Promise<
  Array<{ name: string; song_count: number; album_count: number }>
> {
  try {
    const all = await db.songs.toArray();
    const groups = new Map<
      string,
      { song_count: number }
    >();
    const artistAlbums = new Map<string, Set<string>>();
    for (const s of all) {
      if (!s.artist_name) continue;
      const g = groups.get(s.artist_name);
      if (g) {
        g.song_count++;
      } else {
        groups.set(s.artist_name, { song_count: 1 });
      }
      if (!artistAlbums.has(s.artist_name))
        artistAlbums.set(s.artist_name, new Set());
      if (s.album_name) artistAlbums.get(s.artist_name)!.add(s.album_name);
    }
    return Array.from(groups.entries())
      .map(([name, g]) => ({
        name,
        song_count: g.song_count,
        album_count: artistAlbums.get(name)?.size || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function getSongsByAlbum(
  albumArtist: string,
  album: string,
): Promise<DbSong[]> {
  try {
    const byAlbum = await db.songs
      .where("album_name")
      .equals(album)
      .toArray();
    return byAlbum
      .filter(
        (s) =>
          s.artist_name === albumArtist || s.album_artist === albumArtist,
      )
      .sort((a, b) => (a.track_number || 0) - (b.track_number || 0) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function getSongsByArtist(artist: string): Promise<DbSong[]> {
  try {
    return await db.songs
      .where("artist_name")
      .equals(artist)
      .sortBy("album_name");
  } catch {
    return [];
  }
}

// ── Scan Queue ──

export async function enqueueScan(
  items: Array<{ type: string; path: string }>,
) {
  const now = Date.now();
  const rows = items.map((item) => ({ type: item.type, path: item.path, created_at: now } as Omit<ScanQueueItem, "id">));
  await db.scan_queue.bulkAdd(rows as any);
}

export async function dequeueScan(): Promise<{
  type: string;
  path: string;
} | null> {
  try {
    const item = await db.scan_queue.orderBy("id").first();
    if (!item) return null;
    await db.scan_queue.delete(item.id);
    return { type: item.type, path: item.path };
  } catch {
    return null;
  }
}

export async function getQueueCount(): Promise<number> {
  try {
    return await db.scan_queue.count();
  } catch {
    return 0;
  }
}

export async function clearQueue() {
  try {
    await db.scan_queue.clear();
  } catch {}
}

// ── Scan State ──

export async function getScanState(): Promise<ScanState | null> {
  try {
    const row = await db.scan_state.get(1);
    if (!row) return null;
    const { id: _, ...state } = row;
    return state;
  } catch {
    return null;
  }
}

export async function updateScanState(state: Partial<ScanState>) {
  try {
    const existing =
      (await db.scan_state.get(1)) || {
        id: 1,
        root_folder: "",
        scan_status: "idle",
        total_files: 0,
        scanned_files: 0,
        current_dir: "",
        last_scanned_at: null,
        watcher_enabled: 0,
      };
    await db.scan_state.put({ ...existing, ...state });
  } catch {}
}

// ── Artist CRUD ──

export async function upsertArtist(artist: Omit<DbArtist, "updated_at">) {
  const full: DbArtist = { ...artist, updated_at: Date.now() };
  await db.artists.put(full);
}

export async function getArtistByName(name: string): Promise<DbArtist | null> {
  try {
    return (await db.artists.where("name").equals(name).first()) || null;
  } catch {
    return null;
  }
}

export async function getArtistByMbid(mbid: string): Promise<DbArtist | null> {
  try {
    return (await db.artists.where("mbz_artist_id").equals(mbid).first()) || null;
  } catch {
    return null;
  }
}

export async function getAllArtists(): Promise<DbArtist[]> {
  try {
    return await db.artists.toArray();
  } catch {
    return [];
  }
}

export async function getIndexedArtistCount(): Promise<number> {
  try {
    return await db.artists.count();
  } catch {
    return 0;
  }
}

export async function deleteArtist(id: string) {
  try {
    await db.artists.delete(id);
  } catch {}
}

// Re-export types
export type { DbSong, DbArtist, ScanState, MbzMetadataCache, MbzSearchCache };
