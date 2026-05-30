import { usePlayerStore } from "../../../stores/player.store";
import { PlayerStatus } from "../../../types/domain-types";
import { Button } from "../../../components/ui/button";
import { PlayerbarSlider } from "./playerbar-slider";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
} from "lucide-react";

export function CenterControls() {
  const {
    status,
    repeat,
    shuffle,
    togglePlay,
    next,
    previous,
    toggleRepeat,
    toggleShuffle,
  } = usePlayerStore();

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 ${shuffle !== "none" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          onClick={toggleShuffle}
        >
          <Shuffle className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={previous}
        >
          <SkipBack className="h-5 w-5" />
        </Button>
        <Button
          variant="default"
          size="icon"
          className="h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/90 active:scale-95"
          onClick={togglePlay}
        >
          {status === PlayerStatus.PLAYING ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 pl-0.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={next}
        >
          <SkipForward className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 ${repeat !== "none" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          onClick={toggleRepeat}
        >
          <Repeat className="h-4 w-4" />
        </Button>
      </div>
      <PlayerbarSlider />
    </>
  );
}
