import * as albumRepo from "../../services/db/repositories/album-repo";
import * as artistRepo from "../../services/db/repositories/artist-repo";
import * as configRepo from "../../services/db/repositories/config-repo";
import type { SqliteDbAlbumMeta, SqliteDbAlbumTrack, SqliteDbConfig } from "../../services/sqlite-db/sqlite-db-types";
import { getLibraryRoot, ensureDb } from "../../services/db/ensure-db";
import { joinPaths, fileNameFromPath, isAbsolutePath, normalizePath, splitPath } from "../../lib/path-utils";

function trackToId(path: string): string {
  return fileNameFromPath(path).replace(/\.[^.]+$/, "") || path;
}

export async function getSongByMbid(mbid: string): Promise<SqliteDbAlbumTrack & { albumDir: string } | null> {
  const ready = await ensureDb();
  if (!ready) return null;

  const albums = albumRepo.getAllAlbums();
  for (const { meta, artistDir } of albums) {
    const track = meta.tracks.find((t) => t.mbzRecordingId === mbid);
    if (track) return { ...track, albumDir: joinPaths(artistDir, meta.name) };
  }
  return null;
}

export async function getSongById(id: string): Promise<SqliteDbAlbumTrack & { albumDir: string } | null> {
  const ready = await ensureDb();
  if (!ready) return null;

  const relativePath = isAbsolutePath(id) ? id.slice(1) : id;
  const albums = albumRepo.getAllAlbums();
  for (const { meta, artistDir } of albums) {
    const track = meta.tracks.find((t) => t.path === relativePath || t.path === id);
    if (track) return { ...track, albumDir: joinPaths(artistDir, meta.name) };
  }
  return null;
}

export async function getAllSongs(): Promise<SqliteDbAlbumTrack[]> {
  const ready = await ensureDb();
  if (!ready) return [];

  const albums = albumRepo.getAllAlbums();
  const songs: SqliteDbAlbumTrack[] = [];
  for (const { meta } of albums) {
    songs.push(...meta.tracks);
  }
  return songs;
}

export async function getSongCount(): Promise<number> {
  const ready = await ensureDb();
  if (!ready) return 0;
  const val = configRepo.getConfig("songCount");
  return val ? parseInt(val, 10) : 0;
}

export async function getArtistCount(): Promise<number> {
  const ready = await ensureDb();
  if (!ready) return 0;
  const val = configRepo.getConfig("artistCount");
  return val ? parseInt(val, 10) : 0;
}

export async function getAlbumCount(): Promise<number> {
  const ready = await ensureDb();
  if (!ready) return 0;
  const val = configRepo.getConfig("albumCount");
  return val ? parseInt(val, 10) : 0;
}

export async function getScanState(): Promise<{ scan_status: string; root_folder: string } | null> {
  const ready = await ensureDb();
  if (!ready) return null;
  const scanStatus = configRepo.getConfig("scanStatus");
  const root = getLibraryRoot();
  if (!scanStatus || !root) return null;
  return { scan_status: scanStatus, root_folder: root };
}

export async function getDistinctGenres(): Promise<string[]> {
  const ready = await ensureDb();
  if (!ready) return [];

  const albums = albumRepo.getAllAlbums();
  const genreSet = new Set<string>();
  for (const { meta } of albums) {
    meta.genres?.forEach((g) => genreSet.add(g));
  }
  return Array.from(genreSet).sort();
}

export async function getSongByNameAndArtist(
  songName: string,
  artistName: string,
): Promise<(SqliteDbAlbumTrack & { albumDir: string }) | null> {
  const ready = await ensureDb();
  if (!ready) return null;

  const albums = albumRepo.getAllAlbums();
  for (const { meta, artistDir } of albums) {
    const track = meta.tracks.find(
      (t) =>
        t.name.toLowerCase() === songName.toLowerCase() &&
        t.artistName.toLowerCase() === artistName.toLowerCase(),
    );
    if (track) return { ...track, albumDir: joinPaths(artistDir, meta.name) };
  }
  return null;
}

export async function getSongsByAlbum(albumName: string, artistName: string): Promise<SqliteDbAlbumTrack[]> {
  const ready = await ensureDb();
  if (!ready) return [];

  const meta = albumRepo.findAlbumByName(artistName, albumName);
  return meta?.tracks ?? [];
}

export async function getSongsByArtist(artistName: string): Promise<SqliteDbAlbumTrack[]> {
  const ready = await ensureDb();
  if (!ready) return [];

  const albums = albumRepo.getAlbumsByArtist(artistName);
  const result: SqliteDbAlbumTrack[] = [];
  for (const meta of albums) {
    const matching = meta.tracks.filter((t) => t.artistName === artistName);
    result.push(...matching);
  }
  return result;
}

export async function getAlbumsFromSongs(): Promise<SqliteDbAlbumMeta[]> {
  const ready = await ensureDb();
  if (!ready) return [];
  return albumRepo.getAllAlbums().map((a) => a.meta);
}

export async function getArtistsFromSongs(): Promise<SqliteDbAlbumTrack["artistName"][]> {
  const ready = await ensureDb();
  if (!ready) return [];
  const artists = artistRepo.getAllArtists();
  return artists.map((a) => a.name).sort();
}

export async function getAlbumDir(artist: string, album: string): Promise<string | null> {
  const ready = await ensureDb();
  if (!ready) return null;

  const meta = albumRepo.findAlbumByName(artist, album);
  if (!meta) return null;

  const root = getLibraryRoot();
  if (!root) return null;

  // Try to get the actual filesystem path from the first track's path
  if (meta.tracks.length > 0 && meta.tracks[0].path && meta.tracks[0].path.includes("/")) {
    // After file organizer: path = "Artist/Album (Year)/file.ext"
    const parts = splitPath(meta.tracks[0].path);
    if (parts.length >= 2) {
      return joinPaths(root, parts[0], parts[1]);
    }
  }

  // Before organizer or no tracks: construct from sanitized names
  const { sanitizeForPath } = await import("../../services/organizer/sanitizer");
  const artistDir = sanitizeForPath(artist);
  const albumDir = sanitizeForPath(album);
  return meta.releaseYear
    ? joinPaths(root, artistDir, `${albumDir} (${meta.releaseYear})`)
    : joinPaths(root, artistDir, albumDir);
}

export async function getConfig(): Promise<SqliteDbConfig | null> {
  const ready = await ensureDb();
  if (!ready) return null;

  const scanStatus = configRepo.getConfig("scanStatus") as SqliteDbConfig["scanStatus"] || "idle";
  const songCount = parseInt(configRepo.getConfig("songCount") || "0", 10);
  const artistCount = parseInt(configRepo.getConfig("artistCount") || "0", 10);
  const albumCount = parseInt(configRepo.getConfig("albumCount") || "0", 10);
  const lastScanAt = configRepo.getConfig("lastScanAt");
  const createdAt = configRepo.getConfig("createdAt");
  const libraryName = configRepo.getConfig("libraryName") || "My Music";

  return {
    version: 1,
    libraryName,
    createdAt: createdAt ? parseInt(createdAt, 10) : Date.now(),
    lastScanAt: lastScanAt ? parseInt(lastScanAt, 10) : null,
    scanStatus,
    songCount,
    artistCount,
    albumCount,
  };
}
