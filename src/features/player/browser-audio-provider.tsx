import { useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { PlayerStatus } from "../../types/domain-types";
import { getController } from "../../api/controller";
import {
  connectMediaElement,
  destroy as destroyEngine,
  setOutputDevice,
  addStateChangeListener,
  supportsSinkId,
  getAudioContext,
} from "../../services/audio-engine";
import { AudioOutputManager } from "../../services/audio-output/audio-output-manager";

let audioOutputManager: AudioOutputManager | null = null;

function getAudioOutputManager(): AudioOutputManager {
  if (!audioOutputManager) {
    audioOutputManager = new AudioOutputManager();
  }
  return audioOutputManager;
}

function isStreamUrl(url: string): boolean {
  return url.startsWith("https://") && !url.startsWith("file://");
}

export function WebAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamAudioRef = useRef<HTMLAudioElement | null>(null);
  const previousStreamRef = useRef(false);

  const {
    currentTrack,
    status,
    volume,
    seek,
    seekId,
    play,
    pause,
    setDuration,
    setPositionMs,
    next,
  } = usePlayerStore();

  const { activeAudioOutputs, autoSwitchOutput } = useSettingsStore();

  function isCurrentStream(): boolean {
    return !!(currentTrack?.path && isStreamUrl(currentTrack.path));
  }

  // Ensure the correct audio element is visible/active
  function ensureAudio(isStream: boolean) {
    if (isStream && !streamAudioRef.current) {
      streamAudioRef.current = new Audio();
      streamAudioRef.current.preload = "auto";
      streamAudioRef.current.volume = volume;
      previousStreamRef.current = true;
    }
    if (!isStream && !audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
      connectMediaElement(audioRef.current);
      audioRef.current.volume = volume;
      previousStreamRef.current = false;
    }
  }

  // Resume AudioContext on user interaction
  const resumedRef = useRef(false);
  function tryResumeCtx() {
    if (resumedRef.current) return Promise.resolve();
    resumedRef.current = true;
    return getAudioContext()?.resume().catch(() => {}) ?? Promise.resolve();
  }

  // Initialize main audio element + AudioContext
  useEffect(() => {
    const manager = getAudioOutputManager();
    manager.init();

    const unsubStateChange = addStateChangeListener(() => {
      const { status: s, currentTrack: t } = usePlayerStore.getState();
      if (s === PlayerStatus.PLAYING && t?.path && !isStreamUrl(t.path)) {
        tryResumeCtx();
      }
    });

    const unsubDeviceChange = manager.onDeviceChange(async () => {
      await manager.refreshDevices();
      const newDefaultId = await manager.refreshDefaultDevice();

      if (autoSwitchOutput && newDefaultId && audioRef.current) {
        const audio = audioRef.current;
        if (supportsSinkId(audio)) {
          await setOutputDevice(audio, newDefaultId).catch(() => {});
        }
      }

      const audio = audioRef.current;
      if (!audio) return;
      const { status: s, currentTrack: t } = usePlayerStore.getState();
      if (s === PlayerStatus.PLAYING && audio.paused && audio.src && t?.path && !isStreamUrl(t.path)) {
        try {
          await tryResumeCtx();
          await audio.play();
        } catch {}
      }
    });

    manager.startPolling(3000);

    return () => {
      unsubDeviceChange();
      unsubStateChange();
      manager.stopPolling();
      audioRef.current?.pause();
      audioRef.current = null;
      streamAudioRef.current?.pause();
      streamAudioRef.current = null;
      destroyEngine();
    };
  }, [autoSwitchOutput]);

  // Load track
  useEffect(() => {
    if (!currentTrack?.id) return;
    const trackPath = currentTrack.path || "";
    const isStream = isStreamUrl(trackPath);
    ensureAudio(isStream);

    const audio = isStream ? streamAudioRef.current : audioRef.current;
    if (!audio) return;

    if (previousStreamRef.current !== isStream) {
      previousStreamRef.current = isStream;
      if (isStream) {
        audioRef.current?.pause();
      } else {
        streamAudioRef.current?.pause();
      }
    }

    const trackId = currentTrack.id;
    let cancelled = false;

    async function loadTrack() {
      try {
        let url: string | null = null;

        if (trackPath) {
          if (isStream) {
            url = trackPath;
          } else if (!trackPath.startsWith("http")) {
            // Local file path — read from disk
            try {
              const { getPlatformService } = await import("../../services/platform/factory");
              const p = await getPlatformService();
              const data = await p.readFile(trackPath);
              if (data) {
                url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer]));
              }
            } catch {
              // fall through to controller
            }
          }
        }

        if (!url) {
          const controller = await getController();
          url = await controller.getStreamUrl(trackId);
        }

        if (!url || cancelled) return;
        const el = audio!;
        el.src = url;
        el.load();

        await new Promise<void>((resolve, reject) => {
          const onCanPlay = () => {
            el.removeEventListener("canplay", onCanPlay);
            el.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            el.removeEventListener("canplay", onCanPlay);
            el.removeEventListener("error", onError);
            reject(new Error("Audio load error"));
          };
          el.addEventListener("canplay", onCanPlay);
          el.addEventListener("error", onError);
        });

        if (cancelled) return;
        const { status: currentStatus } = usePlayerStore.getState();
        if (currentStatus === PlayerStatus.PLAYING) {
          if (!isStream) await tryResumeCtx();
          await el.play();
        }
      } catch (err) {
        console.error("Failed to load track:", err);
      }
    }
    loadTrack();
    return () => { cancelled = true; };
  }, [currentTrack?.id]);

  // Play/pause
  useEffect(() => {
    const isStream = isCurrentStream();
    const audio = isStream ? streamAudioRef.current : audioRef.current;
    if (!audio) return;
    const el = audio;

    if (status === PlayerStatus.PLAYING) {
      if (el.readyState < 2) return;
      (async () => {
        try {
          if (!isStream) await tryResumeCtx();
          await el.play();
        } catch (err) {
          console.error("Playback failed:", err);
        }
      })();
    } else if (status === PlayerStatus.PAUSED) {
      el.pause();
    }
  }, [status]);

  // Volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (streamAudioRef.current) streamAudioRef.current.volume = volume;
  }, [volume]);

  // Seek
  useEffect(() => {
    if (seek === undefined) return;
    if (streamAudioRef.current) streamAudioRef.current.currentTime = seek / 1000;
    if (audioRef.current) audioRef.current.currentTime = seek / 1000;
  }, [seekId]);

  // Audio event handlers — attach to whichever element is active
  useEffect(() => {
    const isStream = isCurrentStream();
    const audio = isStream ? streamAudioRef.current : audioRef.current;
    if (!audio) return;
    const el = audio;

    const onTimeUpdate = () => setPositionMs(el.currentTime * 1000);
    const onDurationChange = () => setDuration(el.duration * 1000);
    const onEnded = () => next();
    const onPlay = () => play();
    const onPause = () => pause();

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [setPositionMs, setDuration, next, play, pause, currentTrack?.id]);

  // Apply selected output device
  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    if (!supportsSinkId(audio)) return;
    if (activeAudioOutputs.length > 0) {
      setOutputDevice(audio, activeAudioOutputs[0]).catch(() => {});
    }
  }, [activeAudioOutputs]);

  return <>{children}</>;
}
