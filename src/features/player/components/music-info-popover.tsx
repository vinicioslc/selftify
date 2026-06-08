import { useState } from "react";
import { usePlayerStore } from "../../../stores/player.store";
import { Popover, PopoverTrigger, PopoverContent } from "../../../components/ui/popover";
import { Button } from "../../../components/ui/button";
import { Info } from "lucide-react";
import { SongInfoContent } from "../../song-info/song-info-content";
import type { Album, AlbumArtist } from "../../../types/domain-types";

type MusicInfoPopoverProps = {
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

export function MusicInfoPopover({ onNavigateAlbum, onNavigateArtist }: MusicInfoPopoverProps) {
  const { currentTrack } = usePlayerStore();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Music Info"
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[28rem] p-4 overflow-y-auto max-h-[80vh]"
      >
        {currentTrack ? (
          <SongInfoContent
            song={currentTrack}
            onNavigateAlbum={onNavigateAlbum}
            onNavigateArtist={onNavigateArtist}
          />
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No track playing
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
