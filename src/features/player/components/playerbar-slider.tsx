import { usePlayerStore } from "../../../stores/player.store";
import { Slider } from "../../../components/ui/slider";
import { formatDuration } from "../../../lib/utils";

export function PlayerbarSlider() {
  const { seek, duration, setSeek } = usePlayerStore();

  const progress = duration > 0 ? (seek / duration) * 100 : 0;

  function handleSeek(value: number[]) {
    setSeek((value[0] / 100) * duration);
  }

  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
        {formatDuration(seek)}
      </span>
      <Slider
        value={[progress]}
        onValueChange={handleSeek}
        max={100}
        step={0.1}
        className="flex-1"
      />
      <span className="w-10 text-xs text-muted-foreground tabular-nums">
        {formatDuration(duration)}
      </span>
    </div>
  );
}
