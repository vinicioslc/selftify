import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { PlayerStatus } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Slider } from "../../components/ui/slider";
import { Avatar } from "../../components/ui/avatar";
import { formatDuration } from "../../lib/utils";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Volume2,
  VolumeX,
  Maximize2,
  ListMusic,
} from "lucide-react";

export function PlayerBar() {
  const {
    currentTrack,
    status,
    volume,
    seek,
    duration,
    repeat,
    shuffle,
    play,
    pause,
    next,
    previous,
    togglePlay,
    toggleRepeat,
    toggleShuffle,
    setVolume,
    setSeek,
    toggleFullScreen,
  } = usePlayerStore();
  const { visualizerEnabled } = useSettingsStore();

  if (!currentTrack) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">No track selected</p>
      </div>
    );
  }

  const progress = duration > 0 ? (seek / duration) * 100 : 0;

  return (
    <div className="flex h-full items-center gap-4 px-4">
      {/* Track info */}
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-xs">
        <Avatar
          src={currentTrack.imageUrl}
          alt={currentTrack.name}
          fallback={currentTrack.name.charAt(0)}
          className="h-12 w-12 rounded-lg"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{currentTrack.name}</p>
          <p className="truncate text-xs text-muted-foreground">{currentTrack.artistName}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="hidden flex-col items-center gap-1 sm:flex md:flex-1 lg:max-w-xl">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={shuffle !== "none" ? "text-primary" : ""}
            onClick={toggleShuffle}
          >
            <Shuffle className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={previous}>
            <SkipBack className="h-5 w-5" />
          </Button>
          <Button variant="default" size="icon-lg" className="rounded-full" onClick={togglePlay}>
            {status === PlayerStatus.PLAYING ? (
              <Pause className="h-6 w-6" />
            ) : (
              <Play className="h-6 w-6 pl-0.5" />
            )}
          </Button>
          <Button variant="ghost" size="icon" onClick={next}>
            <SkipForward className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={repeat !== "none" ? "text-primary" : ""}
            onClick={toggleRepeat}
          >
            <Repeat className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex w-full items-center gap-2">
          <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
            {formatDuration(seek)}
          </span>
          <Slider
            value={[progress]}
            onValueChange={([v]) => setSeek((v / 100) * duration)}
            max={100}
            step={0.1}
            className="flex-1"
          />
          <span className="w-10 text-xs text-muted-foreground tabular-nums">
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      {/* Volume & extras */}
      <div className="hidden items-center gap-2 md:flex lg:max-w-xs">
        <Button variant="ghost" size="icon" onClick={() => setVolume(volume === 0 ? 0.8 : 0)}>
          {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </Button>
        <Slider
          value={[volume * 100]}
          onValueChange={([v]) => setVolume(v / 100)}
          max={100}
          step={1}
          className="w-24"
        />
        <Button variant="ghost" size="icon" onClick={toggleFullScreen}>
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon">
          <ListMusic className="h-4 w-4" />
        </Button>
      </div>

      {/* Mobile controls */}
      <div className="flex items-center gap-1 sm:hidden">
        <Button variant="ghost" size="icon" onClick={previous}>
          <SkipBack className="h-5 w-5" />
        </Button>
        <Button variant="default" size="icon" className="rounded-full" onClick={togglePlay}>
          {status === PlayerStatus.PLAYING ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 pl-0.5" />
          )}
        </Button>
        <Button variant="ghost" size="icon" onClick={next}>
          <SkipForward className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
