import { usePlayerStore } from "../../../stores/player.store";
import { PlayerStatus } from "../../../types/domain-types";
import { useDownloadStore } from "../../../stores/download.store";
import { CoverImage } from "../../../components/ui/art-image";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import {
  Play,
  Pause,
  MoreHorizontal,
  ListMusic,
  Download,
  Inbox,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../../../components/ui/dropdown-menu";
import type { Album, AlbumArtist } from "../../../types/domain-types";
import { DownloadStatus } from "../../../types/domain-types";

type CompactPlayerbarProps = {
  onOpenQueue?: () => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

export function CompactPlayerBar({ onOpenQueue, onNavigateAlbum, onNavigateArtist }: CompactPlayerbarProps) {
  const {
    currentTrack,
    status,
    positionMs,
    duration,
    volume,
    setVolume,
    togglePlay,
    toggleFullScreen,
    queue,
  } = usePlayerStore();
  const enqueueSong = useDownloadStore((s) => s.enqueueSong);
  const setPanelOpen = useDownloadStore((s) => s.setPanelOpen);
  const pendingCount = useDownloadStore((s) => s.tasks.filter(
    (t) => t.status === DownloadStatus.PENDING || t.status === DownloadStatus.SEARCHING
      || t.status === DownloadStatus.DOWNLOADING_AUDIO || t.status === DownloadStatus.GETTING_COVER
      || t.status === DownloadStatus.PROCESSING_COVER || t.status === DownloadStatus.EMBEDDING_COVER,
  ).length);

  const progress = duration > 0 ? (positionMs / duration) * 100 : 0;

  if (!currentTrack) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="truncate text-sm text-muted-foreground">Select a track to play</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Thin progress line at top */}
      <div className="h-0.5 w-full bg-border">
        <div
          className="h-full bg-primary transition-all duration-300 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Main content row */}
      <div
        className="flex flex-1 cursor-pointer items-center gap-3 px-3 active:bg-accent/50 transition-colors"
        onClick={toggleFullScreen}
      >
        {/* Album art */}
        <CoverImage
          src={currentTrack.imageUrl}
          alt={currentTrack.name}
          fallback={currentTrack.name.charAt(0)}
          className="h-11 w-11 shrink-0 rounded-md shadow-sm"
        />

        {/* Track info */}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate text-sm font-medium leading-tight text-foreground">
            {currentTrack.name}
          </span>
          <span className="truncate text-xs leading-tight text-muted-foreground">
            {currentTrack.artistName}
          </span>
        </div>

        {/* Play / Pause */}
        <Button
          variant="default"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/90 active:scale-90 transition-transform"
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        >
          {status === PlayerStatus.PLAYING ? (
            <Pause className="h-5 w-5 fill-current" />
          ) : (
            <Play className="h-5 w-5 pl-0.5 fill-current" />
          )}
        </Button>

        {/* More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8}>
            {currentTrack && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); enqueueSong(currentTrack); }}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setPanelOpen(true); }}>
              <Inbox className="mr-2 h-4 w-4" />
              Downloads
              {pendingCount > 0 && (
                <Badge variant="destructive" className="ml-auto h-5 px-1.5 text-[10px]">
                  {pendingCount}
                </Badge>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpenQueue?.(); }}>
              <ListMusic className="mr-2 h-4 w-4" />
              Queue
              {queue.length > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">{queue.length}</span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setVolume(volume === 0 ? 0.8 : 0); }}>
              Volume: {Math.round(volume * 100)}%
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
