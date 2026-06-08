import { create } from "zustand";
import type { YoutubeSearchVideo, YoutubeSearchScoredVideo } from "../services/youtube-ranking";

export type RankingDebugEntry = {
  query: string;
  searchQuery: string;
  videos: YoutubeSearchVideo[];
  scored: YoutubeSearchScoredVideo[];
  selectedVideoId: string | null;
  duration: number | null;
  timestamp: number;
};

type RankingDebugState = {
  entries: RankingDebugEntry[];
  maxEntries: number;
  pushEntry: (entry: RankingDebugEntry) => void;
  clear: () => void;
};

export const useRankingDebugStore = create<RankingDebugState>()((set, get) => ({
  entries: [],
  maxEntries: 50,
  pushEntry: (entry) => {
    const prevLen = get().entries.length;
    set((state) => {
      const next = [...state.entries, entry];
      if (next.length > state.maxEntries) next.splice(0, next.length - state.maxEntries);
      console.log("[debug-store] pushEntry: prev:", prevLen, "now:", next.length, "query:", entry.query, "selected:", entry.selectedVideoId, "scored:", entry.scored.length);
      return { entries: next };
    });
  },
  clear: () => { console.log("[debug-store] clear"); set({ entries: [] }); },
}));
