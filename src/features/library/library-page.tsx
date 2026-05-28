import { useEffect, useMemo, useCallback } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useLocalLibraryStore } from "../../stores/local-library.store";
import { useLocalScan } from "../../hooks/use-local-scan";
import { OriginType } from "../../types/domain-types";
import { getAllSongs, getScanState, updateScanState, getQueueCount, getSongCount, getArtistCount, getAlbumCount, getDistinctGenres, type DbSong } from "../../services/local-database";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
import { formatDuration } from "../../lib/utils";
import { Play, Loader2, Pause as PauseIcon, FolderOpen, Music, RotateCw, List, Disc } from "lucide-react";
import { useState } from "react";

export function LibraryPage() {
  const { currentOrigin } = useAuthStore();
  const { setQueue } = usePlayerStore();
  const [folderPath, setFolderPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [songs, setSongs] = useState<DbSong[]>([]);
  const [stats, setStats] = useState({ songs: 0, artists: 0, albums: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("songs");
  const [genres, setGenres] = useState<string[]>([]);

  const {
    rootFolder,
    scanStatus,
    scanProgress,
    lastScanned,
    setRootFolder,
    reset: resetStore,
  } = useLocalLibraryStore();

  const { startScan, pause, resume, rescan } = useLocalScan();

  const isLocalMode = currentOrigin?.type === OriginType.LOCAL;

  const loadLibrary = useCallback(async () => {
    try {
      const state = await getScanState();
      if (state) {
        setRootFolder(state.root_folder);
        if (state.scan_status === "done") {
          const all = await getAllSongs();
          setSongs(all);
          setStats({
            songs: await getSongCount(),
            artists: await getArtistCount(),
            albums: await getAlbumCount(),
          });
          const g = await getDistinctGenres();
          setGenres(g);
        }
      }
    } catch (err) {
      console.warn("[library] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [setRootFolder]);

  // Load library on mount when in local mode
  useEffect(() => {
    if (isLocalMode) {
      loadLibrary();
    } else {
      setLoading(false);
    }
  }, [isLocalMode, loadLibrary]);

  // Reload when scan completes
  useEffect(() => {
    if (scanStatus === "done" && isLocalMode) {
      loadLibrary();
    }
  }, [scanStatus, isLocalMode, loadLibrary]);

  // Auto-resume a pending scan from a previous session
  useEffect(() => {
    if (!isLocalMode || loading) return;
    (async () => {
      try {
        const state = await getScanState();
        if (!state) return;
        if (state.scan_status === "scanning" || state.scan_status === "paused") {
          const count = await getQueueCount();
          if (count > 0) {
            resume();
          } else {
            // Queue drained but status not updated — finish
            await updateScanState({ scan_status: "done", last_scanned_at: Date.now() });
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [isLocalMode, loading, resume]);

  const filteredSongs = useMemo(() => {
    if (!searchQuery) return songs;
    const q = searchQuery.toLowerCase();
    return songs.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.artist_name.toLowerCase().includes(q) ||
        (s.album_name && s.album_name.toLowerCase().includes(q))
    );
  }, [songs, searchQuery]);

  function handleStartScan() {
    const folder = folderPath || rootFolder;
    if (!folder) return;
    setRootFolder(folder);
    startScan(folder);
  }

  function handlePlayAll() {
    if (songs.length === 0) return;
    const list = songs.map((s) => ({
      id: s.id,
      originId: currentOrigin?.id || "local",
      originType: OriginType.LOCAL,
      name: s.name,
      artistName: s.artist_name,
      albumName: s.album_name || undefined,
      duration: s.duration,
      imageUrl: null,
      path: s.path,
    }));
    setQueue(list, { type: "now" });
  }

  function handlePlayEntry(song: DbSong) {
    const item = {
      id: song.id,
      originId: currentOrigin?.id || "local",
      originType: OriginType.LOCAL,
      name: song.name,
      artistName: song.artist_name,
      albumName: song.album_name || undefined,
      duration: song.duration,
      imageUrl: null,
      path: song.path,
    };
    setQueue([item], { type: "now" });
  }

  function handlePlayGenre(genre: string) {
    const list = songs
      .filter((s) => s.genre === genre)
      .map((s) => ({
        id: s.id,
        originId: currentOrigin?.id || "local",
        originType: OriginType.LOCAL,
        name: s.name,
        artistName: s.artist_name,
        albumName: s.album_name || undefined,
        duration: s.duration,
        imageUrl: null,
        path: s.path,
      }));
    if (list.length > 0) setQueue(list, { type: "now" });
  }

  function formatFileSize(bytes: number | null | undefined): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

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

  if (!isLocalMode) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b p-4">
          <h1 className="text-2xl font-bold">Music Library</h1>
          <p className="text-sm text-muted-foreground">
            Browsing: {currentOrigin?.name || "N/A"} ({currentOrigin?.type || "N/A"})
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Music className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-2 text-muted-foreground">
              Library browsing is available for local files.
            </p>
            <p className="text-sm text-muted-foreground/70">
              Switch to a Local Files origin to scan and browse your music.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <h1 className="text-2xl font-bold">Local Music Library</h1>
        <p className="text-sm text-muted-foreground">
          {stats.songs > 0
            ? `${stats.songs} songs \u00b7 ${stats.artists} artists \u00b7 ${stats.albums} albums`
            : "Scan a folder to find your music"}
          {lastScanned && ` \u00b7 Last scanned ${relativeTime(lastScanned)}`}
        </p>
      </div>

      {/* Scan controls */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Input
          placeholder="/storage/music or /home/user/Music"
          value={folderPath || rootFolder}
          onChange={(e) => setFolderPath(e.target.value)}
          className="h-8 flex-1"
        />

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
            <Button variant="outline" size="sm" className="h-8" onClick={() => rescan()}>
              <RotateCw className="mr-1 h-3 w-3" /> Rescan
            </Button>
            <Badge variant="default" className="gap-1">
              {stats.songs} files
            </Badge>
          </>
        )}
        {scanStatus === "idle" && (
          <Button variant="default" size="sm" className="h-8" onClick={handleStartScan}>
            <FolderOpen className="mr-1 h-3 w-3" /> Scan
          </Button>
        )}

        {scanStatus === "scanning" && (
          <p className="ml-2 truncate text-xs text-muted-foreground">
            {scanProgress.currentDir?.replace(rootFolder, "") || ""}
          </p>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!loading && stats.songs === 0 && scanStatus === "idle" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md text-center">
            <FolderOpen className="mx-auto h-16 w-16 text-muted-foreground/30" />
            <h3 className="mt-4 text-lg font-semibold">No music scanned yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the path to your music folder above and click Scan.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              On Android: /storage/emulated/0/Music
              <br />
              On Desktop: /home/user/Music
            </p>
          </div>
        </div>
      )}

      {scanStatus === "scanning" && stats.songs === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Scanning and extracting tags...</p>
          </div>
        </div>
      )}

      {/* Content tabs */}
      {stats.songs > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-4">
            <TabsList className="h-9">
              <TabsTrigger value="songs" className="gap-1 text-xs">
                <List className="h-3 w-3" /> Songs
              </TabsTrigger>
              <TabsTrigger value="genres" className="gap-1 text-xs">
                <Disc className="h-3 w-3" /> Genres
              </TabsTrigger>
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

          <TabsContent value="songs" className="flex-1 p-0">
            <ScrollArea className="h-full">
              {filteredSongs.length === 0 && songs.length > 0 && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">No results match your filter.</p>
                </div>
              )}
              {filteredSongs.map((song) => (
                <div
                  key={song.id}
                  className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/50"
                >
                  <Avatar
                    alt={song.name}
                    fallback={song.name.charAt(0)}
                    className="h-10 w-10 rounded-md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{song.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {song.artist_name}
                      {song.album_name && ` \u00b7 ${song.album_name}`}
                    </p>
                  </div>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {song.bitrate ? `${Math.round(song.bitrate / 1000)}kbps` : formatFileSize(song.file_size)}
                  </span>
                  <span className="hidden text-xs tabular-nums text-muted-foreground md:inline">
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
              ))}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="genres" className="flex-1 p-0">
            <ScrollArea className="h-full">
              {genres.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">No genres found in your library.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {genres.map((genre) => {
                    const count = songs.filter((s) => s.genre === genre).length;
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
                          onClick={() => handlePlayGenre(genre)}
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
        </Tabs>
      )}
    </div>
  );
}
