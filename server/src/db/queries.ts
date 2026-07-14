import { getDb } from "./connection";

// ── Row types (raw DB) ──
interface ArtistRow {
  id: string;
  name: string;
  sort_name: string | null;
  mbz_id: string | null;
  biography: string | null;
  genres: string;
  images: string;
  album_count?: number;
}

interface AlbumRow {
  id: string;
  artist_id: string;
  name: string;
  artist_name: string;
  album_artist: string | null;
  release_year: number | null;
  mbz_id: string | null;
  mbz_release_group_id: string | null;
  genres: string;
  images: string;
  song_count: number;
  duration: number;
}

interface TrackRow {
  id: string;
  album_id: string;
  path: string;
  name: string;
  artist_name: string;
  album_name: string | null;
  track_number: number | null;
  disc_number: number | null;
  duration: number | null;
  bitrate: number | null;
  genre: string | null;
  mbz_recording_id: string | null;
}

export interface ArtistIndexEntry {
  id: string;
  name: string;
  albumCount: number;
  coverArt: string;
}

export interface ArtistDetail {
  id: string;
  name: string;
  albumCount: number;
  coverArt: string;
  artistImageUrl?: string;
  biography?: string;
  albums: AlbumDto[];
}

export interface AlbumDto {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  coverArt: string;
  songCount: number;
  duration: number;
  year: number | null;
  genre?: string;
}

export interface SongDto {
  id: string;
  title: string;
  album: string;
  artist: string;
  albumId: string;
  artistId: string;
  coverArt: string;
  duration: number | null;
  bitRate: number | null;
  track: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  path: string;
  contentType: string;
  suffix: string;
  size: number | null;
}

function parseGenres(json: string): string | undefined {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
  } catch {
    return undefined;
  }
}

function guessContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3": return "audio/mpeg";
    case "flac": return "audio/flac";
    case "ogg": return "audio/ogg";
    case "m4a": return "audio/mp4";
    case "opus": return "audio/ogg";
    case "wav": return "audio/wav";
    default: return "audio/mpeg";
  }
}

function albumRowToDto(row: AlbumRow): AlbumDto {
  return {
    id: row.id,
    name: row.name,
    artist: row.artist_name,
    artistId: row.artist_id,
    coverArt: row.id,
    songCount: row.song_count,
    duration: row.duration,
    year: row.release_year,
    genre: parseGenres(row.genres),
  };
}

function trackRowToDto(row: TrackRow, albumName: string, artistName: string, albumId: string): SongDto {
  const suffix = row.path.split(".").pop()?.toLowerCase() || "mp3";
  return {
    id: row.id,
    title: row.name,
    album: albumName,
    artist: artistName,
    albumId,
    artistId: "",
    coverArt: albumId,
    duration: row.duration,
    bitRate: row.bitrate,
    track: row.track_number,
    discNumber: row.disc_number,
    year: null,
    genre: row.genre,
    path: row.path,
    contentType: guessContentType(row.path),
    suffix,
    size: null,
  };
}

// ── Queries ──

export function getArtistsGrouped(): { index: { name: string; artist: ArtistIndexEntry[] }[] } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.*, COUNT(al.id) as album_count
       FROM artists a
       LEFT JOIN albums al ON al.artist_id = a.id AND al.deleted_at IS NULL
       GROUP BY a.id
       ORDER BY a.name COLLATE NOCASE`,
    )
    .all() as (ArtistRow & { album_count: number })[];

  const map = new Map<string, ArtistIndexEntry[]>();
  for (const row of rows) {
    const letter = (row.name || "?").charAt(0).toUpperCase();
    const key = /[A-Z]/.test(letter) ? letter : "#";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({
      id: row.id,
      name: row.name,
      albumCount: row.album_count,
      coverArt: `ar-${row.id}`,
    });
  }
  const index = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, artist]) => ({ name, artist }));
  return { index };
}

export function getArtist(id: string): ArtistDetail | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM artists WHERE id = ?`).get(id) as ArtistRow | undefined;
  if (!row) return null;
  const albumRows = db
    .prepare(`SELECT * FROM albums WHERE artist_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`)
    .all(id) as AlbumRow[];
  const albumCount = albumRows.length;
  return {
    id: row.id,
    name: row.name,
    albumCount,
    coverArt: `ar-${row.id}`,
    biography: row.biography || undefined,
    artistImageUrl: undefined,
    albums: albumRows.map(albumRowToDto),
  };
}

