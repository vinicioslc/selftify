import { usePlayerStore } from "../../stores/player.store";
import { useState, useRef } from "react";
import { PlayerStatus } from "../../types/domain-types";
import type { Album, AlbumArtist } from "../../types/domain-types";
import { buildArtistNav, buildAlbumNav } from "../../lib/build-navigation";
import { Button } from "../../components/ui/button";
import { CoverImage } from "../../components/ui/art-image";
import { Slider } from "../../components/ui/slider";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
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
  X,
} from "lucide-react";

type NowPlayingPageProps = {
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
  onClose?: () => void;
};

export function NowPlayingPage({ onNavigateAlbum, onNavigateArtist, onClose }: NowPlayingPageProps) {
  const {
    currentTrack,
    status,
    queue,
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
    setSeek,
    removeFromQueue,
    clearQueue,
  } = usePlayerStore();

  const [isSeeking, setIsSeeking] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentMs = isSeeking ? dragValue : positionMs;
  const progress = duration > 0 ? (currentMs / duration) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Close button */}
      {onClose && (
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold text-foreground">Now Playing</h2>
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close now playing"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      )}

      {/* Now playing header */}
      {currentTrack ? (
        <div className="relative z-10 flex flex-col items-center gap-4 border-b border-border p-6 md:flex-row">
          <CoverImage
            src={currentTrack.imageUrl}
            alt={currentTrack.name}
            fallback={currentTrack.name.charAt(0)}
            className="h-24 w-24 shadow-lg md:h-32 md:w-32"
          />
          <div className="flex flex-col items-center text-center md:items-start md:text-left">
            <h1
              className="cursor-pointer text-xl font-bold text-foreground hover:underline"
              onClick={() => {
                if (currentTrack.albumName) {
                  const nav = buildAlbumNav(currentTrack);
                  if (nav) onNavigateAlbum?.(nav);
                }
              }}
            >
              {currentTrack.name}
            </h1>
            <span
              className="cursor-pointer text-base text-muted-foreground hover:text-foreground hover:underline"
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

            {/* Seek + controls */}
            <div className="mt-4 flex w-full max-w-md flex-col gap-2">
              <div className="flex items-center gap-2">
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
                  className="h-10 w-10 rounded-full bg-foreground text-background hover:bg-foreground/90 active:scale-95"
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
                  className={`h-8 w-8 ${shuffle !== "none" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={toggleShuffle}
                >
                  <Shuffle className="h-4 w-4" />
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
              <div className="flex items-center gap-2">
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                  {formatDuration(currentMs)}
                </span>
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
        <div className="flex items-center justify-center border-b border-border p-8">
          <div className="text-center">
            <Music className="mx-auto mb-2 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">No track playing</p>
          </div>
        </div>
      )}

      {/* Queue */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold text-foreground">Queue ({queue.length})</h2>
          {queue.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={clearQueue}>
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
            <div className="divide-y divide-border">
              {queue.map((track, i) => (
                <div
                  key={track.queueId}
                  className={`flex items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/20 ${
                    track.queueId === currentTrack?.queueId ? "bg-accent/10" : ""
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
                        onClick={() => {
                          onNavigateArtist?.({
                            id: `artist-${track.artistName.toLowerCase().replace(/\s+/g, "-")}`,
                            originId: track.originId,
                            originType: track.originType,
                            name: track.artistName,
                            imageUrl: track.imageUrl || null,
                            mbz: track.mbzArtistId,
                          });
                        }}
                      >
                        {track.artistName}
                      </span>
                      {track.albumName && (
                        <>
                          {" \u00b7 "}
                          <span
                            className="cursor-pointer hover:text-foreground hover:underline"
                            onClick={() => {
                              const albumName = track.albumName as string;
                              onNavigateAlbum?.({
                                id: track.albumId || `album-${(track.albumArtistName || track.artistName).toLowerCase().replace(/\s+/g, "-")}-${albumName.toLowerCase().replace(/\s+/g, "-")}`,
                                originId: track.originId,
                                originType: track.originType,
                                name: albumName,
                                albumArtistName: track.albumArtistName || track.artistName,
                                imageUrl: track.imageUrl || null,
                              });
                            }}
                          >
                            {track.albumName}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                    {formatDuration(track.duration)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 hover:text-foreground hover:opacity-100"
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
