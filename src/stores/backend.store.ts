import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BackendType = "selftify" | "subsonic";

export type BackendConfig = {
  type: BackendType;
  url: string;
  user: string;
  password: string;
};

export const SELFTIFY_CAPABILITIES = [
  "youtube",
  "lyrics-lrc",
  "download",
  "ranking",
  "organizer",
  "origins",
  "search-online",
  "scan",
  "settings",
] as const;

export type SelftifyCapability = (typeof SELFTIFY_CAPABILITIES)[number];

type BackendState = {
  config: BackendConfig | null;
  capabilities: string[];
  setConfig: (config: BackendConfig) => void;
  setCapabilities: (caps: string[]) => void;
  clearConfig: () => void;
  hasCapability: (cap: string) => boolean;
};

export const useBackendStore = create<BackendState>()(
  persist(
    (set, get) => ({
      config: null,
      capabilities: [],
      setConfig: (config) => set({ config }),
      setCapabilities: (capabilities) => set({ capabilities }),
      clearConfig: () => set({ config: null, capabilities: [] }),
      hasCapability: (cap: string) => get().capabilities.includes(cap),
    }),
    {
      name: "selftify-backend",
      partialize: (state) => ({
        config: state.config,
        capabilities: state.capabilities,
      }),
    },
  ),
);
