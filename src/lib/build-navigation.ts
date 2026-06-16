import type { Album, AlbumArtist, Song, Origin } from "../types/domain-types";
import { OriginType } from "../types/domain-types";

export function buildArtistNav(song: Pick<Song, "artistId" | "artistName" | "originId" | "originType" | "imageUrl" | "mbzArtistId">): AlbumArtist {
  return {
    id: song.artistId || `artist-${song.artistName.toLowerCase().replace(/\s+/g, "-")}`,
    originId: song.originId,
    originType: song.originType,
    name: song.artistName,
    imageUrl: song.imageUrl || null,
    mbz: song.mbzArtistId,
  };
}

export function buildAlbumNav(song: Pick<Song, "albumId" | "albumName" | "artistName" | "originId" | "originType" | "imageUrl" | "albumArtistName">): Album | null {
  if (!song.albumName) return null;
  return {
    id: song.albumId || `album-${song.artistName.toLowerCase().replace(/\s+/g, "-")}-${song.albumName.toLowerCase().replace(/\s+/g, "-")}`,
    originId: song.originId,
    originType: song.originType,
    name: song.albumName,
    albumArtistName: song.albumArtistName || song.artistName,
    imageUrl: song.imageUrl || null,
  };
}

export function buildLocalOrigin(form: {
  folderPath: string;
  downloadFolder: string;
  enableOnlineSearch: boolean;
  musicBrainzToken: string;
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
    youtubeMusicHeaders: form.youtubeMusicHeaders || undefined,
  };
}
