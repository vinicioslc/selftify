import { Minus, Plus, Search, Download, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { LyricOverride, LyricSearchQuery } from "../../types/lyrics-types";

interface LyricsActionsProps {
  hasLyrics: boolean;
  offsetMs: number;
  onUpdateOffset: (offsetMs: number) => void;
  onSearchOverride: (params: LyricOverride) => void;
  onExport: () => void;
  onClear: () => void;
  hasIpc?: boolean;
}

export function LyricsActions({
  hasLyrics,
  offsetMs,
  onUpdateOffset,
  onSearchOverride,
  onExport,
  onClear,
  hasIpc = false,
}: LyricsActionsProps) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 border-t border-border">
      {hasIpc && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // Open search modal - handled by parent
            onSearchOverride({} as LyricOverride);
          }}
        >
          <Search className="h-4 w-4 mr-1" />
          Search
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onUpdateOffset(offsetMs - 50)}
        aria-label="Decrease lyric offset by 50ms"
      >
        <Minus className="h-4 w-4" />
      </Button>

      <span className="text-xs text-muted-foreground min-w-[60px] text-center tabular-nums">
        {offsetMs}ms
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onUpdateOffset(offsetMs + 50)}
        aria-label="Increase lyric offset by 50ms"
      >
        <Plus className="h-4 w-4" />
      </Button>

      {hasLyrics && (
        <Button variant="ghost" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>
      )}

      {hasIpc && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
