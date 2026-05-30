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

    async function init() {
      try {
        const AudioMotionAnalyzer = (await import("audiomotion-analyzer")).default;
        const container = containerRef.current!;
        const ctx = getAudioContext();
        const analyser = getAnalyser();
        if (!ctx || !analyser) return;

        const visualizer = new AudioMotionAnalyzer(container, {
          audioCtx: ctx,
          source: analyser,
          width: container.clientWidth,
          height: container.clientHeight,
          mode: 10,
          barSpace: 0.3,
          radial: false,
          gradient: "rainbow",
          showScaleX: false,
          showPeaks: true,
          bgAlpha: 0,
        });

        visualizerRef.current = visualizer;
      } catch (err) {
        console.warn("AudioMotion init error:", err);
      }
    }

    init();

    return () => {
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
      className={`pointer-events-none ${fullScreen ? "absolute inset-0 z-0" : "h-full w-full"}`}
    />
  );
}
