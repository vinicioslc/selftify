import { create } from "zustand";
import { persist } from "zustand/middleware";
import { API_BASE } from "../api/base";

export type OnlineSearchConfig = {
  enabled: boolean;
  musicBrainzToken: string;
  listenBrainzToken: string;
  youtubeMusicHeaders: string;
  downloadFolder: string;
};

type OnlineSearchState = OnlineSearchConfig & {
  setEnabled: (v: boolean) => void;
  updateMusicBrainz: (partial: Partial<Pick<OnlineSearchConfig, "musicBrainzToken" | "listenBrainzToken">>) => void;
  setYoutubeHeaders: (headers: string) => void;
  setDownloadFolder: (path: string) => void;
  clearAuth: () => void;
  reset: () => void;
  /** Pull the authoritative config from the backend (called on startup). */
  syncFromBackend: () => Promise<void>;
};

const DEFAULTS: OnlineSearchConfig = {
  enabled: false,
  musicBrainzToken: "",
  listenBrainzToken: "",
  youtubeMusicHeaders: "",
  downloadFolder: "",
};

// The backend is the single owner of online-search config (dedicated route
// /api/online-search). We keep a localStorage copy as an offline fallback, but
// every mutation is pushed to the backend so it stays authoritative.
async function pushToBackend(cfg: OnlineSearchConfig): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/online-search`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
  } catch {
    // Offline: local state remains the source until the next sync.
  }
}

export const useOnlineSearchStore = create<OnlineSearchState>()(
  persist(
    (set, get) => {
      const push = () => {
        void pushToBackend(get());
      };
      return {
        ...DEFAULTS,

        setEnabled: (enabled) => {
          set({ enabled });
          push();
        },

        updateMusicBrainz: (partial) => {
          set((s) => ({ ...s, ...partial }));
          push();
        },

        setYoutubeHeaders: (youtubeMusicHeaders) => {
          set({ youtubeMusicHeaders });
          push();
        },

        setDownloadFolder: (downloadFolder) => {
          set({ downloadFolder });
          push();
        },

        clearAuth: () => {
          set({ musicBrainzToken: "", listenBrainzToken: "" });
          push();
        },

        reset: () => {
          set(DEFAULTS);
          push();
        },

        syncFromBackend: async () => {
          try {
            const res = await fetch(`${API_BASE}/api/online-search`);
            if (!res.ok) return;
            const data = await res.json();
            set({
              enabled: !!data.enabled,
              musicBrainzToken: data.musicBrainzToken ?? "",
              listenBrainzToken: data.listenBrainzToken ?? "",
              youtubeMusicHeaders: data.youtubeMusicHeaders ?? "",
              downloadFolder: data.downloadFolder ?? "",
            });
          } catch {
            // Keep local state if the backend is unreachable.
          }
        },
      };
    },
    {
      name: "selftify-online-search",
      merge: (persisted: any, current: OnlineSearchState) => ({
        ...current,
        ...DEFAULTS,
        ...persisted,
      }),
    },
  ),
);
