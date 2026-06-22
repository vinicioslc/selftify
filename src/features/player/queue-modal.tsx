import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import { QueuePage } from "./queue-page";
import type { Album, AlbumArtist } from "../../types/domain-types";

type QueueModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

export function QueueModal({ open, onOpenChange, onNavigateAlbum, onNavigateArtist }: QueueModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col w-[90vw] max-w-none h-full max-h-[90vh] p-0">
        <DialogTitle className="sr-only">Queue</DialogTitle>
        <QueuePage onNavigateAlbum={onNavigateAlbum} onNavigateArtist={onNavigateArtist} />
      </DialogContent>
    </Dialog>
  );
}
