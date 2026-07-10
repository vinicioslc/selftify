import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Origin, OriginType } from "../types/domain-types";
import { useOnlineSearchStore } from "./online-search.store";

function migrateOrigin(old: any): Origin {
  if (!old) return old;

  // Extract legacy MusicBrainz/YouTube fields into the global online-search store
  const hasOnlineFields =
    old.enableOnlineSearch || old.musicBrainzToken || old.youtubeMusicHeaders;
  if (hasOnlineFields) {
    const online = useOnlineSearchStore.getState();
    const needsUpdate =
      !online.enabled && old.enableOnlineSearch
      || !online.musicBrainzToken && old.musicBrainzToken;
    if (needsUpdate) {
      useOnlineSearchStore.setState({
        enabled: online.enabled || !!old.enableOnlineSearch || !!old.useMusicBrainz,
        musicBrainzToken: online.musicBrainzToken || old.musicBrainzToken || "",
        musicBrainzClientId: online.musicBrainzClientId || old.musicBrainzClientId || "",
        musicBrainzClientSecret: online.musicBrainzClientSecret || old.musicBrainzClientSecret || "",
        musicBrainzRefreshToken: online.musicBrainzRefreshToken || old.musicBrainzRefreshToken || "",
        musicBrainzTokenExpiresAt: online.musicBrainzTokenExpiresAt || old.musicBrainzTokenExpiresAt || 0,
        youtubeMusicHeaders: online.youtubeMusicHeaders || old.youtubeMusicHeaders || "",
        downloadFolder: online.downloadFolder || old.downloadFolder || "",
      });
    }
  }

  return {
    id: old.id,
    name: old.name,
    type: OriginType.LOCAL,
    folderPath: old.folderPath || old.url || old.baseUrl || undefined,
    downloadFolder: old.downloadFolder || old.folderPath || old.url || undefined,
    organizeOnScan: old.organizeOnScan ?? false,
    organizeDryRun: old.organizeDryRun ?? false,
  };
}

type AuthState = {
  currentOrigin: Origin | null;
  origins: Origin[];
  setCurrentOrigin: (origin: Origin | null) => void;
  addOrigin: (origin: Origin) => void;
  removeOrigin: (id: string) => void;
  updateOrigin: (id: string, updates: Partial<Origin>) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentOrigin: null,
      origins: [],
      setCurrentOrigin: (origin) => set({ currentOrigin: origin }),
      addOrigin: (origin) =>
        set((state) => ({
          origins: [...state.origins.filter((s) => s.id !== origin.id), origin],
        })),
      removeOrigin: (id) =>
        set((state) => ({
          origins: state.origins.filter((s) => s.id !== id),
          currentOrigin: state.currentOrigin?.id === id ? null : state.currentOrigin,
        })),
      updateOrigin: (id, updates) =>
        set((state) => ({
          origins: state.origins.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
          currentOrigin:
            state.currentOrigin?.id === id
              ? { ...state.currentOrigin, ...updates }
              : state.currentOrigin,
        })),
      clearAuth: () => set({ currentOrigin: null, origins: [] }),
    }),
    {
      name: "ytmusic-auth",
      partialize: (state) => ({
        origins: state.origins,
        currentOrigin: state.currentOrigin,
      }),
      merge: (persisted: any, current: AuthState) => {
        if (persisted?.origins) {
          persisted.origins = persisted.origins.map(migrateOrigin);
        }
        if (persisted?.currentOrigin) {
          persisted.currentOrigin = migrateOrigin(persisted.currentOrigin);
        }
        return { ...current, ...persisted };
      },
    }
  )
);
