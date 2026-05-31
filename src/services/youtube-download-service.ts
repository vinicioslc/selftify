import type { Song } from "../types/domain-types";
import { scoreYouTubeResults, type YoutubeSearchVideo } from "./youtube-ranking";

type ElectronApi = {
  yt: {
    search: (query: string) => Promise<YtDlpSearchItem[]>;
    download: (request: YoutubeDownloadRequest) => Promise<string>;
    getStreamUrl: (videoId: string) => Promise<string | null>;
  };
};

type YtDlpSearchItem = {
  id: string;
  title: string;
  duration: number | null;
  uploader: string;
};

type YoutubeDownloadRequest = {
  searchQuery: string;
  videoId: string;
  downloadFolder: string;
  metadata: {
    title: string;
    artist: string;
    album?: string;
    albumArtist?: string;
    trackNumber?: number;
    discNumber?: number;
    releaseYear?: number;
    coverArtUrl?: string | null;
    mbzRecordingId?: string;
    mbzTrackId?: string;
    genres?: string[];
  };
};

function getElectronApi(): ElectronApi | null {
  if (typeof window !== "undefined" && (window as any).electronApi?.yt) {
    return (window as any).electronApi as ElectronApi;
  }
  return null;
}

export async function searchAndRank(
  song: Song,
): Promise<{ videoId: string; title: string } | null> {
  const api = getElectronApi();
  if (!api) {
    console.warn("[yt-download] Electron API not available, falling back to stream");
    return null;
  }

  const query = `${song.artistName} ${song.name}`;

  try {
    const items = await api.yt.search(query);
    if (!items || items.length === 0) return null;

    const videos: YoutubeSearchVideo[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      duration: item.duration ? { seconds: item.duration } : undefined,
      uploader: item.uploader,
    }));

    const ranked = scoreYouTubeResults(videos, {
      title: song.name,
      artist: song.artistName,
      album: song.albumName,
      duration: song.duration ?? undefined,
    });

    if (ranked.length === 0) return null;

    const best = ranked[0];
    return { videoId: best.video.id, title: best.video.title };
  } catch (err) {
    console.error("[yt-download] search error:", err);
    return null;
  }
}

export async function getStreamUrl(song: Song): Promise<string | null> {
  const match = await searchAndRank(song);
  if (!match) return null;

  const api = getElectronApi();
  if (!api) return null;

  try {
    return await api.yt.getStreamUrl(match.videoId);
  } catch (err) {
    console.error("[yt-stream] getStreamUrl error:", err);
    return null;
  }
}

export async function downloadAndGetPath(
  song: Song,
  downloadFolder: string,
): Promise<string | null> {
  const api = getElectronApi();
  if (!api) return null;

  const match = await searchAndRank(song);
  if (!match) return null;

  try {
    const filePath = await api.yt.download({
      searchQuery: `${song.artistName} ${song.name}`,
      videoId: match.videoId,
      downloadFolder,
      metadata: {
        title: song.name,
        artist: song.artistName,
        album: song.albumName,
        albumArtist: song.albumArtistName,
        trackNumber: song.trackNumber,
        discNumber: song.discNumber,
        releaseYear: song.releaseYear,
        coverArtUrl: song.imageUrl,
        mbzRecordingId: song.mbzRecordingId,
        mbzTrackId: song.mbzTrackId,
        genres: song.genres,
      },
    });
    return filePath;
  } catch (err) {
    console.error("[yt-download] download error:", err);
    return null;
  }
}
