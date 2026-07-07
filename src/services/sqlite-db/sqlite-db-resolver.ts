import { OriginType } from "../../types/domain-types";
import type { Song, Album, AlbumArtist } from "../../types/domain-types";
import type { SqliteDbAlbumMeta, SqliteDbAlbumTrack, SqliteDbArtistMeta } from "./sqlite-db-types";
import { joinPaths } from "../../lib/path-utils";

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
  // If track.name is empty or looks like a full path (contains / or \),
  // fall back to the filename stem from track.path
  let displayName = track.name;
  if (
    !displayName ||
    displayName.includes("/") ||
    displayName.includes("\\") ||
    /^[A-Za-z]__/.test(displayName)
  ) {
    const stem = track.path.split("/").pop()?.split("\\").pop()?.replace(/\.[^/.]+$/, "") || "";
    displayName = stem || "Unknown Track";
  }

  return {
    id: albumMeta
      ? `${originId}:${albumMeta.name}:${track.path}`
      : `${originId}:${trackFallbackId(track)}`,
    originId,
    originType,
    name: displayName,
    artistName: track.artistName,
    albumName: track.albumName || albumMeta?.name || undefined,
    albumArtistName: albumMeta?.albumArtist || undefined,
    trackNumber: track.trackNumber || undefined,
    discNumber: track.discNumber || undefined,
    duration: track.duration,
    bitrate: track.bitrate,
    imageUrl: imageUrl ?? null,
    path: albumMeta
      ? track.path.includes("/")
        ? track.path
        : joinPaths(albumMeta.artistName, albumMeta.name, track.path)
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
