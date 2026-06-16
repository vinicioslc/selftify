import type { Song, Origin } from "../types/domain-types";
import { OriginType } from "../types/domain-types";
import { scoreYouTubeResults, persistRanking, type YoutubeSearchVideo, type YoutubeSearchScoredVideo } from "./youtube-ranking";
import { getMbzYtMapping, setMbzYtMapping } from "./sqlite-db/sqlite-db-mappings";
import { useSettingsStore } from "../stores/settings.store";
import { useAuthStore } from "../stores/auth.store";
import { useStatusStore } from "../stores/status.store";
import type { CandidateData, SqliteDbMbzYtMapping } from "./sqlite-db/sqlite-db-types";

function getLibraryRoot(): string | undefined {
  return useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
}

type ElectronApi = {
  yt: {
    search: (query: string, cookies?: string) => Promise<YtDlpSearchItem[]>;
    download: (request: YoutubeDownloadRequest) => Promise<string>;
    getStreamUrl: (videoId: string, cookies?: string) => Promise<string | null>;
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
  const parts = [song.artistName, song.name, song.albumName].filter(Boolean);
  const query = parts.join(" ");
  const api = getElectronApi();
  const cookies = useAuthStore.getState().currentOrigin?.youtubeMusicHeaders;
  const addMsg = (text: string, level: "info" | "success" | "warn" | "danger" = "info") =>
    useStatusStore.getState().addMessage(text, level, "Ranking");

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString("pt-BR") + "." + String(Date.now() % 1000).padStart(3, "0");
    console.log(`[${ts}] [searchAndRank] ${song.mbzRecordingId || "?"}: ${msg}`);
  };

  log(`starting search: "${query}"`);
  addMsg(`🔍 Searching YouTube for "${song.artistName} — ${song.name}"...`);
  if (!api) { log("no electron API"); return null; }

  if (song.mbzRecordingId) {
    const root = getLibraryRoot();
    const cached = root ? await getMbzYtMapping(root, song.mbzRecordingId) : null;
    if (cached) {
      log(`cache HIT → videoId=${cached.selectedVideoId}`);
      addMsg(`📦 Cached match: ${cached.songName}`, "success");
      if (cached.selectedVideoId) {
        return { videoId: cached.selectedVideoId, title: cached.songName };
      }
    }
    log("cache MISS");
  }

  try {
    log("yt:search started");
    const items = await api.yt.search(query, cookies);
    log(`yt:search returned ${items?.length || 0} candidates`);
    if (!items?.length) { addMsg("❌ No YouTube results found"); return null; }
    addMsg(`🔍 Found ${items.length} candidates, ranking...`);

    const weights = useSettingsStore.getState().rankingWeights;
    const videos: YoutubeSearchVideo[] = items.map((item) => ({
      id: item.id, title: item.title,
      duration: item.duration ? { seconds: item.duration } : undefined,
      uploader: item.uploader,
    }));
    const ranked = scoreYouTubeResults(videos, {
      title: song.name, artist: song.artistName, album: song.albumName, duration: song.duration ?? undefined,
    }, weights);
    const best = ranked[0];
    log(`ranking done: best=videoId=${best?.video.id} score=${best?.breakdown.score}`);
    if (!best) { addMsg("❌ No matching video after ranking"); return null; }

    const medals = ["🥇", "🥈", "🥉"];
    const top3 = ranked.slice(0, 3);
    for (let i = 0; i < top3.length; i++) {
      const r = top3[i];
      const medal = medals[i] || `#${i + 1}`;
      const arrow = i === 0 ? " ← selected" : "";
      addMsg(`${medal} ${r.video.title} (${r.video.uploader}) — score ${r.breakdown.score.toFixed(2)}${arrow}`);
    }

    log(`winner: "${best.video.title}" score=${best.breakdown.score}`);
    await persistRanking(query, ranked, song.duration ?? 0);
    if (song.mbzRecordingId) {
      const root = getLibraryRoot();
      if (root) {
        const now = Date.now();
        await setMbzYtMapping(root, {
          mbzRecordingId: song.mbzRecordingId,
          songName: song.name,
          artistName: song.artistName,
          albumName: song.albumName,
          selectedVideoId: best.video.id,
          selectedType: "auto",
          candidates: [],
          createdAt: now,
          updatedAt: now,
        });
        log(`mapping saved`);
      }
    }
    return { videoId: best.video.id, title: best.video.title };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`search failed: ${msg}`);
    addMsg(`❌ YouTube search failed: ${msg.slice(0, 120)}`, "danger");
    console.error("[yt-download] search error:", err);
    return null;
  }
}

