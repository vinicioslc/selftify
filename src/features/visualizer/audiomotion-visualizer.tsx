import { useEffect, useRef } from "react";
import { getAudioContext, getAnalyser } from "../../services/audio-engine";

interface Props {
  enabled: boolean;
  fullScreen?: boolean;
}

export function AudioMotionVisualizer({ enabled, fullScreen }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    let isMounted = true;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      try {
        const ctx = getAudioContext();
        const analyser = getAnalyser();
        if (!ctx || !analyser) return;

        const AudioMotionAnalyzer = (await import("audiomotion-analyzer")).default;
        if (!isMounted) return;

        const container = containerRef.current!;
        const rect = container.getBoundingClientRect();
        const width = rect.width || 600;
        const height = rect.height || 600;

        const visualizer = new AudioMotionAnalyzer(container, {
          audioCtx: ctx,
          source: analyser,
          width,
          height,
          mode: 10,
          barSpace: 0.3,
          radial: false,
          gradient: "rainbow",
          showScaleX: false,
          showPeaks: true,
          bgAlpha: 0,
        });

        visualizerRef.current = visualizer;

        resizeObserver = new ResizeObserver(() => {
          const r = container.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            visualizer.setOptions({ width: r.width, height: r.height });
          }
        });
        resizeObserver.observe(container);
      } catch (err) {
        console.warn("AudioMotion init error:", err);
      }
    }

    init();

    return () => {
      isMounted = false;
      resizeObserver?.disconnect();
      if (visualizerRef.current) {
        visualizerRef.current.destroy();
        visualizerRef.current = null;
      }
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none ${fullScreen ? "absolute inset-0 z-0" : "h-full w-full overflow-hidden"}`}
    />
  );
}
