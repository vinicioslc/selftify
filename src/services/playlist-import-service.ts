import { API_BASE } from "../api/base";
import { OriginType } from "../types/domain-types";
import type { Song, Playlist } from "../types/domain-types";

export interface ResolvedPlaylist {
  id: string;
  name: string;
  url: string;
  source: string | null;
  imageUrl: string | null;
  entries: ResolvedPlaylistEntry[];
}

export interface ResolvedPlaylistEntry {
  videoId: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  position: number;
}

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

export async function resolveUrl(url: string): Promise<{ playlist: ResolvedPlaylist; songs: Song[] }> {
  const resp = await fetch(`${API_BASE}/api/selftify/youtube/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `Server returned ${resp.status}` }));
    throw new Error((err as any).error || `Failed to resolve URL`);
  }
  const data = await resp.json() as any;
  const p = data.playlist as ResolvedPlaylist;
  const songs: Song[] = p.entries.map((e, i) => ({
    id: `ytimport-${e.videoId}`,
    originId: "selftify-server",
    originType: OriginType.YOUTUBE,
    name: e.title,
    artistName: e.uploader || "Unknown",
    duration: e.duration,
    imageUrl: e.thumbnail,
    youtubeVideoId: e.videoId,
    youtubeVideoTitle: e.title,
    youtubeChannelName: e.uploader || undefined,
    trackNumber: e.position,
    path: undefined,
  }));
  return { playlist: p, songs };
}

export async function saveImportedPlaylist(
  url: string,
  name: string,
  songs: Song[],
): Promise<Playlist> {
  const resp = await fetch(`${API_BASE}/api/selftify/youtube/playlist/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, name, songs }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `Server returned ${resp.status}` }));
    throw new Error((err as any).error || "Failed to save playlist");
  }
  const data = await resp.json() as any;
  const dto = data.playlist as ImportedPlaylistDto;
  return {
    id: dto.id,
    originId: "selftify-server",
    originType: OriginType.YOUTUBE,
    name: dto.name,
    songCount: dto.songCount,
    imageUrl: dto.imageUrl,
    sourceUrl: dto.url,
    source: dto.source || undefined,
    imported: true,
  };
}

export async function refreshImportedPlaylist(id: string): Promise<{ playlist: Playlist; songs: Song[] }> {
  const resp = await fetch(`${API_BASE}/api/selftify/youtube/playlist/${id}/refresh`, {
    method: "PUT",
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `Server returned ${resp.status}` }));
    throw new Error((err as any).error || "Failed to refresh playlist");
  }
  const data = await resp.json() as any;
  const p = (data.playlist ?? data) as ImportedPlaylistDto;
  const entries = (data.songs ?? []) as ResolvedPlaylistEntry[];
  const playlist: Playlist = {
    id: p.id,
    originId: "selftify-server",
    originType: OriginType.YOUTUBE,
    name: p.name,
    songCount: entries.length,
    imageUrl: p.imageUrl,
    sourceUrl: p.url,
    source: p.source || undefined,
    imported: true,
  };
  const songs: Song[] = entries.map((e, i) => ({
    id: `ytimport-${e.videoId}`,
    originId: "selftify-server",
    originType: OriginType.YOUTUBE,
    name: e.title,
    artistName: e.uploader || "Unknown",
    duration: e.duration,
    imageUrl: e.thumbnail,
    youtubeVideoId: e.videoId,
    youtubeVideoTitle: e.title,
    youtubeChannelName: e.uploader || undefined,
    trackNumber: e.position,
    path: undefined,
  }));
  return { playlist, songs };
}

export async function getImportedPlaylists(): Promise<Playlist[]> {
  const resp = await fetch(`${API_BASE}/api/selftify/playlists`);
  if (!resp.ok) return [];
  const data = await resp.json() as any;
  return (data.playlists || []).map((p: ImportedPlaylistDto) => ({
    id: p.id,
    originId: "selftify-server",
    originType: OriginType.YOUTUBE,
    name: p.name,
    songCount: p.songCount,
    imageUrl: p.imageUrl,
    sourceUrl: p.url,
    source: p.source || undefined,
    imported: true,
  }));
}

export async function getImportedPlaylistDetail(id: string): Promise<{ playlist: Playlist; songs: Song[] } | null> {
  const resp = await fetch(`${API_BASE}/api/selftify/playlist/${id}`);
  if (!resp.ok) return null;
  const data = await resp.json() as any;
  const p = data.playlist as ImportedPlaylistDto;
  const tracks = (data.songs ?? []) as ResolvedPlaylistEntry[];
  const songs: Song[] = tracks.map((e, i) => ({
    id: `ytimport-${e.videoId}`,
    originId: "selftify-server",
    originType: OriginType.YOUTUBE,
    name: e.title,
    artistName: e.uploader || "Unknown",
    duration: e.duration,
    imageUrl: e.thumbnail,
    youtubeVideoId: e.videoId,
    youtubeVideoTitle: e.title,
    youtubeChannelName: e.uploader || undefined,
    trackNumber: e.position,
    path: undefined,
  }));
  return {
    playlist: {
      id: p.id,
      originId: "selftify-server",
      originType: OriginType.YOUTUBE,
      name: p.name,
      songCount: p.songCount,
      imageUrl: p.imageUrl,
      sourceUrl: p.url,
      source: p.source || undefined,
      imported: true,
    },
    songs,
  };
}

export async function deleteImportedPlaylist(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/selftify/playlist/${id}`, { method: "DELETE" });
}
