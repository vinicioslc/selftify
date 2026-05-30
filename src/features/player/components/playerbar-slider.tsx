import { useState, useRef } from "react";
import { usePlayerStore } from "../../../stores/player.store";
import { Slider } from "../../../components/ui/slider";
import { formatDuration } from "../../../lib/utils";

export function PlayerbarSlider() {
  const { positionMs, duration, setSeek } = usePlayerStore();

  const [isSeeking, setIsSeeking] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentMs = isSeeking ? dragValue : positionMs;
  const progress = duration > 0 ? (currentMs / duration) * 100 : 0;

  function handleSeek(value: number[]) {
    const pos = (value[0] / 100) * duration;
    setDragValue(pos);
    if (!isSeeking) setIsSeeking(true);
  }

  function handleSeekCommit(value: number[]) {
    const pos = (value[0] / 100) * duration;
    setSeek(pos);

    if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
    commitTimeoutRef.current = setTimeout(() => {
      setIsSeeking(false);
    }, 1000);
  }

  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {formatDuration(currentMs)}
      </span>
      <Slider
        value={[progress]}
        onValueChange={handleSeek}
        onValueCommit={handleSeekCommit}
        max={100}
        step={0.1}
        className="flex-1"
      />
      <span className="w-10 text-xs tabular-nums text-muted-foreground">
        {formatDuration(duration)}
      </span>
    </div>
  );
}
