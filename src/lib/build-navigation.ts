import type { Album, AlbumArtist, Song, Origin } from "../types/domain-types";
import { OriginType } from "../types/domain-types";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildArtistNav(song: Pick<Song, "artistId" | "artistName" | "originId" | "originType" | "imageUrl" | "mbzArtistId">): AlbumArtist {
  return {
    id: song.artistId || `artist-${slugify(song.artistName)}`,
    originId: song.originId,
    originType: song.originType,
    name: song.artistName,
    imageUrl: song.imageUrl || null,
    mbz: song.mbzArtistId,
  };
}

export function buildAlbumNav(song: Pick<Song, "albumId" | "albumName" | "artistName" | "originId" | "originType" | "imageUrl" | "albumArtistName" | "mbzAlbumId" | "mbzReleaseGroupId">): Album | null {
  if (!song.albumName) return null;
  return {
    id: song.albumId || `album-${slugify(song.artistName)}-${slugify(song.albumName)}`,
    originId: song.originId,
    originType: song.originType,
    name: song.albumName,
    albumArtistName: song.albumArtistName || song.artistName,
    imageUrl: song.imageUrl || null,
    mbzId: song.mbzAlbumId,
    mbzReleaseGroupId: song.mbzReleaseGroupId,
  };
}

export function buildLocalOrigin(form: {
  folderPath: string;
  downloadFolder: string;
  enableOnlineSearch: boolean;
  musicBrainzToken: string;
  musicBrainzClientId: string;
  musicBrainzClientSecret: string;
  musicBrainzRefreshToken: string;
  musicBrainzTokenExpiresAt: number;
  youtubeMusicHeaders: string;
}): Origin {
  return {
    id: crypto.randomUUID(),
    name: form.folderPath.split("/").filter(Boolean).pop() || "Local Files",
    type: OriginType.LOCAL,
    folderPath: form.folderPath,
    downloadFolder: form.downloadFolder || form.folderPath,
    enableOnlineSearch: form.enableOnlineSearch,
    musicBrainzToken: form.musicBrainzToken || undefined,
    musicBrainzClientId: form.musicBrainzClientId || undefined,
    musicBrainzClientSecret: form.musicBrainzClientSecret || undefined,
    musicBrainzRefreshToken: form.musicBrainzRefreshToken || undefined,
    musicBrainzTokenExpiresAt: form.musicBrainzTokenExpiresAt || undefined,
    youtubeMusicHeaders: form.youtubeMusicHeaders || undefined,
  };
}
