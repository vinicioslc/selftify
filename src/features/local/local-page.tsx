import { useEffect, useMemo, useCallback, useState } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useStatusStore } from "../../stores/status.store";
import { useBackendStore } from "../../stores/backend.store";
import { getController } from "../../api/controller";
import { OriginType, type Song, type Album, type AlbumArtist } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Play, Loader2, Music, List, Disc, ChevronLeft, ChevronRight, Plus, Trash2, Users, Tags } from "lucide-react";
import { DataTable } from "../shared/data-table";
import { songColumns } from "../shared/song-columns";
import { AddToPlaylistDialog } from "../playlist/add-to-playlist-dialog";
import { moveSongToTrash } from "../../services/move-to-trash";
import { CoverImage, ArtImage } from "../../components/ui/art-image";
import { AlbumEmptySvg } from "../../components/ui/empty-image-svg";
import { ContextMenuOverlay } from "../../components/ui/context-menu-overlay";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";

const PAGE_SIZE = 20;

interface LocalPageProps {
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}

export function LocalPage({ onNavigateAlbum, onNavigateArtist }: LocalPageProps) {
  const { currentOrigin, origins } = useAuthStore();
  const backendConfig = useBackendStore((s) => s.config);
  const { setQueue, addToQueue } = usePlayerStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<AlbumArtist[]>([]);
  const [totalSongs, setTotalSongs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("songs");
  const [genres, setGenres] = useState<string[]>([]);
  const [localStats, setLocalStats] = useState({ songs: 0, artists: 0, albums: 0 });
  const [page, setPage] = useState(0);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<Song | null>(null);
  const [contextMenuSong, setContextMenuSong] = useState<Song | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const isLocalMode = currentOrigin?.type === OriginType.LOCAL;

  // ── Data loading ──

  const loadData = useCallback(async () => {
    // A backend (Selftify/Subsonic server) is a valid source even without a
    // local origin in auth.store — mirror the Home page behavior.
    if (!currentOrigin && !backendConfig) { setLoading(false); return; }
    setLoading(true);
    try {
      const controller = await getController();
      if (searchQuery.trim()) {
        useStatusStore.getState().addMessage(`Searching for "${searchQuery}"...`, "info", "Library");
        const res = await controller.search(searchQuery, PAGE_SIZE);
        setSongs(res.songs);
        setTotalSongs(res.songs.length);
        useStatusStore.getState().addMessage(`Found ${res.songs.length} song${res.songs.length !== 1 ? "s" : ""}`, res.songs.length > 0 ? "success" : "info", "Library");
      } else {
        const [songList, albumList, artistList] = await Promise.all([
          controller.getSongList(0, 10000),
          controller.getAlbumList(0, 10000),
          controller.getAlbumArtistList(0, 10000),
        ]);
        setSongs(songList);
        setTotalSongs(songList.length);
        setAlbums(albumList);
        setArtists(artistList);
        setLocalStats({
          songs: songList.length,
          artists: artistList.length,
          albums: albumList.length,
        });
        const genreSet = new Set<string>();
        songList.forEach((s) => s.genres?.forEach((g) => genreSet.add(g)));
        setGenres([...genreSet].sort());
        useStatusStore.getState().addMessage(
          `Loaded ${songList.length} song${songList.length !== 1 ? "s" : ""} from library`,
          "info", "Library",
        );
      }
    } catch (err) {
      console.error("[local] load error:", err);
      setSongs([]);
    } finally {
      setLoading(false);
    }
  }, [currentOrigin, searchQuery]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reset page on search change
  useEffect(() => { setPage(0); }, [searchQuery]);

  // ── Client-side search filter (for when server returns all songs) ──

  const filteredSongs = useMemo(() => {
    if (!searchQuery) return songs;
    const q = searchQuery.toLowerCase();
    return songs.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.artistName.toLowerCase().includes(q) ||
        (s.albumName && s.albumName.toLowerCase().includes(q))
    );
  }, [songs, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredSongs.length / PAGE_SIZE));
  const displaySongs = filteredSongs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const hasPrev = page > 0;
  const hasNext = page < pageCount - 1;

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

  async function handlePlayAlbum(album: Album) {
    const controller = await getController();
    const albumSongs = await controller.getAlbumSongs(album.albumArtistName, album.name);
    if (albumSongs.length > 0) setQueue(albumSongs, { type: "now" });
  }

  async function handlePlayArtist(artist: AlbumArtist) {
    const controller = await getController();
    const artistSongs = await controller.getArtistSongs(artist.name);
    if (artistSongs.length > 0) setQueue(artistSongs, { type: "now" });
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

  const handleNavArtist = useCallback((song: Song) => handleArtistClick(song), [handleArtistClick]);
  const handleNavAlbum = useCallback((song: Song) => handleAlbumClick(song), [handleAlbumClick]);

  // ── No source selected (neither local origin nor backend server) ──

  if (!currentOrigin && !backendConfig) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Music className="h-12 w-12 text-muted-foreground/50" />
        <p className="mt-2 text-muted-foreground">Select an origin or connect a server to browse your music.</p>
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
          Browsing: {currentOrigin?.name ?? (backendConfig ? "Selftify Server" : "Unknown")} ({currentOrigin?.type ?? "server"})
          {localStats.songs > 0 && (
            <>
              {" \u00b7 "}{localStats.songs} songs{" \u00b7 "}{localStats.artists} artists{" \u00b7 "}{localStats.albums} albums
            </>
          )}
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !showSongs && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">No songs found. Run a scan in Settings &gt; Server to populate your library.</p>
        </div>
      )}

      {/* Song list */}
      {showSongs && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-4">
            <TabsList className="h-9">
              <TabsTrigger value="songs" className="gap-1 text-xs">
                <List className="h-3 w-3" /> Songs
              </TabsTrigger>
              <TabsTrigger value="artists" className="gap-1 text-xs">
                <Users className="h-3 w-3" /> Artists
              </TabsTrigger>
              <TabsTrigger value="albums" className="gap-1 text-xs">
                <Disc className="h-3 w-3" /> Albums
              </TabsTrigger>
              <TabsTrigger value="genres" className="gap-1 text-xs">
                <Tags className="h-3 w-3" /> Genres
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

          <TabsContent value="songs" className="flex min-h-0 flex-1 flex-col p-0">
            {/* Pagination bar */}
              {displaySongs.length > 0 && (
              <div className="flex items-center justify-between border-b px-4 py-1.5">
                <p className="text-xs text-muted-foreground">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredSongs.length)} of {filteredSongs.length}
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
                    {page + 1}/{pageCount}
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
              <DataTable
                data={displaySongs}
                columns={[
                  ...songColumns({
                    onNavigateArtist: handleNavArtist,
                    onNavigateAlbum: handleNavAlbum,
                  }),
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
                ]}
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
            </div>
          </TabsContent>

          <TabsContent value="artists" className="flex-1 p-0">
              <ScrollArea className="h-full">
                {artists.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-sm text-muted-foreground">No artists found in your library.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 uw:grid-cols-7">
                    {artists.map((artist) => (
                      <div
                        key={artist.id}
                        className="group cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent/50"
                        onClick={() => onNavigateArtist?.(artist)}
                      >
                        <div className="relative mb-2">
                          <CoverImage
                            src={artist.imageUrl}
                            alt={artist.name}
                            fallback={artist.name.charAt(0).toUpperCase()}
                            className="aspect-square w-full rounded-lg"
                          />
                          <Button
                            size="icon"
                            className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-primary shadow-lg opacity-0 transition-all group-hover:opacity-100 group-hover:translate-y-0 translate-y-2 hover:scale-105 hover:bg-primary/90"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayArtist(artist);
                            }}
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                          </Button>
                        </div>
                        <p className="truncate text-sm font-medium">{artist.name}</p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          <TabsContent value="albums" className="flex-1 p-0">
              <ScrollArea className="h-full">
                {albums.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-sm text-muted-foreground">No albums found in your library.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 uw:grid-cols-7">
                    {albums.map((album) => (
                      <div
                        key={album.id}
                        className="group cursor-pointer"
                        onClick={() => onNavigateAlbum?.(album)}
                      >
                        <div className="relative">
                          <ArtImage
                            src={album.imageUrl}
                            alt={album.name}
                            fallback={album.name.charAt(0).toUpperCase()}
                            emptySvg={<AlbumEmptySvg />}
                            className="aspect-square w-full rounded-[5px] h-auto"
                          />
                          {album.songCount != null && album.songCount > 0 && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/30 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100 pointer-events-none">
                              <span className="text-xs font-medium text-white drop-shadow">
                                {album.songCount} {album.songCount === 1 ? "song" : "songs"}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="px-0.5 pt-2">
                          <p className="truncate text-sm font-medium">{album.name}</p>
                          <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            {album.releaseYear && <span>{album.releaseYear}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          <TabsContent value="genres" className="flex-1 p-0">
            <ScrollArea className="h-full">
              {genres.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">No genres found in your library.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 uw:grid-cols-7">
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
        </Tabs>
      )}

      {/* Context Menu */}
      {contextMenuSong && (
      <ContextMenuOverlay open x={contextMenuPos.x} y={contextMenuPos.y} onClose={() => setContextMenuSong(null)}>
        <DropdownMenuItem onClick={() => { addToQueue?.([contextMenuSong], { type: "now" }); setContextMenuSong(null); }}>
          <span className="text-sm">▶ Play</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { addToQueue?.([contextMenuSong], { type: "next" }); setContextMenuSong(null); }}>
          <span className="text-sm">⏭ Play Next</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { setAddToPlaylistSong(contextMenuSong); setContextMenuSong(null); }}>
          <span className="text-sm">📋 Add to Playlist</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={async () => {
            const origin = origins.find((o) => o.id === contextMenuSong.originId);
            if (origin && contextMenuSong.path) {
              const ok = await moveSongToTrash(contextMenuSong.path, origin);
              if (ok) setSongs((prev) => prev.filter((s) => s.id !== contextMenuSong.id));
            }
            setContextMenuSong(null);
          }}
        >
          <Trash2 className="h-3.5 w-3.5 mr-2" />
          <span className="text-sm">Delete</span>
        </DropdownMenuItem>
      </ContextMenuOverlay>
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
