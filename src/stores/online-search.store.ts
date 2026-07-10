import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OnlineSearchConfig = {
  enabled: boolean;
  musicBrainzToken: string;
  youtubeMusicHeaders: string;
  downloadFolder: string;
};

type OnlineSearchState = OnlineSearchConfig & {
  setEnabled: (v: boolean) => void;
  updateMusicBrainz: (partial: Partial<Pick<OnlineSearchConfig, "musicBrainzToken">>) => void;
  setYoutubeHeaders: (headers: string) => void;
  setDownloadFolder: (path: string) => void;
  clearAuth: () => void;
  reset: () => void;
};

const DEFAULTS: OnlineSearchConfig = {
  enabled: false,
  musicBrainzToken: "",
  youtubeMusicHeaders: "",
  downloadFolder: "",
};

export const useOnlineSearchStore = create<OnlineSearchState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setEnabled: (enabled) => set({ enabled }),

      updateMusicBrainz: (partial) =>
        set((s) => ({
          ...s,
          ...partial,
        })),

      setYoutubeHeaders: (youtubeMusicHeaders) => set({ youtubeMusicHeaders }),

      setDownloadFolder: (downloadFolder) => set({ downloadFolder }),

      clearAuth: () =>
        set({
          musicBrainzToken: "",
        }),

      reset: () => set(DEFAULTS),
    }),
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
