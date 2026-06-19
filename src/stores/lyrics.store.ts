import { create } from "zustand";
import type { FullLyricsMetadata, LyricOverride } from "../types/lyrics-types";

type LyricsState = {
  currentResult: FullLyricsMetadata | null;
  isLoading: boolean;
  error: string | null;
  overrideSelection: LyricOverride | null;
  selectedOffsetMs: number;

  setCurrentResult: (result: FullLyricsMetadata | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setOverrideSelection: (override: LyricOverride | null) => void;
  setSelectedOffsetMs: (ms: number) => void;
  clear: () => void;
};

export const useLyricsStore = create<LyricsState>()((set) => ({
  currentResult: null,
  isLoading: false,
  error: null,
  overrideSelection: null,
  selectedOffsetMs: 0,

  setCurrentResult: (currentResult) => set({ currentResult, isLoading: false, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  setOverrideSelection: (overrideSelection) => set({ overrideSelection }),
  setSelectedOffsetMs: (selectedOffsetMs) => set({ selectedOffsetMs }),
  clear: () =>
    set({
      currentResult: null,
      isLoading: false,
      error: null,
      overrideSelection: null,
      selectedOffsetMs: 0,
    }),
}));
