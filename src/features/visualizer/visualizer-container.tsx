import { useSettingsStore } from "../../stores/settings.store";
import { ButterchurnVisualizer } from "./butterchurn-visualizer";
import { AudioMotionVisualizer } from "./audiomotion-visualizer";

interface Props {
  fullScreen?: boolean;
  force?: boolean;
}

export function VisualizerContainer({ fullScreen, force }: Props) {
  const { visualizerEnabled, visualizerType } = useSettingsStore();

  if (!visualizerEnabled && !force) return null;

  if (visualizerType === "butterchurn") {
    return <ButterchurnVisualizer enabled fullScreen={fullScreen} />;
  }

  if (visualizerType === "audiomotion") {
    return <AudioMotionVisualizer enabled fullScreen={fullScreen} />;
  }

  return null;
}