export function getAlbumList2(
  type: string,
  size: number,
  offset: number,
): AlbumDto[] {
  const db = getDb();
  let orderBy = "a.name COLLATE NOCASE";
  switch (type) {
    case "alphabeticalByName": orderBy = "a.name COLLATE NOCASE"; break;
    case "alphabeticalByArtist": orderBy = "ar.name COLLATE NOCASE, a.name COLLATE NOCASE"; break;
    case "byYear": orderBy = "a.release_year DESC"; break;
    case "byGenre": orderBy = "a.genres"; break;
    case "recent": orderBy = "a.updated_at DESC"; break;
    default: orderBy = "a.name COLLATE NOCASE";
  }
  // Deduplicate by artist_name + name using ROW_NUMBER to keep the most
  // recently updated row (handles stale ghost rows from metadata drift).
  const sql = `SELECT a.* FROM (
                 SELECT *, ROW_NUMBER() OVER (
                   PARTITION BY artist_name, name
                   ORDER BY updated_at DESC
                 ) AS rn
                 FROM albums
                 WHERE deleted_at IS NULL
               ) a
               JOIN artists ar ON ar.id = a.artist_id
               WHERE a.rn = 1
               ORDER BY ${orderBy}
               LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(size, offset) as AlbumRow[];
  return rows.map(albumRowToDto);
}

export function getAlbum(id: string): { album: AlbumDto; songs: SongDto[] } | null {
  const db = getDb();
  const albumRow = db.prepare(`SELECT * FROM albums WHERE id = ?`).get(id) as AlbumRow | undefined;
  if (!albumRow) return null;
  const trackRows = db
    .prepare(`SELECT * FROM tracks WHERE album_id = ? ORDER BY disc_number, track_number, name COLLATE NOCASE`)
    .all(id) as TrackRow[];
  const songs = trackRows.map((t) => trackRowToDto(t, albumRow.name, albumRow.artist_name, albumRow.id));
  return { album: albumRowToDto(albumRow), songs };
}

export function getSong(id: string): SongDto | null {
  const db = getDb();
  const trackRow = db
    .prepare(`SELECT t.*, a.name as album_name, a.artist_name FROM tracks t JOIN albums a ON a.id = t.album_id WHERE t.id = ?`)
    .get(id) as (TrackRow & { album_name: string; artist_name: string }) | undefined;
  if (!trackRow) return null;
  return trackRowToDto(trackRow, trackRow.album_name, trackRow.artist_name, trackRow.album_id);
}

export function getSongPath(id: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT path FROM tracks WHERE id = ?`).get(id) as { path: string } | undefined;
  return row?.path ?? null;
}

export function search3(
  query: string,
  artistCount: number,
  albumCount: number,
  songCount: number,
): { artist: ArtistIndexEntry[]; album: AlbumDto[]; song: SongDto[] } {
  const db = getDb();
  const like = `%${query.toLowerCase()}%`;
  const artistRows = db
    .prepare(`SELECT a.*, COUNT(al.id) as album_count FROM artists a
              LEFT JOIN albums al ON al.artist_id = a.id AND al.deleted_at IS NULL
              WHERE LOWER(a.name) LIKE ? GROUP BY a.id ORDER BY a.name COLLATE NOCASE LIMIT ?`)
    .all(like, artistCount) as (ArtistRow & { album_count: number })[];
  const albumRows = db
    .prepare(`SELECT * FROM albums WHERE deleted_at IS NULL AND LOWER(name) LIKE ? ORDER BY name COLLATE NOCASE LIMIT ?`)
    .all(like, albumCount) as AlbumRow[];
  const songRows = db
    .prepare(`SELECT t.*, a.name as album_name, a.artist_name FROM tracks t
              JOIN albums a ON a.id = t.album_id
              WHERE LOWER(t.name) LIKE ? OR LOWER(t.artist_name) LIKE ? OR LOWER(a.name) LIKE ?
              ORDER BY t.name COLLATE NOCASE LIMIT ?`)
    .all(like, like, like, songCount) as (TrackRow & { album_name: string; artist_name: string })[];

  const artist = artistRows.map((r) => ({
    id: r.id,
    name: r.name,
    albumCount: r.album_count,
    coverArt: `ar-${r.id}`,
  }));
  const album = albumRows.map(albumRowToDto);
  const song = songRows.map((r) => trackRowToDto(r, r.album_name, r.artist_name, r.album_id));
  return { artist, album, song };
}

// ── Playlists ──

