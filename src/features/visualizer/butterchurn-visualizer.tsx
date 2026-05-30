import { useEffect, useRef } from "react";
import { subscribe } from "../../services/audio-engine";

interface Props {
  enabled: boolean;
  fullScreen?: boolean;
}

export function ButterchurnVisualizer({ enabled, fullScreen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled || !canvasRef.current) return;

    async function init() {
      try {
        const butterchurnModule: any = await import("butterchurn");
        const presetsModule: any = await import("butterchurn-presets");
        const Butterchurn = butterchurnModule.default.default;
        const presets = presetsModule.default.default;

        const canvas = canvasRef.current!;
        const visualizer = Butterchurn.createVisualizer(
          null,
          canvas,
          {
            width: canvas.width || window.innerWidth,
            height: canvas.height || window.innerHeight,
            pixelRatio: window.devicePixelRatio || 1,
            textureRatio: 1,
          }
        );

        const presetKeys = Object.keys(presets.getPresets());
        const randomPreset = presetKeys[Math.floor(Math.random() * presetKeys.length)];
        visualizer.loadPreset(presets.getPresets()[randomPreset], 0.5);
        visualizerRef.current = visualizer;
      } catch (err) {
        console.warn("Butterchurn init error:", err);
      }
    }

    init();

    return () => {
      visualizerRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !visualizerRef.current) return;

    const unsub = subscribe((freq, time) => {
      const v = visualizerRef.current;
      if (!v) return;
      v.setAudioData({ waveform: time, frequency: freq });
      v.render();
    });

    return unsub;
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${fullScreen ? "absolute inset-0 z-0" : "h-full w-full"}`}
    />
  );
}
