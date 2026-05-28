import { useState, useCallback } from "react";
import { usePlayerStore } from "../../../stores/player.store";
import { useSettingsStore } from "../../../stores/settings.store";
import { Button } from "../../../components/ui/button";
import { Slider } from "../../../components/ui/slider";
import {
  Volume2,
  VolumeX,
  ListMusic,
  Maximize2,
  Heart,
} from "lucide-react";

export function RightControls({ onNavigate }: { onNavigate?: (view: any) => void }) {
  const { volume, setVolume, toggleFullScreen, queue } = usePlayerStore();
  const { visualizerEnabled, setVisualizerEnabled } = useSettingsStore();
  const [showVolume, setShowVolume] = useState(false);

  const handleVolumeWheel = useCallback(
    (e: React.WheelEvent) => {
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setVolume(Math.max(0, Math.min(1, volume + delta)));
    },
    [volume, setVolume]
  );

  return (
    <div className="flex h-full items-center gap-1 px-2" onWheel={handleVolumeWheel}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setVisualizerEnabled(!visualizerEnabled)}
      >
        <span className="text-xs">{visualizerEnabled ? "🎨" : "▫"}</span>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
      >
        <Heart className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${queue.length > 0 ? "text-primary" : ""}`}
        onClick={() => onNavigate?.("now-playing")}
      >
        <ListMusic className="h-4 w-4" />
      </Button>

      <div
        className="flex items-center gap-1"
        onMouseEnter={() => setShowVolume(true)}
        onMouseLeave={() => setShowVolume(false)}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setVolume(volume === 0 ? 0.8 : 0)}
        >
          {volume === 0 ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>
        {showVolume && (
          <Slider
            value={[volume * 100]}
            onValueChange={([v]) => setVolume(v / 100)}
            max={100}
            step={1}
            className="w-20"
          />
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={toggleFullScreen}
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
