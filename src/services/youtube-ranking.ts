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
  exactDuration: boolean;
  closestDuration: boolean;
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

function getDurationSeconds(video: YoutubeSearchVideo): number {
  if (typeof video.duration === "number") return video.duration;
  if (video.duration && typeof video.duration === "object" && "seconds" in video.duration) {
    return video.duration.seconds;
  }
  return 0;
}

export function scoreYouTubeResults(
  videos: YoutubeSearchVideo[],
  expected: {
    album?: string;
    artist?: string;
    duration?: number;
    title: string;
  },
): YoutubeSearchScoredVideo[] {
  const expectedTitle = normalizeText(expected.title);
  const expectedArtist = normalizeText(expected.artist || "");
  const expectedAlbum = normalizeText(expected.album || "");
  const expectedDuration = expected.duration ?? 0;

  const scored = videos.map((video, originalIndex) => {
    const videoTitle = normalizeText(video.title || "");
    const duration = getDurationSeconds(video);
    const diff = expectedDuration > 0 ? Math.abs(duration - expectedDuration) : Number.POSITIVE_INFINITY;

    const breakdown: YoutubeSearchScoreBreakdown = {
      albumMatch: false,
      artistMatch: false,
      closestDuration: false,
      exactDuration: false,
      score: 0,
      titleMatch: false,
    };

    if (expectedTitle && videoTitle.includes(expectedTitle)) {
      breakdown.titleMatch = true;
      breakdown.score += 1;
    }
    if (expectedAlbum && videoTitle.includes(expectedAlbum)) {
      breakdown.albumMatch = true;
      breakdown.score += 1;
    }
    if (expectedArtist && videoTitle.includes(expectedArtist)) {
      breakdown.artistMatch = true;
      breakdown.score += 0.5;
    }
    if (expectedDuration > 0 && duration === expectedDuration) {
      breakdown.exactDuration = true;
      breakdown.score += 0.5;
    }
    return { breakdown, diff, originalIndex, video };
  });

  if (expectedDuration > 0) {
    const minDiff = Math.min(...scored.map((item) => item.diff));
    for (const item of scored) {
      if (item.diff === minDiff) {
        item.breakdown.closestDuration = true;
        item.breakdown.score += 0.2;
      }
    }
  }

  return scored.sort((a, b) => {
    if (b.breakdown.score !== a.breakdown.score) return b.breakdown.score - a.breakdown.score;
    if (a.diff !== b.diff) return a.diff - b.diff;
    return a.originalIndex - b.originalIndex;
  });
}
