import { useEffect, useRef, useState } from "react";
import { getAudioContext, subscribe } from "../../services/audio-engine";

interface Props {
  enabled: boolean;
  fullScreen?: boolean;
}

export function ButterchurnVisualizer({ enabled, fullScreen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const rafRef = useRef<number>(0);

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
        if (!ctx) return;

        if (ctx.state === "suspended") await ctx.resume();

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

        butterchurnInstance = Butterchurn.createVisualizer(ctx, canvas, {
          width,
          height,
          pixelRatio: window.devicePixelRatio || 1,
          textureRatio: 1,
        });

        const presetKeys = Object.keys(presets.getPresets());
        const randomPreset = presetKeys[Math.floor(Math.random() * presetKeys.length)];
        butterchurnInstance.loadPreset(presets.getPresets()[randomPreset], 0.5);

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
        console.warn("Butterchurn init error:", err);
      }
    }

    init();

    return () => {
      isMounted = false;
      resizeObserver?.disconnect();
      cancelAnimationFrame(rafRef.current);
      visualizerRef.current = null;
      setReady(false);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !ready) return;

    const unsub = subscribe((freq, time) => {
      const v = visualizerRef.current;
      if (!v) return;
      v.setAudioData({ waveform: time, frequency: freq });
      rafRef.current = requestAnimationFrame(() => v.render());
    });

    return () => {
      unsub();
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, ready]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden ${fullScreen ? "absolute inset-0 z-0" : ""}`}
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none h-full w-full"
      />
    </div>
  );
}
