import { useCallback, useEffect, useRef, useState } from "react";
import { Pin, PinOff, ChevronLeft, ChevronRight } from "lucide-react";
import { getAudioContext, subscribe } from "../../services/audio-engine";

const PIN_KEY = "butterchurn-pinned-preset";

interface Props {
  enabled: boolean;
  fullScreen?: boolean;
}

export function ButterchurnVisualizer({ enabled, fullScreen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<any>(null);
  const audioBufRef = useRef(new Uint8Array(1024));
  const rafRef = useRef<number>(0);
  const presetsRef = useRef<any>(null);
  const presetKeysRef = useRef<string[]>([]);
  const presetIndexRef = useRef<number>(0);
  const [ready, setReady] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [presetLabel, setPresetLabel] = useState("");

  function loadPresetAt(index: number) {
    const keys = presetKeysRef.current;
    const v = visualizerRef.current;
    if (!keys.length || !v || !presetsRef.current) return;
    presetIndexRef.current = index;
    const name = keys[index];
    v.loadPreset(presetsRef.current.getPresets()[name], 0.5);
    setPresetLabel(name);
  }

  const prevPreset = useCallback(() => {
    const keys = presetKeysRef.current;
    if (!keys.length) return;
    const prev = (presetIndexRef.current - 1 + keys.length) % keys.length;
    loadPresetAt(prev);
  }, []);

  const nextPreset = useCallback(() => {
    const keys = presetKeysRef.current;
    if (!keys.length) return;
    const next = (presetIndexRef.current + 1) % keys.length;
    loadPresetAt(next);
  }, []);

  const togglePin = useCallback(() => {
    const name = presetKeysRef.current[presetIndexRef.current];
    if (!name) return;
    const wasPinned = !!localStorage.getItem(PIN_KEY);
    if (wasPinned) {
      localStorage.removeItem(PIN_KEY);
      setPinned(false);
    } else {
      localStorage.setItem(PIN_KEY, name);
      setPinned(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }

    let isMounted = true;
    let butterchurnInstance: any = null;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      try {
        const ctx = getAudioContext();
        if (ctx && ctx.state === "suspended") await ctx.resume();

        const [butterchurnModule, presetsModule] = await Promise.all([
          import("butterchurn"),
          import("butterchurn-presets"),
        ]);
        if (!isMounted) return;

        const Butterchurn = butterchurnModule.default;
        const presets = presetsModule.default;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const rect = container.getBoundingClientRect();
        const width = rect.width || 600;
        const height = rect.height || 600;

        canvas.width = width;
        canvas.height = height;

        butterchurnInstance = Butterchurn.createVisualizer(ctx || null, canvas, {
          width,
          height,
          pixelRatio: window.devicePixelRatio || 1,
          textureRatio: 1,
        });

        presetsRef.current = presets;
        presetKeysRef.current = Object.keys(presets.getPresets());

        const savedPin = localStorage.getItem(PIN_KEY);
        const pinValid = savedPin ? presetKeysRef.current.indexOf(savedPin) : -1;
        setPinned(pinValid >= 0);

        let startIdx = 0;
        if (pinValid >= 0) {
          startIdx = pinValid;
        } else {
          if (savedPin) localStorage.removeItem(PIN_KEY);
          startIdx = Math.floor(Math.random() * presetKeysRef.current.length);
        }
        presetIndexRef.current = startIdx;
        const startPreset = presetKeysRef.current[startIdx];
        butterchurnInstance.loadPreset(presets.getPresets()[startPreset], 0.5);
        setPresetLabel(startPreset);

        audioBufRef.current.fill(128);
        butterchurnInstance.render({
          audioLevels: {
            timeByteArray: audioBufRef.current,
            timeByteArrayL: audioBufRef.current,
            timeByteArrayR: audioBufRef.current,
          },
        });

        visualizerRef.current = butterchurnInstance;
        if (isMounted) setReady(true);

        resizeObserver = new ResizeObserver(() => {
          const r = container.getBoundingClientRect();
          const w = r.width || width;
          const h = r.height || height;
          canvas.width = w;
          canvas.height = h;
          butterchurnInstance?.setRendererSize(w, h);
        });
        resizeObserver.observe(container);
      } catch (err) {
        console.warn("[butterchurn] init error:", err);
      }
    }

    init();

    return () => {
      isMounted = false;
      resizeObserver?.disconnect();
      cancelAnimationFrame(rafRef.current);

      if (visualizerRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          const gl =
            canvas.getContext("webgl2") ||
            canvas.getContext("webgl");
          if (gl) {
            const ext = gl.getExtension("WEBGL_lose_context");
            ext?.loseContext();
          }
        }
      }

      visualizerRef.current = null;
      setReady(false);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !ready) return;

    const unsub = subscribe((_freq, time) => {
      const buf = audioBufRef.current;
      buf.fill(128);
      buf.set(time);
    });

    function renderLoop() {
      const v = visualizerRef.current;
      if (v) {
        v.render({
          audioLevels: {
            timeByteArray: audioBufRef.current,
            timeByteArrayL: audioBufRef.current,
            timeByteArrayR: audioBufRef.current,
          },
        });
      }
      rafRef.current = requestAnimationFrame(renderLoop);
    }

    rafRef.current = requestAnimationFrame(renderLoop);

    return () => {
      unsub();
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, ready]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      className={`group relative h-full w-full overflow-hidden ${fullScreen ? "absolute inset-0 z-0" : ""}`}
      style={{ background: "black" }}
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none h-full w-full"
      />
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={prevPreset}
          className="h-7 w-7 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 text-white/80 hover:text-white transition-colors"
          title="Previous preset"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={togglePin}
          className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${
            pinned
              ? "bg-amber-500/70 text-white hover:bg-amber-500/90"
              : "bg-black/50 text-white/80 hover:bg-black/70 hover:text-white"
          }`}
          title={pinned ? "Unpin preset" : "Pin preset"}
        >
          {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={nextPreset}
          className="h-7 w-7 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 text-white/80 hover:text-white transition-colors"
          title="Next preset"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="inline-block px-2 py-0.5 rounded bg-black/60 text-white/90 text-[10px] leading-tight truncate max-w-[200px]">
          {presetLabel}
        </span>
      </div>
    </div>
  );
}
