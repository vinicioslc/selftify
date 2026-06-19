import { query, exec } from "../database";
import type { SqliteDbAlbumTrack } from "../../sqlite-db/sqlite-db-types";

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
  genre: string | null;
  mbz_recording_id: string | null;
  mbz_track_id: string | null;
}

function rowToTrack(row: TrackRow): SqliteDbAlbumTrack {
  return {
    path: row.path,
    name: row.name,
    artistName: row.artist_name,
    albumName: row.album_name,
    trackNumber: row.track_number,
    discNumber: row.disc_number,
    duration: row.duration,
    genre: row.genre,
    mbzRecordingId: row.mbz_recording_id,
    mbzTrackId: row.mbz_track_id,
  };
}

export function getTracksByAlbum(albumId: string): SqliteDbAlbumTrack[] {
  return query<TrackRow>(
    "SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number, name COLLATE NOCASE",
    [albumId],
  ).map(rowToTrack);
}

export function upsertTrack(track: SqliteDbAlbumTrack, albumId: string): void {
  const id = `${albumId}/${track.path}`;
  exec(
    `INSERT OR REPLACE INTO tracks (id, album_id, path, name, artist_name, album_name, track_number, disc_number, duration, genre, mbz_recording_id, mbz_track_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, albumId, track.path, track.name, track.artistName, track.albumName, track.trackNumber, track.discNumber, track.duration, track.genre, track.mbzRecordingId, track.mbzTrackId],
  );
}

export function deleteTracksByAlbum(albumId: string): void {
  exec("DELETE FROM tracks WHERE album_id = ?", [albumId]);
}

export function deleteTrack(path: string): void {
  exec("DELETE FROM tracks WHERE path = ?", [path]);
}

export function searchTracks(queryText: string): (SqliteDbAlbumTrack & { album_id: string })[] {
  const like = `%${queryText.toLowerCase()}%`;
  return query<any>(
    `SELECT t.* FROM tracks t
     JOIN albums a ON a.id = t.album_id
     WHERE LOWER(t.name) LIKE ? OR LOWER(t.artist_name) LIKE ? OR LOWER(a.name) LIKE ?
     ORDER BY t.name`,
    [like, like, like],
  ).map((r) => ({ ...rowToTrack(r as TrackRow), album_id: r.album_id }));
}
