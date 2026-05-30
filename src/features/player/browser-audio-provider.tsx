import { useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { PlayerStatus } from "../../types/domain-types";
import { getController } from "../../api/controller";
import {
  connectMediaElement,
  resumeContext,
  destroy as destroyEngine,
  setOutputDevice,
  addStateChangeListener,
  supportsSinkId,
} from "../../services/audio-engine";
import { AudioOutputManager } from "../../services/audio-output/audio-output-manager";

let audioOutputManager: AudioOutputManager | null = null;

function getAudioOutputManager(): AudioOutputManager {
  if (!audioOutputManager) {
    audioOutputManager = new AudioOutputManager();
  }
  return audioOutputManager;
}

export function WebAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // Initialize audio element and AudioContext at startup
  useEffect(() => {
    const manager = getAudioOutputManager();
    manager.init();

    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
      connectMediaElement(audioRef.current);
    }

    const unsubStateChange = addStateChangeListener(() => {
      const { status: s } = usePlayerStore.getState();
      if (s === PlayerStatus.PLAYING) {
        resumeContext().catch(() => {});
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
      const { status: s } = usePlayerStore.getState();
      if (s === PlayerStatus.PLAYING && audio.paused && audio.src) {
        try {
          await resumeContext();
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
      destroyEngine();
    };
  }, [autoSwitchOutput]);

  // Load track
  useEffect(() => {
    if (!currentTrack?.id || !audioRef.current) return;
    const audio = audioRef.current;
    const trackId = currentTrack.id;
    let cancelled = false;

    async function loadTrack() {
      try {
        const controller = await getController();
        const url = await controller.getStreamUrl(trackId);
        if (!url || cancelled) return;

        audio.src = url;
        audio.load();

        await new Promise<void>((resolve, reject) => {
          const onCanPlay = () => {
            audio.removeEventListener("canplay", onCanPlay);
            audio.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            audio.removeEventListener("canplay", onCanPlay);
            audio.removeEventListener("error", onError);
            reject(new Error("Audio load error"));
          };
          audio.addEventListener("canplay", onCanPlay);
          audio.addEventListener("error", onError);
        });

        if (cancelled) return;
        const { status: currentStatus } = usePlayerStore.getState();
        if (currentStatus === PlayerStatus.PLAYING) {
          await resumeContext();
          await audio.play();
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
    if (!audioRef.current) return;
    const audio = audioRef.current;

    if (status === PlayerStatus.PLAYING) {
      if (audio.readyState < 2) return;
      (async () => {
        try {
          await resumeContext();
          await audio.play();
        } catch (err) {
          console.error("Playback failed:", err);
        }
      })();
    } else if (status === PlayerStatus.PAUSED) {
      audio.pause();
    }
  }, [status]);

  // Volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Seek — uses seekId so every user seek is applied even if same position
  useEffect(() => {
    if (audioRef.current && seek !== undefined) {
      audioRef.current.currentTime = seek / 1000;
    }
  }, [seekId]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setPositionMs(audio.currentTime * 1000);
    const onDurationChange = () => setDuration(audio.duration * 1000);
    const onEnded = () => next();
    const onPlay = () => play();
    const onPause = () => pause();

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [setPositionMs, setDuration, next, play, pause]);

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
