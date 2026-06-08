import { useState, useEffect, useMemo, useCallback } from "react";
import { getController, type SearchResults } from "../../api/controller";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useStatusStore } from "../../stores/status.store";
import { Song, Album, AlbumArtist, OriginType } from "../../types/domain-types";
import type { AppView } from "../../types/types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardDescription, CardTitle } from "../../components/ui/card";
import { ArtImage } from "../../components/ui/art-image";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";
import { Search, Play, Plus, Loader2, FolderOpen, Globe, Music, Database, Trash2 } from "lucide-react";
import { searchAndRankAll, getSavedSelectedVideoId } from "../../services/youtube-download-service";
import { DownloadButton } from "../download/download-button";
import { resolveSong, resolveSongs } from "../../services/stream-resolver";
import { searchYouTubePure } from "../../services/youtube-pure-search";
import type { YoutubeSearchScoredVideo } from "../../services/youtube-ranking";
import { getSearchCache, setSearchCache, pruneExpiredCache, getMbzYtMapping, setMbzYtMapping, type CandidateData } from "../../services/search-cache";
import { useSettingsStore } from "../../stores/settings.store";
import { useRankingDebugStore } from "../../stores/ranking-debug.store";
import { searchMusicBrainz } from "../../services/search-service";
import { getCachedResult, setCachedResult, getPendingRequest, setPendingRequest } from "../../services/memory-cache";
import { DataTable, type ColumnDef } from "../shared/data-table";
import { AddToPlaylistDialog } from "../playlist/add-to-playlist-dialog";
import { SongInfoDialog } from "../song-info/song-info-dialog";
import { AlbumEmptySvg, ArtistEmptySvg, SongEmptySvg } from "../../components/ui/empty-image-svg";
import { useArtistImage } from "../../hooks/use-artist-image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { cn, formatDuration } from "../../lib/utils";
import { getSongCount } from "../../services/local-database";
import { moveSongToTrash } from "../../services/move-to-trash";

type SearchMode = "local" | "musicbrainz" | "youtube";

interface SearchPageProps {
  initialQuery?: string;
  initialMode?: SearchMode;
  onSearchStateChange?: (state: { query: string; mode: SearchMode }) => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
  onNavigate?: (view: AppView) => void;
}

