import { OriginType } from "../../types/domain-types";
import type { Song, Album, AlbumArtist } from "../../types/domain-types";
import type { SqliteDbAlbumMeta, SqliteDbAlbumTrack, SqliteDbArtistMeta } from "./sqlite-db-types";

function trackFallbackId(track: SqliteDbAlbumTrack): string {
  return track.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? track.path;
}

export function sqliteDbTrackToSong(
  track: SqliteDbAlbumTrack,
  originId: string,
  originType: OriginType = OriginType.LOCAL,
  albumMeta?: SqliteDbAlbumMeta,
  imageUrl?: string | null,
): Song {
  return {
    id: albumMeta
      ? `${originId}:${albumMeta.name}:${track.path}`
      : `${originId}:${trackFallbackId(track)}`,
    originId,
    originType,
    name: track.name,
    artistName: track.artistName,
    albumName: track.albumName || albumMeta?.name || undefined,
    albumArtistName: albumMeta?.albumArtist || undefined,
    trackNumber: track.trackNumber || undefined,
    discNumber: track.discNumber || undefined,
    duration: track.duration,
    imageUrl: imageUrl ?? null,
    path: albumMeta
      ? track.path.includes("/")
        ? track.path
        : `${albumMeta.artistName}/${albumMeta.name}/${track.path}`
      : track.path,
    genres: track.genre ? [track.genre] : [],
    releaseYear: albumMeta?.releaseYear || undefined,
    mbzRecordingId: track.mbzRecordingId || undefined,
    mbzTrackId: track.mbzTrackId || undefined,
  };
}

export function sqliteDbAlbumMetaToAlbum(
  meta: SqliteDbAlbumMeta,
  originId: string,
  originType: OriginType = OriginType.LOCAL,
  imageUrl?: string | null,
): Album {
  return {
    id: `${originId}:${meta.artistName}:${meta.name}`
      .toLowerCase().replace(/[^a-z0-9:]+/g, "-"),
    originId,
    originType,
    name: meta.name,
    albumArtistName: meta.albumArtist || meta.artistName,
    songCount: meta.songCount,
    duration: meta.duration,
    imageUrl: imageUrl ?? null,
    releaseYear: meta.releaseYear || undefined,
    genres: meta.genres,
    mbzId: meta.mbzId || undefined,
    mbzReleaseGroupId: meta.mbzReleaseGroupId || undefined,
  };
}

export function sqliteDbArtistMetaToAlbumArtist(
  meta: SqliteDbArtistMeta,
  originId: string,
  originType: OriginType = OriginType.LOCAL,
  imageUrl?: string | null,
): AlbumArtist {
  return {
    id: `${originId}:${meta.name}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-"),
    originId,
    originType,
    name: meta.name,
    imageUrl: imageUrl ?? null,
    biography: meta.biography || undefined,
    genres: meta.genres,
    mbz: meta.mbzId || undefined,
  };
}
