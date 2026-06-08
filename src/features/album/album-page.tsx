import { useState, useEffect, useRef, useCallback } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { Song, OriginType, type Album, type AlbumArtist } from "../../types/domain-types";
import type { MusicBrainzContext } from "../../services/musicbrainz-disk-cache";
import { getController } from "../../api/controller";
import { resolveSong, resolveSongs } from "../../services/stream-resolver";
import { ArtImage } from "../../components/ui/art-image";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Play, ArrowLeft, Loader2, Info, MoreHorizontal, Download } from "lucide-react";
import { cn, formatDuration } from "../../lib/utils";
import { RotatingBlurBackground } from "../shared/rotating-blur-background";
import { DataTable, type ColumnDef } from "../shared/data-table";
import { fetchAlbumCover } from "../../services/image-fetch";
import { AlbumEmptySvg, SongEmptySvg } from "../../components/ui/empty-image-svg";
import { useCover } from "../../hooks/use-cover";
import { SongInfoDialog } from "../song-info/song-info-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { AlbumImageManager } from "./album-image-manager";
import { DownloadButton } from "../download/download-button";
import { useDownloadStore } from "../../stores/download.store";
import { findImages, recordToBlobUrl } from "../../services/image-store";
import { isElectronImageStore, electronFindImages, electronRecordToBlobUrl } from "../../services/electron-image-store";
import { loadFromArtistDotImg } from "../../services/dot-img-loader";

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
  const resolvedCoverUrl = albumImageUrl || coverUrl || album.imageUrl || null;
  const coverUrlRef = useRef<string | null>(resolvedCoverUrl);

  function handleImageSaved(blobUrl: string) {
    if (blobUrl) {
      setAlbumImageUrl(blobUrl);
    } else {
      setAlbumImageUrl(null);
    }
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

        // 3. Merge: local songs win over MBZ tracks by mbzRecordingId or (artistName + trackName)
        if (!cancelled) {
          const merged = new Map<string, Song>();
          const normKey = (s: Song): string => {
            if (s.mbzRecordingId) return `mbz:${s.mbzRecordingId}`;
            return `name:${s.artistName.toLowerCase()}|${s.name.toLowerCase()}`;
          };
          for (const t of mbzTracks) {
            merged.set(normKey(t), t);
          }
          for (const t of filteredLocal) {
            merged.set(normKey(t), t);
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

  // Resolve cover art from network if missing in database
  useEffect(() => {
    if (resolvedCoverUrl) return;
    const mbzRgId = album.mbzReleaseGroupId || album.mbzId;
    if (!mbzRgId) return;
    fetchAlbumCover(album.mbzReleaseGroupId, album.mbzId, album.albumArtistName, album.name)
      .catch((err) => {
        console.warn("[album-page] cover fetch error:", err);
      });
  }, [album.mbzReleaseGroupId, album.mbzId, resolvedCoverUrl]);

  async function playSong(song: Song) {
    const { song: resolved } = await resolveSong(song);
    setQueue([resolved], { type: "now" });
  }

  async function playAll() {
    if (songs.length === 0) return;
    const results = await resolveSongs(songs);
    const all = results.map((r) => r.song);
    setQueue(all, { type: "now" });
  }

  async function resolveArtistImage(artistName: string): Promise<string | null> {
    try {
      const isElectron = await isElectronImageStore();
      const artistNorm = artistName.toLowerCase().trim();
      // 1. IndexedDB / Electron store
      const records = isElectron
        ? await electronFindImages({ artistName: artistNorm })
        : await findImages({ artistName: artistNorm });
      if (records.length > 0) {
        return isElectron ? await electronRecordToBlobUrl(records[0]) : await recordToBlobUrl(records[0]);
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
    {
      id: "cover",
      label: "",
      width: "2.5rem",
      sortable: false,
      render: (song) => (
        <ArtImage
          src={song.imageUrl}
          alt={song.name}
          fallback={song.name.charAt(0)}
          emptySvg={<SongEmptySvg />}
          className="h-8 w-8 rounded"
        />
      ),
    },
    {
      id: "title",
      label: "Title",
      width: "1fr",
      sortable: true,
      sortValue: (song) => song.name,
      render: (song) => (
        <p className="truncate text-sm font-medium">{song.name}</p>
      ),
    },
    {
      id: "artist",
      label: "Artist",
      defaultVisible: false,
      sortable: true,
      sortValue: (song) => song.artistName,
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
      id: "duration",
      label: "Duration",
      sortable: true,
      sortValue: (song) => song.duration ?? 0,
      render: (song, _, isSelected) => (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {song.duration ? formatDuration(Math.round(song.duration)) : "--:--"}
          </span>
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
        </div>
      ),
    },
    {
      id: "download",
      label: "",
      width: "2rem",
      sortable: false,
      render: (song) => <DownloadButton song={song} variant="icon" size="sm" />,
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
        <div className="relative z-10 border-b border-border p-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </div>

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
              {songs.some((s) => !s.path) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const toDownload = songs.filter((s) => !s.path);
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
            loading={loading}
            emptyMessage="No songs found in this album."
            storageKey="album"
            defaultSortColumn="track"
          />
        </div>
      </ScrollArea>

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
    </div>
  );
}

