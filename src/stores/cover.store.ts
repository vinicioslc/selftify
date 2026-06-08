import { create } from "zustand";

type CoverState = {
  urls: Record<string, string>;
  loading: Record<string, boolean>;
  setCover: (key: string, blobUrl: string) => void;
  revoke: (key: string) => void;
};

export const useCoverStore = create<CoverState>()((set, get) => ({
  urls: {},
  loading: {},

  setCover: (key: string, blobUrl: string) => {
    const state = get();
    const oldUrl = state.urls[key];
    if (oldUrl && oldUrl !== blobUrl) {
      try { URL.revokeObjectURL(oldUrl); } catch { /* ignore */ }
    }
    set((s) => ({
      urls: { ...s.urls, [key]: blobUrl },
      loading: { ...s.loading, [key]: false },
    }));
  },

  revoke: (key: string) => {
    const state = get();
    const oldUrl = state.urls[key];
    if (oldUrl) {
      try { URL.revokeObjectURL(oldUrl); } catch { /* ignore */ }
    }
    set((s) => {
      const next = { ...s.urls };
      delete next[key];
      const loadNext = { ...s.loading };
      delete loadNext[key];
      return { urls: next, loading: loadNext };
    });
  },
}));
