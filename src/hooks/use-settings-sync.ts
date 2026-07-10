import { useEffect, useRef } from "react";
import { API_BASE } from "../api/base";
import { useSettingsStore } from "../stores/settings.store";

export function useSettingsSync() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/settings`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.settings) {
          useSettingsStore.setState(data.settings);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const {
          theme,
          visualizerType,
          visualizerEnabled,
          crossfadeEnabled,
          fadeInDuration,
          fadeOutDuration,
          sidebarCollapsed,
          sidebarWidth,
          activeAudioOutputs,
          autoSwitchOutput,
          animationsEnabled,
          imageFetchTimeoutMs,
          searchTimeoutMs,
          streamTimeoutMs,
          cacheTtlMinutes,
          coverPriority,
          rankingWeights,
          ytSearchFields,
          artworkProviders,
          lyrics,
          audioApi,
          transitionMixingEnabled,
          reconnectionEnabled,
          sidebarAlbumCollapsed,
          sidebarShowVisualizer,
        } = state;
        const payload = {
          theme,
          visualizerType,
          visualizerEnabled,
          audioApi,
          crossfadeEnabled,
          fadeInDuration,
          fadeOutDuration,
          transitionMixingEnabled,
          reconnectionEnabled,
          sidebarCollapsed,
          sidebarWidth,
          activeAudioOutputs,
          autoSwitchOutput,
          sidebarAlbumCollapsed,
          sidebarShowVisualizer,
          animationsEnabled,
          imageFetchTimeoutMs,
          searchTimeoutMs,
          streamTimeoutMs,
          cacheTtlMinutes,
          coverPriority,
          rankingWeights,
          ytSearchFields,
          artworkProviders,
          lyrics,
        };
        fetch(`${API_BASE}/api/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: payload }),
        }).catch(() => {});
      }, 1000);
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return null;
}
