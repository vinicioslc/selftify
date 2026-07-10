import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OnlineSearchConfig = {
  enabled: boolean;
  musicBrainzClientId: string;
  musicBrainzClientSecret: string;
  musicBrainzToken: string;
  musicBrainzRefreshToken: string;
  musicBrainzTokenExpiresAt: number;
  youtubeMusicHeaders: string;
  downloadFolder: string;
};

type OnlineSearchState = OnlineSearchConfig & {
  setEnabled: (v: boolean) => void;
  updateMusicBrainz: (partial: Partial<Pick<OnlineSearchConfig, "musicBrainzToken" | "musicBrainzClientId" | "musicBrainzClientSecret" | "musicBrainzRefreshToken" | "musicBrainzTokenExpiresAt">>) => void;
  setYoutubeHeaders: (headers: string) => void;
  setDownloadFolder: (path: string) => void;
  clearAuth: () => void;
  reset: () => void;
};

const DEFAULTS: OnlineSearchConfig = {
  enabled: false,
  musicBrainzClientId: "",
  musicBrainzClientSecret: "",
  musicBrainzToken: "",
  musicBrainzRefreshToken: "",
  musicBrainzTokenExpiresAt: 0,
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
          musicBrainzRefreshToken: "",
          musicBrainzTokenExpiresAt: 0,
          musicBrainzClientId: "",
          musicBrainzClientSecret: "",
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
