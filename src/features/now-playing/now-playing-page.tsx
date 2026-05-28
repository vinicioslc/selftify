import { usePlayerStore } from "../../stores/player.store";
import { PlayerStatus } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/avatar";
import { Slider } from "../../components/ui/slider";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { VisualizerContainer } from "../visualizer/visualizer-container";
import { useSettingsStore } from "../../stores/settings.store";
import { formatDuration } from "../../lib/utils";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Trash2,
  Music,
} from "lucide-react";

export function NowPlayingPage() {
  const {
    currentTrack,
    status,
    queue,
    seek,
    duration,
    repeat,
    shuffle,
    togglePlay,
    next,
    previous,
    toggleRepeat,
    toggleShuffle,
    setSeek,
    removeFromQueue,
    clearQueue,
  } = usePlayerStore();
  const { visualizerEnabled } = useSettingsStore();

  const progress = duration > 0 ? (seek / duration) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Visualizer backdrop */}
      {visualizerEnabled && currentTrack && (
        <div className="pointer-events-none absolute inset-0 z-0 opacity-10">
          <VisualizerContainer />
        </div>
      )}

      {/* Now playing header */}
      {currentTrack ? (
        <div className="relative z-10 flex flex-col items-center gap-4 border-b p-6 md:flex-row">
          <Avatar
            src={currentTrack.imageUrl}
            alt={currentTrack.name}
            fallback={currentTrack.name.charAt(0)}
            className="h-24 w-24 rounded-xl shadow-lg md:h-32 md:w-32"
          />
          <div className="flex flex-col items-center text-center md:items-start md:text-left">
            <h1 className="text-xl font-bold">{currentTrack.name}</h1>
            <p className="text-base text-muted-foreground">{currentTrack.artistName}</p>
            {currentTrack.albumName && (
              <p className="text-sm text-muted-foreground/70">{currentTrack.albumName}</p>
            )}

            {/* Seek + controls */}
            <div className="mt-4 flex w-full max-w-md flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={previous}>
                  <SkipBack className="h-5 w-5" />
                </Button>
                <Button
                  variant="default"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  onClick={togglePlay}
                >
                  {status === PlayerStatus.PLAYING ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5 pl-0.5" />
                  )}
                </Button>
                <Button variant="ghost" size="icon" onClick={next}>
                  <SkipForward className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={shuffle !== "none" ? "text-primary" : ""}
                  onClick={toggleShuffle}
                >
                  <Shuffle className="h-4 w-4" />
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
              <div className="flex items-center gap-2">
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                  {formatDuration(seek)}
                </span>
                <Slider
                  value={[progress]}
                  onValueChange={([v]) => setSeek((v / 100) * duration)}
                  max={100}
                  step={0.1}
                  className="flex-1"
                />
                <span className="w-10 text-xs tabular-nums text-muted-foreground">
                  {formatDuration(duration)}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center border-b p-8">
          <div className="text-center">
            <Music className="mx-auto mb-2 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">No track playing</p>
          </div>
        </div>
      )}

      {/* Queue */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h2 className="text-sm font-semibold">Queue ({queue.length})</h2>
          {queue.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearQueue}>
              <Trash2 className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1">
          {queue.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">Queue is empty</p>
            </div>
          ) : (
            <div className="divide-y">
              {queue.map((track, i) => (
                <div
                  key={track.queueId}
                  className={`flex items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/50 ${
                    track.queueId === currentTrack?.queueId ? "bg-accent" : ""
                  }`}
                >
                  <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Avatar
                    src={track.imageUrl}
                    alt={track.name}
                    fallback={track.name.charAt(0)}
                    className="h-10 w-10 rounded-md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{track.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{track.artistName}</p>
                  </div>
                  <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                    {formatDuration(track.duration)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 hover:opacity-100"
                    onClick={() => removeFromQueue(track.queueId)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
