import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MusicBrainzCacheTtl } from "../services/musicbrainz-disk-cache";

export type VisualizerType = "butterchurn" | "audiomotion" | "none";

export type KeywordWeight = {
  term: string;
  weight: number;
};

export type RankingWeights = {
  title: number;
  artist: number;
  album: number;
  duration: number;
  artistOnChannel: number;
  keywords: KeywordWeight[];
};

export const DEFAULT_KEYWORDS: KeywordWeight[] = [
  { term: "CD Audio", weight: 1.0 },
];

export type ArtworkProviderSetting = {
  enabled: boolean;
  paceMs: number;
  apiKey?: string;
  apiSecret?: string;
  token?: string;
};

export type ArtworkProviders = Record<string, ArtworkProviderSetting>;

export const DEFAULT_ARTWORK_PROVIDERS: ArtworkProviders = {
  embedded: { enabled: true, paceMs: 0 },
  cover_art_archive: { enabled: true, paceMs: 200 },
  musicbrainz_release_group: { enabled: true, paceMs: 1000 },
  itunes: { enabled: false, paceMs: 500 },
  deezer: { enabled: false, paceMs: 500 },
  spotify: { enabled: false, paceMs: 1000, apiKey: "", apiSecret: "" },
  discogs: { enabled: false, paceMs: 1000, token: "" },
  fanart_tv: { enabled: false, paceMs: 500, apiKey: "" },
};

type SettingsState = {
  theme: "dark" | "light" | "system";
  visualizerType: VisualizerType;
  visualizerEnabled: boolean;
  audioApi: "webaudio" | "htmlaudio";
  crossfadeEnabled: boolean;
  crossfadeDuration: number;
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
  musicbrainzCacheTtl: MusicBrainzCacheTtl;
  rankingWeights: RankingWeights;
  artworkProviders: ArtworkProviders;

  setTheme: (theme: "dark" | "light" | "system") => void;
  setVisualizerType: (type: VisualizerType) => void;
  setVisualizerEnabled: (enabled: boolean) => void;
  setAudioApi: (api: "webaudio" | "htmlaudio") => void;
  setCrossfadeEnabled: (enabled: boolean) => void;
  setCrossfadeDuration: (duration: number) => void;
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
  setMusicbrainzCacheTtl: (ttl: MusicBrainzCacheTtl) => void;
  setRankingWeights: (weights: RankingWeights) => void;
  addRankingKeyword: (keyword: KeywordWeight) => void;
  removeRankingKeyword: (term: string) => void;
  updateRankingKeyword: (term: string, updates: Partial<KeywordWeight>) => void;
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
      crossfadeDuration: 3,
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
      musicbrainzCacheTtl: "30min",
      rankingWeights: { title: 1.0, artist: 0.5, album: 1.0, duration: 0.5, artistOnChannel: 0.3, keywords: [...DEFAULT_KEYWORDS] },
      artworkProviders: { ...DEFAULT_ARTWORK_PROVIDERS },

      setTheme: (theme) => set({ theme }),
      setVisualizerType: (visualizerType) => set({ visualizerType }),
      setVisualizerEnabled: (visualizerEnabled) => set({ visualizerEnabled }),
      setAudioApi: (audioApi) => set({ audioApi }),
      setCrossfadeEnabled: (crossfadeEnabled) => set({ crossfadeEnabled }),
      setCrossfadeDuration: (crossfadeDuration) => set({ crossfadeDuration }),
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
      setMusicbrainzCacheTtl: (musicbrainzCacheTtl) => set({ musicbrainzCacheTtl }),
      setRankingWeights: (rankingWeights) =>
        set((state) => ({
          rankingWeights: {
            ...{ title: 1.0, artist: 0.5, album: 1.0, duration: 0.5, artistOnChannel: 0.3, keywords: [] },
            ...state.rankingWeights,
            ...rankingWeights,
          },
        })),
      addRankingKeyword: (keyword) =>
        set((state) => ({
          rankingWeights: {
            ...state.rankingWeights,
            keywords: [...state.rankingWeights.keywords, keyword],
          },
        })),
      removeRankingKeyword: (term) =>
        set((state) => ({
          rankingWeights: {
            ...state.rankingWeights,
            keywords: state.rankingWeights.keywords.filter((k) => k.term !== term),
          },
        })),
      updateRankingKeyword: (term, updates) =>
        set((state) => ({
          rankingWeights: {
            ...state.rankingWeights,
            keywords: state.rankingWeights.keywords.map((k) =>
              k.term === term ? { ...k, ...updates } : k,
            ),
          },
        })),
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
