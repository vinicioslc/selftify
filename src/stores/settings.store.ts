import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VisualizerType = "butterchurn" | "audiomotion" | "none";

type SettingsState = {
  theme: "dark" | "light" | "system";
  visualizerType: VisualizerType;
  visualizerEnabled: boolean;
  audioApi: "webaudio" | "htmlaudio";
  crossfadeEnabled: boolean;
  crossfadeDuration: number;
  reconnectionEnabled: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  activeAudioOutputs: string[];
  autoSwitchOutput: boolean;

  setTheme: (theme: "dark" | "light" | "system") => void;
  setVisualizerType: (type: VisualizerType) => void;
  setVisualizerEnabled: (enabled: boolean) => void;
  setAudioApi: (api: "webaudio" | "htmlaudio") => void;
  setCrossfadeEnabled: (enabled: boolean) => void;
  setCrossfadeDuration: (duration: number) => void;
  setReconnectionEnabled: (enabled: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setActiveAudioOutputs: (outputs: string[]) => void;
  setAutoSwitchOutput: (enabled: boolean) => void;
  toggleSidebar: () => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      visualizerType: "butterchurn",
      visualizerEnabled: false,
      audioApi: "webaudio",
      crossfadeEnabled: false,
      crossfadeDuration: 3,
      reconnectionEnabled: true,
      sidebarCollapsed: false,
      sidebarWidth: 280,
      activeAudioOutputs: [],
      autoSwitchOutput: true,

      setTheme: (theme) => set({ theme }),
      setVisualizerType: (visualizerType) => set({ visualizerType }),
      setVisualizerEnabled: (visualizerEnabled) => set({ visualizerEnabled }),
      setAudioApi: (audioApi) => set({ audioApi }),
      setCrossfadeEnabled: (crossfadeEnabled) => set({ crossfadeEnabled }),
      setCrossfadeDuration: (crossfadeDuration) => set({ crossfadeDuration }),
      setReconnectionEnabled: (reconnectionEnabled) => set({ reconnectionEnabled }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setActiveAudioOutputs: (activeAudioOutputs) => set({ activeAudioOutputs }),
      setAutoSwitchOutput: (autoSwitchOutput) => set({ autoSwitchOutput }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: "ytmusic-settings",
    }
  )
);
