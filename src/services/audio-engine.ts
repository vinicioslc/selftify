let audioCtx: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let sourceNode: AudioNode | null = null;
let currentAudio: HTMLAudioElement | null = null;
let rafId: number = 0;
let listeners = new Set<(freq: Uint8Array, time: Uint8Array) => void>();
let isLoopRunning = false;
let stateChangeListeners = new Set<() => void>();

function loop() {
  if (!analyserNode) return;
  const freq = new Uint8Array(analyserNode.frequencyBinCount);
  const time = new Uint8Array(analyserNode.fftSize);
  analyserNode.getByteFrequencyData(freq);
  analyserNode.getByteTimeDomainData(time);
  for (const fn of listeners) {
    fn(freq, time);
  }
  rafId = requestAnimationFrame(loop);
}

function onStateChange() {
  for (const fn of stateChangeListeners) fn();
}

let _usingCaptureStream = false;

function buildPipeline(audio: HTMLAudioElement): void {
  audioCtx = new AudioContext();
  audioCtx.addEventListener("statechange", onStateChange);

  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 256;

  // try captureStream first (web audio plays natively → device switching works)
  if ("captureStream" in audio) {
    try {
      const stream = (audio as any).captureStream();
      if (stream && stream.getAudioTracks().length > 0) {
        sourceNode = audioCtx.createMediaStreamSource(stream);

        const zeroGain = audioCtx.createGain();
        zeroGain.gain.value = 0;

        sourceNode.connect(analyserNode);
        analyserNode.connect(zeroGain);
        zeroGain.connect(audioCtx.destination);

        _usingCaptureStream = true;
        currentAudio = audio;
        if (!isLoopRunning) {
          isLoopRunning = true;
          rafId = requestAnimationFrame(loop);
        }
        return;
      }
    } catch (err) {
      console.warn("[audio-engine] captureStream failed:", err);
    }
  }

  // fallback – use createMediaElementSource (audio routes through AudioContext)
  sourceNode = audioCtx.createMediaElementSource(audio);
  sourceNode.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);

  _usingCaptureStream = false;
  currentAudio = audio;

  if (!isLoopRunning) {
    isLoopRunning = true;
    rafId = requestAnimationFrame(loop);
  }
}

export function usingCaptureStream(): boolean {
  return _usingCaptureStream;
}

/** Static check – true if the runtime supports captureStream */
export function isCaptureStreamSupported(): boolean {
  return typeof HTMLAudioElement !== "undefined" && "captureStream" in HTMLAudioElement.prototype;
}

export function connectMediaElement(audio: HTMLAudioElement): void {
  if (audioCtx) return;
  buildPipeline(audio);
}

export function resumeContext(): Promise<void> {
  if (audioCtx?.state === "suspended" || audioCtx?.state === "interrupted") {
    return audioCtx.resume();
  }
  return Promise.resolve();
}

export function subscribe(
  fn: (freq: Uint8Array, time: Uint8Array) => void
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getAudioContext(): AudioContext | null {
  return audioCtx;
}

export function getAnalyser(): AnalyserNode | null {
  return analyserNode;
}

export function destroy(): void {
  cancelAnimationFrame(rafId);
  rafId = 0;
  isLoopRunning = false;
  sourceNode?.disconnect();
  analyserNode?.disconnect();
  audioCtx?.close();
  sourceNode = null;
  analyserNode = null;
  audioCtx = null;
  currentAudio = null;
}

export function addStateChangeListener(fn: () => void): () => void {
  stateChangeListeners.add(fn);
  return () => {
    stateChangeListeners.delete(fn);
  };
}

export async function setOutputDevice(audio: HTMLAudioElement, deviceId: string): Promise<void> {
  if (!("setSinkId" in audio)) return;
  try {
    await (audio as any).setSinkId(deviceId);
  } catch (err) {
    console.warn("[audio-engine] setSinkId failed:", err);
  }
}

export function supportsSinkId(audio: HTMLAudioElement): boolean {
  return "setSinkId" in audio;
}

// ── Fade utilities for crossfade ──

export interface FadeHandle {
  cancel: () => void;
}

/**
 * Smoothly ramps an HTMLAudioElement's volume from `from` to `to`
 * over `durationSec` seconds using requestAnimationFrame.
 */
export function fadeVolume(
  element: HTMLAudioElement,
  from: number,
  to: number,
  durationSec: number,
  onComplete?: () => void,
): FadeHandle {
  if (durationSec <= 0) {
    element.volume = to;
    onComplete?.();
    return { cancel: () => {} };
  }

  let cancelled = false;
  const startTime = performance.now();

  function tick() {
    if (cancelled) return;
    const elapsed = (performance.now() - startTime) / 1000;
    const progress = Math.min(elapsed / durationSec, 1);
    // Cubic ease for more natural-sounding fade
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    element.volume = from + (to - from) * eased;

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.volume = to;
      onComplete?.();
    }
  }

  requestAnimationFrame(tick);

  return {
    cancel: () => { cancelled = true; },
  };
}

/**
 * Creates a GainNode inside the existing AudioContext for
 * programmatic volume control (used for local files routed
 * through createMediaElementSource).
 *
 * Returns `null` if the AudioContext isn't initialized or if
 * the captureStream path is active (volume controlled via element).
 */
export function createFadeGainNode(): GainNode | null {
  if (!audioCtx || _usingCaptureStream) return null;
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1;

  // Disconnect the existing analyser → destination, insert gain in between
  try {
    analyserNode?.disconnect();
    analyserNode?.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  } catch {
    return null;
  }

  return gainNode;
}

/**
 * Schedules a smooth gain ramp on a GainNode using the AudioContext
 * timeline. Returns a cancel handle.
 */
export function scheduleGainRamp(
  gainNode: GainNode,
  from: number,
  to: number,
  durationSec: number,
  onComplete?: () => void,
): FadeHandle {
  if (!audioCtx) return { cancel: () => {} };

  let cancelled = false;
  const ctx = audioCtx;
  const startTime = ctx.currentTime;

  // Immediate set to starting volume
  gainNode.gain.setValueAtTime(from, startTime);
  // Linear ramp to target
  gainNode.gain.linearRampToValueAtTime(to, startTime + durationSec);

  if (durationSec <= 0) {
    onComplete?.();
    return { cancel: () => {} };
  }

  // Poll for completion since AudioContext timeline runs independently
  let pollId: number | undefined;
  function poll() {
    if (cancelled) return;
    if (ctx.currentTime >= startTime + durationSec) {
      onComplete?.();
      return;
    }
    pollId = window.setTimeout(poll, 50);
  }
  pollId = window.setTimeout(poll, Math.max(durationSec * 1000 - 50, 0));

  return {
    cancel: () => {
      cancelled = true;
      if (pollId !== undefined) clearTimeout(pollId);
      // Hold at current value
      try { gainNode.gain.cancelScheduledValues(ctx.currentTime); } catch {}
    },
  };
}
