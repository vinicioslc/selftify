import { usePlayerStore } from "../../stores/player.store";
import { buildArtistNav, buildAlbumNav } from "../../lib/build-navigation";
import { Button } from "../../components/ui/button";
import { CoverImage } from "../../components/ui/art-image";
import { ScrollArea } from "../../components/ui/scroll-area";
import { formatDuration } from "../../lib/utils";
import { Trash2, Music } from "lucide-react";
import type { Album, AlbumArtist } from "../../types/domain-types";

type QueuePageProps = {
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

export function QueuePage({ onNavigateAlbum, onNavigateArtist }: QueuePageProps) {
  const { queue, currentTrack, removeFromQueue, clearQueue } = usePlayerStore();

  return (
    <div className="flex h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
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
            <div className="text-center">
              <Music className="mx-auto mb-2 h-12 w-12 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Queue is empty</p>
            </div>
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
  );
}
