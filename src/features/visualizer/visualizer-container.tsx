import { useState, useCallback } from "react";
import { Expand, Shrink } from "lucide-react";
import { useSettingsStore } from "../../stores/settings.store";
import { ButterchurnVisualizer } from "./butterchurn-visualizer";
import { AudioMotionVisualizer } from "./audiomotion-visualizer";

interface Props {
  fullScreen?: boolean;
  force?: boolean;
  children?: React.ReactNode;
}

export function VisualizerContainer({ fullScreen, force, children }: Props) {
  const { visualizerEnabled, visualizerType } = useSettingsStore();
  const [widescreen, setWidescreen] = useState(false);

  const toggleWidescreen = useCallback(() => setWidescreen((w) => !w), []);

  const showContent = visualizerEnabled || force;

  let content: React.ReactNode = null;
  if (children) {
    content = children;
  } else if (showContent) {
    if (visualizerType === "butterchurn") {
      content = <ButterchurnVisualizer enabled fullScreen={fullScreen} />;
    } else if (visualizerType === "audiomotion") {
      content = <AudioMotionVisualizer enabled fullScreen={fullScreen} />;
    }
  }

  if (!content) return null;

  return (
    <div
      className={`group ${widescreen ? "fixed inset-0 z-[9998]" : "relative h-full w-full"}`}
    >
      <div className="h-full w-full">
        {content}
      </div>

      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          type="button"
          onClick={toggleWidescreen}
          className="h-7 w-7 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 text-white/80 hover:text-white transition-colors"
          title={widescreen ? "Exit widescreen" : "Widescreen"}
        >
          {widescreen ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
        </button>
      </div>

      {widescreen && (
        <button
          type="button"
          onClick={toggleWidescreen}
          className="fixed top-3 right-3 h-8 w-8 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 text-white/80 hover:text-white transition-colors z-[9999]"
          title="Exit widescreen"
        >
          <Shrink className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
