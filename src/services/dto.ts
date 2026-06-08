/**
 * Unified DTO (Data Transfer Object) layer.
 *
 * Provides consistent conversions between database types (DbSong, etc.)
 * and domain types (Song, Album, AlbumArtist).
 *
 * Use these functions everywhere instead of ad-hoc mapping.
 */

import { OriginType } from "../types/domain-types";
import type { Song, Album, AlbumArtist, Playlist } from "../types/domain-types";
import type { DbSong } from "./local-database-types";
import type { SelftifyPlaylist } from "./playlist-service";

// ── Song DTO ──

export function dbSongToSong(
  row: DbSong,
  originId: string,
  originType: OriginType = OriginType.LOCAL,
  imageUrlOverride?: string | null,
): Song {
  return {
    id: row.id,
    originId,
    originType,
    name: row.name,
    artistName: row.artist_name || "Unknown Artist",
    artistId: undefined,
    albumName: row.album_name || undefined,
    albumId: undefined,
    albumArtistName: row.album_artist || undefined,
    trackNumber: row.track_number || undefined,
    discNumber: row.disc_number || undefined,
    duration: row.duration || null,
    imageUrl: imageUrlOverride ?? null,
    path: row.path,
    genres: row.genre ? [row.genre] : [],
    releaseYear: row.year || undefined,
    mbzRecordingId: row.mbz_recording_id || undefined,
    mbzTrackId: row.mbz_track_id || undefined,
    mbzArtistId: row.mbz_artist_id || undefined,
    mbzReleaseGroupId: row.mbz_release_group_id || undefined,
    mbzAlbumId: row.mbz_album_id || undefined,
  };
}

// ── Album DTO ──

export function dbRowToAlbum(
  row: {
    name: string;
    artist_name: string;
    song_count: number;
    duration: number;
  },
  originId: string,
  imageUrl: string | null,
  originType: OriginType = OriginType.LOCAL,
): Album {
  return {
    id: `local-album-${row.artist_name.toLowerCase().replace(/\s+/g, "-")}-${row.name.toLowerCase().replace(/\s+/g, "-")}`,
    originId,
    originType,
    name: row.name,
    albumArtistName: row.artist_name,
    songCount: row.song_count,
    duration: row.duration,
    imageUrl,
  };
}

// ── AlbumArtist DTO ──

export function dbRowToAlbumArtist(
  row: {
    name: string;
    song_count: number;
    album_count: number;
  },
  originId: string,
  imageUrl: string | null,
  originType: OriginType = OriginType.LOCAL,
): AlbumArtist {
  return {
    id: `local-artist-${row.name.toLowerCase().replace(/\s+/g, "-")}`,
    originId,
    originType,
    name: row.name,
    songCount: row.song_count,
    albumCount: row.album_count,
    imageUrl,
  };
}

// ── Playlist DTO ──

export function selftifyPlaylistToPlaylist(
  sp: SelftifyPlaylist,
): Playlist {
  return {
    id: sp.id,
    originId: sp.originId,
    originType: OriginType.LOCAL,
    name: sp.name,
    songCount: sp.songCount,
    imageUrl: null,
  };
}