export async function researchSong(song: Song): Promise<void> {
  if (!song.mbzRecordingId) return;
  const result = await searchAndRank(song);
  if (result && song.mbzRecordingId) {
    const root = getLibraryRoot();
    if (root) {
      const now = Date.now();
      await setMbzYtMapping(root, {
        mbzRecordingId: song.mbzRecordingId,
        songName: song.name,
        artistName: song.artistName,
        albumName: song.albumName,
        selectedVideoId: result.videoId,
        selectedType: "auto",
        candidates: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

export async function fetchCustomVideoInfo(url: string): Promise<CandidateData | null> {
  // Parse video ID from various YouTube URL formats
  let videoId: string | null = null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      videoId = u.searchParams.get("v") || u.pathname.slice(1).split("/")[0];
    }
  } catch {
    // Might be a plain video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) videoId = url;
  }
  if (!videoId) return null;

  const api = getElectronApi();
  if (!api) return null;
  try {
    const videoInfo = await api.yt.search(videoId, undefined);
    if (!videoInfo || videoInfo.length === 0) return null;
    const v = videoInfo[0];
    return {
      videoId: v.id,
      title: v.title,
      uploader: v.uploader || "",
      duration: v.duration ?? 0,
      score: 0,
      keywordScore: 0,
      diff: 0,
      titleMatch: false,
      artistMatch: false,
      albumMatch: false,
      artistOnChannel: false,
      exactDuration: false,
      closestDuration: false,
      source: "custom",
    };
  } catch {
    return null;
  }
}

export async function searchAndRankAll(song: Song): Promise<{ scored: YoutubeSearchScoredVideo[] } | null> {
  const parts = [song.artistName, song.name, song.albumName].filter(Boolean);
  const query = parts.join(" ");
  const api = getElectronApi();
  const cookies = useAuthStore.getState().currentOrigin?.youtubeMusicHeaders;
  if (!api) return null;

  try {
    const items = await api.yt.search(query, cookies);
    if (!items?.length) return null;
    const videos: YoutubeSearchVideo[] = items.map((item) => ({
      id: item.id, title: item.title,
      duration: item.duration ? { seconds: item.duration } : undefined,
      uploader: item.uploader,
    }));
    const weights = useSettingsStore.getState().rankingWeights;
    const scored = scoreYouTubeResults(videos, {
      title: song.name, artist: song.artistName, album: song.albumName, duration: song.duration ?? undefined,
    }, weights);
    return { scored };
  } catch {
    return null;
  }
}

export async function getSavedSelectedVideoId(song: Song): Promise<string | null> {
  if (!song.mbzRecordingId) return null;
  try {
    const root = getLibraryRoot();
    if (!root) return null;
    const cached = await getMbzYtMapping(root, song.mbzRecordingId);
    return cached?.selectedVideoId ?? null;
  } catch {
    return null;
  }
}

export async function getStreamUrl(song: Song): Promise<string | null> {
  const addMsg = (text: string, level: "info" | "success" | "warn" | "danger" = "info") =>
    useStatusStore.getState().addMessage(text, level, "Player");

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString("pt-BR") + "." + String(Date.now() % 1000).padStart(3, "0");
    console.log(`[${ts}] [getStreamUrl] ${song.mbzRecordingId || song.name}: ${msg}`);
  };

  log("starting");
  const match = await searchAndRank(song);
  if (!match) { addMsg("❌ Could not find a YouTube match", "warn"); return null; }
  addMsg(`🎵 Selected: ${match.title}`, "success");
  addMsg("⬇ Extracting audio stream...");
  const api = getElectronApi();
  if (!api) return null;
  const cookies = useAuthStore.getState().currentOrigin?.youtubeMusicHeaders;
  log("yt:stream-url started");
  try {
    const url = await api.yt.getStreamUrl(match.videoId, cookies);
    if (url) {
      addMsg(`▶ Audio stream ready — "${match.title}"`, "success");
      log(`yt:stream-url OK → url length=${url.length}`);
    } else {
      addMsg("❌ Stream extraction failed", "warn");
      log("yt:stream-url returned null");
    }
    return url;
  } catch (err) {
    log(`yt:stream-url failed: ${err instanceof Error ? err.message : err}`);
    addMsg("❌ Stream extraction error", "danger");
    console.error("[yt-stream] getStreamUrl error:", err);
    return null;
  }
}

export async function downloadAndGetPath(song: Song, downloadFolder: string): Promise<string | null> {
  const api = getElectronApi();
  if (!api) return null;
  const match = await searchAndRank(song);
  if (!match) return null;
  try {
    return await api.yt.download({
      searchQuery: `${song.artistName} ${song.name}`,
      videoId: match.videoId, downloadFolder,
      metadata: {
        title: song.name, artist: song.artistName, album: song.albumName,
        albumArtist: song.albumArtistName, trackNumber: song.trackNumber,
        discNumber: song.discNumber, releaseYear: song.releaseYear,
        coverArtUrl: song.imageUrl, mbzRecordingId: song.mbzRecordingId,
        mbzTrackId: song.mbzTrackId, genres: song.genres,
      },
    });
  } catch (err) { console.error("[yt-download] download error:", err); return null; }
}
