import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useStatusStore } from "../../stores/status.store";
import { PlayerStatus } from "../../types/domain-types";
import { getController } from "../../api/controller";
import {
  connectMediaElement,
  destroy as destroyEngine,
  setOutputDevice,
  addStateChangeListener,
  supportsSinkId,
  getAudioContext,
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
  return url.startsWith("https://") && !url.startsWith("file://");
}

export function WebAudioProvider({ children }: { children: React.ReactNode }) {
  // ── Audio element refs ──
  const audioRef = useRef<HTMLAudioElement | null>(null);        // current local
  const audioNextRef = useRef<HTMLAudioElement | null>(null);    // next local (crossfade)
  const streamAudioRef = useRef<HTMLAudioElement | null>(null);   // current stream
  const streamAudioNextRef = useRef<HTMLAudioElement | null>(null); // next stream (crossfade)
  const previousStreamRef = useRef(false);
  const fadeHandleRef = useRef<FadeHandle | null>(null);
  const crossfadePendingRef = useRef(false);
  const crossfadeCleanupRef = useRef<(() => void) | null>(null);
  const resumedRef = useRef(false);
  const [isCrossfading, setIsCrossfading] = useState(false);

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

  const {
    activeAudioOutputs,
    autoSwitchOutput,
    transitionMixingEnabled,
    crossfadeDuration,
  } = useSettingsStore();

  function isCurrentStream(): boolean {
    return !!(currentTrack?.path && isStreamUrl(currentTrack.path));
  }

  function getActiveElement(): HTMLAudioElement | null {
    const isStream = isCurrentStream();
    return isStream ? streamAudioRef.current : audioRef.current;
  }

  function tryResumeCtx() {
    if (resumedRef.current) return Promise.resolve();
    resumedRef.current = true;
    return getAudioContext()?.resume().catch(() => {}) ?? Promise.resolve();
  }

  // ── Utility: stop/cancel any active fade ──
  function cancelFade() {
    fadeHandleRef.current?.cancel();
    fadeHandleRef.current = null;
  }

  // ── Utility: hard-stop an element (pause + clear src) ──
  function hardStopElement(el: HTMLAudioElement | null) {
    if (!el) return;
    el.pause();
    if (el.src) { el.removeAttribute("src"); el.load(); }
  }

  // ── Utility: create a fresh audio element ──
  function createAudio(isStream: boolean): HTMLAudioElement {
    const el = new Audio();
    el.preload = "auto";
    if (!isStream) connectMediaElement(el);
    return el;
  }

  // ── Initialize AudioContext + device management ──
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
      hardStopElement(audioNextRef.current);
      hardStopElement(streamAudioRef.current);
      hardStopElement(streamAudioNextRef.current);
      audioRef.current = null;
      audioNextRef.current = null;
      streamAudioRef.current = null;
      streamAudioNextRef.current = null;
      destroyEngine();
    };
  }, [autoSwitchOutput]);

  // ── Load track (with optional crossfade) ──
  useEffect(() => {
    if (!currentTrack?.id) return;
    const trackPath = currentTrack.path || "";
    const isStream = isStreamUrl(trackPath);
    const durationSec = crossfadeDuration ?? 3;

    // Cancel any in-progress crossfade
    cancelFade();
    crossfadeCleanupRef.current?.();
    crossfadeCleanupRef.current = null;

    // ── Crossfade mode ──
    if (transitionMixingEnabled && durationSec > 0) {
      // Determine which elements to use
      const oldEl = isStream ? streamAudioRef.current : audioRef.current;
      const newEl = isStream
        ? (streamAudioNextRef.current ??= createAudio(true))
        : (audioNextRef.current ??= createAudio(false));

      crossfadePendingRef.current = true;
      setIsCrossfading(true);
      setTransitionProgress(0);

      const crossfadeStart = performance.now();
      const trackId = currentTrack.id;
      let cancelled = false;

      // Phase 1: fade-out old element (if it's playing)
      if (oldEl && !oldEl.paused && oldEl.src) {
        fadeVolume(oldEl, oldEl.volume, 0, durationSec, () => {
          hardStopElement(oldEl);
        });
      }

      // Phase 2: load + fade-in new element
      async function loadNext() {
        const pLog = (m: string) => useStatusStore.getState().addMessage(m, "info", "Player");
        try {
          let url: string | null = null;

          if (trackPath) {
            if (isStream) {
              url = trackPath;
            } else {
              try {
                const { getPlatformService } = await import("../../services/platform/factory");
                const p = await getPlatformService();
                const data = await p.readFile(trackPath);
                if (data) url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer]));
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
          const el = newEl!;
          el.volume = 0;
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

          // Start playing at volume 0, then fade in
          await el.play();
          pLog("▶ Crossfading...");

          // Track crossfade progress via RAF
          let progressRaf: number | undefined;
          function progressLoop() {
            if (cancelled) { setTransitionProgress(0); return; }
            const elapsed = (performance.now() - crossfadeStart) / 1000;
            const p = Math.min(elapsed / durationSec, 1);
            setTransitionProgress(p);
            if (p < 1) {
              progressRaf = requestAnimationFrame(progressLoop);
            } else {
              setTransitionProgress(0);
            }
          }
          progressRaf = requestAnimationFrame(progressLoop);

          fadeHandleRef.current = fadeVolume(el, 0, volume, durationSec, () => {
            if (progressRaf !== undefined) cancelAnimationFrame(progressRaf);
            setTransitionProgress(0);
            setIsCrossfading(false);
            crossfadePendingRef.current = false;
          });
        } catch (err) {
          console.error("[crossfade] loadNext failed:", err);
          setIsCrossfading(false);
          crossfadePendingRef.current = false;
        }
      }

      loadNext();

      // Cleanup: swap refs after crossfade duration
      crossfadeCleanupRef.current = () => {
        cancelled = true;
        setIsCrossfading(false);
        crossfadePendingRef.current = false;
        // Swap refs so the "next" element becomes the "current" element
        if (isStream) {
          hardStopElement(streamAudioRef.current);
          streamAudioRef.current = streamAudioNextRef.current;
          streamAudioNextRef.current = null;
          previousStreamRef.current = true;
          if (streamAudioRef.current) streamAudioRef.current.volume = volume;
        } else {
          hardStopElement(audioRef.current);
          audioRef.current = audioNextRef.current;
          audioNextRef.current = null;
          previousStreamRef.current = false;
          if (audioRef.current) audioRef.current.volume = volume;
        }
      };

      return () => {
        cancelled = true;
      };
    }

    // ── Non-crossfade mode (hard-switch) ──
    {
      // Ensure the correct audio element exists
      if (isStream && !streamAudioRef.current) {
        streamAudioRef.current = new Audio();
        streamAudioRef.current.preload = "auto";
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

      // Hard-stop the OTHER type's element (e.g. if switching from stream→local)
      if (isStream) {
        hardStopElement(audioRef.current);
      } else {
        hardStopElement(streamAudioRef.current);
      }

      // Hard-stop the element we'll reuse
      hardStopElement(audio);

      if (previousStreamRef.current !== isStream) {
        previousStreamRef.current = isStream;
      }

      const trackId = currentTrack.id;
      let cancelled = false;

      async function loadTrack() {
        const pLog = (m: string) => useStatusStore.getState().addMessage(m, "info", "Player");
        console.log(`[playback] loadTrack ${currentTrack?.name || "?"}: path=${trackPath ? trackPath.slice(0, 80) + "..." : "null"} isStream=${isStream}`);
        try {
          let url: string | null = null;

          if (trackPath) {
            if (isStream) {
              url = trackPath;
            } else if (!trackPath.startsWith("http")) {
              try {
                const { getPlatformService } = await import("../../services/platform/factory");
                const p = await getPlatformService();
                const data = await p.readFile(trackPath);
                if (data) url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer]));
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
          console.log(`[playback] setting audio.src (length=${url.length})`);
          pLog("Loading audio...");
          el.src = url;
          el.load();

          await new Promise<void>((resolve, reject) => {
            const onCanPlay = () => {
              console.log(`[playback] canplay fired — audio ready (${el.buffered.length} ranges)`);
              el.removeEventListener("canplay", onCanPlay);
              el.removeEventListener("error", onError);
              resolve();
            };
            const onError = () => {
              console.error(`[playback] audio error event`);
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
            if (usePlayerStore.getState().status !== PlayerStatus.PLAYING) return;
            console.log(`[playback] calling audio.play()`);
            await el.play().then(() => {
              console.log(`[playback] audio.play() resolved — AUDIO PLAYING`);
              pLog("▶ Now playing");
            });
          }
        } catch (err) {
          console.error("Failed to load track:", err);
        }
      }
      loadTrack();
      return () => { cancelled = true; };
    }
  }, [currentTrack?.id, transitionMixingEnabled, crossfadeDuration]);

  // ── Play/pause ──
  useEffect(() => {
    // During crossfade, pause/resume both elements
    if (crossfadePendingRef.current || isCrossfading) {
      const allEls = [audioRef.current, audioNextRef.current, streamAudioRef.current, streamAudioNextRef.current];
      if (status === PlayerStatus.PLAYING) {
        for (const el of allEls) {
          if (el && el.readyState >= 2 && el.paused) {
            el.play().catch(() => {});
          }
        }
      } else if (status === PlayerStatus.PAUSED || status === PlayerStatus.STOPPED) {
        for (const el of allEls) {
          el?.pause();
        }
      }
      return;
    }

    const el = getActiveElement();
    if (!el) return;

    if (status === PlayerStatus.PLAYING) {
      if (el.readyState < 2) return;
      (async () => {
        try {
          if (!isCurrentStream()) await tryResumeCtx();
          if (usePlayerStore.getState().status !== PlayerStatus.PLAYING) return;
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
    for (const el of [audioRef.current, audioNextRef.current, streamAudioRef.current, streamAudioNextRef.current]) {
      if (el) el.volume = volume;
    }
  }, [volume]);

  // ── Seek ──
  useEffect(() => {
    if (seek === undefined) return;
    for (const el of [streamAudioRef.current, audioRef.current]) {
      if (el) el.currentTime = seek / 1000;
    }
  }, [seekId]);

  // ── Audio event handlers — attach to whichever element is active ──
  useEffect(() => {
    const el = getActiveElement();
    if (!el) return;

    const onTimeUpdate = () => setPositionMs(el.currentTime * 1000);
    const onDurationChange = () => setDuration(el.duration * 1000);
    const onEnded = () => {
      if (!crossfadePendingRef.current && !isCrossfading) next();
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("ended", onEnded);
    };
  }, [setPositionMs, setDuration, next, currentTrack?.id, isCrossfading]);

  // ── Apply selected output device ──
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
