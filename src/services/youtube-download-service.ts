import type { Song } from "../types/domain-types";
import { scoreYouTubeResults, persistRanking, type YoutubeSearchVideo, type YoutubeSearchScoredVideo } from "./youtube-ranking";
import { getMbzYtMapping, setMbzYtMapping, type CandidateData } from "./search-cache";
import { useSettingsStore } from "../stores/settings.store";
import { useRankingDebugStore, type RankingDebugEntry } from "../stores/ranking-debug.store";
import { useAuthStore } from "../stores/auth.store";
import { useStatusStore } from "../stores/status.store";

type ElectronApi = {
  yt: {
    search: (query: string, cookies?: string) => Promise<YtDlpSearchItem[]>;
    download: (request: YoutubeDownloadRequest) => Promise<string>;
    getStreamUrl: (videoId: string, cookies?: string) => Promise<string | null>;
    getVideoInfo: (videoId: string) => Promise<YtVideoInfo | null>;
  };
};

type YtVideoInfo = {
  title: string;
  uploader: string;
  duration: number;
  thumbnail?: string;
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

function debugEntry(query: string, selectedVideoId: string | null, dur: number | null,
  videos?: YoutubeSearchVideo[], scored?: YoutubeSearchScoredVideo[]): RankingDebugEntry {
  return { query, searchQuery: query, videos: videos ?? [], scored: scored ?? [],
    selectedVideoId, duration: dur, timestamp: Date.now() };
}

function scoredToCandidate(s: YoutubeSearchScoredVideo): CandidateData {
  const dur = s.video.duration;
  const seconds = typeof dur === "number" ? dur : (dur && typeof dur === "object" && "seconds" in dur ? dur.seconds : undefined);
  return {
    videoId: s.video.id,
    title: s.video.title,
    uploader: s.video.uploader,
    duration: seconds,
    thumbnailUrl: null,
    score: s.breakdown.score,
    titleMatch: s.breakdown.titleMatch,
    artistMatch: s.breakdown.artistMatch,
    albumMatch: s.breakdown.albumMatch,
    artistOnChannel: s.breakdown.artistOnChannel,
    exactDuration: s.breakdown.exactDuration,
    closestDuration: s.breakdown.closestDuration,
    keywordScore: s.breakdown.keywordScore,
    diff: s.diff,
    source: "ranking",
  };
}

function candidateToScored(c: CandidateData): YoutubeSearchScoredVideo {
  return {
    video: { id: c.videoId, title: c.title, uploader: c.uploader, duration: c.duration ? { seconds: c.duration } : undefined },
    breakdown: {
      titleMatch: c.titleMatch, artistMatch: c.artistMatch, albumMatch: c.albumMatch,
      artistOnChannel: c.artistOnChannel,
      exactDuration: c.exactDuration, closestDuration: c.closestDuration,
      keywordScore: c.keywordScore ?? 0,
      score: c.score,
    },
    diff: c.diff,
    originalIndex: 0,
  };
}

export async function getSavedSelectedVideoId(song: Song): Promise<string | null> {
  if (!song.mbzRecordingId) return null;
  const saved = await getMbzYtMapping(song.mbzRecordingId);
  return saved?.selectedVideoId ?? null;
}

export async function searchAndRank(
  song: Song,
): Promise<{ videoId: string; title: string } | null> {
  const result = await searchAndRankInternal(song);
  if (!result) return null;
  return { videoId: result.scored[result.selectedIndex]?.video.id ?? result.scored[0].video.id, title: result.scored[0].video.title };
}

export async function searchAndRankAll(
  song: Song,
  cookiesOverride?: string | null,
): Promise<{ scored: YoutubeSearchScoredVideo[]; selectedIndex: number } | null> {
  return searchAndRankInternal(song, cookiesOverride);
}

async function searchAndRankInternal(
  song: Song,
  cookiesOverride?: string | null,
): Promise<{ scored: YoutubeSearchScoredVideo[]; selectedIndex: number } | null> {
  const parts = [song.artistName, song.name, song.albumName].filter(Boolean);
  const query = parts.join(" ");
  const api = getElectronApi();
  const cookies = cookiesOverride ?? useAuthStore.getState().currentOrigin?.youtubeMusicHeaders;
  const push = (selected: string | null, v?: YoutubeSearchVideo[], s?: YoutubeSearchScoredVideo[]) =>
    useRankingDebugStore.getState().pushEntry(debugEntry(query, selected, song.duration, v, s));
  const addMsg = (text: string, level: "info" | "success" | "warn" | "danger" = "info") =>
    useStatusStore.getState().addMessage(text, level, "Ranking");

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString("pt-BR") + "." + String(Date.now() % 1000).padStart(3, "0");
    console.log(`[${ts}] [searchAndRank] ${song.mbzRecordingId || "?"}: ${msg}`);
  };

  log(`starting search: "${query}"`);
  addMsg(`🔍 Searching YouTube for "${song.artistName} — ${song.name}"...`);
  if (!api) { log("no electron API"); push(null); return null; }

  // Check saved mapping (all candidates + selection)
  if (song.mbzRecordingId) {
    const saved = await getMbzYtMapping(song.mbzRecordingId);
    if (saved && saved.candidates) {
      log(`cache HIT → selectedVideoId=${saved.selectedVideoId}, candidates=${JSON.parse(saved.candidates).length}`);
      addMsg(`📦 Using saved data for "${song.name}"`, "success");
      const candidates: CandidateData[] = JSON.parse(saved.candidates);
      const scored = candidates.map(candidateToScored);
      const selectedIndex = scored.findIndex(s => s.video.id === saved.selectedVideoId);
      push(saved.selectedVideoId, scored.map(s => s.video), scored);
      if (selectedIndex >= 0) {
        return { scored, selectedIndex };
      }
      return { scored, selectedIndex: 0 };
    }
    log("cache MISS");
  }

  // Full search + ranking
  try {
    log("yt:search started");
    const items = await api.yt.search(query, cookies);
    log(`yt:search returned ${items?.length || 0} candidates`);
    if (!items?.length) { addMsg("❌ No YouTube results found"); push(null); return null; }
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
    push(best?.video.id ?? null, videos, ranked);
    if (!best) { addMsg("❌ No matching video after ranking"); return null; }

    const top3 = ranked.slice(0, 3);
    for (let i = 0; i < top3.length; i++) {
      const r = top3[i];
      const arrow = i === 0 ? " ← selected" : "";
      addMsg(`#${i + 1} ${r.video.title} (${r.video.uploader}) — score ${r.breakdown.score.toFixed(2)}${arrow}`);
    }

    log(`winner: "${best.video.title}" score=${best.breakdown.score}`);
    await persistRanking(query, ranked, song.duration ?? 0);

    // Save ALL candidates persistently
    if (song.mbzRecordingId) {
      await setMbzYtMapping({
        mbzRecordingId: song.mbzRecordingId,
        songName: song.name,
        artistName: song.artistName,
        albumName: song.albumName,
        albumImageUrl: song.imageUrl,
        selectedVideoId: best.video.id,
        selectedType: "auto",
        candidates: JSON.stringify(ranked.map(scoredToCandidate)),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      log(`mapping saved with ${ranked.length} candidates`);
    }
    return { scored: ranked, selectedIndex: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`search failed: ${msg}`);
    addMsg(`❌ YouTube search failed: ${msg.slice(0, 120)}`, "danger");
    console.error("[yt-download] search error:", err);
    push(null);
    return null;
  }
}

/** Force a fresh search + ranking, ignoring any saved mapping */
export async function researchSong(
  song: Song,
  cookiesOverride?: string | null,
): Promise<{ scored: YoutubeSearchScoredVideo[]; selectedIndex: number } | null> {
  // Clear saved mapping first, then do a fresh search
  if (song.mbzRecordingId) {
    const { deleteMbzYtMapping } = await import("./search-cache");
    await deleteMbzYtMapping(song.mbzRecordingId);
  }
  return searchAndRankInternal(song, cookiesOverride);
}

export async function getStreamUrl(song: Song, manualVideoId?: string): Promise<string | null> {
  const addMsg = (text: string, level: "info" | "success" | "warn" | "danger" = "info") =>
    useStatusStore.getState().addMessage(text, level, "Player");

  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString("pt-BR") + "." + String(Date.now() % 1000).padStart(3, "0");
    console.log(`[${ts}] [getStreamUrl] ${song.mbzRecordingId || song.name}: ${msg}`);
  };

  log("starting");
  const api = getElectronApi();
  if (!api) return null;
  const cookies = useAuthStore.getState().currentOrigin?.youtubeMusicHeaders;

  let videoId = manualVideoId;
  let videoTitle = song.name;

  // 1. Manual videoId (from SongInfoPanel) has highest priority
  if (videoId) {
    log(`using manual videoId: ${videoId}`);
    addMsg(`🎵 Using manually selected video`, "success");
  } else {
    // 2. Check saved mapping for previously selected video
    if (song.mbzRecordingId) {
      const saved = await getMbzYtMapping(song.mbzRecordingId);
      if (saved) {
        videoId = saved.selectedVideoId;
        log(`using saved videoId: ${videoId} (type=${saved.selectedType})`);
        addMsg(`🎵 Using saved selection`, "success");
      }
    }
  }

  // 3. No saved selection, do auto-ranking
  if (!videoId) {
    const match = await searchAndRank(song);
    if (!match) { addMsg("❌ Could not find a YouTube match", "warn"); return null; }
    videoId = match.videoId;
    videoTitle = match.title;
    addMsg(`🎵 Auto-selected: ${match.title}`, "success");
  }

  addMsg("⬇ Extracting audio stream...");
  log("yt:stream-url started");
  try {
    let url = await api.yt.getStreamUrl(videoId, cookies);
    if (!url && manualVideoId) {
      log(`manual videoId failed, falling back to auto-ranking`);
      addMsg("⚠ Selected video failed, trying auto-ranked...", "warn");
      const match = await searchAndRank(song);
      if (match) {
        videoId = match.videoId;
        videoTitle = match.title;
        url = await api.yt.getStreamUrl(videoId, cookies);
      }
    }
    if (url) {
      addMsg(`▶ Audio stream ready — "${videoTitle}"`, "success");
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

function extractYoutubeVideoId(input: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const match = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match?.[1] ?? null;
}

export async function fetchCustomVideoInfo(
  videoUrl: string,
): Promise<CandidateData | null> {
  const videoId = extractYoutubeVideoId(videoUrl);
  if (!videoId) return null;

  const api = getElectronApi();
  if (!api?.yt?.getVideoInfo) return null;

  try {
    const info = await api.yt.getVideoInfo(videoId);
    if (!info) return null;

    return {
      videoId,
      title: info.title,
      uploader: info.uploader,
      duration: info.duration,
      thumbnailUrl: info.thumbnail || null,
      score: 0,
      titleMatch: false,
      artistMatch: false,
      albumMatch: false,
      artistOnChannel: false,
      exactDuration: false,
      closestDuration: false,
      keywordScore: 0,
      diff: 0,
      source: "custom",
    };
  } catch (err) {
    console.error("[yt-download] fetchCustomVideoInfo error:", err);
    return null;
  }
}
