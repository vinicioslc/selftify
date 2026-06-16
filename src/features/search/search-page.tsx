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
import { ArtImage, CoverImage } from "../../components/ui/art-image";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";
import { CachedBadge } from "../../components/ui/cached-badge";
import { Search, Play, Plus, Loader2, FolderOpen, Globe, Music, Trash2 } from "lucide-react";
import { searchAndRankAll, getSavedSelectedVideoId } from "../../services/youtube-download-service";
import { DownloadButton } from "../download/download-button";
import { resolveSong, resolveSongs } from "../../services/stream-resolver";
import { searchYouTubePure } from "../../services/youtube-pure-search";
import type { YoutubeSearchScoredVideo } from "../../services/youtube-ranking";
import { getSavedMbzYtMapping, setSavedMbzYtMapping } from "../../services/sqlite-db/sqlite-db-mappings";
import type { CandidateData } from "../../services/sqlite-db/sqlite-db-types";
import { useSettingsStore } from "../../stores/settings.store";
import { searchMusicBrainz } from "../../services/search-service";
import { DataTable, type ColumnDef } from "../shared/data-table";
import { songTitleColumn, sourceBadgeColumn } from "../shared/song-columns";
import { AddToPlaylistDialog } from "../playlist/add-to-playlist-dialog";
import { SongInfoDialog } from "../song-info/song-info-dialog";
import { AlbumEmptySvg, ArtistEmptySvg } from "../../components/ui/empty-image-svg";
import { useArtistImage } from "../../hooks/use-artist-image";
import { useCover } from "../../hooks/use-cover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { cn, formatDuration } from "../../lib/utils";
import { buildArtistNav, buildAlbumNav } from "../../lib/build-navigation";
import { moveSongToTrash } from "../../services/move-to-trash";

type SearchMode = "local" | "musicbrainz" | "youtube";

function SearchArtistCard({ artist, onNavigate }: { artist: AlbumArtist; onNavigate?: (artist: AlbumArtist) => void }) {
  const imageUrl = useArtistImage(artist.mbz, artist.name);
  return (
    <div
      className="flex cursor-pointer flex-col items-center gap-2 transition-opacity hover:opacity-80"
      onClick={() => onNavigate?.(artist)}
    >
      <ArtImage
        src={imageUrl}
        alt={artist.name}
        fallback={artist.name.charAt(0)}
        emptySvg={<ArtistEmptySvg />}
        className="h-20 w-20 rounded-md"
      />
      <p className="max-w-20 truncate text-center text-xs font-medium">{artist.name}</p>
    </div>
  );
}

