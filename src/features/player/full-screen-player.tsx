import { useState } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { PlayerStatus } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Slider } from "../../components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
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
  Heart,
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
    <div className="fixed inset-0 z-50 flex animate-in flex-col bg-background">
      {/* Background visualizer */}
      {visualizerEnabled && (
        <div className="absolute inset-0 z-0 opacity-30">
          <VisualizerContainer fullScreen />
        </div>
      )}

      {/* Header bar */}
      <div className="relative z-10 flex items-center justify-between border-b px-4 py-3">
        <Button variant="ghost" size="sm" onClick={toggleFullScreen}>
          <Minimize2 className="mr-2 h-4 w-4" />
          Minimize
        </Button>
        <h2 className="text-sm font-semibold">Now Playing</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Heart className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ListMusic className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content: 2-column on desktop, 1-column on mobile */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* Left: album art + basic controls */}
        <div className="flex flex-col items-center justify-center gap-6 p-8 md:w-1/2">
          <Avatar
            src={currentTrack.imageUrl}
            alt={currentTrack.name}
            fallback={currentTrack.name.charAt(0)}
            className="h-56 w-56 rounded-2xl shadow-2xl md:h-72 md:w-72 lg:h-96 lg:w-96"
          />

          <div className="text-center">
            <h2 className="text-2xl font-bold">{currentTrack.name}</h2>
            <p className="text-lg text-muted-foreground">{currentTrack.artistName}</p>
            {currentTrack.albumName && (
              <p className="text-sm text-muted-foreground/70">{currentTrack.albumName}</p>
            )}
          </div>

          {/* Seek */}
          <div className="flex w-full max-w-md flex-col gap-2">
            <Slider
              value={[progress]}
              onValueChange={([v]) => setSeek((v / 100) * duration)}
              max={100}
              step={0.1}
            />
            <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
              <span>{formatDuration(seek)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className={shuffle !== "none" ? "text-primary" : ""}
              onClick={toggleShuffle}
            >
              <Shuffle className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-10 w-10" onClick={previous}>
              <SkipBack className="h-6 w-6" />
            </Button>
            <Button
              variant="default"
              size="icon"
              className="h-14 w-14 rounded-full"
              onClick={togglePlay}
            >
              {status === PlayerStatus.PLAYING ? (
                <Pause className="h-7 w-7" />
              ) : (
                <Play className="h-7 w-7 pl-1" />
              )}
            </Button>
            <Button variant="ghost" size="icon" className="h-10 w-10" onClick={next}>
              <SkipForward className="h-6 w-6" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={repeat !== "none" ? "text-primary" : ""}
              onClick={toggleRepeat}
            >
              <Repeat className="h-5 w-5" />
            </Button>
          </div>

          {/* Volume */}
          <div className="flex w-full max-w-xs items-center gap-2">
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
            <Slider
              value={[volume * 100]}
              onValueChange={([v]) => setVolume(v / 100)}
              max={100}
              step={1}
            />
          </div>
        </div>

        {/* Right: tabs (queue, lyrics, visualizer info) */}
        <div className="flex flex-col border-t md:w-1/2 md:border-l md:border-t-0">
          <Tabs defaultValue="queue" className="flex h-full flex-col">
            <TabsList className="mx-4 mt-4 grid w-auto grid-cols-2">
              <TabsTrigger value="queue">
                <ListMusic className="mr-2 h-4 w-4" />
                Queue
              </TabsTrigger>
              <TabsTrigger value="visualizer">
                <span className="mr-2">🎨</span>
                Visualizer
              </TabsTrigger>
            </TabsList>

            <TabsContent value="queue" className="flex-1 overflow-hidden p-4">
              <ScrollArea className="h-full">
                {queue.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Queue is empty</p>
                ) : (
                  <div className="space-y-1">
                    {queue.map((track, i) => (
                      <div
                        key={track.queueId}
                        className={`flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent ${
                          track.queueId === currentTrack.queueId ? "bg-accent" : ""
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
                          <p className="truncate text-xs text-muted-foreground">
                            {track.artistName}
                          </p>
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatDuration(track.duration)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="visualizer" className="flex-1 p-4">
              <p className="text-sm text-muted-foreground">
                Visualizer is {visualizerEnabled ? "active" : "disabled"}. Enable it in Settings or
                click the visualizer toggle in the player bar.
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
