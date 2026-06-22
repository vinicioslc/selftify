import { useState, useCallback } from "react";
import { usePlayerStore } from "../../../stores/player.store";
import { useDownloadStore } from "../../../stores/download.store";
import { Button } from "../../../components/ui/button";
import { Slider } from "../../../components/ui/slider";
import { MusicInfoPopover } from "./music-info-popover";
import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";
import {
  Volume2,
  VolumeX,
  ListMusic,
  Maximize2,
  Heart,
  Download,
  Inbox,
  MicVocal,
} from "lucide-react";
import type { Album, AlbumArtist } from "../../../types/domain-types";
import { DownloadStatus } from "../../../types/domain-types";

type RightControlsProps = {
  onOpenQueue?: () => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

export function RightControls({ onOpenQueue, onNavigateAlbum, onNavigateArtist }: RightControlsProps) {
  const { volume, setVolume, toggleFullScreen, isFullScreen, setFullScreenTab, queue, currentTrack } = usePlayerStore();
  const enqueueSong = useDownloadStore((s) => s.enqueueSong);
  const setPanelOpen = useDownloadStore((s) => s.setPanelOpen);
  const pendingCount = useDownloadStore((s) => s.tasks.filter(t => t.status === DownloadStatus.PENDING || t.status === DownloadStatus.SEARCHING || t.status === DownloadStatus.DOWNLOADING_AUDIO || t.status === DownloadStatus.GETTING_COVER || t.status === DownloadStatus.PROCESSING_COVER || t.status === DownloadStatus.EMBEDDING_COVER).length);
  const [showVolume, setShowVolume] = useState(false);

  const handleVolumeWheel = useCallback(
    (e: React.WheelEvent) => {
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setVolume(Math.max(0, Math.min(1, volume + delta)));
    },
    [volume, setVolume]
  );

  return (
    <div className="flex h-full items-center gap-1 px-2" onWheel={handleVolumeWheel}>
      {/* Download current track */}
      {currentTrack && (
        <Button
          variant={currentTrack.path ? "default" : "outline"}
          size="icon"
          className={cn(
            "h-8 w-8",
            !currentTrack.path && "text-muted-foreground"
          )}
          onClick={() => enqueueSong(currentTrack)}
          title={currentTrack.path ? "Local file — click to re-download" : "Download current track"}
        >
          <Download className="h-4 w-4" />
        </Button>
      )}

      {/* Open download queue */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
        onClick={() => setPanelOpen(true)}
        title="Open download queue"
      >
        <Inbox className="h-4 w-4" />
        {pendingCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px]"
          >
            {pendingCount}
          </Badge>
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setFullScreenTab("lyrics");
          if (!isFullScreen) toggleFullScreen();
        }}
        title="Show lyrics"
      >
        <MicVocal className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
      >
        <Heart className="h-4 w-4" />
      </Button>

      <MusicInfoPopover onNavigateAlbum={onNavigateAlbum} onNavigateArtist={onNavigateArtist} />

      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${queue.length > 0 ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        onClick={() => onOpenQueue?.()}
        title="Show queue"
      >
        <ListMusic className="h-4 w-4" />
      </Button>

      <div
        className="flex items-center gap-1"
        onMouseEnter={() => setShowVolume(true)}
        onMouseLeave={() => setShowVolume(false)}
      >
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
        {showVolume && (
          <Slider
            value={[volume * 100]}
            onValueChange={([v]) => setVolume(v / 100)}
            max={100}
            step={1}
            className="w-32"
          />
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={toggleFullScreen}
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
