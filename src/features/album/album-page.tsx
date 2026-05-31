import { useState, useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { Song, OriginType, type Album, type AlbumArtist } from "../../types/domain-types";
import { getController } from "../../api/controller";
import { Avatar } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Play, ArrowLeft, Loader2 } from "lucide-react";
import { cn, formatDuration } from "../../lib/utils";
import { RotatingBlurBackground } from "../shared/rotating-blur-background";
import { DataTable, type ColumnDef } from "../shared/data-table";
import { fetchCoverArt, tagImageSource } from "../../services/image-fetch";

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
  const [coverUrl, setCoverUrl] = useState<string | null>(album.imageUrl);
  const [coverLoading, setCoverLoading] = useState(false);
  const coverUrlRef = useRef<string | null>(album.imageUrl);

  // Keep ref in sync
  useEffect(() => {
    coverUrlRef.current = coverUrl;
  }, [coverUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { getReleaseDetail, getReleaseByReleaseGroup, searchReleases } = await import("../../services/musicbrainz-client");
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
        if (releaseMbid) {
          const release = await getReleaseDetail(releaseMbid);
          if (release?.media && !cancelled) {
            const tracks: Song[] = [];
            for (const m of release.media) {
              for (const t of m.tracks ?? []) {
                const trackArtistMbzId = release["artist-credit"]?.[0]?.artist?.id;
                tracks.push({
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
            setSongs(tracks);
          } else if (!cancelled) {
            setSongs([]);
          }
        } else {
          const controller = await getController();
          const result = await controller.getAlbumSongs(album.albumArtistName, album.name);
          if (!cancelled) setSongs(result.filter((s) => s.albumName === album.name || s.albumName === undefined));
        }
      } catch {
        if (!cancelled) setSongs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [album]);

  // Patch imageUrl on songs when coverUrl loads (no re-fetch)
  useEffect(() => {
    if (!coverUrl) return;
    setSongs((prev) => prev.map((s) => ({ ...s, imageUrl: coverUrl })));
  }, [coverUrl]);

  // Resolve cover art lazily if missing
  useEffect(() => {
    const mbzRgId = album.mbzReleaseGroupId || album.mbzId;
    if (coverUrl || !mbzRgId) return;
    setCoverLoading(true);
    const rgUrl = `https://coverartarchive.org/release-group/${mbzRgId}/front-250.jpg`;
    fetchCoverArt(mbzRgId, "release-group").then((url) => {
      setCoverUrl(url);
      setCoverLoading(false);
    });
    tagImageSource(rgUrl, {
      artistName: album.albumArtistName,
      albumName: album.name,
      mbzReleaseGroupId: mbzRgId,
      mbzReleaseId: album.mbzId || undefined,
    });
  }, [album.mbzReleaseGroupId, album.mbzId, coverUrl]);

  function playAll() {
    if (songs.length > 0) {
      setQueue(songs, { type: "now" });
    }
  }

  function playSong(song: Song) {
    setQueue([song], { type: "now" });
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
        <Avatar
          src={song.imageUrl}
          alt={song.name}
          fallback={song.name.charAt(0)}
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {song.duration ? formatDuration(Math.round(song.duration)) : "--:--"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 transition-opacity",
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
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header with background */}
      <div className="relative overflow-hidden">
        <RotatingBlurBackground
          imageUrl={coverUrl}
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
          <Avatar
            src={coverUrl}
            alt={album.name}
            fallback={album.name.charAt(0)}
            className="h-48 w-48 shrink-0 rounded-lg md:h-56 md:w-56"
          />
          {coverLoading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-muted/60">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex flex-col justify-end gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Album</p>
          <h1 className="text-3xl font-bold">{album.name}</h1>
          <p className="text-lg text-muted-foreground">
            <span
              className="cursor-pointer hover:text-foreground hover:underline"
              onClick={() => {
                const artistMbzFromTracks = songs.find((s) => s.mbzArtistId)?.mbzArtistId;
                onNavigateArtist?.({
                  id: `artist-${album.albumArtistName.toLowerCase().replace(/\s+/g, "-")}`,
                  originId: album.originId,
                  originType: album.originType,
                  name: album.albumArtistName,
                  imageUrl: coverUrl,
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
            <Button onClick={playAll} className="mt-2 w-fit gap-2">
              <Play className="h-4 w-4" /> Play All
            </Button>
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
    </div>
  );
}

