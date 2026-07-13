import { useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useStatusStore } from "../../stores/status.store";
import { useAuthStore } from "../../stores/auth.store";
import { PlayerStatus } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";
import { getController } from "../../api/controller";
import { joinPaths } from "../../lib/path-utils";
import { initMediaSession, initElectronMediaControls } from "../../services/media-session";
import {
  connectMediaElement,
  connectStreamAudio,
  destroy as destroyEngine,
  setOutputDevice,
  addStateChangeListener,
  supportsSinkId,
  resumeContext,
  fadeVolume,
  type FadeHandle,
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
  // HTTP/HTTPS URLs (not file://) are external streams.
  // Subsonic/Youtube streams are http://localhost:PORT/... — treat as streams.
  // The standalone streamAudioRef element is used for these to avoid
  // AudioContext cross-origin silencing.
  return (url.startsWith("http://") || url.startsWith("https://")) && !url.startsWith("file://");
}

function resolveLocalPath(trackPath: string): string {
  if (trackPath.startsWith("/")) return trackPath;
  const origin = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL);
  if (origin?.folderPath) {
    return joinPaths(origin.folderPath, trackPath);
  }
  return trackPath;
}

export function WebAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamAudioRef = useRef<HTMLAudioElement | null>(null);
  const previousStreamRef = useRef(false);
  const fadeHandleRef = useRef<FadeHandle | null>(null);
  const fadeOutStartedRef = useRef(false);

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
    setTransitionProgress,
    next,
  } = usePlayerStore();

  const {
    activeAudioOutputs,
    autoSwitchOutput,
    crossfadeEnabled,
    fadeInDuration,
    fadeOutDuration,
  } = useSettingsStore();

  const statusRef = useRef(status);
  statusRef.current = status;

  function isCurrentStream(): boolean {
    return !!(currentTrack?.path && isStreamUrl(currentTrack.path));
  }

  function getActiveElement(): HTMLAudioElement | null {
    return isCurrentStream() ? streamAudioRef.current : audioRef.current;
  }

  function cancelFade() {
    fadeHandleRef.current?.cancel();
    fadeHandleRef.current = null;
  }

  function hardStopElement(el: HTMLAudioElement | null) {
    if (!el) return;
    el.pause();
    if (el.src) { el.removeAttribute("src"); el.load(); }
  }

  // ── Initialize AudioContext + device management ──
  useEffect(() => {
    const manager = getAudioOutputManager();
    manager.init();

    const unsubStateChange = addStateChangeListener(() => {
      const { status: s, currentTrack: t } = usePlayerStore.getState();
      if (s === PlayerStatus.PLAYING && t?.path && !isStreamUrl(t.path)) {
        resumeContext();
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
          await resumeContext();
          await audio.play();
        } catch (err) {
          console.warn("[browser-audio] auto-play error:", err);
        }
      }
    });

    manager.startPolling(3000);

    return () => {
      unsubDeviceChange();
      unsubStateChange();
      manager.stopPolling();
      cancelFade();
      hardStopElement(audioRef.current);
      hardStopElement(streamAudioRef.current);
      audioRef.current = null;
      streamAudioRef.current = null;
      destroyEngine();
    };
  }, [autoSwitchOutput]);

  // ── Load track (with optional fade-in) ──
  useEffect(() => {
    if (!currentTrack?.id) return;
    const trackPath = currentTrack.path || "";
    const isStream = isStreamUrl(trackPath);

    cancelFade();
    fadeOutStartedRef.current = false;

    if (isStream && !streamAudioRef.current) {
      streamAudioRef.current = new Audio();
      streamAudioRef.current.preload = "auto";
      streamAudioRef.current.crossOrigin = "anonymous";
      streamAudioRef.current.volume = volume;
    }
    if (!isStream && !audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
      connectMediaElement(audioRef.current);
      audioRef.current.volume = volume;
    }

    const audio = isStream ? streamAudioRef.current : audioRef.current;
    if (!audio) return;

    if (isStream) {
      hardStopElement(audioRef.current);
    } else {
      hardStopElement(streamAudioRef.current);
    }

    if (previousStreamRef.current !== isStream) {
      previousStreamRef.current = isStream;
    }

    hardStopElement(audio);

    const trackId = currentTrack.id;
    const fadeInSec = crossfadeEnabled ? (fadeInDuration ?? 3) : 0;
    const targetVolume = volume;
    let cancelled = false;

    async function loadTrack() {
      const pLog = (m: string) => useStatusStore.getState().addMessage(m, "info", "Player");
      try {
        let url: string | null = null;

        if (trackPath) {
          if (isStream) {
            url = trackPath;
          } else if (!trackPath.startsWith("http")) {
            try {
              const { getPlatformService } = await import("../../services/platform/factory");
              const p = await getPlatformService();
              const filePath = resolveLocalPath(trackPath);
              const data = await p.readFile(filePath);
              if (data) {
                url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer]));
              }
            } catch (err) {
              console.warn("[browser-audio] readFile error:", err);
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

        if (isStream) {
          try {
            connectStreamAudio(el);
            // The AudioContext must be running for the AnalyserNode to process
            // frequency data (feed visualizers). Stream audio plays natively
            // via <audio>, but captureStream() routes through AudioContext.
            await resumeContext();
          } catch (err) {
            console.warn("[browser-audio] connectStreamAudio error:", err);
          }
        }

        const { status: currentStatus } = usePlayerStore.getState();
        if (currentStatus === PlayerStatus.PLAYING) {
          if (!isStream) await resumeContext();

          if (fadeInSec > 0) {
            el.volume = 0;
            setTransitionProgress(0);
            await el.play();
            pLog("▶ Fade in...");
            const fadeStart = performance.now();
            const rafId = requestAnimationFrame(function tick() {
              if (cancelled) { setTransitionProgress(0); return; }
              const elapsed = (performance.now() - fadeStart) / 1000;
              const p = Math.min(elapsed / fadeInSec, 1);
              setTransitionProgress(p);
              if (p < 1) requestAnimationFrame(tick);
            });
            fadeHandleRef.current = fadeVolume(el, 0, targetVolume, fadeInSec, () => {
              cancelAnimationFrame(rafId);
              setTransitionProgress(0);
              pLog("▶ Now playing");
            });
          } else {
            el.volume = targetVolume;
            await el.play();
          }
        }
      } catch (err) {
        console.error("Failed to load track:", err);
      }
    }
    loadTrack();
    return () => { cancelled = true; };
  }, [currentTrack?.id, volume, crossfadeEnabled, fadeInDuration]);

  // ── Play/pause ──
  useEffect(() => {
    const el = getActiveElement();
    if (!el) return;

    if (status === PlayerStatus.PLAYING) {
      if (el.readyState < 2) return;
      (async () => {
        try {
          if (!isCurrentStream()) await resumeContext();
          await el.play();
        } catch (err) {
          console.error("Playback failed:", err);
        }
      })();
    } else if (status === PlayerStatus.PAUSED) {
      el.pause();
    }
  }, [status]);

  // ── Volume ──
  useEffect(() => {
    for (const el of [audioRef.current, streamAudioRef.current]) {
      if (el) el.volume = volume;
    }
  }, [volume]);

  // ── Seek ──
  useEffect(() => {
    if (seek === undefined) return;
    cancelFade();
    fadeOutStartedRef.current = false;
    for (const el of [streamAudioRef.current, audioRef.current]) {
      if (el) {
        el.currentTime = seek / 1000;
        el.volume = volume;
      }
    }
  }, [seekId, volume]);

  // ── Audio event handlers ──
  useEffect(() => {
    const el = getActiveElement();
    if (!el) return;

    const onTimeUpdate = () => {
      const currentTime = el.currentTime;
      const dur = el.duration;
      setPositionMs(currentTime * 1000);

      if (
        crossfadeEnabled &&
        fadeOutDuration > 0 &&
        dur > 0 &&
        !fadeOutStartedRef.current &&
        statusRef.current === PlayerStatus.PLAYING
      ) {
        const remaining = dur - currentTime;
        if (remaining <= fadeOutDuration && remaining > 0) {
          fadeOutStartedRef.current = true;
          cancelFade();
          fadeHandleRef.current = fadeVolume(el, el.volume, 0, remaining);
        }
      }
    };

    const onDurationChange = () => setDuration(el.duration * 1000);
    const onEnded = () => next();
    const onPlayEvt = () => play();
    const onPauseEvt = () => pause();

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlayEvt);
    el.addEventListener("pause", onPauseEvt);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlayEvt);
      el.removeEventListener("pause", onPauseEvt);
    };
  }, [setPositionMs, setDuration, next, play, pause, currentTrack?.id, crossfadeEnabled, fadeOutDuration]);

  // ── Apply selected output device ──
  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    if (!supportsSinkId(audio)) return;
    if (activeAudioOutputs.length > 0) {
      setOutputDevice(audio, activeAudioOutputs[0]).catch(() => {});
    }
  }, [activeAudioOutputs]);

  // ── Media Session (OS media controls: Windows SMTC, media keys, thumbar buttons) ──
  useEffect(() => {
    const cleanupMediaSession = initMediaSession();
    const cleanupElectron = initElectronMediaControls();
    return () => {
      cleanupMediaSession();
      cleanupElectron();
    };
  }, []);

  return <>{children}</>;
}
