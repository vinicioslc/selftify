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
    } catch {}
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
  } catch {
  }
}

export function supportsSinkId(audio: HTMLAudioElement): boolean {
  return "setSinkId" in audio;
}
