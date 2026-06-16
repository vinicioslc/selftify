import { useState, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { PlayerStatus } from "../../types/domain-types";
import type { Album, AlbumArtist } from "../../types/domain-types";
import { buildArtistNav, buildAlbumNav } from "../../lib/build-navigation";
import { Button } from "../../components/ui/button";
import { Slider } from "../../components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
import { CoverImage } from "../../components/ui/art-image";
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
  AudioLines,
} from "lucide-react";

export function FullScreenPlayer({ onNavigateAlbum, onNavigateArtist }: { onNavigateAlbum?: (album: Album) => void; onNavigateArtist?: (artist: AlbumArtist) => void }) {
  const {
    currentTrack,
    status,
    volume,
    seek,
    positionMs,
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
  const { visualizerEnabled, visualizerType } = useSettingsStore();

  const [isSeeking, setIsSeeking] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentMs = isSeeking ? dragValue : positionMs;
  const progress = duration > 0 ? (currentMs / duration) * 100 : 0;
  if (!isFullScreen || !currentTrack) return null;
  const blurBg = currentTrack.imageUrl;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Blurred cover art background */}
      {blurBg && (
        <div className="absolute inset-0 z-0">
          <img
            src={blurBg}
            alt=""
            className="h-full w-full object-cover opacity-20"
            style={{ filter: "blur(40px)" }}
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>
      )}

      {/* Header bar */}
      <div className="relative z-10 flex items-center justify-between border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={toggleFullScreen} className="text-muted-foreground hover:text-foreground">
          <Minimize2 className="mr-2 h-4 w-4" />
          Minimize
        </Button>
        <h2 className="text-sm font-semibold text-foreground">Now Playing</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <Heart className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <ListMusic className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content: 2-column on desktop, 1-column on mobile */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* Left: album art or visualizer + basic controls */}
        <div className="flex flex-col items-center justify-center gap-6 p-8 md:w-1/2">
          <div className="relative flex h-56 w-56 items-center justify-center overflow-hidden md:h-72 md:w-72 lg:h-96 lg:w-96">
            <VisualizerContainer fullScreen>
              {visualizerEnabled && visualizerType !== "none" ? undefined : (
                <CoverImage
                  src={currentTrack.imageUrl}
                  alt={currentTrack.name}
                  fallback={currentTrack.name.charAt(0)}
                  className="h-56 w-56 shadow-2xl md:h-72 md:w-72 lg:h-96 lg:w-96"
                />
              )}
            </VisualizerContainer>
          </div>

          <div className="text-center">
            <h2
              className="cursor-pointer text-2xl font-bold text-foreground hover:underline"
              onClick={() => {
                const nav = buildAlbumNav(currentTrack);
                if (nav) onNavigateAlbum?.(nav);
              }}
            >
              {currentTrack.name}
            </h2>
            <span
              className="cursor-pointer text-lg text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => onNavigateArtist?.(buildArtistNav(currentTrack))}
            >
              {currentTrack.artistName}
            </span>
            {currentTrack.albumName && (
              <span
                className="cursor-pointer text-sm text-muted-foreground/60 hover:text-foreground hover:underline"
                onClick={() => {
                  const nav = buildAlbumNav(currentTrack);
                  if (nav) onNavigateAlbum?.(nav);
                }}
              >
                {currentTrack.albumName}
              </span>
            )}
          </div>

          {/* Seek */}
          <div className="flex w-full max-w-md flex-col gap-2">
            <Slider
              value={[progress]}
              onValueChange={([v]) => {
                const pos = (v / 100) * duration;
                setDragValue(pos);
                if (!isSeeking) setIsSeeking(true);
              }}
              onValueCommit={([v]) => {
                const pos = (v / 100) * duration;
                setSeek(pos);
                if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
                commitTimeoutRef.current = setTimeout(() => setIsSeeking(false), 1000);
              }}
              max={100}
              step={0.1}
            />
            <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
              <span>{formatDuration(currentMs)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className={`${shuffle !== "none" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              onClick={toggleShuffle}
            >
              <Shuffle className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-foreground" onClick={previous}>
              <SkipBack className="h-6 w-6" />
            </Button>
            <Button
              variant="default"
              size="icon"
              className="h-14 w-14 rounded-full bg-foreground text-background hover:bg-foreground/90 active:scale-95"
              onClick={togglePlay}
            >
              {status === PlayerStatus.PLAYING ? (
                <Pause className="h-7 w-7" />
              ) : (
                <Play className="h-7 w-7 pl-1" />
              )}
            </Button>
            <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-foreground" onClick={next}>
              <SkipForward className="h-6 w-6" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`${repeat !== "none" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
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
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
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
        <div className="flex flex-col border-t border-border md:w-1/2 md:border-l md:border-t-0">
          <Tabs defaultValue="queue" className="flex h-full flex-col">
            <TabsList className="mx-4 mt-4 grid w-auto grid-cols-2 border-border">
              <TabsTrigger value="queue">
                <ListMusic className="mr-2 h-4 w-4" />
                Queue
              </TabsTrigger>
              <TabsTrigger value="visualizer">
                <AudioLines className="mr-2 h-4 w-4" />
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
                        className={`flex items-center gap-3 rounded-none p-2 transition-colors hover:bg-accent/20 ${
                          track.queueId === currentTrack.queueId ? "bg-accent/10" : ""
                        }`}
                      >
                        <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <CoverImage
                          src={track.imageUrl}
                          alt={track.name}
                          fallback={track.name.charAt(0)}
                          className="h-10 w-10 shrink-0 rounded-md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{track.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span
                              className="cursor-pointer hover:text-foreground hover:underline"
                              onClick={() => onNavigateArtist?.(buildArtistNav(track))}
                            >
                              {track.artistName}
                            </span>
                            {track.albumName && (
                              <>
                                {" \u00b7 "}
                                <span
                                  className="cursor-pointer hover:text-foreground hover:underline"
                                  onClick={() => {
                                    const nav = buildAlbumNav(track);
                                    if (nav) onNavigateAlbum?.(nav);
                                  }}
                                >
                                  {track.albumName}
                                </span>
                              </>
                            )}
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
              {visualizerEnabled && visualizerType !== "none" ? (
                <div className="relative flex h-full w-full items-center justify-center">
                  <VisualizerContainer fullScreen />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Visualizer is disabled. Enable it with the{" "}
                  <AudioLines className="inline h-4 w-4" /> button in the player bar.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
