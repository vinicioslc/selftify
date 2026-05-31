import type { Song, Album, AlbumArtist } from "../types/domain-types";
import { OriginType } from "../types/domain-types";

type YtDlpSearchItem = {
  id: string;
  title: string;
  duration: number | null;
  uploader: string;
  thumbnail?: string;
};

type ElectronYtApi = {
  search: (query: string) => Promise<YtDlpSearchItem[]>;
};

type YTPureSearchResult = {
  songs: Song[];
  albums: Album[];
  albumArtists: AlbumArtist[];
  hasMore: boolean;
};

function getElectronYt(): ElectronYtApi | null {
  if (typeof window !== "undefined" && (window as any).electronApi?.yt) {
    return (window as any).electronApi.yt as ElectronYtApi;
  }
  return null;
}

export async function searchYouTubePure(
  query: string,
  _offset?: number,
  _cookie?: string | null,
): Promise<YTPureSearchResult> {
  const api = getElectronYt();
  if (!api) {
    throw new Error("YouTube Pure search requires Electron runtime");
  }

  const rawItems = await api.search(query);
  if (!rawItems || rawItems.length === 0) {
    return { songs: [], albums: [], albumArtists: [], hasMore: false };
  }

  const songs: Song[] = rawItems.map((item, i) => ({
    id: `ytpure-${item.id}`,
    originId: "youtube-pure",
    originType: OriginType.LOCAL,
    name: item.title,
    artistName: item.uploader || "Unknown",
    duration: item.duration,
    imageUrl: item.thumbnail || null,
  }));

  return { songs, albums: [], albumArtists: [], hasMore: false };
}

export function clearYouTubePureCache(_query?: string): void {}
