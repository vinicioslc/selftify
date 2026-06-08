import { useEffect, useMemo, useCallback, useState } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useLocalLibraryStore } from "../../stores/local-library.store";
import { useLocalScan } from "../../hooks/use-local-scan";
import { useStatusStore } from "../../stores/status.store";
import { getController } from "../../api/controller";
import { OriginType, type Song, type Album, type AlbumArtist } from "../../types/domain-types";
import { getAllSongs, getScanState, getSongCount, getArtistCount, getAlbumCount, getDistinctGenres } from "../../services/local-database";
import { dbSongToSong } from "../../services/dto";
import { SCAN_STATUS_LABEL } from "../../lib/status-labels";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { CoverImage } from "../../components/ui/art-image";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
import { formatDuration } from "../../lib/utils";
import { Play, Loader2, Pause as PauseIcon, FolderOpen, Music, RotateCw, List, Disc, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { DataTable, type ColumnDef } from "../shared/data-table";
import { AddToPlaylistDialog } from "../playlist/add-to-playlist-dialog";
import { moveSongToTrash } from "../../services/move-to-trash";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";

const PAGE_SIZE = 20;

interface LocalPageProps {
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}

export function LocalPage({ onNavigateAlbum, onNavigateArtist }: LocalPageProps) {
  const { currentOrigin, origins } = useAuthStore();
  const { setQueue, addToQueue } = usePlayerStore();
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
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<Song | null>(null);
  const [contextMenuSong, setContextMenuSong] = useState<Song | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const {
    rootFolder,
    scanStatus,
    scanProgress,
    lastScanned,
    setRootFolder,
  } = useLocalLibraryStore();

  const { startScan, pause, resume, rescan, autoScan } = useLocalScan();

  const isLocalMode = currentOrigin?.type === OriginType.LOCAL;

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
            const controller = await getController();
            const withImages = await controller.populateSongImages(mapped);
            setSongs(withImages);
            setTotalSongs(mapped.length);
            useStatusStore.getState().addMessage(`Loaded ${mapped.length} song${mapped.length !== 1 ? "s" : ""} from local library`, "info", "Library");
            setLocalStats({
              songs: await getSongCount(),
              artists: await getArtistCount(),
              albums: await getAlbumCount(),
            });
            setGenres(await getDistinctGenres());
          } else {
            setSongs([]);
            setTotalSongs(0);
            const mappedStatus = state.scan_status === "indexing" ? "scanning" : state.scan_status;
            useLocalLibraryStore.getState().setScanStatus(mappedStatus as any);
            useStatusStore.getState().addMessage("Local library scan not yet complete", "info", "Library");
          }
        } else {
          // No scan state in DB — reset store status
          useLocalLibraryStore.getState().setScanStatus("idle");
        }
      } else if (searchQuery.trim()) {
        useStatusStore.getState().addMessage(`Searching local files for "${searchQuery}"...`, "info", "Search");
        const controller = await getController();
        const res = await controller.search(searchQuery, PAGE_SIZE);
        setSongs(res.songs);
        setTotalSongs(res.songs.length);
        useStatusStore.getState().addMessage(`Found ${res.songs.length} song${res.songs.length !== 1 ? "s" : ""}`, res.songs.length > 0 ? "success" : "info", "Search");
      } else {
        const controller = await getController();
        const list = await controller.getSongList(page * PAGE_SIZE, PAGE_SIZE);
        setSongs(list);
        setTotalSongs(list.length < PAGE_SIZE ? page * PAGE_SIZE + list.length : null);
      }
    } catch (err) {
      console.error("[local] load error:", err);
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
      try { await autoScan(rootFolder); }
      catch (err) { console.warn("[local-page] autoScan error:", err); }
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
                } catch (err) {
                  console.warn("[local-page] openFolderPicker error:", err);
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
          <div className="w-full max-w-sm text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            {scanProgress.total > 0 ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Extracting metadata&hellip;
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground/70">
                  {scanProgress.currentDir?.replace(folderPath || rootFolder, "").replace(/^\//, "") || ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {scanProgress.done} / {scanProgress.total}
                </p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.round((scanProgress.done / scanProgress.total) * 100))}%` }}
                  />
                </div>
              </>
            ) : scanProgress.done > 0 ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Scanning&hellip;
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Found {scanProgress.done} files so far
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground/70">
                  {scanProgress.currentDir?.replace(folderPath || rootFolder, "").replace(/^\//, "") || ""}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Counting files&hellip;
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground/70">
                  {scanProgress.currentDir?.replace(folderPath || rootFolder, "").replace(/^\//, "") || ""}
                </p>
              </>
            )}
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

      {!loading && !showSongs && !isLocalMode && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">No songs found.</p>
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

            <div className="flex-1 overflow-auto px-4 py-2">
              {(() => {
                const columns: ColumnDef<Song>[] = [
                  {
                    id: "title",
                    label: "Title",
                    defaultVisible: true,
                    width: "1fr",
                    sortable: true,
                    sortValue: (s) => s.name,
                    render: (song) => (
                      <div className="flex min-w-0 items-center gap-3">
                        <CoverImage
                          src={song.imageUrl}
                          alt={song.name}
                          fallback={song.name.charAt(0)}
                          className="h-10 w-10 shrink-0 rounded-md"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{song.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span
                              className="cursor-pointer hover:text-foreground hover:underline"
                              onClick={(e) => { e.stopPropagation(); handleArtistClick(song); }}
                            >
                              {song.artistName}
                            </span>
                            {song.albumName && (
                              <>
                                {" \u00b7 "}
                                <span
                                  className="cursor-pointer hover:text-foreground hover:underline"
                                  onClick={(e) => { e.stopPropagation(); handleAlbumClick(song); }}
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
                    width: "80px",
                    sortable: true,
                    sortValue: (s) => s.duration ?? 0,
                    render: (song) => (
                      <span className="text-xs text-muted-foreground">
                        {song.duration ? formatDuration(Math.round(song.duration)) : "\u2014"}
                      </span>
                    ),
                  },
                  {
                    id: "addToPlaylist",
                    label: "",
                    width: "40px",
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
                ];

                return (
                  <DataTable
                    data={displaySongs}
                    columns={columns}
                    getRowId={(s) => s.id}
                    selectedId={selectedSongId}
                    onSelectedIdChange={setSelectedSongId}
                    onRowDoubleClick={(song) => handlePlayEntry(song)}
                    onRowContextMenu={(song, e) => {
                      e.preventDefault();
                      setContextMenuSong(song);
                      setContextMenuPos({ x: e.clientX, y: e.clientY });
                    }}
                    emptyMessage="No results match your filter."
                    storageKey="local-songs"
                    defaultSortColumn="title"
                  />
                );
              })()}
            </div>
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
                    addToQueue?.([contextMenuSong], { type: "now" });
                    setContextMenuSong(null);
                  }}
                >
                  <span className="text-sm">▶ Play</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    addToQueue?.([contextMenuSong], { type: "next" });
                    setContextMenuSong(null);
                  }}
                >
                  <span className="text-sm">⏭ Play Next</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setAddToPlaylistSong(contextMenuSong);
                    setContextMenuSong(null);
                  }}
                >
                  <span className="text-sm">📋 Add to Playlist</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={async () => {
                    const origin = origins.find((o) => o.id === contextMenuSong.originId);
                    if (origin && contextMenuSong.path) {
                      const ok = await moveSongToTrash(contextMenuSong.path, origin);
                      if (ok) {
                        setSongs((prev) => prev.filter((s) => s.id !== contextMenuSong.id));
                      }
                    }
                    setContextMenuSong(null);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  <span className="text-sm">Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Add to Playlist Dialog */}
      {addToPlaylistSong && (
        <AddToPlaylistDialog
          open={!!addToPlaylistSong}
          onOpenChange={(open) => { if (!open) setAddToPlaylistSong(null); }}
          song={addToPlaylistSong}
        />
      )}
    </div>
  );
}
