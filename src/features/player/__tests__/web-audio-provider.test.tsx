import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { usePlayerStore } from "../../../stores/player.store";
import { PlayerStatus } from "../../../types/domain-types";
import type { Song, OriginType } from "../../../types/domain-types";

// ── Hoisted mocks (run before any imports) ──

const mockAudio = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  const instance = {
    _src: "",
    get src() { return this._src; },
    set src(v: string) { this._src = v; },
    _readyState: 0,
    get readyState() { return this._readyState; },
    set readyState(v: number) { this._readyState = v; },
    _currentTime: 0,
    get currentTime() { return this._currentTime; },
    set currentTime(v: number) { this._currentTime = v; },
    _paused: true,
    get paused() { return this._paused; },
    set paused(v: boolean) { this._paused = v; },
    _ended: false,
    get ended() { return this._ended; },
    set ended(v: boolean) { this._ended = v; },
    preload: "",
    buffered: { length: 0, start: vi.fn(), end: vi.fn() },
    load: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    addEventListener: vi.fn((event: string, fn: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    removeEventListener: vi.fn((event: string, fn: (...args: any[]) => void) => {
      listeners.get(event)?.delete(fn);
    }),
    _fireEvent(event: string, ...args: any[]) {
      listeners.get(event)?.forEach((fn) => fn(...args));
    },
  };

  return {
    instance,
    reset() {
      instance._src = "";
      instance._readyState = 0;
      instance._currentTime = 0;
      instance._paused = true;
      instance._ended = false;
      instance.buffered.length = 0;
      listeners.clear();
      instance.load.mockClear();
      instance.play.mockClear();
      instance.pause.mockClear();
      instance.removeAttribute.mockClear();
      instance.addEventListener.mockClear();
      instance.removeEventListener.mockClear();
    },
  };
});

function AudioMock() {
  return mockAudio.instance;
}
vi.stubGlobal("Audio", AudioMock);

vi.mock("../../../services/audio-engine", () => ({
  connectMediaElement: vi.fn(),
  resumeContext: vi.fn().mockResolvedValue(undefined),
  getAudioContext: vi.fn().mockReturnValue(undefined),
  destroy: vi.fn(),
  setOutputDevice: vi.fn().mockResolvedValue(undefined),
  addStateChangeListener: vi.fn().mockReturnValue(vi.fn()),
  supportsSinkId: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../api/controller", () => ({
  getController: vi.fn().mockResolvedValue({
    getStreamUrl: vi.fn().mockResolvedValue("blob:test-audio-url"),
  }),
}));

// ── Import after mocks ──

import { WebAudioProvider } from "../web-audio-provider";

const mockSong: Song = {
  id: "test-song-1",
  originId: "local-1",
  originType: "local" as OriginType,
  name: "Test Song",
  artistName: "Test Artist",
  duration: 200000,
  imageUrl: null,
};

describe("WebAudioProvider — playback race condition", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    mockAudio.reset();
    usePlayerStore.setState({
      currentTrack: null,
      status: PlayerStatus.STOPPED,
      seek: 0,
      duration: 0,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  it("não chama play() antes do audio estar carregado (canplay)", async () => {
    // Monta o provider (sem track → sem load)
    root.render(<WebAudioProvider><div /></WebAudioProvider>);

    // Simula race condition: currentTrack + status=PLAYING simultâneos
    const playSpy = vi.fn().mockResolvedValue(undefined);
    mockAudio.instance.play = playSpy;
    mockAudio.instance._readyState = 1; // não carregado

    usePlayerStore.getState().setCurrentTrack(mockSong);

    // Aguarda o loadTrack effect rodar e setar src + chamar load()
    await vi.waitFor(() => {
      expect(mockAudio.instance.load).toHaveBeenCalled();
    });
    expect(mockAudio.instance._src).toBe("blob:test-audio-url");

    // ASSERT CRÍTICO: play() NÃO deve ter sido chamado (audio não carregou)
    // Se essa asserção falhar, a race condition entre os effects voltou
    expect(playSpy).not.toHaveBeenCalled();

    // Simula carregamento completo
    mockAudio.instance._readyState = 4;
    mockAudio.instance._fireEvent("canplay");

    // play() deve ter sido chamado (audio carregou e status é PLAYING)
    await vi.waitFor(() => {
      expect(playSpy).toHaveBeenCalledOnce();
    });
  });

  it("play() não é chamado se usuário pausou antes do carregamento", async () => {
    root.render(<WebAudioProvider><div /></WebAudioProvider>);

    const playSpy = vi.fn().mockResolvedValue(undefined);
    mockAudio.instance.play = playSpy;
    mockAudio.instance._readyState = 1;

    // Inicia carregamento
    usePlayerStore.getState().setCurrentTrack(mockSong);

    await vi.waitFor(() => {
      expect(mockAudio.instance.load).toHaveBeenCalled();
    });

    // Usuário pausa antes do carregamento terminar
    usePlayerStore.getState().pause();

    // Carregamento termina
    mockAudio.instance._readyState = 4;
    mockAudio.instance._fireEvent("canplay");

    // play NÃO deve ter sido chamado (usuário pausou)
    await vi.waitFor(() => {
      expect(usePlayerStore.getState().status).toBe(PlayerStatus.PAUSED);
    });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("play() funciona quando audio já está carregado (resume)", async () => {
    // Monta com uma música ativa → carrega e toca
    mockAudio.instance._readyState = 4;
    root.render(<WebAudioProvider><div /></WebAudioProvider>);
    usePlayerStore.getState().setCurrentTrack(mockSong);

    await vi.waitFor(() => {
      expect(mockAudio.instance.load).toHaveBeenCalled();
    });

    mockAudio.instance._readyState = 4;
    mockAudio.instance._fireEvent("canplay");

    // Deve tocar após carregar
    await vi.waitFor(() => {
      expect(mockAudio.instance.play).toHaveBeenCalled();
    });

    mockAudio.instance.play.mockClear();

    // Pausa
    usePlayerStore.getState().pause();

    await vi.waitFor(() => {
      expect(mockAudio.instance.pause).toHaveBeenCalled();
    });
    mockAudio.instance.pause.mockClear();

    // Resume — audio já carregado (readyState = 4)
    usePlayerStore.getState().play();

    await vi.waitFor(() => {
      expect(mockAudio.instance.play).toHaveBeenCalledOnce();
    });
  });
});
