import { useEffect, useMemo } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useLocalLibraryStore } from "../../stores/local-library.store";
import { useLocalScan } from "../../hooks/use-local-scan";
import { ServerType } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { ScrollArea } from "../../components/ui/scroll-area";
import { formatDuration } from "../../lib/utils";
import { Play, Loader2, Pause as PauseIcon, FolderOpen, Music, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";

export function LibraryPage() {
  const { currentServer } = useAuthStore();
  const { setQueue, queue } = usePlayerStore();
  const [folderPath, setFolderPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const {
    rootFolder,
    entries,
    scanStatus,
    scanProgress,
    lastScanned,
    setRootFolder,
    reset,
  } = useLocalLibraryStore();

  const { startScan, pause, resume } = useLocalScan();

  const isLocalMode = currentServer?.type === ServerType.LOCAL;

  // Auto-init scan when library loads in local mode with existing root
  useEffect(() => {
    if (isLocalMode && rootFolder && entries.length === 0 && scanStatus === "idle") {
      startScan(rootFolder);
    }
  }, [isLocalMode, rootFolder]);

  const filteredEntries = useMemo(() => {
    if (!searchQuery) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.artistName.toLowerCase().includes(q) ||
        (e.albumName && e.albumName.toLowerCase().includes(q))
    );
  }, [entries, searchQuery]);

  const albumCount = useMemo(() => {
    const albums = new Set(entries.filter((e) => e.albumName).map((e) => e.albumName));
    return albums.size;
  }, [entries]);

  const artistCount = useMemo(() => {
    const artists = new Set(entries.map((e) => e.artistName));
    return artists.size;
  }, [entries]);

  function handleStartScan() {
    const folder = folderPath || rootFolder;
    if (!folder) return;
    setRootFolder(folder);
    startScan(folder);
  }

  function handlePlayAll() {
    if (entries.length === 0) return;
    const songs = entries.map((e) => ({
      id: e.id,
      serverId: currentServer?.id || "local",
      serverType: ServerType.LOCAL,
      name: e.name,
      artistName: e.artistName,
      albumName: e.albumName || undefined,
      duration: e.duration,
      imageUrl: e.imageUrl,
      path: e.path,
    }));
    setQueue(songs, { type: "now" });
  }

  function handlePlayEntry(entry: typeof entries[0]) {
    const song = {
      id: entry.id,
      serverId: currentServer?.id || "local",
      serverType: ServerType.LOCAL,
      name: entry.name,
      artistName: entry.artistName,
      albumName: entry.albumName || undefined,
      duration: entry.duration,
      imageUrl: entry.imageUrl,
      path: entry.path,
    };
    setQueue([song], { type: "now" });
  }

  function formatFileSize(bytes: number | null): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function relativeTime(ts: number | null): string {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // Non-local mode
  if (!isLocalMode) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b p-4">
          <h1 className="text-2xl font-bold">Music Library</h1>
          <p className="text-sm text-muted-foreground">
            Browsing: {currentServer?.name || "N/A"} ({currentServer?.type || "N/A"})
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Music className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-2 text-muted-foreground">
              Library browsing is available for local files.
            </p>
            <p className="text-sm text-muted-foreground/70">
              Switch to a Local Files server to scan and browse your music.
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
          {entries.length > 0
            ? `${entries.length} songs · ${artistCount} artists · ${albumCount} albums`
            : "Scan a folder to find your music"}
          {lastScanned && ` · Last scanned ${relativeTime(lastScanned)}`}
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
              {scanProgress.done}/{scanProgress.total || "?"}
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
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => startScan(rootFolder)}
            >
              <RotateCw className="mr-1 h-3 w-3" /> Rescan
            </Button>
            <Badge variant="default" className="gap-1">
              {entries.length} files
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

      {/* Search + Play All */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Input
            placeholder="Filter songs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 flex-1"
          />
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={handlePlayAll}>
            <Play className="h-3 w-3" /> Play All ({filteredEntries.length})
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-destructive" onClick={reset}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Song list */}
      <ScrollArea className="flex-1">
        {scanStatus === "idle" && entries.length === 0 && (
          <div className="flex h-full items-center justify-center">
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

        {scanStatus === "scanning" && entries.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">Scanning directories...</p>
            </div>
          </div>
        )}

        {filteredEntries.length === 0 && entries.length > 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">No results match your filter.</p>
          </div>
        )}

        {filteredEntries.length > 0 && (
          <div className="divide-y">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/50"
              >
                <Avatar
                  src={entry.imageUrl}
                  alt={entry.name}
                  fallback={entry.name.charAt(0)}
                  className="h-10 w-10 rounded-md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.artistName}
                    {entry.albumName && ` · ${entry.albumName}`}
                  </p>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {formatFileSize(entry.size)}
                </span>
                <span className="hidden text-xs tabular-nums text-muted-foreground md:inline">
                  {entry.duration ? formatDuration(entry.duration) : "—"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100"
                  onClick={() => handlePlayEntry(entry)}
                >
                  <Play className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
