import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { SynchronizedLyrics } from "../synchronized-lyrics";
import { UnsynchronizedLyrics } from "../unsynchronized-lyrics";
import { parseLrc } from "../../../services/lyrics/lrc-parser";
import type {
  LyricOverride,
  LyricSearchResult,
  FullLyricsMetadata,
} from "../../../types/lyrics-types";
import { LyricSource } from "../../../types/lyrics-types";

interface LyricsSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist?: string;
  name?: string;
  onApply: (override: LyricOverride) => void;
}

export function LyricsSearchModal({
  open,
  onOpenChange,
  artist = "",
  name = "",
  onApply,
}: LyricsSearchModalProps) {
  const [searchName, setSearchName] = useState(name);
  const [searchArtist, setSearchArtist] = useState(artist);
  const [selectedResult, setSelectedResult] =
    useState<LyricSearchResult | null>(null);
  const [debouncedName, setDebouncedName] = useState(name);
  const [debouncedArtist, setDebouncedArtist] = useState(artist);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedName(searchName), 500);
    return () => clearTimeout(timer);
  }, [searchName]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedArtist(searchArtist), 500);
    return () => clearTimeout(timer);
  }, [searchArtist]);

  const { data: searchResults, isLoading: isSearchLoading } = useQuery({
    queryKey: ["lyrics", "search", { name: debouncedName, artist: debouncedArtist }],
    queryFn: async () => {
      const { searchAll } = await import("../../../services/lyrics/lyrics-service");
      return searchAll({ name: debouncedName, artist: debouncedArtist });
    },
    enabled: open && (!!debouncedName || !!debouncedArtist),
  });

  const { data: previewData, isLoading: isPreviewLoading } = useQuery({
    queryKey: ["lyrics", "preview", selectedResult?.source, selectedResult?.id],
    queryFn: async () => {
      if (!selectedResult) return null;
      const { getRemoteLyricsById } = await import("../../../services/lyrics/lyrics-service");
      const raw = await getRemoteLyricsById({
        remoteSongId: selectedResult.id,
        remoteSource: selectedResult.source,
      });
      if (!raw) return null;
      return parseLrc(raw);
    },
    enabled: !!selectedResult,
  });

  const allResults = useMemo(() => {
    if (!searchResults) return [];
    const results: LyricSearchResult[] = [];
    Object.values(searchResults as Record<string, LyricSearchResult[]>).forEach((arr) => {
      if (Array.isArray(arr)) results.push(...arr);
    });
    return results.sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
  }, [searchResults]);

  const handleApply = () => {
    if (!selectedResult) return;
    onApply({
      artist: selectedResult.artist,
      id: selectedResult.id,
      name: selectedResult.name,
      remote: true,
      source: selectedResult.source,
    });
    onOpenChange(false);
  };

  const previewMetadata: FullLyricsMetadata | null = useMemo(() => {
    if (!selectedResult || !previewData) return null;
    return {
      artist: selectedResult.artist,
      lyrics: previewData,
      name: selectedResult.name,
      remote: true,
      source: selectedResult.source,
    };
  }, [selectedResult, previewData]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle>Search Lyrics</DialogTitle>
        </DialogHeader>

        <div className="flex gap-4">
          <Input
            placeholder="Song name"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            autoFocus
          />
          <Input
            placeholder="Artist"
            value={searchArtist}
            onChange={(e) => setSearchArtist(e.target.value)}
          />
        </div>

        <div className="flex flex-1 gap-4 min-h-0 mt-4">
          {/* Results */}
          <div className="w-1/2 flex flex-col">
            <ScrollArea className="flex-1">
              {isSearchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : allResults.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No results found
                </p>
              ) : (
                <div className="space-y-2">
                  {allResults.map((result) => (
                    <button
                      key={`${result.source}-${result.id}`}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedResult?.id === result.id &&
                        selectedResult?.source === result.source
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-accent/20"
                      }`}
                      onClick={() => setSelectedResult(result)}
                    >
                      <p className="font-medium text-sm truncate">{result.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {result.artist}
                      </p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {result.source}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {result.score !== undefined
                            ? `${((1 - result.score) * 100).toFixed(0)}%`
                            : ""}
                        </span>
                        {result.isSync === true && (
                          <span className="text-xs text-green-500">Synced</span>
                        )}
                        {result.isSync === false && (
                          <span className="text-xs text-yellow-500">Plain</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Preview */}
          <div className="w-1/2 flex flex-col">
            <ScrollArea className="flex-1 border border-border rounded-lg p-4">
              {isPreviewLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : previewMetadata ? (
                Array.isArray(previewMetadata.lyrics) ? (
                  <SynchronizedLyrics lyrics={previewMetadata} />
                ) : (
                  <UnsynchronizedLyrics lyrics={previewMetadata} />
                )
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Select a result to preview
                </p>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!selectedResult}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
