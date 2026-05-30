import { useEffect, useMemo, useCallback, useState } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useLocalLibraryStore } from "../../stores/local-library.store";
import { useLocalScan } from "../../hooks/use-local-scan";
import { getController } from "../../api/controller";
import { OriginType, type Song, type Album, type AlbumArtist } from "../../types/domain-types";
import { getAllSongs, getScanState, updateScanState, getQueueCount, getSongCount, getArtistCount, getAlbumCount, getDistinctGenres, type DbSong } from "../../services/local-database";
import { getImageUrlByTag } from "../../services/image-cache";
import { SCAN_STATUS_LABEL } from "../../lib/status-labels";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
import { formatDuration } from "../../lib/utils";
import { Play, Loader2, Pause as PauseIcon, FolderOpen, Music, RotateCw, List, Disc, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 20;
const YT_ORIGINS = new Set([OriginType.YOUTUBE_MUSIC]);

interface LibraryPageProps {
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}

async function dbSongToSong(s: DbSong, originId: string): Promise<Song> {
  const artistNorm = s.artist_name.toLowerCase().trim();
  const albumNorm = (s.album_name || "").toLowerCase().trim();
  const songUrl = await getImageUrlByTag(`song/${s.id}`);
  const albumUrl = albumNorm && artistNorm ? await getImageUrlByTag(`album/${artistNorm}/${albumNorm}`) : null;
  const artistUrl = artistNorm ? await getImageUrlByTag(`artist/${artistNorm}`) : null;

  return {
    id: s.id,
    originId,
    originType: OriginType.LOCAL,
    name: s.name,
    artistName: s.artist_name || "Unknown Artist",
    albumName: s.album_name || undefined,
    duration: s.duration || null,
    imageUrl: songUrl || albumUrl || artistUrl || null,
    path: s.path,
    genres: s.genre ? [s.genre] : undefined,
    trackNumber: s.track_number || undefined,
    discNumber: s.disc_number || undefined,
    albumArtistName: s.album_artist || undefined,
    releaseYear: s.year || undefined,
  };
}

export function LibraryPage({ onNavigateAlbum, onNavigateArtist }: LibraryPageProps) {
  const { currentOrigin } = useAuthStore();
  const { setQueue } = usePlayerStore();
  const [folderPath, setFolderPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [totalSongs, setTotalSongs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("songs");
  const [genres, setGenres] = useState<string[]>([]);
  const [localStats, setLocalStats] = useState({ songs: 0, artists: 0, albums: 0 });
  const [page, setPage] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);

  const {
    rootFolder,
    scanStatus,
    scanProgress,
    lastScanned,
    setRootFolder,
  } = useLocalLibraryStore();

  const { startScan, pause, resume, rescan } = useLocalScan();

  const isLocalMode = currentOrigin?.type === OriginType.LOCAL;
  const isYouTubeMode = currentOrigin ? YT_ORIGINS.has(currentOrigin.type) : false;

  // ── Data loading ──

  const loadData = useCallback(async () => {
    if (!currentOrigin) { setLoading(false); return; }
    setLoading(true);
    try {
      if (isLocalMode) {
        const state = await getScanState();
        if (state) {
          setRootFolder(state.root_folder);
          if (state.scan_status === "done") {
            const all = await getAllSongs();
            const mapped = await Promise.all(all.map((s) => dbSongToSong(s, currentOrigin.id)));
            setSongs(mapped);
            setTotalSongs(mapped.length);
            setLocalStats({
              songs: await getSongCount(),
              artists: await getArtistCount(),
              albums: await getAlbumCount(),
            });
            setGenres(await getDistinctGenres());
          } else {
            setSongs([]);
            setTotalSongs(0);
          }
        }
      } else if (searchQuery.trim()) {
        const controller = await getController();
        const res = await controller.search(searchQuery, PAGE_SIZE);
        setSongs(res.songs);
        setTotalSongs(res.songs.length);
      } else {
        const controller = await getController();
        const list = await controller.getSongList(page * PAGE_SIZE, PAGE_SIZE);
        setSongs(list);
        setTotalSongs(list.length < PAGE_SIZE ? page * PAGE_SIZE + list.length : null);
      }
    } catch (err) {
      console.error("[library] load error:", err);
      setSongs([]);
    } finally {
      setLoading(false);
    }
  }, [currentOrigin, isLocalMode, page, searchQuery, setRootFolder]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reload when a local scan completes
  useEffect(() => {
    if (scanStatus === "done" && isLocalMode) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanStatus, isLocalMode]);

  // Auto-scan on init / resume interrupted scan
  useEffect(() => {
    if (!isLocalMode || loading) return;
    (async () => {
      try {
        const state = await getScanState();
        if (state && (state.scan_status === "scanning" || state.scan_status === "paused")) {
          const count = await getQueueCount();
          if (count > 0) { resume(); }
          else { await updateScanState({ scan_status: "done", last_scanned_at: Date.now() }); }
          return;
        }
        if (scanStatus === "idle" && rootFolder) {
          startScan(rootFolder);
        }
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalMode, loading, rootFolder]);

  // Reset page on search change
  useEffect(() => { setPage(0); }, [searchQuery]);

  // ── Filtering (local mode only – server already filters) ──

  const filteredSongs = useMemo(() => {
    if (!isLocalMode) return songs;
    if (!searchQuery) return songs;
    const q = searchQuery.toLowerCase();
    return songs.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.artistName.toLowerCase().includes(q) ||
        (s.albumName && s.albumName.toLowerCase().includes(q))
    );
  }, [songs, searchQuery, isLocalMode]);

  const pageCount = Math.max(1, Math.ceil(filteredSongs.length / PAGE_SIZE));
  const displaySongs = isLocalMode
    ? filteredSongs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    : songs;

  const hasPrev = page > 0;
  const hasNext = isLocalMode
    ? page < pageCount - 1
    : songs.length >= PAGE_SIZE;

  // ── Play helpers ──

  function handlePlayAll() {
    if (songs.length === 0) return;
    setQueue(filteredSongs, { type: "now" });
  }

  function handlePlayEntry(song: Song) {
    setQueue([song], { type: "now" });
  }

  function handlePlayGenre(genre: string) {
    const list = songs.filter((s) => s.genres?.includes(genre));
    if (list.length > 0) setQueue(list, { type: "now" });
  }

  function handleAlbumClick(song: Song) {
    if (!song.albumName || !song.artistName) return;
    const album: Album = {
      id: `local-album-${song.artistName.toLowerCase().replace(/\s+/g, "-")}-${song.albumName.toLowerCase().replace(/\s+/g, "-")}`,
      originId: currentOrigin?.id || "",
      originType: currentOrigin?.type || OriginType.LOCAL,
      name: song.albumName,
      albumArtistName: song.albumArtistName || song.artistName,
      imageUrl: song.imageUrl || null,
    };
    onNavigateAlbum?.(album);
  }

  function handleArtistClick(song: Song) {
    const artist: AlbumArtist = {
      id: `local-artist-${song.artistName.toLowerCase().replace(/\s+/g, "-")}`,
      originId: currentOrigin?.id || "",
      originType: currentOrigin?.type || OriginType.LOCAL,
      name: song.artistName,
      imageUrl: song.imageUrl || null,
    };
    onNavigateArtist?.(artist);
  }

  // ── Formatting helpers ──

  function relativeTime(ts: number | null | undefined): string {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // ── No origin selected ──

  if (!currentOrigin) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Music className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-2 text-muted-foreground">Select an origin to browse your music.</p>
      </div>
    );
  }

  // ── Main content ──

  const showSongs = songs.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <h1 className="text-2xl font-bold">
          {isLocalMode ? "Local Music Library" : "Music Library"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Browsing: {currentOrigin.name} ({currentOrigin.type})
          {isLocalMode && localStats.songs > 0 && (
            <>
              {" \u00b7 "}{localStats.songs} songs{" \u00b7 "}{localStats.artists} artists{" \u00b7 "}{localStats.albums} albums
            </>
          )}
          {isLocalMode && lastScanned && ` \u00b7 Last scanned ${relativeTime(lastScanned)}`}
        </p>
      </div>

      {/* Scan controls (local only) */}
      {isLocalMode && (
        <>
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <Input
              placeholder="/storage/music or /home/user/Music"
              value={folderPath || rootFolder}
              onChange={(e) => setFolderPath(e.target.value)}
              className="h-8 flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={async () => {
                try {
                  const { getPlatformService } = await import("../../services/platform/factory");
                  const p = await getPlatformService();
                  const selected = await p.openFolderPicker();
                  if (selected) {
                    setFolderPath(selected);
                    setRootFolder(selected);
                    setScanError(null);
                  }
                } catch {
                  console.debug("[library] Native dialog unavailable");
                }
              }}
            >
              <FolderOpen className="h-3 w-3" /> Browse
            </Button>

            {scanStatus === "scanning" && (
              <>
                <Button variant="outline" size="sm" className="h-8" onClick={pause}>
                  <PauseIcon className="mr-1 h-3 w-3" /> Pause
                </Button>
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {scanProgress.done}/{scanProgress.total || scanProgress.done || "?"}
                </Badge>
              </>
            )}
            {scanStatus === "paused" && (
              <Button variant="outline" size="sm" className="h-8" onClick={resume}>
                <RotateCw className="mr-1 h-3 w-3" /> Resume
              </Button>
            )}
            {scanStatus === "done" && (
              <>
                <Button variant="outline" size="sm" className="h-8" onClick={() => { setScanError(null); rescan(); }}>
                  <RotateCw className="mr-1 h-3 w-3" /> Rescan
                </Button>
                <Badge variant="default" className="gap-1">
                  {localStats.songs} files
                </Badge>
              </>
            )}
            {scanStatus === "idle" && (
              <Button variant="default" size="sm" className="h-8" onClick={() => {
                const folder = folderPath || rootFolder;
                if (!folder) return;
                setRootFolder(folder);
                setScanError(null);
                startScan(folder);
              }}>
                <FolderOpen className="mr-1 h-3 w-3" /> Scan
              </Button>
            )}

            {scanStatus === "scanning" && (
              <p className="ml-2 truncate text-xs text-muted-foreground">
                {scanProgress.currentDir?.replace(rootFolder, "") || ""}
              </p>
            )}
          </div>
          {scanError && (
            <div className="border-b bg-destructive/10 px-4 py-2">
              <p className="text-xs text-destructive">{scanError}</p>
            </div>
          )}
        </>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Empty states */}
      {!loading && !showSongs && isLocalMode && scanStatus === "idle" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md text-center">
            <FolderOpen className="mx-auto h-16 w-16 text-muted-foreground/30" />
            <h3 className="mt-4 text-lg font-semibold">{SCAN_STATUS_LABEL.idle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the path to your music folder above and click Scan.
            </p>
          </div>
        </div>
      )}

      {!loading && !showSongs && isLocalMode && scanStatus === "scanning" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">{SCAN_STATUS_LABEL.scanning} &mdash; extracting tags&hellip;</p>
          </div>
        </div>
      )}

      {!loading && !showSongs && isLocalMode && scanStatus === "done" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md text-center">
            <Music className="mx-auto h-16 w-16 text-muted-foreground/30" />
            <h3 className="mt-4 text-lg font-semibold">{SCAN_STATUS_LABEL.done} &mdash; no music found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              No audio files were found in the scanned folder.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Make sure the folder contains supported files (.mp3, .flac, .ogg, .wav, .m4a, .aac, .wma, .opus).
              If you see a permission error in the console, use the <strong>Browse</strong> button above to select the folder via the native file picker.
            </p>
          </div>
        </div>
      )}

      {!loading && !showSongs && !isLocalMode && !isYouTubeMode && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">No songs found on this server.</p>
        </div>
      )}

      {!loading && !showSongs && isYouTubeMode && (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md text-center">
            <Music className="mx-auto h-16 w-16 text-muted-foreground/30" />
            <h3 className="mt-4 text-lg font-semibold">Browse not available</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              YouTube Music does not support browsing all songs. Use the Search page to find music.
            </p>
          </div>
        </div>
      )}

      {/* Song list */}
      {showSongs && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-4">
            <TabsList className="h-9">
              <TabsTrigger value="songs" className="gap-1 text-xs">
                <List className="h-3 w-3" /> Songs
              </TabsTrigger>
              {isLocalMode && (
                <TabsTrigger value="genres" className="gap-1 text-xs">
                  <Disc className="h-3 w-3" /> Genres
                </TabsTrigger>
              )}
            </TabsList>

            <div className="flex items-center gap-2">
              <Input
                placeholder="Filter..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 w-44 text-xs"
              />
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handlePlayAll}>
                <Play className="h-3 w-3" /> Play All ({filteredSongs.length})
              </Button>
            </div>
          </div>

          <TabsContent value="songs" className="flex flex-1 flex-col p-0">
            {/* Pagination bar */}
            {displaySongs.length > 0 && (
              <div className="flex items-center justify-between border-b px-4 py-1.5">
                <p className="text-xs text-muted-foreground">
                  {isLocalMode
                    ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filteredSongs.length)} of ${filteredSongs.length}`
                    : `Page ${page + 1}`}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={!hasPrev}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="min-w-[3ch] text-center text-xs tabular-nums text-muted-foreground">
                    {isLocalMode ? `${page + 1}/${pageCount}` : page + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={!hasNext}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            <ScrollArea className="flex-1">
              {filteredSongs.length === 0 && searchQuery ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">No results match your filter.</p>
                </div>
              ) : (
                displaySongs.map((song) => (
                  <div
                    key={song.id}
                    className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/50"
                  >
                    <Avatar
                      src={song.imageUrl}
                      alt={song.name}
                      fallback={song.name.charAt(0)}
                      className="h-10 w-10 rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{song.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span
                          className="cursor-pointer hover:text-foreground hover:underline"
                          onClick={() => handleArtistClick(song)}
                        >
                          {song.artistName}
                        </span>
                        {song.albumName && (
                          <>
                            {" \u00b7 "}
                            <span
                              className="cursor-pointer hover:text-foreground hover:underline"
                              onClick={() => handleAlbumClick(song)}
                            >
                              {song.albumName}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="hidden text-xs text-muted-foreground md:inline">
                      {song.duration ? formatDuration(Math.round(song.duration)) : "\u2014"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      onClick={() => handlePlayEntry(song)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </ScrollArea>
          </TabsContent>

          {isLocalMode && (
            <TabsContent value="genres" className="flex-1 p-0">
            <ScrollArea className="h-full">
              {genres.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">No genres found in your library.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {genres.map((genre) => {
                    const count = songs.filter((s) => s.genres?.includes(genre)).length;
                    return (
                      <div
                        key={genre}
                        className="group rounded-lg border p-3 transition-colors hover:bg-accent/50"
                      >
                        <p className="truncate text-sm font-medium">{genre}</p>
                        <p className="text-xs text-muted-foreground">{count} songs</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-6 w-full text-xs opacity-0 group-hover:opacity-100"
                          onClick={() => {
                            const list = songs.filter((s) => s.genres?.includes(genre));
                            if (list.length > 0) setQueue(list, { type: "now" });
                          }}
                        >
                          <Play className="mr-1 h-3 w-3" /> Play
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
