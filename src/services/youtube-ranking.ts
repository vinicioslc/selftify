import type { RankingWeights } from "../stores/settings.store";
import { recordRanking } from "./sqlite-db/sqlite-db-ranking-log";

export type YoutubeSearchVideo = {
  id: string;
  title: string;
  duration?: { seconds: number } | number;
  uploader?: string;
};

export type YoutubeSearchScoreBreakdown = {
  titleMatch: boolean;
  albumMatch: boolean;
  artistMatch: boolean;
  artistOnChannel: boolean;
  channelExactMatch: boolean;
  exactDuration: boolean;
  closestDuration: boolean;
  isCover: boolean;
  keywordScore: number;
  score: number;
};

export type YoutubeSearchScoredVideo = {
  video: YoutubeSearchVideo;
  breakdown: YoutubeSearchScoreBreakdown;
  diff: number;
  originalIndex: number;
};

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeForComparison(text: string): string {
  return normalizeText(stripAccents(text));
}

function getDurationSeconds(video: YoutubeSearchVideo): number {
  if (typeof video.duration === "number") return video.duration;
  if (video.duration && typeof video.duration === "object" && "seconds" in video.duration) {
    return video.duration.seconds;
  }
  return 0;
}

export function scoreYouTubeResults(
  videos: YoutubeSearchVideo[],
  expected: { album?: string; artist?: string; duration?: number; title: string },
  weights?: RankingWeights,
): YoutubeSearchScoredVideo[] {
  const w = { title: 1.0, artist: 0.5, album: 1.0, duration: 0.5, artistOnChannel: 0.3, channelExactMatch: 1.0, coverPenalty: -3, keywords: [], ...weights };
  const expectedTitle = normalizeText(expected.title);
  const expectedArtist = normalizeText(expected.artist || "");
  const expectedAlbum = normalizeText(expected.album || "");
  const expectedDuration = expected.duration ?? 0;

  const scored = videos.map((video, originalIndex) => {
    const videoTitle = normalizeText(video.title || "");
    const duration = getDurationSeconds(video);
    const diff = expectedDuration > 0 ? Math.abs(duration - expectedDuration) : Number.POSITIVE_INFINITY;

    let keywordScore = 0;
    const channelName = normalizeText(video.uploader || "");
    for (const kw of w.keywords) {
      if (kw.term) {
        const normTerm = normalizeText(kw.term);
        if (videoTitle.includes(normTerm) || channelName.includes(normTerm)) {
          keywordScore += kw.weight;
        }
      }
    }

    const breakdown: YoutubeSearchScoreBreakdown = {
      albumMatch: false,
      artistMatch: false,
      artistOnChannel: false,
      channelExactMatch: false,
      closestDuration: false,
      exactDuration: false,
      isCover: false,
      keywordScore,
      score: 0,
      titleMatch: false,
    };

    if (expectedTitle && videoTitle.includes(expectedTitle)) {
      breakdown.titleMatch = true;
      breakdown.score += w.title;
    }
    if (expectedAlbum && videoTitle.includes(expectedAlbum)) {
      breakdown.albumMatch = true;
      breakdown.score += w.album;
    }
    if (expectedArtist && videoTitle.includes(expectedArtist)) {
      breakdown.artistMatch = true;
      breakdown.score += w.artist;
    }
    if (expectedArtist) {
      const channelName = normalizeText(video.uploader || "");
      const segments = expectedArtist.split(/\s+/);
      if (segments.some((seg) => channelName.includes(seg))) {
        breakdown.artistOnChannel = true;
        breakdown.score += w.artistOnChannel;
      }
      if (normalizeForComparison(video.uploader || "") === normalizeForComparison(expected.artist || "")) {
        breakdown.channelExactMatch = true;
        breakdown.score += w.channelExactMatch;
      }
    }
    if (expectedDuration > 0 && duration === expectedDuration) {
      breakdown.exactDuration = true;
      breakdown.score += w.duration;
    }
    if (/\bcover(?:s|ed|ing)?\b/i.test(video.title || "")) {
      breakdown.isCover = true;
      breakdown.score += w.coverPenalty;
    }
    breakdown.score += keywordScore;
    return { breakdown, diff, originalIndex, video };
  });

  if (expectedDuration > 0) {
    const minDiff = Math.min(...scored.map((item) => item.diff));
    for (const item of scored) {
      if (item.diff === minDiff) {
        item.breakdown.closestDuration = true;
        item.breakdown.score += w.duration * 0.2;
      }
    }
  }

  return scored.sort((a, b) => {
    if (b.breakdown.score !== a.breakdown.score) return b.breakdown.score - a.breakdown.score;
    if (a.diff !== b.diff) return a.diff - b.diff;
    return a.originalIndex - b.originalIndex;
  });
}

export async function persistRanking(
  query: string,
  scored: YoutubeSearchScoredVideo[],
  voteDuration: number,
): Promise<void> {
  if (scored.length === 0) return;
  const winner = scored[0];
  await recordRanking({
    query,
    winnerId: winner.video.id,
    winnerTitle: winner.video.title,
    winnerUploader: winner.video.uploader || "",
    score: winner.breakdown.score,
    scores: JSON.stringify(winner.breakdown),
    candidates: scored.length,
  });
}
