import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──

let mockResume: ReturnType<typeof vi.fn>;
let mockCreateAnalyser: ReturnType<typeof vi.fn>;
let mockCreateMediaStreamSource: ReturnType<typeof vi.fn>;
let mockCreateGain: ReturnType<typeof vi.fn>;
let mockAddEventListener: ReturnType<typeof vi.fn>;
let mockCaptureStream: ReturnType<typeof vi.fn>;
let rafCb: FrameRequestCallback | null;

interface MockAnalyser {
  fftSize: number;
  disconnect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  frequencyBinCount: number;
  getByteFrequencyData: ReturnType<typeof vi.fn>;
  getByteTimeDomainData: ReturnType<typeof vi.fn>;
}

let analyserRef: MockAnalyser | null = null;

function mockAudioContext(state = "suspended") {
  const analyser: MockAnalyser = {
    fftSize: 256,
    disconnect: vi.fn(),
    connect: vi.fn(),
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn(),
    getByteTimeDomainData: vi.fn(),
  };
  analyserRef = analyser;
  mockCreateAnalyser.mockReturnValue(analyser);

  const source = { disconnect: vi.fn(), connect: vi.fn() };
  mockCreateMediaStreamSource.mockReturnValue(source);

  const gain = { gain: { value: 0 }, connect: vi.fn() };
  mockCreateGain.mockReturnValue(gain);

  vi.stubGlobal("AudioContext", vi.fn().mockImplementation(() => ({
    state,
    resume: mockResume,
    close: vi.fn(),
    createAnalyser: mockCreateAnalyser,
    createMediaStreamSource: mockCreateMediaStreamSource,
    createGain: mockCreateGain,
    addEventListener: mockAddEventListener,
    destination: {},
  })));
}

function mockAudioElement(captureStreamFn?: () => { getAudioTracks: () => { length: number }[] }) {
  const defaultStream = () => ({
    getAudioTracks: () => [{ length: 1 }],
  });
  mockCaptureStream = vi.fn(captureStreamFn ?? defaultStream);
  return { captureStream: mockCaptureStream } as unknown as HTMLAudioElement;
}

/** Tick one animation frame synchronously (executes the stored callback). */
function tickOneFrame() {
  if (rafCb) {
    const cb = rafCb;
    rafCb = null;
    cb(performance.now());
  }
}

// ── Module under test ──

const mod = await import("../audio-engine");
const {
  connectStreamAudio,
  connectMediaElement,
  resumeContext,
  subscribe,
  getAnalyser,
  getAudioContext,
  destroy,
  isCaptureStreamSupported,
} = mod;

describe("audio-engine — stream pipeline", () => {
  beforeEach(() => {
    analyserRef = null;
    mockResume = vi.fn().mockResolvedValue(undefined);
    mockCreateAnalyser = vi.fn();
    mockCreateMediaStreamSource = vi.fn();
    mockCreateGain = vi.fn();
    mockAddEventListener = vi.fn();
    rafCb = null;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      rafCb = cb;
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {
      rafCb = null;
    });
  });

  afterEach(() => {
    destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    analyserRef = null;
  });

  // ── connectStreamAudio ──

  it("creates AudioContext and connects analyser via captureStream", () => {
    mockAudioContext();
    const audio = mockAudioElement();

    connectStreamAudio(audio);

    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(mockCaptureStream).toHaveBeenCalledWith();
    expect(mockCreateMediaStreamSource).toHaveBeenCalled();
    expect(mockCreateAnalyser).toHaveBeenCalled();
    const analyser = mockCreateAnalyser.mock.results[0].value;
    expect(analyser.fftSize).toBe(256);
    const source = mockCreateMediaStreamSource.mock.results[0].value;
    expect(source.connect).toHaveBeenCalledWith(analyser);
  });

  it("does not create a second AudioContext if one already exists", () => {
    mockAudioContext();
    const audio = mockAudioElement();
    const audio2 = mockAudioElement();

    connectStreamAudio(audio);
    connectStreamAudio(audio2);

    expect(AudioContext).toHaveBeenCalledTimes(1);
  });

  it("handles captureStream missing tracks silently (no crash)", () => {
    mockAudioContext();
    const audio = mockAudioElement(() => ({
      getAudioTracks: () => [],
    }));

    expect(() => connectStreamAudio(audio)).not.toThrow();
  });

  it("handles captureStream throwing SecurityError — fixes cross-origin stream visualizers", () => {
    mockAudioContext();
    const audio = mockAudioElement(() => {
      throw new DOMException("Cannot capture from element with cross-origin data", "SecurityError");
    });

    expect(() => connectStreamAudio(audio)).not.toThrow();
  });

  // ── resumeContext ──

  it("calls audioCtx.resume() when context is suspended", async () => {
    mockAudioContext("suspended");
    connectStreamAudio(mockAudioElement());

    await resumeContext();

    expect(mockResume).toHaveBeenCalledTimes(1);
  });

  it("does not call resume() when context is already running", async () => {
    mockAudioContext("running");
    connectStreamAudio(mockAudioElement());

    await resumeContext();

    expect(mockResume).not.toHaveBeenCalled();
  });

  it("returns resolved promise when no AudioContext exists", async () => {
    const result = await resumeContext();
    expect(result).toBeUndefined();
  });

  it("lets resume() rejections propagate (caller wraps in try-catch)", async () => {
    mockAudioContext("suspended");
    connectStreamAudio(mockAudioElement());
    const err = new DOMException("play() failed", "NotAllowedError");
    mockResume.mockRejectedValueOnce(err);

    await expect(resumeContext()).rejects.toThrow(err);
  });

  // ── subscribe ──

  it("subscribed listener receives frequency and time data from analyser", () => {
    mockAudioContext();
    connectStreamAudio(mockAudioElement());

    const analyser = analyserRef!;
    analyser.getByteFrequencyData.mockImplementation((buf: Uint8Array) => buf.fill(42));
    analyser.getByteTimeDomainData.mockImplementation((buf: Uint8Array) => buf.fill(128));

    const listener = vi.fn();
    subscribe(listener);

    tickOneFrame();

    expect(listener).toHaveBeenCalledTimes(1);
    const [freq, time] = listener.mock.calls[0];
    expect(freq[0]).toBe(42);
    expect(time[0]).toBe(128);
  });

  it("unsubscribe removes listener", () => {
    mockAudioContext();
    connectStreamAudio(mockAudioElement());
    const analyser = analyserRef!;
    analyser.getByteFrequencyData.mockImplementation((buf: Uint8Array) => buf.fill(1));

    const listener = vi.fn();
    const unsub = subscribe(listener);
    unsub();

    tickOneFrame();

    expect(listener).not.toHaveBeenCalled();
  });

  // ── isCaptureStreamSupported ──

  it("detects captureStream support when prototype has the method", () => {
    // happy-dom HTMLAudioElement.prototype should have it from our mock setup
    expect(isCaptureStreamSupported()).toBe(true);
  });

  // ── Getters ──

  it("returns the analyser node after connectStreamAudio", () => {
    mockAudioContext();
    connectStreamAudio(mockAudioElement());

    expect(getAnalyser()).not.toBeNull();
  });

  it("returns null analyser before any connection", () => {
    expect(getAnalyser()).toBeNull();
  });
});
