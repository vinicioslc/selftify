import { useState, useEffect, useRef, useCallback } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { Song, OriginType, type Album, type AlbumArtist } from "../../types/domain-types";
import type { MusicBrainzContext } from "../../services/musicbrainz-types";
import { getController } from "../../api/controller";
import { resolveSong, resolveSongs } from "../../services/stream-resolver";
import { ArtImage } from "../../components/ui/art-image";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Play, Loader2, Info, MoreHorizontal, Download, RefreshCw, Trash2, SkipForward, ListPlus } from "lucide-react";
import { cn, formatDuration } from "../../lib/utils";
import { RotatingBlurBackground } from "../shared/rotating-blur-background";
import { DataTable, type ColumnDef } from "../shared/data-table";
import { buildArtistNav } from "../../lib/build-navigation";
import { songColumns } from "../shared/song-columns";
import { AlbumEmptySvg } from "../../components/ui/empty-image-svg";
import { useCover } from "../../hooks/use-cover";
import { SongInfoDialog } from "../song-info/song-info-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { AlbumImageManager } from "./album-image-manager";
import { CachedBadge } from "../../components/ui/cached-badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { DownloadButton } from "../download/download-button";
import { useDownloadStore } from "../../stores/download.store";
import { findImages, recordToBlobUrl } from "../../services/image-store";
import { loadFromArtistDotImg } from "../../services/dot-img-loader";
import { deleteAlbumFromLibrary } from "../../services/delete-album";
import { moveSongToTrash } from "../../services/move-to-trash";

interface AlbumPageProps {
  album: Album;
  onBack: () => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}

