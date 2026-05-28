import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { PlayerStatus } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Slider } from "../../components/ui/slider";
import { Avatar } from "../../components/ui/avatar";
import { VisualizerContainer } from "../visualizer/visualizer-container";
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
  Minimize2,
  ListMusic,
} from "lucide-react";

export function FullScreenPlayer() {
  const {
    currentTrack,
    status,
    volume,
    seek,
    duration,
    repeat,
    shuffle,
    togglePlay,
    next,
    previous,
    toggleRepeat,
    toggleShuffle,
    setVolume,
    setSeek,
    isFullScreen,
    toggleFullScreen,
    queue,
  } = usePlayerStore();
  const { visualizerEnabled } = useSettingsStore();

  if (!isFullScreen || !currentTrack) return null;

  const progress = duration > 0 ? (seek / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Visualizer background */}
      {visualizerEnabled && (
        <div className="absolute inset-0 z-0 opacity-40">
          <VisualizerContainer fullScreen />
        </div>
      )}

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between p-4">
        <Button variant="ghost" size="icon" onClick={toggleFullScreen}>
          <Minimize2 className="h-5 w-5" />
        </Button>
        <p className="text-sm font-medium">Now Playing</p>
        <Button variant="ghost" size="icon">
          <ListMusic className="h-5 w-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-8">
        {/* Album art */}
        <Avatar
          src={currentTrack.imageUrl}
          alt={currentTrack.name}
          fallback={currentTrack.name.charAt(0)}
          className="h-64 w-64 rounded-2xl shadow-2xl md:h-80 md:w-80"
        />

        {/* Track info */}
        <div className="text-center">
          <h2 className="text-2xl font-bold">{currentTrack.name}</h2>
          <p className="text-lg text-muted-foreground">{currentTrack.artistName}</p>
          {currentTrack.albumName && (
            <p className="text-sm text-muted-foreground">{currentTrack.albumName}</p>
          )}
        </div>

        {/* Progress */}
        <div className="flex w-full max-w-xl flex-col gap-2">
          <Slider
            value={[progress]}
            onValueChange={([v]) => setSeek((v / 100) * duration)}
            max={100}
            step={0.1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{formatDuration(seek)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon-lg"
            className={shuffle !== "none" ? "text-primary" : ""}
            onClick={toggleShuffle}
          >
            <Shuffle className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon-lg" onClick={previous}>
            <SkipBack className="h-7 w-7" />
          </Button>
          <Button variant="default" size="icon" className="h-16 w-16 rounded-full" onClick={togglePlay}>
            {status === PlayerStatus.PLAYING ? (
              <Pause className="h-8 w-8" />
            ) : (
              <Play className="h-8 w-8 pl-1" />
            )}
          </Button>
          <Button variant="ghost" size="icon-lg" onClick={next}>
            <SkipForward className="h-7 w-7" />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            className={repeat !== "none" ? "text-primary" : ""}
            onClick={toggleRepeat}
          >
            <Repeat className="h-5 w-5" />
          </Button>
        </div>

        {/* Volume */}
        <div className="flex w-full max-w-xs items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setVolume(volume === 0 ? 0.8 : 0)}>
            {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Slider
            value={[volume * 100]}
            onValueChange={([v]) => setVolume(v / 100)}
            max={100}
            step={1}
          />
        </div>
      </div>

      {/* Queue */}
      {queue.length > 1 && (
        <div className="relative z-10 max-h-32 overflow-y-auto border-t px-4 py-2">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Up Next ({queue.length} tracks)</p>
          <div className="space-y-1">
            {queue.slice(0, 5).map((track) => (
              <div key={track.queueId} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{track.queueIndex + 1}.</span>
                <span className="truncate">{track.name}</span>
                <span className="text-xs text-muted-foreground">{track.artistName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
