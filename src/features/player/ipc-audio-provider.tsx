import { useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useAuthStore } from "../../stores/auth.store";
import { PlayerStatus, OriginType } from "../../types/domain-types";
import { getController } from "../../api/controller";
import * as electronAudio from "../../services/electron-audio";
import { fadeVolume, type FadeHandle } from "../../services/audio-engine";

function resolveLocalPath(trackPath: string): string {
  if (trackPath.startsWith("/")) return trackPath;
  const origin = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL);
  if (origin?.folderPath) return `${origin.folderPath}/${trackPath}`;
  return trackPath;
}

export function IpcAudioProvider({ children }: { children: React.ReactNode }) {
  const statusRef = useRef(PlayerStatus.STOPPED);
  const nextRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeHandleRef = useRef<FadeHandle | null>(null);
  const fadeOutStartedRef = useRef(false);

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
  const { crossfadeEnabled, fadeInDuration, fadeOutDuration } = useSettingsStore();

  statusRef.current = status;
  nextRef.current = next;

  // Progress polling + fade-out detection
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const pos = await electronAudio.getPosition();
        setPositionMs(pos * 1000);
        const dur = await electronAudio.getDuration();

        if (dur > 1) {
          const remaining = dur - pos;
          const { crossfadeEnabled: cf, fadeOutDuration: fo } = useSettingsStore.getState();
          const { volume: vol } = usePlayerStore.getState();

          // Fade-out: trigger when within fadeOutDuration of ending
          if (
            cf &&
            fo > 0 &&
            remaining <= fo &&
            remaining > 0 &&
            !fadeOutStartedRef.current &&
            statusRef.current === PlayerStatus.PLAYING
          ) {
            fadeOutStartedRef.current = true;
            const currentVol = vol;
            const steps = Math.max(2, Math.floor(remaining * 20));
            const stepDur = (remaining / steps) * 1000;
            let step = 0;

            const iv = setInterval(() => {
              step++;
              const progress = Math.min(step / steps, 1);
              const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
              const fadeVol = currentVol * (1 - eased);
              electronAudio.setVolume(fadeVol).catch(() => {});

              if (step >= steps) {
                clearInterval(iv);
                electronAudio.setVolume(0).catch(() => {});
              }
            }, stepDur);
          }

          // End-of-track detection
          if (remaining <= 0.5) {
            nextRef.current?.();
          }
        }
      } catch (err) {
        console.warn("[ipc-audio] poll error:", err);
      }
    }, 200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [setPositionMs]);

  // Load track via Electron IPC mpv
  useEffect(() => {
    if (!currentTrack?.id) return;
    const trackId = currentTrack.id;
    const trackPath = currentTrack.path;
    const fadeInSec = crossfadeEnabled ? (fadeInDuration ?? 3) : 0;

    fadeHandleRef.current?.cancel();
    fadeOutStartedRef.current = false;

    (async () => {
      try {
        let url: string | null = null;
        if (trackPath) {
          if (trackPath.startsWith("http")) {
            url = trackPath;
          } else {
            try {
              const { getPlatformService } = await import("../../services/platform/factory");
              const p = await getPlatformService();
              const filePath = resolveLocalPath(trackPath);
              const data = await p.readFile(filePath);
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
        if (!url) return;

        setPositionMs(0);
        setDuration(0);

        // Silence before loading new track (prevent click/pop)
        await electronAudio.setVolume(0).catch(() => {});
        await electronAudio.stopPlayback();
        await electronAudio.loadTrack(url);

        const dur = await electronAudio.getDuration();
        setDuration(dur * 1000);

        const { status: s } = usePlayerStore.getState();

        // Fade-in after load
        if (fadeInSec > 0 && s === PlayerStatus.PLAYING) {
          setTransitionProgress(0);
          const fadeStart = performance.now();
          const iv = setInterval(() => {
            const elapsed = (performance.now() - fadeStart) / 1000;
            const progress = Math.min(elapsed / fadeInSec, 1);
            const eased = progress < 0.5
              ? 2 * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            const fadeVol = volume * eased;
            electronAudio.setVolume(fadeVol).catch(() => {});
            setTransitionProgress(progress);
            if (progress >= 1) {
              clearInterval(iv);
              electronAudio.setVolume(volume).catch(() => {});
              setTransitionProgress(0);
            }
          }, 50);
        } else if (fadeInSec <= 0) {
          await electronAudio.setVolume(volume).catch(() => {});
        }

        if (s !== PlayerStatus.PLAYING) {
          await electronAudio.pause();
        }
      } catch (err) {
        console.error("[ipc] load failed:", err);
      }
    })();

    return () => {
      fadeHandleRef.current?.cancel();
    };
  }, [currentTrack?.id, setDuration, setPositionMs, currentOrigin?.type, crossfadeEnabled, fadeInDuration, volume]);

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
      fadeOutStartedRef.current = false;
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