export function SearchPage({ initialQuery, initialMode, onSearchStateChange, onNavigateAlbum, onNavigateArtist, onNavigate }: SearchPageProps) {
  const { currentOrigin, origins } = useAuthStore();
  const { setQueue, addToQueue } = usePlayerStore();
  const [query, setQuery] = useState(initialQuery || "");

  // Results per source
  const [localResults, setLocalResults] = useState<Song[]>([]);
  const [mbResults, setMbResults] = useState<SearchResults | null>(null);
  const [ytResults, setYtResults] = useState<{
    songs: Song[];
    hasMore: boolean;
    offset: number;
  }>({ songs: [], hasMore: false, offset: 0 });

  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>(
    initialMode ?? (currentOrigin?.enableOnlineSearch ? "musicbrainz" : "local"),
  );
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<Song | null>(null);
  const [hasAutoSearched, setHasAutoSearched] = useState(false);
  const [ytLoadingMore, setYtLoadingMore] = useState(false);
  const [isCached, setIsCached] = useState(false);

  type ExpandedState = {
    candidates: YoutubeSearchScoredVideo[] | null;
    selectedVideoId: string | null;
    loading: boolean;
  };
  const [expandedCandidates, setExpandedCandidates] = useState<Map<string, ExpandedState>>(new Map());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const hasOnlineSearch = currentOrigin?.enableOnlineSearch ?? false;

  useEffect(() => {
    onSearchStateChange?.({ query, mode: searchMode });
  }, [query, searchMode, onSearchStateChange]);

  useEffect(() => {
    if (initialQuery && !hasAutoSearched) {
      setHasAutoSearched(true);
      handleSearchInternal(initialQuery, initialMode ?? (currentOrigin?.enableOnlineSearch ? "musicbrainz" : "local"));
    }
  }, []);

  useEffect(() => () => { /* cleanup */ }, []);

  /** Shared helper: try memory cache → try pending promise → fetch */
  async function doSearch<T>(
    provider: string,
    q: string,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    // 1. Memory cache hit?
    const cached = getCachedResult<T>(provider, q);
    if (cached) return cached;

    // 2. Already in-flight for this exact query?
    const pending = getPendingRequest<T>(provider, q);
    if (pending) return pending;

    // 3. Fresh request — store promise, cache result on completion
    const promise = fetchFn();
    setPendingRequest(provider, q, promise);
    try {
      const data = await promise;
      setCachedResult(provider, q, data);
      return data;
    } catch (err) {
      // Don't cache failed results — will retry next time
      throw err;
    }
  }

  async function handleSearchInternal(q: string, mode: SearchMode) {
    if (!q.trim() || !currentOrigin) return;
    const addMsg = useStatusStore.getState().addMessage;
    const cacheTtl = useSettingsStore.getState().cacheTtlMinutes * 60 * 1000;
    pruneExpiredCache(cacheTtl);

    setLoading(true);
    setSearchError(null);

    if (mode === "local") {
      setMbResults(null);
      setYtResults({ songs: [], hasMore: false, offset: 0 });
      addMsg("Searching local files...", "info", "Search");
        const localCacheHit = !!getCachedResult<SearchResults>("local", q);
        try {
          const results = await doSearch<SearchResults>("local", q, async () => {
            const ctrl = await getController();
            return (await ctrl.search(q, 20)) ?? { songs: [], albums: [], albumArtists: [] };
          });
          setLocalResults(results.songs);
          setIsCached(localCacheHit);
          addMsg(`Found ${results.songs.length} song${results.songs.length !== 1 ? "s" : ""} in local files`, results.songs.length > 0 ? "success" : "info", "Search");
      } catch (err) {
        console.error("Search error:", err);
        setSearchError("Search failed. Please try again.");
        addMsg(`Search failed: ${err instanceof Error ? err.message : "Unknown error"}`, "danger", "Search");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === "musicbrainz") {
      setLocalResults([]);
      setYtResults({ songs: [], hasMore: false, offset: 0 });

      try {
        // 1. Memory cache hit — restore results
        const cachedMb = getCachedResult<SearchResults>("musicbrainz", q);
        if (cachedMb) {
          let resolved = cachedMb;
          const needsResolve = resolved.songs.length > 0 && !resolved.songs[0].imageUrl?.startsWith("blob:");
          if (needsResolve || resolved.albumArtists.some((a) => !a.imageUrl)) {
            try {
              const ctrl = await getController();
              if (needsResolve) {
                const withImages = await ctrl.populateSongImages(resolved.songs);
                resolved = { ...resolved, songs: withImages };
              }
              if (resolved.albumArtists.length > 0) {
                const withArtistImages = await ctrl.populateArtistImages(resolved.albumArtists);
                resolved = { ...resolved, albumArtists: withArtistImages };
              }
            } catch {
              // non-critical
            }
          }
          setMbResults(resolved);
          setIsCached(true);
          setLoading(false);
          return;
        }

        // 2. No cache — do fresh search. Use pending-request dedup so a
        //    duplicate click doesn't fire a second API call.
        const pending = getPendingRequest<SearchResults>("musicbrainz", q);
        let mbRaw: SearchResults;

        if (pending) {
          mbRaw = await pending;
        } else {
          addMsg("Searching MusicBrainz...", "info", "Search");

          const promise = searchMusicBrainz(q, 20, currentOrigin.id);
          setPendingRequest("musicbrainz", q, promise);
          mbRaw = await promise;
          setCachedResult("musicbrainz", q, mbRaw);

          // Persist to IndexedDB so results survive page refresh
          if (mbRaw.songs.length > 0 || mbRaw.albums.length > 0 || mbRaw.albumArtists.length > 0) {
            setSearchCache("musicbrainz", q, mbRaw).catch(() => {});
          }
        }

        // Resolve images through centralized pipeline
        if (mbRaw.songs.length > 0 || mbRaw.albumArtists.length > 0) {
          try {
            const ctrl = await getController();
            if (mbRaw.songs.length > 0) {
              const withImages = await ctrl.populateSongImages(mbRaw.songs);
              mbRaw = { ...mbRaw, songs: withImages };
            }
            if (mbRaw.albumArtists.length > 0) {
              const withArtistImages = await ctrl.populateArtistImages(mbRaw.albumArtists);
              mbRaw = { ...mbRaw, albumArtists: withArtistImages };
            }
          } catch {
            // non-critical — images remain as-is
          }
        }

        setIsCached(false);
        setMbResults(mbRaw);
      } catch (err) {
        console.error("Search error:", err);
        setSearchError("Search failed. Please try again.");
        addMsg(`Search failed: ${err instanceof Error ? err.message : "Unknown error"}`, "danger", "Search");
      } finally {
        setLoading(false);
      }
      return;
    }

    // YouTube mode
    addMsg("Searching YouTube...", "info", "Search");
    setLocalResults([]);
    setMbResults(null);
    try {
      const cachedYt = getCachedResult<{ songs: Song[]; hasMore: boolean }>("youtube", q);
      if (cachedYt) {
        setYtResults({ songs: cachedYt.songs, hasMore: cachedYt.hasMore, offset: 20 });
        setIsCached(true);
        setLoading(false);
        return;
      }

      const ytRaw = await doSearch<{ songs: Song[]; hasMore: boolean }>("youtube", q, () =>
        searchYouTubePure(q, 0, currentOrigin.youtubeMusicHeaders, currentOrigin.id).then((r) => ({
          songs: r.songs,
          hasMore: r.hasMore,
        })),
      );

      setIsCached(false);
      setYtResults({ songs: ytRaw.songs, hasMore: ytRaw.hasMore, offset: 20 });

      if (ytRaw.songs.length > 0) {
        setSearchCache("youtube-pure", q, { songs: ytRaw.songs, albums: [], albumArtists: [] }).catch(() => {});
      }
    } catch (err) {
      console.error("Search error:", err);
      setSearchError("Search failed. Please try again.");
      addMsg(`Search failed: ${err instanceof Error ? err.message : "Unknown error"}`, "danger", "Search");
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    await handleSearchInternal(query, searchMode);
  }

  async function loadMore() {
    if (!query.trim() || ytLoadingMore || !ytResults.hasMore) return;
    setYtLoadingMore(true);
    try {
      const res = await searchYouTubePure(query, ytResults.offset, currentOrigin?.youtubeMusicHeaders, currentOrigin?.id);
      setYtResults((prev) => ({
        songs: [...prev.songs, ...res.songs],
        hasMore: res.hasMore,
        offset: prev.offset + 20,
      }));
    } catch (err) {
      console.error("Load more error:", err);
    } finally {
      setYtLoadingMore(false);
    }
  }


  function getElectronYt() {
    if (typeof window !== "undefined" && (window as any).electronApi?.yt) {
      return (window as any).electronApi.yt as { getStreamUrl: (videoId: string, cookies?: string) => Promise<string | null>; };
    }
    return null;
  }

  function playbackLog(source: string, msg: string, friendly?: string) {
    const ts = new Date().toLocaleTimeString("pt-BR") + "." + String(Date.now() % 1000).padStart(3, "0");
    console.log(`[${ts}] [${source}] ${msg}`);
    if (friendly) useStatusStore.getState().addMessage(friendly, "info", source);
  }

  async function handleToggleExpand(songId: string) {
    const allSongs = [...localResults, ...(mbResults?.songs ?? []), ...ytResults.songs];
    const song = allSongs.find((s) => s.id === songId);
    if (!song) return;

    const wasExpanded = expandedIds.has(songId);
    if (wasExpanded) {
      setExpandedIds((prev) => { const next = new Set(prev); next.delete(songId); return next; });
      return;
    }
    const existing = expandedCandidates.get(songId);
    if (existing && existing.candidates !== null) {
      setExpandedIds((prev) => new Set(prev).add(songId));
      return;
    }
    setExpandedCandidates((prev) => {
      const next = new Map(prev);
      next.set(songId, { candidates: null, selectedVideoId: null, loading: true });
      return next;
    });
    setExpandedIds((prev) => new Set(prev).add(songId));

    try {
      const result = await searchAndRankAll(song);
      setExpandedCandidates((prev) => {
        const next = new Map(prev);
        if (result && result.scored.length > 0) {
          next.set(songId, { candidates: result.scored, selectedVideoId: result.scored[0].video.id, loading: false });
        } else {
          next.set(songId, { candidates: [], selectedVideoId: null, loading: false });
        }
        return next;
      });
    } catch {
      setExpandedCandidates((prev) => {
        const next = new Map(prev);
        next.set(songId, { candidates: [], selectedVideoId: null, loading: false });
        return next;
      });
    }
  }

  function handleSelectCandidate(song: Song, videoId: string) {
    setExpandedCandidates((prev) => {
      const next = new Map(prev);
      const entry = next.get(song.id);
      if (entry) {
        next.set(song.id, { ...entry, selectedVideoId: videoId });
      }
      return next;
    });
    // Persist to IndexedDB so subsequent plays use this selection
    if (song.mbzRecordingId) {
      getMbzYtMapping(song.mbzRecordingId).then((saved) => {
        if (saved) {
          setMbzYtMapping({ ...saved, selectedVideoId: videoId, selectedType: "manual", updatedAt: Date.now() });
        }
      });
    }
  }

  function getSelectedVideoId(songId: string): string | null {
    return expandedCandidates.get(songId)?.selectedVideoId ?? null;
  }

  async function playYtPure(song: Song): Promise<string | null> {
    const videoId = song.id.slice(7);
    const log = (msg: string, f?: string) => playbackLog("playYtPure", `${videoId}: ${msg}`, f);
    const yt = getElectronYt();
    if (!yt) { log("no electron API"); return null; }
    const cookies = currentOrigin?.youtubeMusicHeaders;
    log("yt:stream-url started", `▶ Streaming "${song.name}" directly from YouTube...`);
    try {
      const url = await yt.getStreamUrl(videoId, cookies || undefined);
      if (url) log(`yt:stream-url OK → url length=${url.length}`, "Audio stream ready ✓");
      else log("yt:stream-url returned null", "Stream resolution failed");
      if (url) {
        useRankingDebugStore.getState().pushEntry({
          query: `${song.artistName} ${song.name} ${song.albumName ?? ""}`.trim(),
          searchQuery: videoId,
          videos: [{ id: videoId, title: song.name, uploader: song.artistName }],
          scored: [], selectedVideoId: videoId,
          duration: song.duration, timestamp: Date.now(),
        });
      }
      return url;
    } catch (e) { log(`yt:stream-url error: ${e}`); return null; }
  }

  async function playSong(song: Song) {
    const log = (msg: string, f?: string) => playbackLog("playSong", `${song.id}: ${msg}`, f);
    if (!currentOrigin?.enableOnlineSearch) { log("offline mode, queueing without path"); setQueue([song], { type: "now" }); return; }

    const isYt = song.id.startsWith("ytpure-");
    setDownloadingId(song.id);
    try {
      if (isYt) {
        const streamUrl = await playYtPure(song);
        if (streamUrl) {
          log(`queuing with YouTube stream (length=${streamUrl.length})`);
          setQueue([{ ...song, path: streamUrl }], { type: "now" });
        } else {
          log("YouTube stream failed, queueing without path");
          setQueue([song], { type: "now" });
        }
      } else {
        // MusicBrainz song: use unified resolver (local-first, YouTube fallback)
        const manualVideoId = getSelectedVideoId(song.id);
        const { song: resolved, source } = await resolveSong(song, manualVideoId || undefined);
        log(`resolved via ${source}: ${resolved.path ? "path=" + resolved.path.slice(0, 60) : "no path"}`);
        setQueue([resolved], { type: "now" });
      }
    } finally {
      setDownloadingId(null);
    }
  }

  async function playAll(sourceSongs: Song[]) {
    if (!sourceSongs.length) return;
    if (!currentOrigin?.enableOnlineSearch) { setQueue(sourceSongs, { type: "now" }); return; }

    setDownloadingId("__all__");
    try {
      const resolved: Song[] = [];
      for (const song of sourceSongs) {
        if (song.id.startsWith("ytpure-")) {
          const streamUrl = await playYtPure(song);
          resolved.push(streamUrl ? { ...song, path: streamUrl } : song);
        } else {
          const manualVideoId = getSelectedVideoId(song.id);
          const r = await resolveSong(song, manualVideoId || undefined);
          resolved.push(r.song);
        }
      }
      setQueue(resolved, { type: "now" });
    } finally {
      setDownloadingId(null);
    }
  }

  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [songInfoSong, setSongInfoSong] = useState<Song | null>(null);
  const [contextMenuSong, setContextMenuSong] = useState<Song | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const songColumns = useMemo(
    (): ColumnDef<Song>[] => [
      {
        id: "cover",
        label: "",
        width: "2.5rem",
        sortable: false,
        render: (song) => (
          <div className="relative">
            <ArtImage
              src={song.imageUrl}
              alt={song.name}
              fallback={song.name.charAt(0)}
              emptySvg={<SongEmptySvg />}
              className="h-8 w-8 rounded"
            />
          </div>
        ),
      },
      {
        id: "source",
        label: "",
        width: "1.5rem",
        sortable: false,
        render: (song) =>
          song.id.startsWith("ytpure-") ? (
            <svg className="h-3.5 w-3.5 text-red-500" viewBox="0 0 24 24" fill="currentColor" aria-label="YouTube">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          ) : (
            <span className="text-[10px] font-bold text-purple-500" title="MusicBrainz">MB</span>
          ),
      },
      {
        id: "title",
        label: "Title",
        width: "1fr",
        sortable: true,
        sortValue: (s) => s.name,
        render: (song) => (
          <span className="truncate text-sm font-medium">{song.name}</span>
        ),
      },
      {
        id: "artist",
        label: "Artist",
        sortable: true,
        sortValue: (s) => s.artistName,
        render: (song) => (
          <span
            className="cursor-pointer truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
              onClick={(e) => {
                  e.stopPropagation();
                  onNavigateArtist?.({
                    id: song.artistId || `artist-${song.artistName.toLowerCase().replace(/\s+/g, "-")}`,
                    originId: song.originId,
                    originType: song.originType,
                    name: song.artistName,
                    imageUrl: song.imageUrl || null,
                    mbz: song.mbzArtistId,
                  });
                }}
          >
            {song.artistName}
          </span>
        ),
      },
      {
        id: "album",
        label: "Album",
        sortable: true,
        sortValue: (s) => s.albumName || "",
        render: (song) =>
          song.albumName ? (
            <span
              className="cursor-pointer truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                const album: Album = {
                  id: song.albumId || `album-${song.artistName.toLowerCase().replace(/\s+/g, "-")}-${song.albumName!.toLowerCase().replace(/\s+/g, "-")}`,
                  originId: song.originId,
                  originType: song.originType,
                  name: song.albumName!,
                  albumArtistName: song.albumArtistName || song.artistName,
                  imageUrl: song.imageUrl || null,
                };
                onNavigateAlbum?.(album);
              }}
            >
              {song.albumName}
            </span>
          ) : null,
      },
      {
        id: "duration",
        label: "Duration",
        width: "5rem",
        sortable: true,
        sortValue: (s) => s.duration ?? 0,
        render: (song, _, isSelected) => (
          <div className="flex items-center gap-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">
              {song.duration ? formatDuration(song.duration) : "--:--"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 transition-opacity",
                isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              onClick={(e) => {
                e.stopPropagation();
                playSong(song);
              }}
              disabled={downloadingId === song.id}
            >
              {downloadingId === song.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        ),
      },
      {
        id: "download",
        label: "",
        width: "2rem",
        sortable: false,
        render: (song) => (
          <DownloadButton song={song} variant="icon" size="sm" />
        ),
      },
      {
        id: "addToPlaylist",
        label: "",
        width: "2rem",
        sortable: false,
        render: (song) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setAddToPlaylistSong(song);
            }}
            title="Add to playlist"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        ),
      },
    ],
    [onNavigateAlbum, onNavigateArtist, downloadingId],
  );

  const renderMbExpanded = useCallback(
    (song: Song) => {
      const state = expandedCandidates.get(song.id);
      if (!state || state.loading) {
        return (
          <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching YouTube...
          </div>
        );
      }
      if (!state.candidates || state.candidates.length === 0) {
        return (
          <div className="py-1 text-sm text-muted-foreground">
            No YouTube matches found
          </div>
        );
      }
      return (
        <div className="space-y-0.5">
          {state.candidates.map((scored) => {
            const v = scored.video;
            const bd = scored.breakdown;
            const isSelected = state.selectedVideoId === v.id;
            return (
              <label
                key={v.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50",
                  isSelected && "bg-accent/30",
                )}
              >
                <input
                  type="radio"
                  name={`candidate-${song.id}`}
                  checked={isSelected}
                  onChange={() => handleSelectCandidate(song, v.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="flex-1 truncate font-medium">{v.title}</span>
                <span className="hidden truncate text-muted-foreground sm:inline max-w-[120px]">
                  {v.uploader}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {bd.score.toFixed(1)}
                </span>
                <span className="flex shrink-0 gap-1 text-[10px] text-muted-foreground">
                  {bd.titleMatch && <span className="font-bold text-green-500" title="Title match">T</span>}
                  {bd.artistMatch && <span className="font-bold text-blue-500" title="Artist match">A</span>}
                  {bd.albumMatch && <span className="font-bold text-amber-500" title="Album match">Al</span>}
                  {bd.exactDuration && <span className="font-bold text-purple-500" title="Exact duration">D</span>}
                  {bd.closestDuration && <span className="font-bold text-purple-400" title="Closest duration">~D</span>}
                </span>
              </label>
            );
          })}
        </div>
      );
    },
    [expandedCandidates],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Input
            placeholder={currentOrigin ? `Search ${currentOrigin.name}...` : "Add an origin first"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
        {hasOnlineSearch && (
          <div className="mt-2 flex justify-center gap-2">
            <Button
              variant={searchMode === "local" ? "default" : "outline"}
              size="sm"
              className="gap-1"
              onClick={() => {
                setSearchMode("local");
                if (query.trim()) handleSearchInternal(query, "local");
              }}
            >
              <FolderOpen className="h-3 w-3" /> Local Files
            </Button>
            <Button
              variant={searchMode === "musicbrainz" ? "default" : "outline"}
              size="sm"
              className="gap-1"
              onClick={() => {
                setSearchMode("musicbrainz");
                if (query.trim()) handleSearchInternal(query, "musicbrainz");
              }}
            >
              <span className="text-[11px] font-bold text-purple-500">MB</span> MusicBrainz
            </Button>
            <Button
              variant={searchMode === "youtube" ? "default" : "outline"}
              size="sm"
              className="gap-1"
              onClick={() => {
                setSearchMode("youtube");
                if (query.trim()) handleSearchInternal(query, "youtube");
              }}
            >
              <svg className="h-3.5 w-3.5 text-red-500" viewBox="0 0 24 24" fill="currentColor" aria-label="YouTube">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              YouTube
            </Button>
          </div>
        )}
        {searchMode === "musicbrainz" && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Search MusicBrainz for albums, artists &amp; recordings
          </p>
        )}
        {searchMode === "youtube" && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Search YouTube for songs
          </p>
        )}
        {searchMode === "local" && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Search local files
          </p>
        )}
      </div>

      <ScrollArea className="relative flex-1">
        {!currentOrigin && (
          <div className="flex h-full items-center justify-center p-8">
            <p className="text-center text-sm text-muted-foreground">
              Connect to an origin in Settings
            </p>
          </div>
        )}

        {searchError && (
          <div className="flex h-full items-center justify-center p-8">
            <p className="text-center text-sm text-destructive">{searchError}</p>
          </div>
        )}

        {currentOrigin && !loading && !searchError && (
          (searchMode === "local" && localResults.length === 0 && !query.trim()) ||
          (searchMode === "musicbrainz" && !mbResults && !query.trim()) ||
          (searchMode === "youtube" && ytResults.songs.length === 0 && !query.trim())
        ) && (
          <div className="flex h-full items-center justify-center p-8">
            <p className="text-center text-sm text-muted-foreground">
              {searchMode === "local" && "Search your local music files"}
              {searchMode === "musicbrainz" && "Search MusicBrainz for albums, artists & recordings"}
              {searchMode === "youtube" && "Search YouTube for songs"}
            </p>
          </div>
        )}

        {currentOrigin && !loading && !searchError && searchMode === "local" && localResults.length === 0 && query.trim() && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
            <Music className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-center text-sm text-muted-foreground">
              No local files match "{query}".
            </p>
            <p className="max-w-sm text-center text-xs text-muted-foreground/60">
              Make sure your local library has been indexed. Use the Local page to scan your music folder.
              Supported formats: mp3, flac, ogg, m4a, wav, aac, opus.
            </p>
            {onNavigate && (
              <Button variant="outline" size="sm" className="gap-2 mt-1" onClick={() => onNavigate("local-songs")}>
                <FolderOpen className="h-4 w-4" />
                Go to Local Library
              </Button>
            )}
          </div>
        )}

        {/* ── LOCAL RESULTS ── */}
        {searchMode === "local" && localResults.length > 0 && (
          <div className="mx-auto max-w-4xl space-y-6 p-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Local Files</h2>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{localResults.length} songs</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => playAll(localResults)}>
                  Play All
                </Button>
              </div>
              <DataTable
                data={localResults}
                columns={songColumns}
                getRowId={(s) => s.id}
                selectedId={selectedSongId}
                onSelectedIdChange={setSelectedSongId}
                onRowDoubleClick={playSong}
                onRowContextMenu={(song, e) => {
                  e.preventDefault();
                  setContextMenuSong(song);
                  setContextMenuPos({ x: e.clientX, y: e.clientY });
                }}
                storageKey="search-local"
              />
            </section>
          </div>
        )}

        {/* ── YOUTUBE RESULTS ── */}
        {searchMode === "youtube" && ytResults.songs.length > 0 && (
          <div className="mx-auto max-w-4xl space-y-6 p-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  <h2 className="text-lg font-semibold">YouTube</h2>
                  <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-500">{ytResults.songs.length} songs</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => playAll(ytResults.songs)}>
                  Play All
                </Button>
              </div>
              <DataTable
                data={ytResults.songs}
                columns={songColumns}
                getRowId={(s) => s.id}
                selectedId={selectedSongId}
                onSelectedIdChange={setSelectedSongId}
                onRowDoubleClick={playSong}
                onRowContextMenu={(song, e) => {
                  e.preventDefault();
                  setContextMenuSong(song);
                  setContextMenuPos({ x: e.clientX, y: e.clientY });
                }}
                storageKey="search-yt"
              />
              {ytResults.hasMore && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={ytLoadingMore}>
                    {ytLoadingMore ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Load More
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ── MUSICBRAINZ RESULTS ── */}
        {searchMode === "musicbrainz" && mbResults && (
          <div className="mx-auto max-w-4xl space-y-6 p-6">
            {/* Artists */}
            {mbResults.albumArtists.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Artists</h2>
                <div className="flex flex-wrap gap-4">
                  {mbResults.albumArtists.map((artist) => (
                    <div
                      key={artist.id}
                      className="flex cursor-pointer flex-col items-center gap-2 transition-opacity hover:opacity-80"
                      onClick={() => onNavigateArtist?.(artist)}
                    >
                      <ArtImage
                        src={artist.imageUrl}
                        alt={artist.name}
                        fallback={artist.name.charAt(0)}
                        emptySvg={<ArtistEmptySvg />}
                        className="h-20 w-20 rounded-md"
                      />
                      <p className="max-w-20 truncate text-center text-xs font-medium">{artist.name}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Albums */}
            {mbResults.albums.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Albums</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {mbResults.albums.map((album) => (
                    <Card
                      key={album.id}
                      className="cursor-pointer overflow-hidden transition-colors hover:bg-accent/50"
                      onClick={() => onNavigateAlbum?.(album)}
                    >
                      <CardContent className="p-0">
                        <div className="relative">
                          <ArtImage
                            src={album.imageUrl}
                            alt={album.name}
                            fallback={album.name.charAt(0)}
                            emptySvg={<AlbumEmptySvg />}
                            className="h-32 w-full rounded-none md:h-40"
                          />
                        </div>
                        <div className="p-3">
                          <CardTitle className="truncate text-sm">{album.name}</CardTitle>
                          <CardDescription className="truncate text-xs">
                            {album.albumArtistName} {album.releaseYear ? `\u2022 ${album.releaseYear}` : ""}
                          </CardDescription>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Songs */}
            {mbResults.songs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-purple-500">MB</span>
                    <h2 className="text-lg font-semibold">Songs</h2>
                    <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-500">{mbResults.songs.length} songs</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => playAll(mbResults.songs)}>
                    Play All
                  </Button>
                </div>
                <DataTable
                  data={mbResults.songs}
                  columns={songColumns}
                  getRowId={(s) => s.id}
                  selectedId={selectedSongId}
                  onSelectedIdChange={setSelectedSongId}
                  onRowDoubleClick={playSong}
                  onRowContextMenu={(song, e) => {
                    e.preventDefault();
                    setContextMenuSong(song);
                    setContextMenuPos({ x: e.clientX, y: e.clientY });
                  }}
                  storageKey="search-mb-songs"
                  renderExpanded={renderMbExpanded}
                  expandedIds={expandedIds}
                  onToggleExpand={handleToggleExpand}
                />
              </section>
            )}

            {mbResults.albumArtists.length === 0 && mbResults.albums.length === 0 && mbResults.songs.length === 0 && (
              <div className="flex h-full items-center justify-center py-20">
                <p className="text-muted-foreground">No results found</p>
              </div>
            )}
          </div>
        )}

        {isCached && !loading && (
          <div className="absolute right-4 top-2 z-10">
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Database className="h-3 w-3" />
              Cached
            </Badge>
          </div>
        )}
      </ScrollArea>

      {/* Add to Playlist Dialog */}
      {addToPlaylistSong && (
        <AddToPlaylistDialog
          open={!!addToPlaylistSong}
          onOpenChange={(open) => { if (!open) setAddToPlaylistSong(null); }}
          song={addToPlaylistSong}
        />
      )}

      {/* Song Info Dialog */}
      {songInfoSong && (
        <SongInfoDialog
          open={!!songInfoSong}
          onOpenChange={(open) => { if (!open) setSongInfoSong(null); }}
          song={songInfoSong}
        />
      )}

      {/* Context Menu */}
      {contextMenuSong && (
        <div
          className="fixed inset-0 z-50"
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => setContextMenuSong(null)}
        >
          <div
            className="absolute"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          >
            <DropdownMenu open={true} onOpenChange={(o) => { if (!o) setContextMenuSong(null); }}>
              <DropdownMenuTrigger asChild>
                <span className="absolute w-px h-px" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="bottom"
                align="start"
                className="min-w-[180px]"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <DropdownMenuItem
                  onClick={() => {
                    playSong(contextMenuSong);
                    setContextMenuSong(null);
                  }}
                >
                  <span className="text-sm">▶ Play</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    addToQueue([contextMenuSong], { type: "next" });
                    setContextMenuSong(null);
                  }}
                >
                  <span className="text-sm">⏭ Add Next</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setAddToPlaylistSong(contextMenuSong);
                    setContextMenuSong(null);
                  }}
                >
                  <span className="text-sm">📋 Add to Playlist</span>
                </DropdownMenuItem>
                {!contextMenuSong.path && (
                  <DropdownMenuItem
                    onClick={() => {
                      import("../../stores/download.store").then((m) =>
                        m.useDownloadStore.getState().enqueueSong(contextMenuSong),
                      );
                      setContextMenuSong(null);
                    }}
                  >
                    <span className="text-sm">⬇ Download</span>
                  </DropdownMenuItem>
                )}
                {contextMenuSong.path && contextMenuSong.originType === OriginType.LOCAL && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={async () => {
                      const origin = origins.find((o) => o.id === contextMenuSong.originId);
                      if (origin && contextMenuSong.path) {
                        const ok = await moveSongToTrash(contextMenuSong.path, origin);
                        if (ok) {
                          setLocalResults((prev) => prev.filter((s) => s.id !== contextMenuSong.id));
                        }
                      }
                      setContextMenuSong(null);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    <span className="text-sm">Delete</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setSongInfoSong(contextMenuSong);
                    setContextMenuSong(null);
                  }}
                >
                  <span className="text-sm">🔍 Music Metadata</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  );
}
