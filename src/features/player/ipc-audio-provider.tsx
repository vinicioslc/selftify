import { useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useAuthStore } from "../../stores/auth.store";
import { PlayerStatus } from "../../types/domain-types";
import { getController } from "../../api/controller";
import * as electronAudio from "../../services/electron-audio";
import { fadeVolume, type FadeHandle } from "../../services/audio-engine";

export function IpcAudioProvider({ children }: { children: React.ReactNode }) {
  const statusRef = useRef(PlayerStatus.STOPPED);
  const nextRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeHandleRef = useRef<FadeHandle | null>(null);

  const {
    currentTrack,
    status,
    volume,
    seek,
    seekId,
    setDuration,
    setPositionMs,
    setTransitionProgress,
    next,
  } = usePlayerStore();

  const currentOrigin = useAuthStore((s) => s.currentOrigin);
  const { transitionMixingEnabled, crossfadeDuration } = useSettingsStore();

  statusRef.current = status;
  nextRef.current = next;

  // Progress polling
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const pos = await electronAudio.getPosition();
        setPositionMs(pos * 1000);

        const dur = await electronAudio.getDuration();
        if (dur > 1 && pos >= dur - 0.5) {
          nextRef.current?.();
        }
      } catch (err) {
        console.warn("[ipc-audio] poll error:", err);
      }
    }, 500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [setPositionMs]);

  // Load track via Electron IPC mpv
  useEffect(() => {
    if (!currentTrack?.id) return;
    const trackId = currentTrack.id;
    const trackPath = currentTrack.path;
    const durationSec = crossfadeDuration ?? 3;

    // Cancel any in-progress fade
    fadeHandleRef.current?.cancel();

    // ── Crossfade mode: fade out current volume, then load, then fade in ──
    if (transitionMixingEnabled && durationSec > 0) {
      const crossfadeStart = performance.now();
      let cancelled = false;

      (async () => {
        try {
          // Step 1: Fade out current volume over durationSec
          const currentVol = volume;
          await new Promise<void>((resolve) => {
            // Use setInterval to control mpv volume smoothly (mpv has no RAF)
            let start: number | null = null;
            const interval = setInterval(() => {
              if (cancelled) { clearInterval(interval); resolve(); return; }
              if (start === null) start = performance.now();
              const elapsed = (performance.now() - start) / 1000;
              const progress = Math.min(elapsed / durationSec, 1);
              const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
              const fadeVol = currentVol * (1 - eased);
              electronAudio.setVolume(fadeVol).catch(() => {});
              setTransitionProgress(progress);
              if (progress >= 1) {
                clearInterval(interval);
                resolve();
              }
            }, 50);
          });

          if (cancelled) return;

          // Step 2: Stop old, load new
          await electronAudio.stopPlayback();

          let url: string | null = null;
          if (trackPath) {
            if (trackPath.startsWith("http")) {
              url = trackPath;
            } else {
              try {
                const { getPlatformService } = await import("../../services/platform/factory");
                const p = await getPlatformService();
                const data = await p.readFile(trackPath);
                if (data) url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer]));
              } catch (err) {
                console.warn("[ipc-audio] readFile error:", err);
              }
            }
          }
          if (!url) {
            const controller = await getController();
            url = await controller.getStreamUrl(trackId);
          }
          if (!url || cancelled) return;

          setPositionMs(0);
          setDuration(0);
          await electronAudio.loadTrack(url);

          if (cancelled) return;

          const dur = await electronAudio.getDuration();
          setDuration(dur * 1000);

          // Step 3: Fade in volume
          const fadeInStart = performance.now();
          await new Promise<void>((resolve) => {
            let start: number | null = null;
            const interval = setInterval(() => {
              if (cancelled) { clearInterval(interval); resolve(); return; }
              if (start === null) start = performance.now();
              const elapsed = (performance.now() - start) / 1000;
              const progress = Math.min(elapsed / durationSec, 1);
              const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
              const fadeVol = volume * eased;
              electronAudio.setVolume(fadeVol).catch(() => {});
              // Update overall progress
              const totalElapsed = (performance.now() - crossfadeStart) / 1000;
              const totalDuration = durationSec * 2;
              setTransitionProgress(Math.min(totalElapsed / totalDuration, 1));
              if (progress >= 1) {
                clearInterval(interval);
                electronAudio.setVolume(volume).catch(() => {});
                resolve();
              }
            }, 50);
          });

          setTransitionProgress(0);

          const { status: s } = usePlayerStore.getState();
          if (s !== PlayerStatus.PLAYING) {
            await electronAudio.pause();
          }
        } catch (err) {
          console.error("[ipc] crossfade load failed:", err);
          setTransitionProgress(0);
        }
      })();

      return () => { cancelled = true; };
    }

    // ── Non-crossfade: hard-stop ──
    electronAudio.stopPlayback().catch(() => {});

    let cancelled = false;

    async function loadTrack() {
      try {
        let url: string | null = null;

        if (trackPath) {
          if (trackPath.startsWith("http")) {
            url = trackPath;
          } else {
            try {
              const { getPlatformService } = await import("../../services/platform/factory");
              const p = await getPlatformService();
              const data = await p.readFile(trackPath);
              if (data) {
                url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer]));
              }
            } catch (err) {
              console.warn("[ipc-audio] readFile error:", err);
            }
          }
        }

        if (!url) {
          const controller = await getController();
          url = await controller.getStreamUrl(trackId);
        }

        if (!url || cancelled) return;

        setPositionMs(0);
        setDuration(0);

        await electronAudio.loadTrack(url);

        if (cancelled) return;

        const dur = await electronAudio.getDuration();
        setDuration(dur * 1000);

        const { status: s } = usePlayerStore.getState();
        if (s !== PlayerStatus.PLAYING) {
          await electronAudio.pause();
        }
      } catch (err) {
        console.error("[ipc] load failed:", err);
      }
    }
    loadTrack();
    return () => { cancelled = true; };
  }, [currentTrack?.id, setDuration, setPositionMs, currentOrigin?.type, transitionMixingEnabled, crossfadeDuration]);

  // Play/pause
  useEffect(() => {
    if (status === PlayerStatus.PLAYING) {
      electronAudio.resume().catch((err) => console.error("[ipc] resume:", err));
    } else if (status === PlayerStatus.PAUSED) {
      electronAudio.pause().catch((err) => console.error("[ipc] pause:", err));
    }
  }, [status]);

  // Volume
  useEffect(() => {
    electronAudio.setVolume(volume).catch((err) => console.error("[ipc] setVolume:", err));
  }, [volume]);

  // Seek
  useEffect(() => {
    if (seek !== undefined) {
      electronAudio.seek(seek / 1000).catch((err) => console.error("[ipc] seek:", err));
    }
  }, [seekId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      electronAudio.stopPlayback().catch((err) => console.error("[ipc] stop:", err));
    };
  }, []);

  return <>{children}</>;
}
