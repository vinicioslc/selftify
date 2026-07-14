import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SynchronizedLyrics } from "./synchronized-lyrics";
import { UnsynchronizedLyrics } from "./unsynchronized-lyrics";
import { LyricsActions } from "./lyrics-actions";
import { useLyricsStore } from "../../stores/lyrics.store";
import { usePlayerStore } from "../../stores/player.store";
import { useStatusStore } from "../../stores/status.store";
import { getRemoteLyrics, getLocalLyrics } from "../../services/lyrics/lyrics-service";
import { parseLrc } from "../../services/lyrics/lrc-parser";
import type { FullLyricsMetadata, LyricOverride } from "../../types/lyrics-types";

export function LyricsPanel() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const {
    currentResult,
    isLoading,
    setCurrentResult,
    setLoading,
    setError,
    setSelectedOffsetMs,
    selectedOffsetMs,
  } = useLyricsStore();

  const [pendingSongId, setPendingSongId] = useState<string | undefined>();
  const [showEmpty, setShowEmpty] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevSongIdRef = useRef<string | undefined>(undefined);

  // Debounce song change (500ms)
  useEffect(() => {
    const songId = currentTrack?.id;
    if (songId === prevSongIdRef.current) return;
    prevSongIdRef.current = songId;
    setPendingSongId(undefined);
    setShowEmpty(false);
    setFadeOut(false);

    if (!songId) return;

    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setPendingSongId(songId);
    }, 500);

    return () => clearTimeout(timeoutRef.current);
  }, [currentTrack?.id]);

  // Fetch lyrics
  useEffect(() => {
    if (!pendingSongId || !currentTrack) return;
    if (pendingSongId !== currentTrack.id) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const addMsg = useStatusStore.getState().addMessage;
    addMsg(`Searching lyrics for ${currentTrack.name}...`, "info", "Lyrics");

    // Try local first, then remote
    const fetchLyrics = async () => {
      if (cancelled) return;

      let result: FullLyricsMetadata | null = null;

      // Local (embedded + .lrc)
      if (currentTrack.lyricsEmbedded || currentTrack.lyricsPath) {
        result = await getLocalLyrics(currentTrack);
      }

      // Remote
      if (!result) {
        result = await getRemoteLyrics(currentTrack);
      }

      if (cancelled) return;

      if (result) {
        setCurrentResult(result);
        addMsg(`Found lyrics from ${result.source}`, "success", "Lyrics");
        setShowEmpty(false);
      } else {
        setCurrentResult(null);
        setError(null);
        addMsg(`No lyrics found for ${currentTrack.name}`, "info", "Lyrics");
        setShowEmpty(true);
        setTimeout(() => setFadeOut(true), 3000);
      }
    };

    fetchLyrics();

    return () => {
      cancelled = true;
    };
  }, [pendingSongId, currentTrack]);

  const isSynced = useMemo(() => {
    if (!currentResult) return false;
    return Array.isArray(currentResult.lyrics);
  }, [currentResult]);

  const handleUpdateOffset = useCallback(
    (offsetMs: number) => {
      setSelectedOffsetMs(offsetMs);
      useStatusStore.getState().addMessage(
        `Lyric offset adjusted to ${offsetMs}ms`,
        "info",
        "Lyrics",
      );
    },
    [setSelectedOffsetMs],
  );

  const handleSearchOverride = useCallback(
    (_params: LyricOverride) => {
      // Opens the search modal (handled by parent)
    },
    [],
  );

  const handleExport = useCallback(() => {
    // Opens export modal (handled by parent)
  }, []);

  const handleClear = useCallback(() => {
    setCurrentResult(null);
    setError(null);
    if (currentTrack) {
      useStatusStore.getState().addMessage(
        `Lyrics cleared for ${currentTrack.name}`,
        "info",
        "Lyrics",
      );
    }
  }, [currentTrack, setCurrentResult, setError]);

  const hasIpc = false;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentResult) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <p
          className={`text-sm text-muted-foreground transition-opacity duration-500 ${
            showEmpty && fadeOut ? "opacity-0" : "opacity-100"
          }`}
        >
          No lyrics found
        </p>
        <LyricsActions
          hasLyrics={false}
          offsetMs={selectedOffsetMs}
          onUpdateOffset={handleUpdateOffset}
          onSearchOverride={handleSearchOverride}
          onExport={handleExport}
          onClear={handleClear}
          hasIpc={hasIpc}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" role="region" aria-label="Song lyrics">
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          {isSynced ? (
            <SynchronizedLyrics lyrics={currentResult} />
          ) : (
            <UnsynchronizedLyrics lyrics={currentResult} />
          )}
        </div>
      </div>
      <LyricsActions
        hasLyrics={true}
        offsetMs={selectedOffsetMs}
        onUpdateOffset={handleUpdateOffset}
        onSearchOverride={handleSearchOverride}
        onExport={handleExport}
        onClear={handleClear}
        hasIpc={hasIpc}
      />
    </div>
  );
}
