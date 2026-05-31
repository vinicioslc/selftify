import { useState, useEffect, useMemo } from "react";
import { getController, type SearchResults } from "../../api/controller";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useStatusStore } from "../../stores/status.store";
import { Song, Album, AlbumArtist, OriginType } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardDescription, CardTitle } from "../../components/ui/card";
import { Avatar } from "../../components/ui/avatar";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";
import { Search, Play, Plus, Loader2, FolderOpen, Globe } from "lucide-react";
import { downloadAndGetPath, getStreamUrl } from "../../services/youtube-download-service";
import { searchYouTubePure } from "../../services/youtube-pure-search";
import { fetchCoverArt, tagImageSource, clearImageQueue } from "../../services/image-fetch";
import { fetchArtistImage } from "../../services/artist-image";
import { DataTable, type ColumnDef } from "../shared/data-table";
import { cn, formatDuration } from "../../lib/utils";

type SearchMode = "local" | "musicbrainz" | "youtube-pure";

interface SearchPageProps {
  initialQuery?: string;
  initialMode?: SearchMode;
  onSearchStateChange?: (state: { query: string; mode: SearchMode }) => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}

export function SearchPage({ initialQuery, initialMode, onSearchStateChange, onNavigateAlbum, onNavigateArtist }: SearchPageProps) {
  const { currentOrigin } = useAuthStore();
  const { setQueue } = usePlayerStore();
  const [query, setQuery] = useState(initialQuery || "");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>(
    initialMode || (currentOrigin?.enableOnlineSearch ? "musicbrainz" : "local"),
  );
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [hasAutoSearched, setHasAutoSearched] = useState(false);
  const [loadingCovers, setLoadingCovers] = useState<Set<string>>(new Set());
  const [loadingSongCovers, setLoadingSongCovers] = useState<Set<string>>(new Set());

  const [ytPureOffset, setYtPureOffset] = useState(0);
  const [ytPureHasMore, setYtPureHasMore] = useState(false);
  const [ytPureLoadingMore, setYtPureLoadingMore] = useState(false);

  const hasOnlineSearch = currentOrigin?.enableOnlineSearch ?? false;

  // Sync state changes to parent (for URL/history)
  useEffect(() => {
    onSearchStateChange?.({ query, mode: searchMode });
  }, [query, searchMode, onSearchStateChange]);

  // Auto-search on mount if initialQuery is set (back/forward navigation)
  useEffect(() => {
    if (initialQuery && !hasAutoSearched) {
      setHasAutoSearched(true);
      handleSearchInternal(initialQuery, initialMode || searchMode);
    }
  }, []);

  async function searchMusicBrainz(q: string, limit = 10): Promise<SearchResults> {
    try {
      const { searchRecordings, searchReleases, searchArtists } = await import("../../services/musicbrainz-client");
      const [rr, relR, arR] = await Promise.all([
        searchRecordings("", "", { rawQuery: q, limit }),
        searchReleases("", "", { rawQuery: q, limit: Math.min(limit, 5) }),
        searchArtists("", { rawQuery: q, limit: Math.min(limit, 5) }),
      ]);
      const songs: Song[] = (rr.recordings ?? []).map((r) => ({
        id: `mbz-rec-${r.id}`,
        originId: currentOrigin?.id || "",
        originType: OriginType.LOCAL,
        name: r.title,
        artistName: r["artist-credit"]?.[0]?.name || "Unknown Artist",
        albumName: r.releases?.[0]?.title || undefined,
        duration: r.length ? Math.round(r.length / 1000) : null,
        imageUrl: null,
        mbzRecordingId: r.id,
        mbzArtistId: r["artist-credit"]?.[0]?.artist?.id,
      }));
      const albums: Album[] = (relR.releases ?? [])
        .filter((rel) => rel["cover-art-archive"]?.front === true)
        .map((rel) => ({
          id: `mbz-rel-${rel.id}`,
          originId: currentOrigin?.id || "",
          originType: OriginType.LOCAL,
          name: rel.title,
          albumArtistName: rel["artist-credit"]?.[0]?.name || "Unknown Artist",
          releaseYear: rel.date ? parseInt(rel.date.slice(0, 4), 10) : undefined,
          imageUrl: null,
          mbzId: rel.id,
          mbzReleaseGroupId: rel["release-group"]?.id,
        }));
      // Start background cover art fetches for albums
      const loadingIds = new Set(albums.map((a) => a.id));
      setLoadingCovers(loadingIds);
      setLoadingSongCovers(new Set());
      for (const album of albums) {
        if (album.mbzReleaseGroupId) {
          const coverUrl = `https://coverartarchive.org/release-group/${album.mbzReleaseGroupId}/front-250.jpg`;
          fetchCoverArt(album.mbzReleaseGroupId, "release-group")
            .then((url) => {
              setResults((prev) => {
                if (!prev) return prev;
                const updatedArtists = prev.albumArtists.map((a) =>
                  !a.imageUrl && a.name === album.albumArtistName && url
                    ? { ...a, imageUrl: url }
                    : a,
                );
                return {
                  ...prev,
                  albums: prev.albums.map((a) =>
                    a.id === album.id ? { ...a, imageUrl: url } : a,
                  ),
                  albumArtists: updatedArtists,
                };
              });
              setLoadingCovers((prev) => {
                const next = new Set(prev);
                next.delete(album.id);
                return next;
              });
            })
            .catch(() => {});
          tagImageSource(coverUrl, {
            artistName: album.albumArtistName,
            albumName: album.name,
            mbzReleaseGroupId: album.mbzReleaseGroupId,
            mbzReleaseId: album.mbzId,
          });
        } else {
          // No release group ID — nothing to fetch, clear loading immediately
          setLoadingCovers((prev) => {
            const next = new Set(prev);
            next.delete(album.id);
            return next;
          });
        }
      }
      // Start background cover art fetches for songs (group by release group ID)
      const rgToSongIds = new Map<string, string[]>();
      for (const r of rr.recordings ?? []) {
        const rgId = r.releases?.[0]?.["release-group"]?.id;
        if (rgId) {
          const ids = rgToSongIds.get(rgId) || [];
          ids.push(`mbz-rec-${r.id}`);
          rgToSongIds.set(rgId, ids);
        }
      }
      const songLoadingIds = new Set<string>();
      for (const ids of rgToSongIds.values()) {
        for (const id of ids) songLoadingIds.add(id);
      }
      if (songLoadingIds.size > 0) setLoadingSongCovers(songLoadingIds);
      for (const [rgId, songIds] of rgToSongIds) {
        const coverUrl = `https://coverartarchive.org/release-group/${rgId}/front-250.jpg`;
        fetchCoverArt(rgId, "release-group")
          .then((url) => {
            setResults((prev) => {
              if (!prev) return prev;
              const idSet = new Set(songIds);
              const firstSong = prev.songs.find((s) => idSet.has(s.id));
              if (firstSong) {
                tagImageSource(coverUrl, {
                  artistName: firstSong.artistName,
                  albumName: firstSong.albumName,
                });
              }
              return {
                ...prev,
                songs: prev.songs.map((s) =>
                  idSet.has(s.id) && url ? { ...s, imageUrl: url } : s,
                ),
              };
            });
            setLoadingSongCovers((prev) => {
              const next = new Set(prev);
              for (const id of songIds) next.delete(id);
              return next;
            });
          })
          .catch(() => {});
      }
      const albumArtists: AlbumArtist[] = (arR.artists ?? []).map((a) => ({
        id: `mbz-art-${a.id}`,
        originId: currentOrigin?.id || "",
        originType: OriginType.LOCAL,
        name: a.name,
        imageUrl: null,
        mbz: a.id,
      }));
      // Start background artist image fetches — only for artists without an album cover
      for (const artist of albumArtists) {
        fetchArtistImage(artist.name, artist.mbz || undefined)
          .then((url) => {
            if (!url) return;
            setResults((prev) => {
              if (!prev) return prev;
              // Only set Wikipedia image if artist still has no image (no album cover took priority)
              return {
                ...prev,
                albumArtists: prev.albumArtists.map((a) =>
                  a.id === artist.id && !a.imageUrl ? { ...a, imageUrl: url } : a,
                ),
              };
            });
          })
          .catch(() => {});
      }
      return { songs, albums, albumArtists };
    } catch (err) {
      console.error("MusicBrainz search error:", err);
      return { songs: [], albums: [], albumArtists: [] };
    }
  }

  async function handleSearchInternal(q: string, mode: SearchMode) {
    if (!q.trim() || !currentOrigin) return;
    const addMsg = useStatusStore.getState().addMessage;
    if (mode === "local") addMsg("Searching local files...", "info", "Search");
    else addMsg(`Searching ${mode === "musicbrainz" ? "MusicBrainz" : "YouTube Pure"}...`, "info", "Search");
    setLoading(true);
    setSearchError(null);
    setLoadingCovers(new Set());
    setLoadingSongCovers(new Set());
    setYtPureOffset(0);
    setYtPureHasMore(false);
    setYtPureLoadingMore(false);
    try {
      let searchResults: SearchResults | null = null;
      if (mode === "musicbrainz") {
        searchResults = await searchMusicBrainz(q, 20);
        setResults(searchResults);
      } else if (mode === "youtube-pure") {
        const res = await searchYouTubePure(q, 0, currentOrigin?.youtubeMusicHeaders);
        searchResults = { songs: res.songs, albums: res.albums, albumArtists: res.albumArtists };
        setResults(searchResults);
        setYtPureHasMore(res.hasMore);
        setYtPureOffset(20);
      } else {
        searchResults = await (await getController()).search(q, 20);
        setResults(searchResults);
      }
      const total = searchResults?.songs.length ?? 0;
      if (mode === "local") addMsg(`Found ${total} song${total !== 1 ? "s" : ""} in local files`, total > 0 ? "success" : "info", "Search");
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
    if (!query.trim() || ytPureLoadingMore || !ytPureHasMore) return;
    setYtPureLoadingMore(true);
    try {
      const res = await searchYouTubePure(query, ytPureOffset, currentOrigin?.youtubeMusicHeaders);
      setResults((prev) => {
        if (!prev) return prev;
        return {
          songs: [...prev.songs, ...res.songs],
          albums: [...prev.albums, ...res.albums],
          albumArtists: [...prev.albumArtists, ...res.albumArtists],
        };
      });
      setYtPureHasMore(res.hasMore);
      setYtPureOffset((prev) => prev + 20);
    } catch (err) {
      console.error("Load more error:", err);
    } finally {
      setYtPureLoadingMore(false);
    }
  }

  function getElectronYt() {
    if (typeof window !== "undefined" && (window as any).electronApi?.yt) {
      return (window as any).electronApi.yt as { getStreamUrl: (videoId: string) => Promise<string | null> };
    }
    return null;
  }

  async function playSong(song: Song) {
    if ((searchMode === "musicbrainz" || searchMode === "youtube-pure") && currentOrigin?.enableOnlineSearch) {
      setDownloadingId(song.id);
      try {
        if (searchMode === "youtube-pure" && song.id.startsWith("ytpure-")) {
          const videoId = song.id.slice(7);
          const yt = getElectronYt();
          if (yt) {
            try {
              const streamUrl = await yt.getStreamUrl(videoId);
              if (streamUrl) {
                setQueue([{ ...song, path: streamUrl }], { type: "now" });
                return;
              }
              console.warn("[play] yt:stream-url returned null for", videoId);
            } catch (e) {
              console.error("[play] yt:stream-url error:", e);
            }
          }
        }
        const streamUrl = await getStreamUrl(song);
        if (streamUrl) {
          setQueue([{ ...song, path: streamUrl }], { type: "now" });
          return;
        }
        console.warn("[play] getStreamUrl returned null, trying download");
        const downloadFolder = currentOrigin.downloadFolder || currentOrigin.folderPath || "";
        if (downloadFolder) {
          const filePath = await downloadAndGetPath(song, downloadFolder);
          if (filePath) {
            setQueue([{ ...song, path: filePath }], { type: "now" });
            return;
          }
        }
        console.warn("[play] all sources failed, queueing without path");
        setQueue([song], { type: "now" });
      } finally {
        setDownloadingId(null);
      }
    } else {
      setQueue([song], { type: "now" });
    }
  }

  async function playAll() {
    if (!results?.songs.length) return;
    if ((searchMode === "musicbrainz" || searchMode === "youtube-pure") && currentOrigin?.enableOnlineSearch) {
      setDownloadingId("__all__");
      try {
        const songs = await resolveStreamUrls(results.songs);
        setQueue(songs, { type: "now" });
      } finally {
        setDownloadingId(null);
      }
    } else {
      setQueue(results.songs, { type: "now" });
    }
  }

  async function resolveStreamUrls(songs: Song[]): Promise<Song[]> {
    const resolved: Song[] = [];
    for (const song of songs) {
      const streamUrl = await getStreamUrl(song);
      resolved.push(streamUrl ? { ...song, path: streamUrl } : song);
    }
    return resolved;
  }

  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);

  const songColumns = useMemo(
    (): ColumnDef<Song>[] => [
      {
        id: "cover",
        label: "",
        width: "2.5rem",
        sortable: false,
        render: (song) => (
          <div className="relative">
            <Avatar
              src={song.imageUrl}
              alt={song.name}
              fallback={song.name.charAt(0)}
              className="h-8 w-8 rounded"
            />
            {loadingSongCovers.has(song.id) && (
              <div className="absolute inset-0 flex items-center justify-center rounded bg-muted/60">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
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
    ],
    [onNavigateAlbum, onNavigateArtist, loadingSongCovers, downloadingId],
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
              <Globe className="h-3 w-3" /> MusicBrainz
            </Button>
            <Button
              variant={searchMode === "youtube-pure" ? "default" : "outline"}
              size="sm"
              className="gap-1"
              onClick={() => {
                setSearchMode("youtube-pure");
                if (query.trim()) handleSearchInternal(query, "youtube-pure");
              }}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg> YouTube Pure
            </Button>
          </div>
        )}
        {searchMode === "musicbrainz" && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Searching MusicBrainz. Click play to download from YouTube.
          </p>
        )}
        {searchMode === "youtube-pure" && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Searching YouTube directly for title, uploader, and thumbnail.
          </p>
        )}
        {searchMode === "local" && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Searching local files.
          </p>
        )}
      </div>

      <ScrollArea className="flex-1">
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

        {currentOrigin && !results && !loading && !searchError && (
          <div className="flex h-full items-center justify-center p-8">
            <p className="text-center text-sm text-muted-foreground">
              {searchMode === "musicbrainz"
                ? "Search MusicBrainz for songs, albums, and artists"
                : searchMode === "youtube-pure"
                  ? "Search YouTube for songs, albums, and artists"
                  : "Search your local files"}
            </p>
          </div>
        )}

        {results && (
          <div className="mx-auto max-w-4xl space-y-6 p-6">
            {results.songs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Songs</h2>
                  <Button variant="outline" size="sm" onClick={playAll}>
                    Play All
                  </Button>
                </div>
                <DataTable
                  data={results.songs}
                  columns={songColumns}
                  getRowId={(s) => s.id}
                  selectedId={selectedSongId}
                  onSelectedIdChange={setSelectedSongId}
                  onRowDoubleClick={playSong}
                  storageKey="search-songs"
                />
              </section>
            )}

            {searchMode === "youtube-pure" && ytPureHasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={ytPureLoadingMore}
                >
                  {ytPureLoadingMore ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : null}
                  Load More
                </Button>
              </div>
            )}

            {results.albums.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Albums</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {results.albums.map((album) => (
                    <Card
                      key={album.id}
                      className="cursor-pointer overflow-hidden transition-colors hover:bg-accent/50"
                      onClick={() => onNavigateAlbum?.(album)}
                    >
                      <CardContent className="p-0">
                        <div className="relative">
                          <Avatar
                            src={album.imageUrl}
                            alt={album.name}
                            fallback={album.name.charAt(0)}
                            className="h-32 w-full rounded-none md:h-40"
                          />
                          {loadingCovers.has(album.id) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
                              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                          )}
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

            {results.albumArtists.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Artists</h2>
                <div className="flex flex-wrap gap-4">
                  {results.albumArtists.map((artist) => (
                    <div
                      key={artist.id}
                      className="flex cursor-pointer flex-col items-center gap-2 transition-opacity hover:opacity-80"
                      onClick={() => onNavigateArtist?.(artist)}
                    >
                      <Avatar
                        src={artist.imageUrl}
                        alt={artist.name}
                        fallback={artist.name.charAt(0)}
                        className="h-20 w-20 rounded-md"
                      />
                      <p className="max-w-20 truncate text-center text-xs font-medium">{artist.name}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {results.songs.length === 0 && results.albums.length === 0 && results.albumArtists.length === 0 && (
              <div className="flex h-full items-center justify-center py-20">
                <p className="text-muted-foreground">No results found</p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
