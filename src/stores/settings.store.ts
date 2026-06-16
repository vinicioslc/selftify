import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VisualizerType = "butterchurn" | "audiomotion" | "none";

export type RankingWeights = {
  title: number;
  artist: number;
  album: number;
  duration: number;
};

export type ArtworkProviderSetting = {
  enabled: boolean;
  paceMs: number;
};

export type ArtworkProviders = Record<string, ArtworkProviderSetting>;

export const DEFAULT_ARTWORK_PROVIDERS: ArtworkProviders = {
  embedded: { enabled: true, paceMs: 0 },
  cover_art_archive: { enabled: true, paceMs: 200 },
  musicbrainz_release_group: { enabled: true, paceMs: 1000 },
  itunes: { enabled: false, paceMs: 500 },
  deezer: { enabled: false, paceMs: 500 },
};

type SettingsState = {
  theme: "dark" | "light" | "system";
  visualizerType: VisualizerType;
  visualizerEnabled: boolean;
  audioApi: "webaudio" | "htmlaudio";
  crossfadeEnabled: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
  transitionMixingEnabled: boolean;
  reconnectionEnabled: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  activeAudioOutputs: string[];
  autoSwitchOutput: boolean;
  sidebarAlbumCollapsed: boolean;
  sidebarShowVisualizer: boolean;
  animationsEnabled: boolean;
  imageFetchTimeoutMs: number;
  searchTimeoutMs: number;
  streamTimeoutMs: number;
  cacheTtlMinutes: number;
  rankingWeights: RankingWeights;
  artworkProviders: ArtworkProviders;

  setTheme: (theme: "dark" | "light" | "system") => void;
  setVisualizerType: (type: VisualizerType) => void;
  setVisualizerEnabled: (enabled: boolean) => void;
  setAudioApi: (api: "webaudio" | "htmlaudio") => void;
  setCrossfadeEnabled: (enabled: boolean) => void;
  setFadeInDuration: (duration: number) => void;
  setFadeOutDuration: (duration: number) => void;
  setTransitionMixingEnabled: (enabled: boolean) => void;
  setReconnectionEnabled: (enabled: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setActiveAudioOutputs: (outputs: string[]) => void;
  setAutoSwitchOutput: (enabled: boolean) => void;
  setSidebarAlbumCollapsed: (collapsed: boolean) => void;
  setSidebarShowVisualizer: (show: boolean) => void;
  setAnimationsEnabled: (enabled: boolean) => void;
  setImageFetchTimeoutMs: (ms: number) => void;
  setSearchTimeoutMs: (ms: number) => void;
  setStreamTimeoutMs: (ms: number) => void;
  setCacheTtlMinutes: (min: number) => void;
  setRankingWeights: (weights: RankingWeights) => void;
  toggleSidebar: () => void;
  isArtworkProviderEnabled: (name: string) => boolean;
  getArtworkPaceMs: (name: string) => number;
  setArtworkProvider: (name: string, partial: Partial<ArtworkProviderSetting>) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      visualizerType: "butterchurn",
      visualizerEnabled: false,
      audioApi: "webaudio",
      crossfadeEnabled: false,
      fadeInDuration: 3,
      fadeOutDuration: 3,
      transitionMixingEnabled: false,
      reconnectionEnabled: true,
      sidebarCollapsed: false,
      sidebarWidth: 280,
      activeAudioOutputs: [],
      autoSwitchOutput: true,
      sidebarAlbumCollapsed: false,
      sidebarShowVisualizer: false,
      animationsEnabled: true,
      imageFetchTimeoutMs: 10000,
      searchTimeoutMs: 60000,
      streamTimeoutMs: 60000,
      cacheTtlMinutes: 60,
      rankingWeights: { title: 1.0, artist: 0.5, album: 1.0, duration: 0.5 },
      artworkProviders: { ...DEFAULT_ARTWORK_PROVIDERS },

      setTheme: (theme) => set({ theme }),
      setVisualizerType: (visualizerType) => set({ visualizerType }),
      setVisualizerEnabled: (visualizerEnabled) => set({ visualizerEnabled }),
      setAudioApi: (audioApi) => set({ audioApi }),
      setCrossfadeEnabled: (crossfadeEnabled) => set({ crossfadeEnabled }),
      setFadeInDuration: (fadeInDuration) => set({ fadeInDuration }),
      setFadeOutDuration: (fadeOutDuration) => set({ fadeOutDuration }),
      setTransitionMixingEnabled: (transitionMixingEnabled) => set({ transitionMixingEnabled }),
      setReconnectionEnabled: (reconnectionEnabled) => set({ reconnectionEnabled }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setActiveAudioOutputs: (activeAudioOutputs) => set({ activeAudioOutputs }),
      setAutoSwitchOutput: (autoSwitchOutput) => set({ autoSwitchOutput }),
      setSidebarAlbumCollapsed: (sidebarAlbumCollapsed) => set({ sidebarAlbumCollapsed }),
      setSidebarShowVisualizer: (sidebarShowVisualizer) => set({ sidebarShowVisualizer }),
      setAnimationsEnabled: (animationsEnabled) => set({ animationsEnabled }),
      setImageFetchTimeoutMs: (imageFetchTimeoutMs) => set({ imageFetchTimeoutMs }),
      setSearchTimeoutMs: (searchTimeoutMs) => set({ searchTimeoutMs }),
      setStreamTimeoutMs: (streamTimeoutMs) => set({ streamTimeoutMs }),
      setCacheTtlMinutes: (cacheTtlMinutes) => set({ cacheTtlMinutes }),
      setRankingWeights: (rankingWeights) => set({ rankingWeights }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      isArtworkProviderEnabled: (name) => get().artworkProviders[name]?.enabled ?? true,
      getArtworkPaceMs: (name) => get().artworkProviders[name]?.paceMs ?? 1000,
      setArtworkProvider: (name, partial) =>
        set((state) => ({
          artworkProviders: {
            ...state.artworkProviders,
            [name]: { ...state.artworkProviders[name], ...partial },
          },
        })),
    }),
    {
      name: "ytmusic-settings",
    }
  )
);
