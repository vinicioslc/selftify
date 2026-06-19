import { useState, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Switch } from "../../../components/ui/switch";
import { formatLrc } from "../../../services/lyrics/lrc-parser";
import type { FullLyricsMetadata } from "../../../types/lyrics-types";

interface LyricsExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lyrics: FullLyricsMetadata;
  offsetMs: number;
}

export function LyricsExportModal({
  open,
  onOpenChange,
  lyrics,
  offsetMs,
}: LyricsExportModalProps) {
  const [synced, setSynced] = useState(Array.isArray(lyrics.lyrics));

  const displayedLyrics = useMemo(() => {
    if (synced && Array.isArray(lyrics.lyrics)) {
      return (
        formatLrc(lyrics.lyrics, {
          artist: lyrics.artist,
          title: lyrics.name,
          offset: offsetMs + (lyrics.offsetMs ?? 0),
        }) + "\n"
      );
    }
    if (Array.isArray(lyrics.lyrics)) {
      return lyrics.lyrics.map(([, t]) => t).join("\n") + "\n";
    }
    return lyrics.lyrics;
  }, [synced, lyrics, offsetMs]);

  const handleExport = useCallback(() => {
    const extension = synced ? ".lrc" : ".txt";
    const file = new File([displayedLyrics], lyrics.name + extension, {
      type: "text/plain",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
    onOpenChange(false);
  }, [displayedLyrics, synced, lyrics.name, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[500px] flex flex-col">
        <DialogHeader>
          <DialogTitle>Export Lyrics</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="synced-format"
              checked={synced}
              onCheckedChange={setSynced}
            />
            <label htmlFor="synced-format" className="text-sm">
              Synced format (.lrc)
            </label>
          </div>
        </div>

        <pre className="flex-1 overflow-auto bg-muted rounded-lg p-4 text-sm font-mono whitespace-pre-wrap mt-4">
          {displayedLyrics}
        </pre>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleExport}>Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
