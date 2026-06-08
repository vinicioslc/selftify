import { useRef, useEffect } from "react";
import type { Song } from "../../types/domain-types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { SongInfoContent } from "./song-info-content";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: Song;
};

let mountedCount = 0;

export function SongInfoDialog({ open, onOpenChange, song }: Props) {
  const mountRef = useRef(false);
  useEffect(() => {
    if (open) {
      if (mountedCount > 0) {
        console.warn("[SongInfoDialog] multiple instances detected — enforcing singleton");
      }
      mountedCount++;
      mountRef.current = true;
    }
    return () => {
      if (mountRef.current) {
        mountedCount--;
        mountRef.current = false;
      }
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{song.name}</DialogTitle>
        </DialogHeader>
        <SongInfoContent song={song} />
      </DialogContent>
    </Dialog>
  );
}