function MbSongImageCell({ song }: { song: Song }) {
  const { coverUrl, loading, triggerRemote } = useCover({
    artistName: song.artistName,
    albumName: song.albumName,
    mbzArtistId: song.mbzArtistId,
    mbzReleaseGroupId: song.mbzReleaseGroupId,
    mbzReleaseId: song.mbzAlbumId,
  }, { deferRemote: true });
  const finalUrl = coverUrl || song.imageUrl;
  return (
    <CoverImage
      src={finalUrl}
      alt={song.name}
      fallback={song.name.charAt(0)}
      className="h-10 w-10 shrink-0 rounded-md"
      lazy={!finalUrl}
      onLazyLoad={triggerRemote}
    />
  );
}

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

  const resultCache = useMemo(() => new Map<string, unknown>(), []);
  const pendingCache = useMemo(() => new Map<string, Promise<unknown>>(), []);

  function cacheKey(provider: string, q: string): string {
    return `${provider}:${q.toLowerCase().trim()}`;
  }

  /** Shared helper: try memory cache → try pending promise → fetch */
  async function doSearch<T>(
    provider: string,
    q: string,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    const key = cacheKey(provider, q);

    const cached = resultCache.get(key) as T | undefined;
    if (cached !== undefined) return cached;

    const inFlight = pendingCache.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const promise = fetchFn();
    pendingCache.set(key, promise);
    try {
      const data = await promise;
      resultCache.set(key, data);
      return data;
    } catch (err) {
      throw err;
    } finally {
      pendingCache.delete(key);
    }
  }

  async function handleSearchInternal(q: string, mode: SearchMode) {
    if (!q.trim() || !currentOrigin) return;
    const addMsg = useStatusStore.getState().addMessage;
    const { getSearchCache, setSearchCache } = await import("../../services/sqlite-db/sqlite-db-search-store");


    setLoading(true);
    setSearchError(null);

    if (mode === "local") {
      setMbResults(null);
      setYtResults({ songs: [], hasMore: false, offset: 0 });
      addMsg("Searching local files...", "info", "Search");
        try {
          // Check FSDB cache first
          const sqliteDbCached = await getSearchCache("local", q);
          if (sqliteDbCached) {
            setLocalResults(sqliteDbCached.songs);
            setIsCached(true);
            addMsg(`Found ${sqliteDbCached.songs.length} song${sqliteDbCached.songs.length !== 1 ? "s" : ""} in local files (cached)`, "info", "Search");
            setLoading(false);
            return;
          }

          const results = await doSearch<SearchResults>("local", q, async () => {
            const ctrl = await getController();
            return (await ctrl.search(q, 20)) ?? { songs: [], albums: [], albumArtists: [] };
          });
          await setSearchCache("local", q, results).catch(() => {});
          setLocalResults(results.songs);
          setIsCached(false);
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

        // 1. FSDB cache hit — restore results
        const sqliteDbCached = await getSearchCache("musicbrainz", q);
        if (sqliteDbCached) {
          let resolved = sqliteDbCached;
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

        // 2. Memory cache hit — restore results
        const cachedMb = resultCache.get(cacheKey("musicbrainz", q)) as SearchResults | undefined;
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
        const mbKey = cacheKey("musicbrainz", q);
        const pending = pendingCache.get(mbKey) as Promise<SearchResults> | undefined;
        let mbRaw: SearchResults;

        if (pending) {
          mbRaw = await pending;
        } else {
          addMsg("Searching MusicBrainz...", "info", "Search");

          const promise = searchMusicBrainz(q, 20, currentOrigin.id);
          pendingCache.set(mbKey, promise);
          mbRaw = await promise;
          resultCache.set(mbKey, mbRaw);

          // Results cached in-memory; no client-side persistence needed
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
        // Save to persistent FSDB cache
        setSearchCache("musicbrainz", q, mbRaw).catch(() => {});
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

      // 1. FSDB cache hit
      const sqliteDbCached = await getSearchCache("youtube", q);
      if (sqliteDbCached) {
        setYtResults({ songs: sqliteDbCached.songs, hasMore: false, offset: 20 });
        setIsCached(true);
        setLoading(false);
        return;
      }

      // 2. Memory cache hit
      const cachedYt = resultCache.get(cacheKey("youtube", q)) as { songs: Song[]; hasMore: boolean } | undefined;
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
      setSearchCache("youtube", q, { songs: ytRaw.songs, albums: [], albumArtists: [] }).catch(() => {});

      // Results cached in-memory; no client-side persistence needed
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
      getSavedMbzYtMapping(song.mbzRecordingId).then((saved) => {
        if (saved) {
          setSavedMbzYtMapping({ ...saved, selectedVideoId: videoId, selectedType: "manual", updatedAt: Date.now() });
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
        console.debug("[search-page] stream URL resolved", { videoId, song: song.name });
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

  const handleNavArtist = useCallback((song: Song) => {
    onNavigateArtist?.(buildArtistNav(song));
  }, [onNavigateArtist]);

  const handleNavAlbum = useCallback((song: Song) => {
    const nav = buildAlbumNav(song);
    if (nav) onNavigateAlbum?.(nav);
  }, [onNavigateAlbum]);

  const searchColumns = useMemo(
    (): ColumnDef<Song>[] => [
      sourceBadgeColumn(),
      songTitleColumn({ onNavigateArtist: handleNavArtist, onNavigateAlbum: handleNavAlbum }),
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
    [handleNavArtist, handleNavAlbum, downloadingId],
  );

  const mbSongColumns = useMemo(
    (): ColumnDef<Song>[] => [
      sourceBadgeColumn(),
      {
        id: "title",
        label: "Title",
        defaultVisible: true,
        width: "1.5fr",
        sortable: true,
        sortValue: (s) => s.name,
        render: (song) => (
          <div className="flex min-w-0 items-center gap-3">
            <MbSongImageCell song={song} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{song.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                <span
                  className="cursor-pointer hover:text-foreground hover:underline"
                  onClick={(e) => { e.stopPropagation(); handleNavArtist(song); }}
                >
                  {song.artistName}
                </span>
                {song.albumName && (
                  <>
                    {" \u00b7 "}
                    <span
                      className="cursor-pointer hover:text-foreground hover:underline"
                      onClick={(e) => { e.stopPropagation(); handleNavAlbum(song); }}
                    >
                      {song.albumName}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        ),
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
    [handleNavArtist, handleNavAlbum, downloadingId],
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
                columns={searchColumns}
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
                columns={searchColumns}
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
                    <SearchArtistCard key={artist.id} artist={artist} onNavigate={onNavigateArtist} />
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
                  columns={mbSongColumns}
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

        <CachedBadge
          visible={isCached && !loading}
          onClear={async () => {
            const key = `${searchMode}:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
            const { deleteSearchCache } = await import("../../services/sqlite-db/sqlite-db-search-store");
            await deleteSearchCache(key).catch(() => {});
            resultCache.delete(cacheKey(searchMode, query));
            setIsCached(false);
            useStatusStore.getState().addMessage(`Search cache cleared for "${query}"`, "info", "Search");
          }}
        />
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
