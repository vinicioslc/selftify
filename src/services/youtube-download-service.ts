import type { Song } from "../types/domain-types";
import { scoreYouTubeResults, persistRanking, type YoutubeSearchVideo, type YoutubeSearchScoredVideo } from "./youtube-ranking";
import {
  getMbzYtMapping,
  setMbzYtMapping,
  deleteMbzYtMapping,
  type MbzYtMapping,
} from "../api/backend-state";
import { useSettingsStore, type YtSearchFields } from "../stores/settings.store";
import { useOnlineSearchStore } from "../stores/online-search.store";
import { useStatusStore } from "../stores/status.store";
import type { CandidateData } from "../api/backend-state";

function getYtHeaders(): string | undefined {
  return useOnlineSearchStore.getState().youtubeMusicHeaders || undefined;
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
  cookies?: string;
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

function buildYtSearchQuery(song: Song, fields: YtSearchFields): string {
  const parts: string[] = [];
  if (fields.artistName && song.artistName) parts.push(song.artistName);
  if (fields.songName && song.name) parts.push(song.name);
  if (fields.albumName && song.albumName) parts.push(song.albumName);
  if (fields.releaseYear && song.releaseYear) parts.push(String(song.releaseYear));
  if (fields.genres && song.genres?.length) parts.push(song.genres[0]);
  return parts.join(" ");
}

export async function searchAndRank(
  song: Song,
): Promise<{ videoId: string; title: string } | null> {
  const fields = useSettingsStore.getState().ytSearchFields;
  const query = buildYtSearchQuery(song, fields);
  const api = getElectronApi();
  const cookies = getYtHeaders();
  const addMsg = (text: string, level: "info" | "success" | "warn" | "danger" = "info") =>
    useStatusStore.getState().addMessage(text, level, "Ranking");

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString("pt-BR") + "." + String(Date.now() % 1000).padStart(3, "0");
    console.log(`[${ts}] [searchAndRank] ${song.mbzRecordingId || "?"}: ${msg}`);
  };

  // Early return if song already has a cached youtubeVideoId
  if (song.youtubeVideoId) {
    log(`using cached youtubeVideoId=${song.youtubeVideoId}`);
    return { videoId: song.youtubeVideoId, title: song.youtubeVideoTitle || song.name };
  }

  log(`starting search: "${query}"`);
  addMsg(`🔍 Searching YouTube for "${song.artistName} — ${song.name}"...`);
  if (!api) { log("no electron API"); return null; }

  if (song.mbzRecordingId) {
    const cached = await getMbzYtMapping(song.mbzRecordingId);
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
      const now = Date.now();
      const candidatesData: CandidateData[] = ranked.map((r) => ({
        videoId: r.video.id,
        title: r.video.title,
        uploader: r.video.uploader || "",
        duration:
          typeof r.video.duration === "object" && r.video.duration
            ? r.video.duration.seconds
            : typeof r.video.duration === "number"
            ? r.video.duration
            : undefined,
        score: r.breakdown.score,
        titleMatch: r.breakdown.titleMatch,
        artistMatch: r.breakdown.artistMatch,
        albumMatch: r.breakdown.albumMatch,
        artistOnChannel: r.breakdown.artistOnChannel,
        channelExactMatch: r.breakdown.channelExactMatch,
        isCover: r.breakdown.isCover,
        exactDuration: r.breakdown.exactDuration,
        closestDuration: r.breakdown.closestDuration,
        keywordScore: r.breakdown.keywordScore,
        diff: r.diff,
        source: "ranking" as const,
      }));
      await setMbzYtMapping({
        mbzRecordingId: song.mbzRecordingId,
        songName: song.name,
        artistName: song.artistName,
        albumName: song.albumName,
        selectedVideoId: best.video.id,
        selectedType: "auto",
        candidates: candidatesData,
        createdAt: now,
        updatedAt: now,
      });
      log(`mapping saved`);
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
  await deleteMbzYtMapping(song.mbzRecordingId);
  await searchAndRank(song);
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
  const cookies = getYtHeaders();
  try {
    const videoInfo = await api.yt.search(videoId, cookies);
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
      channelExactMatch: false,
      isCover: false,
      exactDuration: false,
      closestDuration: false,
      source: "custom",
    };
  } catch {
    return null;
  }
}

export async function searchAndRankAll(song: Song, customQuery?: string): Promise<{ scored: YoutubeSearchScoredVideo[]; query: string } | null> {
  const fields = useSettingsStore.getState().ytSearchFields;
  const query = customQuery ?? buildYtSearchQuery(song, fields);
  const api = getElectronApi();
  const cookies = getYtHeaders();
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
    return { scored, query };
  } catch {
    return null;
  }
}

export async function getSavedSelectedVideoId(song: Song): Promise<string | null> {
  if (!song.mbzRecordingId) return null;
  try {
    const cached = await getMbzYtMapping(song.mbzRecordingId);
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

  // Fast path: cached youtubeVideoId → skip search entirely
  if (song.youtubeVideoId) {
    log(`using cached youtubeVideoId=${song.youtubeVideoId}`);
    addMsg(`▶ Extracting cached stream...`, "info");
    const api = getElectronApi();
    if (api) {
      const cookies = getYtHeaders();
      try {
        const url = await api.yt.getStreamUrl(song.youtubeVideoId, cookies);
        if (url) {
          addMsg(`▶ Audio stream ready — "${song.name}"`, "success");
          return url;
        }
      } catch (err) {
        log(`yt:stream-url failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    // Fall through to searchAndRank if fast path fails
  }

  const match = await searchAndRank(song);
  if (!match) { addMsg("❌ Could not find a YouTube match", "warn"); return null; }
  addMsg(`🎵 Selected: ${match.title}`, "success");
  addMsg("⬇ Extracting audio stream...");
  const api = getElectronApi();
  if (!api) return null;
  const cookies = getYtHeaders();
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
  const cookies = getYtHeaders();
  const match = await searchAndRank(song);
  if (!match) return null;
  try {
    return await api.yt.download({
      searchQuery: `${song.artistName} ${song.name}`,
      videoId: match.videoId, downloadFolder, cookies,
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
