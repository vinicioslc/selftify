import { useEffect, useRef } from "react";
import { getAudioAnalyser } from "../player/web-audio-provider";

interface Props {
  enabled: boolean;
  fullScreen?: boolean;
}

export function ButterchurnVisualizer({ enabled, fullScreen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !canvasRef.current) return;

    async function init() {
      try {
        const butterchurn = await import("butterchurn");
        const presets = await import("butterchurn-presets");

        const canvas = canvasRef.current!;
        const visualizer = butterchurn.default.createVisualizer(
          null,
          canvas,
          {
            width: canvas.width || window.innerWidth,
            height: canvas.height || window.innerHeight,
            pixelRatio: window.devicePixelRatio || 1,
            textureRatio: 1,
          }
        );

        const presetKeys = Object.keys(presets.default.getPresets());
        const randomPreset = presetKeys[Math.floor(Math.random() * presetKeys.length)];
        visualizer.loadPreset(presets.default.getPresets()[randomPreset], 0.5);
        visualizerRef.current = visualizer;
      } catch (err) {
        console.warn("Butterchurn init error:", err);
      }
    }

    init();

    return () => {
      if (visualizerRef.current) {
        visualizerRef.current = null;
      }
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !visualizerRef.current) return;

    function render() {
      const analyser = getAudioAnalyser();
      if (analyser && visualizerRef.current) {
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);
        visualizerRef.current.render();
        visualizerRef.current.setAudioData({
          waveform: new Float32Array(0),
          frequency: freqData,
        });
      }
      animFrameRef.current = requestAnimationFrame(render);
    }

    render();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${fullScreen ? "absolute inset-0 z-0" : "h-full w-full"}`}
    />
  );
}