export interface PlaylistDto {
  id: string;
  name: string;
  owner: string;
  comment?: string;
  public: boolean;
  songCount: number;
  duration: number;
  coverArt: string;
}

export function getPlaylists(): PlaylistDto[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT p.*, COUNT(pt.track_id) as song_count,
              COALESCE(SUM((SELECT duration FROM tracks t WHERE t.id = pt.track_id)), 0) as duration
              FROM playlists p
              LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
              GROUP BY p.id ORDER BY p.name COLLATE NOCASE`)
    .all() as (PlaylistDto & { duration: number })[]; // note: p.* includes public as 0/1
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    owner: r.owner,
    comment: r.comment,
    public: !!r.public,
    songCount: r.songCount,
    duration: r.duration,
    coverArt: r.id,
  }));
}

export function getPlaylist(id: string): { playlist: PlaylistDto; songs: SongDto[] } | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM playlists WHERE id = ?`).get(id) as
    | (Omit<PlaylistDto, "songCount" | "duration" | "coverArt" | "public"> & { public: number })
    | undefined;
  if (!row) return null;
  const trackIds = db
    .prepare(`SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position`)
    .all(id) as { track_id: string }[];
  const songs: SongDto[] = [];
  for (const { track_id } of trackIds) {
    const s = getSong(track_id);
    if (s) songs.push(s);
  }
  const playlist: PlaylistDto = {
    id: row.id,
    name: row.name,
    owner: row.owner,
    comment: row.comment,
    public: !!row.public,
    songCount: songs.length,
    duration: songs.reduce((acc, s) => acc + (s.duration || 0), 0),
    coverArt: row.id,
  };
  return { playlist, songs };
}

// ── Imported Playlists ──

export interface ImportedPlaylistDto {
  id: string;
  name: string;
  url: string;
  source: string | null;
  imageUrl: string | null;
  songCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ImportedPlaylistTrackDto {
  videoId: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  position: number;
  downloaded: boolean;
}

export function getImportedPlaylists(): ImportedPlaylistDto[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM imported_playlists ORDER BY updated_at DESC`)
    .all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    source: r.source || null,
    imageUrl: r.image_url || null,
    songCount: r.song_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getImportedPlaylist(id: string): { playlist: ImportedPlaylistDto; tracks: ImportedPlaylistTrackDto[] } | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM imported_playlists WHERE id = ?`).get(id) as any;
  if (!row) return null;
  const trackRows = db
    .prepare(`SELECT * FROM imported_playlist_tracks WHERE playlist_id = ? ORDER BY position`)
    .all(id) as any[];
  const playlist: ImportedPlaylistDto = {
    id: row.id,
    name: row.name,
    url: row.url,
    source: row.source || null,
    imageUrl: row.image_url || null,
    songCount: row.song_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const tracks: ImportedPlaylistTrackDto[] = trackRows.map((t) => ({
    videoId: t.video_id,
    title: t.title,
    uploader: t.uploader || null,
    duration: t.duration ?? null,
    thumbnail: t.thumbnail || null,
    position: t.position,
    downloaded: !!t.downloaded,
  }));
  return { playlist, tracks };
}

export function saveImportedPlaylist(
  id: string,
  name: string,
  url: string,
  source: string | null,
  imageUrl: string | null,
  tracks: { videoId: string; title: string; uploader: string | null; duration: number | null; thumbnail: string | null; position: number }[],
): ImportedPlaylistDto {
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO imported_playlists (id, name, url, source, image_url, song_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    url,
    source || null,
    imageUrl || null,
    tracks.length,
    now,
    now,
  );

  // Replace all tracks
  db.prepare(`DELETE FROM imported_playlist_tracks WHERE playlist_id = ?`).run(id);
  const insertTrack = db.prepare(`
    INSERT INTO imported_playlist_tracks (playlist_id, video_id, title, uploader, duration, thumbnail, position, downloaded)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  for (const t of tracks) {
    insertTrack.run(id, t.videoId, t.title, t.uploader, t.duration, t.thumbnail, t.position);
  }

  return {
    id,
    name,
    url,
    source: source || null,
    imageUrl: imageUrl || null,
    songCount: tracks.length,
    createdAt: now,
    updatedAt: now,
  };
}

export function deleteImportedPlaylist(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM imported_playlists WHERE id = ?`).run(id);
}

export function markTrackDownloaded(playlistId: string, videoId: string): void {
  const db = getDb();
  db.prepare(`UPDATE imported_playlist_tracks SET downloaded = 1 WHERE playlist_id = ? AND video_id = ?`).run(playlistId, videoId);
}