export function AlbumPage({ album, onBack, onNavigateArtist }: AlbumPageProps) {
  const { setQueue, currentTrack, status } = usePlayerStore();
  const { animationsEnabled } = useSettingsStore();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [songInfoSong, setSongInfoSong] = useState<Song | null>(null);
  const { coverUrl, loading: coverLoading } = useCover({
    artistName: album.albumArtistName,
    albumName: album.name,
    mbzReleaseGroupId: album.mbzReleaseGroupId,
    mbzReleaseId: album.mbzId,
  });
  const [albumImageUrl, setAlbumImageUrl] = useState<string | null>(null);
  const [imageManagerOpen, setImageManagerOpen] = useState(false);
  const [mbzLoading, setMbzLoading] = useState(false);
  const [isAlbumCached, setIsAlbumCached] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [contextMenuSong, setContextMenuSong] = useState<Song | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const resolvedCoverUrl = albumImageUrl || coverUrl || album.imageUrl || null;
  const coverUrlRef = useRef<string | null>(resolvedCoverUrl);

  function handleImageSaved(blobUrl: string) {
    if (blobUrl) {
      setAlbumImageUrl(blobUrl);
    } else {
      setAlbumImageUrl(null);
    }
  }

  async function handleFetchMusicBrainz() {
    const addMsg = useStatusStore.getState().addMessage;
    setMbzLoading(true);
    addMsg(`Fetching MusicBrainz data for ${album.name}\u2026`, "info", "MusicBrainz");
    try {
      const { getReleaseDetail, getReleaseByReleaseGroup, searchReleases } = await import("../../services/musicbrainz-client");
      const { initDatabase, isReady } = await import("../../services/db/database");
      const { findAlbumByName, upsertAlbum } = await import("../../services/db/repositories/album-repo");
      const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
      if (!root) { addMsg("No local library configured", "warn", "MusicBrainz"); return; }
      if (!isReady()) await initDatabase(root);
      if (!isReady()) { addMsg("Database not ready", "warn", "MusicBrainz"); return; }

      let releaseMbid = album.mbzId;

      if (!releaseMbid && album.mbzReleaseGroupId) {
        const release = await getReleaseByReleaseGroup(album.mbzReleaseGroupId);
        releaseMbid = release?.id;
      }
      if (!releaseMbid && album.name && album.albumArtistName) {
        const q = `release:"${album.name}" AND artist:"${album.albumArtistName}"`;
        const res = await searchReleases("", "", { rawQuery: q, limit: 1 });
        releaseMbid = res.releases?.[0]?.id;
      }
      if (!releaseMbid) {
        addMsg(`No MusicBrainz release found for ${album.name}`, "warn", "MusicBrainz");
        return;
      }

      const existing = findAlbumByName(album.albumArtistName, album.name);
      if (!existing) {
        addMsg(`Album not found in library for ${album.name}`, "warn", "MusicBrainz");
        return;
      }

      const releaseData = await getReleaseDetail(releaseMbid);
      if (!releaseData) {
        addMsg(`No MusicBrainz data returned for ${album.name}`, "warn", "MusicBrainz");
        return;
      }

      const meta: import("../../services/sqlite-db/sqlite-db-types").SqliteDbAlbumMeta = {
        $schema: "selftify-album",
        version: 1,
        name: album.name,
        artistName: album.albumArtistName,
        albumArtist: releaseData["artist-credit"]?.map((a: any) => a.name).join(", ") || existing.albumArtist || null,
        releaseYear: releaseData.date ? parseInt(releaseData.date.slice(0, 4), 10) : existing.releaseYear || null,
        mbzId: releaseMbid || existing.mbzId || null,
        mbzReleaseGroupId: existing.mbzReleaseGroupId || null,
        genres: existing.genres || [],
        images: existing.images || [],
        songCount: existing.songCount || 0,
        duration: existing.duration || 0,
        tracks: existing.tracks || [],
        updatedAt: Date.now(),
        enrichedAt: Date.now(),
      };
      upsertAlbum(meta, album.albumArtistName);
      setIsAlbumCached(true);
      addMsg(`MusicBrainz data saved for ${album.name}`, "success", "MusicBrainz");
    } catch (err) {
      console.error("[album-page] MB fetch error:", err);
      addMsg(`Failed to fetch MusicBrainz data for ${album.name}`, "danger", "MusicBrainz");
    } finally {
      setMbzLoading(false);
    }
  }

  // Check if album has cached MusicBrainz data
  useEffect(() => {
    if (!album.name || !album.albumArtistName) return;
    let cancelled = false;
    (async () => {
      try {
        const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
        if (!root) return;
        const { initDatabase, isReady } = await import("../../services/db/database");
        const { findAlbumByName } = await import("../../services/db/repositories/album-repo");
        if (!isReady()) await initDatabase(root);
        if (!isReady()) return;
        if (cancelled) return;
        const meta = findAlbumByName(album.albumArtistName, album.name);
        if (meta?.enrichedAt != null) setIsAlbumCached(true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [album.name, album.albumArtistName]);

  async function handleDeleteAlbum() {
    setDeleting(true);
    try {
      const ok = await deleteAlbumFromLibrary(album);
      if (ok) {
        onBack();
      }
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  async function handleClearAlbumCache() {
    try {
      const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
      if (!root) return;
      const { initDatabase, isReady } = await import("../../services/db/database");
      const { findAlbumByName, upsertAlbum } = await import("../../services/db/repositories/album-repo");
      if (!isReady()) await initDatabase(root);
      if (!isReady()) return;
      const meta = findAlbumByName(album.albumArtistName, album.name);
      if (meta) {
        meta.enrichedAt = null;
        meta.mbzId = null;
        meta.mbzReleaseGroupId = null;
        meta.updatedAt = Date.now();
        upsertAlbum(meta, album.albumArtistName);
      }
      setIsAlbumCached(false);
      useStatusStore.getState().addMessage(`MusicBrainz cache cleared for ${album.name}`, "info", "MusicBrainz");
    } catch {}
  }

  // Keep ref in sync
  useEffect(() => {
    coverUrlRef.current = resolvedCoverUrl;
  }, [resolvedCoverUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const controller = await getController();
      try {
        // 1. Always fetch local songs from SQLite (have paths, embedded images)
        const [localSongs, mbzModule] = await Promise.all([
          controller.getAlbumSongs(album.albumArtistName, album.name).catch(() => [] as Song[]),
          import("../../services/musicbrainz-client").catch(() => null),
        ]);
        const filteredLocal = localSongs.filter(
          (s) => s.albumName === album.name || s.albumName === undefined,
        );

        // 2. Try to fetch MusicBrainz tracks (for MBZ IDs, extra metadata)
        let mbzTracks: Song[] = [];
          if (mbzModule) {
            const { getReleaseDetail, getReleaseByReleaseGroup, searchReleases } = mbzModule;
            const mbCtx: MusicBrainzContext = { artistName: album.albumArtistName };
            try {
              let releaseMbid = album.mbzId;
              if (!releaseMbid && album.mbzReleaseGroupId) {
                const release = await getReleaseByReleaseGroup(album.mbzReleaseGroupId, mbCtx);
                releaseMbid = release?.id;
              }
              if (!releaseMbid && album.name && album.albumArtistName) {
                const q = `release:"${album.name}" AND artist:"${album.albumArtistName}"`;
                const res = await searchReleases("", "", { rawQuery: q, limit: 1 });
                releaseMbid = res.releases?.[0]?.id;
              }
              if (releaseMbid) {
                const release = await getReleaseDetail(releaseMbid, mbCtx);
              if (release?.media) {
                for (const m of release.media) {
                  for (const t of m.tracks ?? []) {
                    const trackArtistMbzId = release["artist-credit"]?.[0]?.artist?.id;
                    mbzTracks.push({
                      id: `mbz-track-${t.id}`,
                      originId: album.originId,
                      originType: OriginType.LOCAL,
                      name: t.title,
                      artistName: release["artist-credit"]?.[0]?.name || album.albumArtistName,
                      albumName: release.title,
                      albumArtistName: album.albumArtistName,
                      duration: t.length ? Math.round(t.length / 1000) : null,
                      trackNumber: t.number ? parseInt(t.number, 10) : undefined,
                      imageUrl: coverUrlRef.current,
                      mbzRecordingId: t.recording?.id,
                      mbzTrackId: t.id,
                      mbzArtistId: trackArtistMbzId,
                    });
                  }
                }
              }
            }
          } catch {
            // MBZ fetch failed — proceed with local only
          }
        }

        // 3. Merge: local songs win over MBZ tracks by name key.
        //    MBZ metadata (imageUrl, mbz IDs) merged into local entry when available.
        if (!cancelled) {
          const merged = new Map<string, Song>();
          const nameKey = (s: Song): string =>
            `name:${(s.artistName || "").toLowerCase()}|${(s.name || "").toLowerCase()}`;

          for (const t of mbzTracks) {
            const key = nameKey(t);
            if (merged.has(key)) continue;
            merged.set(key, t);
          }

          for (const t of filteredLocal) {
            const key = nameKey(t);
            const existing = merged.get(key);
            if (existing) {
              // Merge: local id + path+duration+trackNumber win;
              // keep MBZ imageUrl+mbz metadata when local lacks them.
              merged.set(key, {
                ...existing,
                id: t.id ?? existing.id,
                originId: t.originId ?? existing.originId,
                path: t.path ?? existing.path,
                duration: t.duration ?? existing.duration,
                trackNumber: t.trackNumber ?? existing.trackNumber,
                discNumber: t.discNumber ?? existing.discNumber,
                imageUrl: existing.imageUrl ?? t.imageUrl,
              });
            } else {
              merged.set(key, t);
            }
          }

          const mergedList = Array.from(merged.values()).sort(
            (a, b) => (a.trackNumber ?? 999) - (b.trackNumber ?? 999) || a.name.localeCompare(b.name),
          );
          setSongs(mergedList);
        }
      } catch (err) {
        console.warn("[album-page] load album songs error:", err);
        if (!cancelled) setSongs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [album]);

  // Patch imageUrl on songs when coverUrl loads (no re-fetch)
  useEffect(() => {
    if (!resolvedCoverUrl) return;
    setSongs((prev) => prev.map((s) => ({ ...s, imageUrl: resolvedCoverUrl })));
  }, [resolvedCoverUrl]);

  async function playSong(song: Song) {
    const { song: resolved } = await resolveSong(song);
    setQueue([resolved], { type: "now" });
  }

  function handlePlayNext(song: Song) {
    resolveSong(song).then(({ song: resolved }) => {
      setQueue([resolved], { type: "next" });
    });
  }

  function handleAddToQueue(song: Song) {
    resolveSong(song).then(({ song: resolved }) => {
      setQueue([resolved], { type: "last" });
    });
  }

  async function handleDeleteSong(song: Song) {
    if (!song.path) return;
    const addMsg = useStatusStore.getState().addMessage;
    setContextMenuSong(null);
    try {
      const origin = useAuthStore.getState().currentOrigin;
      if (!origin) return;
      await moveSongToTrash(song.path, origin);
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
      addMsg(`Moved "${song.name}" to trash`, "success", "Album");
    } catch (err) {
      addMsg(`Failed to delete "${song.name}"`, "danger", "Album");
    }
  }

  async function playAll() {
    if (songs.length === 0) return;
    const results = await resolveSongs(songs);
    const all = results.map((r) => r.song);
    setQueue(all, { type: "now" });
  }

  async function resolveArtistImage(artistName: string): Promise<string | null> {
    try {
      const artistNorm = artistName.toLowerCase().trim();
      // 1. Image store
      const records = await findImages();
      if (records.length > 0) {
        return await recordToBlobUrl(records[0]);
      }
      // 2. .img/ folder on filesystem
      const dotImgUrl = await loadFromArtistDotImg(artistName);
      if (dotImgUrl) return dotImgUrl;
    } catch {
      // fall through to album cover
    }
    return null;
  }

  const isAlbumPlaying = currentTrack?.albumName === album.name && currentTrack?.albumArtistName === album.albumArtistName;

  const handleNavArtist = useCallback((song: Song) => {
    onNavigateArtist?.(buildArtistNav(song));
  }, [onNavigateArtist]);

  const handleNavAlbum = useCallback((_song: Song) => {
    // album context is already clear on this page — no-op
  }, []);

  const columns: ColumnDef<Song>[] = [
    {
      id: "track",
      label: "#",
      width: "3rem",
      sortable: true,
      sortValue: (song) => song.trackNumber ?? 0,
      render: (song, i) => (
        <span className="text-sm text-muted-foreground">{song.trackNumber || i + 1}</span>
      ),
    },
    ...songColumns({ onNavigateArtist: handleNavArtist, onNavigateAlbum: handleNavAlbum }),
    {
      id: "actions",
      label: "",
      width: "5rem",
      sortable: false,
      render: (song, _, isSelected) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 transition-opacity",
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            onClick={(e) => {
              e.stopPropagation();
              setSongInfoSong(song);
            }}
            title="Song Info"
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 transition-opacity",
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            onClick={(e) => {
              e.stopPropagation();
              playSong(song);
            }}
          >
            <Play className="h-4 w-4" />
          </Button>
          <DownloadButton song={song} variant="icon" size="sm" />
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header with background */}
      <div className="relative overflow-hidden">
        <RotatingBlurBackground
          imageUrl={resolvedCoverUrl}
          isActive={isAlbumPlaying}
          animationsEnabled={animationsEnabled}
          status={status}
        />
        <div className="relative z-10 flex flex-col gap-6 p-6 md:flex-row">
        <div className="relative">
        <ArtImage
          src={resolvedCoverUrl}
          alt={album.name}
          fallback={album.name.charAt(0)}
          emptySvg={<AlbumEmptySvg />}
          className="h-48 w-48 shrink-0 rounded-lg md:h-56 md:w-56"
        />
          {coverLoading && !resolvedCoverUrl && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex flex-col justify-end gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Album</p>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold">{album.name}</h1>
            <CachedBadge visible={isAlbumCached} onClear={handleClearAlbumCache} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuItem onClick={() => setImageManagerOpen(true)}>
                  <span className="text-sm">🖼 Manage Album Cover</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleFetchMusicBrainz} disabled={mbzLoading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${mbzLoading ? "animate-spin" : ""}`} />
                  <span className="text-sm">Fetch MusicBrainz</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  <span className="text-sm">Delete Album</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="text-lg text-muted-foreground">
            <span
              className="cursor-pointer hover:text-foreground hover:underline"
              onClick={async () => {
                const artistMbzFromTracks = songs.find((s) => s.mbzArtistId)?.mbzArtistId;
                const artistImage = await resolveArtistImage(album.albumArtistName);
                onNavigateArtist?.({
                  id: `artist-${album.albumArtistName.toLowerCase().replace(/\s+/g, "-")}`,
                  originId: album.originId,
                  originType: album.originType,
                  name: album.albumArtistName,
                  imageUrl: artistImage || resolvedCoverUrl,
                  mbz: artistMbzFromTracks,
                });
              }}
            >
              {album.albumArtistName}
            </span>
            {album.releaseYear && <> &middot; {album.releaseYear}</>}
          </p>
          {album.songCount && (
            <p className="text-sm text-muted-foreground">
              {album.songCount} songs
              {album.duration ? <> &middot; {formatDuration(Math.round(album.duration / album.songCount * 1000))} avg</> : null}
            </p>
          )}
          {songs.length > 0 && (
            <div className="mt-2 flex gap-2">
              <Button onClick={playAll} className="w-fit gap-2">
                <Play className="h-4 w-4" /> Play All
              </Button>
              {songs.some((s) => !s.path && !useDownloadStore.getState().isInQueue(s)) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const toDownload = songs.filter((s) => !s.path && !useDownloadStore.getState().isInQueue(s));
                    if (toDownload.length === 0) return;
                    useDownloadStore.getState().enqueueMultiple(toDownload);
                  }}
                  className="w-fit gap-2"
                >
                  <Download className="h-4 w-4" /> Save Local
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      <ScrollArea className="flex-1 px-6">
        <div className="max-w-3xl">
          <DataTable
            data={songs}
            columns={columns}
            getRowId={(s) => s.id}
            selectedId={selectedSongId}
            onSelectedIdChange={setSelectedSongId}
            onRowDoubleClick={playSong}
            onRowContextMenu={(song, e) => {
              e.preventDefault();
              setContextMenuSong(song);
              setContextMenuPos({ x: e.clientX, y: e.clientY });
            }}
            loading={loading}
            emptyMessage="No songs found in this album."
            storageKey="album"
            defaultSortColumn="track"
          />
        </div>
      </ScrollArea>

      {contextMenuSong && (
        <div
          className="fixed inset-0 z-50"
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => setContextMenuSong(null)}
        >
          <div className="absolute" style={{ left: contextMenuPos.x, top: contextMenuPos.y }}>
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
                <DropdownMenuItem onClick={() => { setContextMenuSong(null); playSong(contextMenuSong); }}>
                  <Play className="mr-2 h-4 w-4" />
                  <span>Play</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlePlayNext(contextMenuSong)}>
                  <SkipForward className="mr-2 h-4 w-4" />
                  <span>Play Next</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddToQueue(contextMenuSong)}>
                  <ListPlus className="mr-2 h-4 w-4" />
                  <span>Add to Queue</span>
                </DropdownMenuItem>
                {contextMenuSong.path && contextMenuSong.originType === OriginType.LOCAL && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleDeleteSong(contextMenuSong)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span>Delete File</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {songInfoSong && (
        <SongInfoDialog
          open={!!songInfoSong}
          onOpenChange={(open) => { if (!open) setSongInfoSong(null); }}
          song={songInfoSong}
        />
      )}

      <AlbumImageManager
        open={imageManagerOpen}
        onOpenChange={setImageManagerOpen}
        album={album}
        currentImageUrl={albumImageUrl}
        onImageSaved={handleImageSaved}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Album</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all audio files and cover art for{" "}
              <strong>{album.name}</strong> and hide it from your library.
              Metadata will be preserved for faster re-scanning.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={handleDeleteAlbum}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting\u2026
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

