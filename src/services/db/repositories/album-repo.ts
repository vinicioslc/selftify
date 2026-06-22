import { query, exec } from "../database";
import type { SqliteDbAlbumMeta, SqliteDbAlbumTrack, SqliteDbImage } from "../../sqlite-db/sqlite-db-types";
import { getTracksByAlbum, deleteTracksByAlbum, upsertTrack } from "./track-repo";

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
  updated_at: number;
  enriched_at: number | null;
  deleted_at: number | null;
}

function rowToAlbumMeta(row: AlbumRow, tracks: SqliteDbAlbumTrack[]): SqliteDbAlbumMeta {
  return {
    $schema: "selftify-album",
    version: 1,
    name: row.name,
    artistName: row.artist_name,
    albumArtist: row.album_artist,
    releaseYear: row.release_year,
    mbzId: row.mbz_id,
    mbzReleaseGroupId: row.mbz_release_group_id,
    genres: JSON.parse(row.genres || "[]"),
    images: JSON.parse(row.images || "[]"),
    songCount: row.song_count,
    duration: row.duration,
    tracks,
    updatedAt: row.updated_at,
    enrichedAt: row.enriched_at,
  };
}

function albumToRow(meta: SqliteDbAlbumMeta, artistId: string, deletedAt?: number | null): AlbumRow {
  return {
    id: `${artistId}/${meta.name}`,
    artist_id: artistId,
    name: meta.name,
    artist_name: meta.artistName,
    album_artist: meta.albumArtist || null,
    release_year: meta.releaseYear || null,
    mbz_id: meta.mbzId || null,
    mbz_release_group_id: meta.mbzReleaseGroupId || null,
    genres: JSON.stringify(meta.genres || []),
    images: JSON.stringify(meta.images || []),
    song_count: meta.songCount || 0,
    duration: meta.duration || 0,
    updated_at: meta.updatedAt,
    enriched_at: meta.enrichedAt || null,
    deleted_at: deletedAt ?? null,
  };
}

export function getAllAlbums(includeDeleted = false): { meta: SqliteDbAlbumMeta; artistDir: string }[] {
  const sql = includeDeleted
    ? "SELECT * FROM albums ORDER BY name COLLATE NOCASE"
    : "SELECT * FROM albums WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE";
  const rows = query<AlbumRow>(sql);
  return rows.map((r) => ({
    meta: rowToAlbumMeta(r, getTracksByAlbum(r.id)),
    artistDir: r.artist_id,
  }));
}

export function findAlbumByName(artistName: string, albumName: string, includeDeleted = false): SqliteDbAlbumMeta | null {
  const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
  const rows = query<AlbumRow>(
    "SELECT * FROM albums WHERE artist_name COLLATE NOCASE = ? AND name COLLATE NOCASE = ?" + deletedClause,
    [artistName, albumName],
  );
  if (!rows.length) return null;
  return rowToAlbumMeta(rows[0], getTracksByAlbum(rows[0].id));
}

export function getAlbumsByArtist(artistName: string, includeDeleted = false): SqliteDbAlbumMeta[] {
  const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
  const rows = query<AlbumRow>(
    "SELECT * FROM albums WHERE artist_name COLLATE NOCASE = ?" + deletedClause + " ORDER BY name COLLATE NOCASE",
    [artistName],
  );
  return rows.map((r) => rowToAlbumMeta(r, getTracksByAlbum(r.id)));
}

export function upsertAlbum(meta: SqliteDbAlbumMeta, artistId: string): void {
  const r = albumToRow(meta, artistId);
  exec(
    `INSERT OR REPLACE INTO albums (id, artist_id, name, artist_name, album_artist, release_year, mbz_id, mbz_release_group_id, genres, images, song_count, duration, updated_at, enriched_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.id, r.artist_id, r.name, r.artist_name, r.album_artist, r.release_year, r.mbz_id, r.mbz_release_group_id, r.genres, r.images, r.song_count, r.duration, r.updated_at, r.enriched_at, r.deleted_at],
  );
  deleteTracksByAlbum(r.id);
  for (const t of meta.tracks) {
    upsertTrack(t, r.id);
  }
}

export function searchAlbums(queryText: string, includeDeleted = false): SqliteDbAlbumMeta[] {
  const like = `%${queryText.toLowerCase()}%`;
  const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
  const rows = query<AlbumRow>(
    "SELECT * FROM albums WHERE LOWER(name) LIKE ? COLLATE NOCASE" + deletedClause + " ORDER BY name",
    [like],
  );
  return rows.map((r) => rowToAlbumMeta(r, getTracksByAlbum(r.id)));
}

export function deleteAlbum(albumId: string): void {
  exec("DELETE FROM albums WHERE id = ?", [albumId]);
}

export function softDeleteAlbum(albumId: string): void {
  exec("UPDATE albums SET deleted_at = ?, images = '[]' WHERE id = ?", [Date.now(), albumId]);
}

export function restoreAlbum(albumId: string): void {
  exec("UPDATE albums SET deleted_at = NULL WHERE id = ?", [albumId]);
}

export function getDeletedAlbums(): { meta: SqliteDbAlbumMeta; artistDir: string }[] {
  const rows = query<AlbumRow>("SELECT * FROM albums WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
  return rows.map((r) => ({
    meta: rowToAlbumMeta(r, getTracksByAlbum(r.id)),
    artistDir: r.artist_id,
  }));
}
