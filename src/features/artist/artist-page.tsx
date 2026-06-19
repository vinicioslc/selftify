import { useState, useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { OriginType, type AlbumArtist, type Album } from "../../types/domain-types";
import type { MusicBrainzContext } from "../../services/musicbrainz-types";
import { getController } from "../../api/controller";
import { CoverImage, ArtImage } from "../../components/ui/art-image";
import { ImageOverlay } from "../../components/ui/image-overlay";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { ScrollArea } from "../../components/ui/scroll-area";

import { Play, Shuffle, Loader2, MoreHorizontal, RefreshCw } from "lucide-react";
import { RotatingBlurBackground } from "../shared/rotating-blur-background";
import { fetchAlbumCover } from "../../services/image-fetch";
import { fetchArtistImage } from "../../services/artist-image";
import { AlbumEmptySvg, ArtistEmptySvg, SongEmptySvg } from "../../components/ui/empty-image-svg";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { ArtistImageManager } from "./artist-image-manager";
import { CachedBadge } from "../../components/ui/cached-badge";

interface ArtistPageProps {
  artist: AlbumArtist;
  onBack: () => void;
  onNavigateAlbum: (album: Album) => void;
}

type ArtistAlbum = {
  id: string;
  name: string;
  imageUrl: string | null;
  releaseYear?: number;
  hasLocal: boolean;
  primaryType?: string;
  localSongCount: number;
};

function fetchAndSetCover(
  albumId: string,
  artistName: string,
  albumName: string,
  setAlbums: React.Dispatch<React.SetStateAction<ArtistAlbum[]>>,
  setLoadingAlbumCovers: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  fetchAlbumCover(albumId, undefined, artistName, albumName)
    .then((url) => {
      setAlbums((prev) =>
        prev.map((a) => (a.id === albumId ? { ...a, imageUrl: url || a.imageUrl } : a)),
      );
      setLoadingAlbumCovers((prev) => {
        const next = new Set(prev);
        next.delete(albumId);
        return next;
      });
    })
    .catch((err) => {
      console.error("[artist-page] fetchAlbumCover failed:", albumId, albumName, err);
      setLoadingAlbumCovers((prev) => {
        const next = new Set(prev);
        next.delete(albumId);
        return next;
      });
    });
}

const PAGE_SIZE = 25;

export function ArtistPage({ artist, onBack, onNavigateAlbum }: ArtistPageProps) {
  const { setQueue } = usePlayerStore();
  const { animationsEnabled } = useSettingsStore();
  const [albums, setAlbums] = useState<ArtistAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [allLoaded, setAllLoaded] = useState(false);
  const [artistImageUrl, setArtistImageUrl] = useState<string | null>(artist.imageUrl);
  const [loadingAlbumCovers, setLoadingAlbumCovers] = useState<Set<string>>(new Set());
  const [localAlbumNames, setLocalAlbumNames] = useState<Set<string>>(new Set());
  const [imageManagerOpen, setImageManagerOpen] = useState(false);
  const [mbzLoading, setMbzLoading] = useState(false);
  const [isArtistCached, setIsArtistCached] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [resolvedMbid, setResolvedMbid] = useState<string | null | undefined>(artist.mbz);
  const localAlbumImagesRef = useRef<Map<string, string>>(new Map());
  const localSongCountsRef = useRef<Map<string, number>>(new Map());
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset resolvedMbid when navigating to a different artist
  useEffect(() => {
    setResolvedMbid(artist.mbz);
    setIsArtistCached(false);
  }, [artist.id]);

  // Fetch artist image if not available
  useEffect(() => {
    if (!artist.imageUrl && artist.name) {
      fetchArtistImage(artist.name, artist.mbz || undefined)
        .then((url) => {
          if (url) {
            console.log(`[artist-page] got artist image URL for "${artist.name}", length=${url.length}, first 50=${url.slice(0, 50)}`);
            setArtistImageUrl(url);
          } else {
            console.warn(`[artist-page] fetchArtistImage returned null for "${artist.name}" — Wikipedia has no image or fetch failed`);
          }
        })
        .catch((err) => {
          console.error("[artist-page] fetchArtistImage failed:", artist.name, err);
        });
    }
  }, [artist.name, artist.mbz, artist.imageUrl]);

  // Check if artist has cached MusicBrainz data; auto-enrich if not
  useEffect(() => {
    if (!artist.name) return;
    let cancelled = false;
    (async () => {
      try {
        const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
        if (!root) return;
        const { initDatabase, isReady } = await import("../../services/db/database");
        const { findArtistByName } = await import("../../services/db/repositories/artist-repo");
        if (!isReady()) await initDatabase(root);
        if (!isReady() || cancelled) return;
        const meta = findArtistByName(artist.name);
        const cached = meta?.enrichedAt != null;
        if (!cancelled) setIsArtistCached(cached);

        if (!cached && !cancelled) {
          const { searchArtists, getArtistDetail } = await import("../../services/musicbrainz-client");
          const { upsertArtist } = await import("../../services/db/repositories/artist-repo");
          const addMsg = useStatusStore.getState().addMessage;

          let mbid = artist.mbz;
          let artistData: any = null;

          if (mbid) {
            artistData = await getArtistDetail(mbid);
          }
          if (!artistData) {
            const searchRes = await searchArtists(artist.name, { limit: 1 });
            if (searchRes?.artists?.length) {
              mbid = searchRes.artists[0].id;
              artistData = await getArtistDetail(mbid);
            }
          }
          if (!artistData || cancelled) {
            if (!cancelled) addMsg(`No MusicBrainz match found for ${artist.name}`, "warn", "MusicBrainz");
            return;
          }

          const existing = findArtistByName(artist.name);
          if (!existing || cancelled) return;

          const upsertMeta: import("../../services/sqlite-db/sqlite-db-types").SqliteDbArtistMeta = {
            $schema: "selftify-artist",
            version: 1,
            name: artist.name,
            sortName: artistData.sortName || existing.sortName || null,
            mbzId: mbid || existing.mbzId || null,
            biography: artistData.biography || artistData.wikipedia?.extract || existing.biography || null,
            genres: artistData.tags ? artistData.tags.map((t: any) => t.name) : existing.genres || [],
            country: artistData.country || existing.country || null,
            type: artistData.type || existing.type || null,
            disambiguation: artistData.disambiguation || existing.disambiguation || null,
            images: existing.images || [],
            updatedAt: Date.now(),
            enrichedAt: Date.now(),
          };
          upsertArtist(upsertMeta);
          if (!cancelled) {
            setIsArtistCached(true);
            if (mbid && mbid !== artist.mbz) setResolvedMbid(mbid);
            addMsg(`MusicBrainz data loaded for ${artist.name}`, "info", "MusicBrainz");
          }
        }
      } catch (err) {
        console.warn("[artist-page] auto-enrich error:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [artist.name, artist.mbz]);

  async function handleClearArtistCache() {
    try {
      const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
      if (!root) return;
      const { initDatabase, isReady } = await import("../../services/db/database");
      const { findArtistByName, upsertArtist } = await import("../../services/db/repositories/artist-repo");
      if (!isReady()) await initDatabase(root);
      if (!isReady()) return;
      const meta = findArtistByName(artist.name);
      if (meta) {
        meta.enrichedAt = null;
        meta.biography = null;
        meta.mbzId = null;
        meta.genres = [];
        meta.country = null;
        meta.type = null;
        meta.updatedAt = Date.now();
        upsertArtist(meta);
      }
      setIsArtistCached(false);
      useStatusStore.getState().addMessage(`MusicBrainz cache cleared for ${artist.name}`, "info", "MusicBrainz");
    } catch {}
  }

  function handleImageSaved(blobUrl: string) {
    if (blobUrl) {
      setArtistImageUrl(blobUrl);
    } else {
      setArtistImageUrl(null);
    }
  }

  async function handleFetchMusicBrainz() {
    const addMsg = useStatusStore.getState().addMessage;
    setMbzLoading(true);
    addMsg(`Fetching MusicBrainz data for ${artist.name}\u2026`, "info", "MusicBrainz");
    try {
      const { searchArtists, getArtistDetail } = await import("../../services/musicbrainz-client");
      const { initDatabase, isReady } = await import("../../services/db/database");
      const { findArtistByName, upsertArtist } = await import("../../services/db/repositories/artist-repo");
      const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
      if (!root) { addMsg("No local library configured", "warn", "MusicBrainz"); return; }
      if (!isReady()) await initDatabase(root);
      if (!isReady()) { addMsg("Database not ready", "warn", "MusicBrainz"); return; }

      let mbid = artist.mbz;
      let artistData = null;

      if (mbid) {
        artistData = await getArtistDetail(mbid);
      }
      if (!artistData) {
        const searchRes = await searchArtists(artist.name, { limit: 1 });
        if (searchRes?.artists?.length && searchRes.artists.length > 0) {
          const found = searchRes.artists[0];
          mbid = found.id;
          artistData = await getArtistDetail(mbid);
        }
      }
      if (!artistData) {
        addMsg(`No MusicBrainz match found for ${artist.name}`, "warn", "MusicBrainz");
        return;
      }

      const existing = findArtistByName(artist.name);
      if (!existing) {
        addMsg(`Artist not found in library for ${artist.name}`, "warn", "MusicBrainz");
        return;
      }

      const meta = {
        $schema: "selftify-artist" as const,
        version: 1 as const,
        name: artist.name,
        sortName: (artistData as any).sortName || existing.sortName || null,
        mbzId: mbid || existing.mbzId || null,
        biography: (artistData as any).biography || ((artistData as any).wikipedia && (artistData as any).wikipedia.extract) || existing.biography || null,
        genres: (artistData as any).tags ? (artistData as any).tags.map((t: any) => t.name) : existing.genres || [],
        country: (artistData as any).country || existing.country || null,
        type: (artistData as any).type || existing.type || null,
        disambiguation: (artistData as any).disambiguation || existing.disambiguation || null,
        images: existing.images || [],
        updatedAt: Date.now(),
        enrichedAt: Date.now(),
      };
      upsertArtist(meta);
      setIsArtistCached(true);
      addMsg(`MusicBrainz data saved for ${artist.name}`, "success", "MusicBrainz");
    } catch (err) {
      console.error("[artist-page] MB fetch error:", err);
      addMsg(`Failed to fetch MusicBrainz data for ${artist.name}`, "danger", "MusicBrainz");
    } finally {
      setMbzLoading(false);
    }
  }

  // Fetch first page of albums
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const controller = await getController();
        const localSongs = await controller.getArtistSongs(artist.name);
        const localNames = new Set<string>();
        const localAlbumImages = new Map<string, string>();
        const localCounts = new Map<string, number>();
        for (const s of localSongs) {
          if (s.albumName) {
            localNames.add(s.albumName);
            localCounts.set(s.albumName, (localCounts.get(s.albumName) || 0) + 1);
            if (s.imageUrl) localAlbumImages.set(s.albumName, s.imageUrl);
          }
        }
        localAlbumImagesRef.current = localAlbumImages;
        localSongCountsRef.current = localCounts;
        if (!cancelled) {
          setLocalAlbumNames(localNames);
          setAlbums([]);
          setOffset(0);
          setAllLoaded(false);
          setTotal(0);
        }

        // Resolve MBZ from SQLite cache (no network)
        let effectiveMbid = resolvedMbid;
        if (!effectiveMbid) {
          try {
            const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
            if (root) {
              const { initDatabase, isReady } = await import("../../services/db/database");
              const { findArtistByName } = await import("../../services/db/repositories/artist-repo");
              if (!isReady()) await initDatabase(root);
              if (isReady()) {
                const dbArtist = findArtistByName(artist.name);
                if (dbArtist?.mbzId) effectiveMbid = dbArtist.mbzId;
              }
            }
          } catch {
            // fall through
          }
        }

        if (!effectiveMbid) {
          if (!cancelled) {
            const localAlbums: ArtistAlbum[] = [];
            const grouped = new Map<string, ArtistAlbum>();
            for (const s of localSongs) {
              const key = s.albumName || "(No Album)";
              if (!grouped.has(key)) {
                grouped.set(key, {
                  id: `local-${key}`,
                  name: key,
                  imageUrl: s.imageUrl,
                  hasLocal: true,
                  localSongCount: localCounts.get(key) || 0,
                });
              }
            }
            localAlbums.push(...grouped.values());
            setAlbums(localAlbums);
          }
          return;
        }

        const { getArtistReleaseGroups } = await import("../../services/musicbrainz-client");
        const mbCtx: MusicBrainzContext | undefined = effectiveMbid
          ? { artistName: artist.name, artistMbid: effectiveMbid }
          : undefined;
        const result = await getArtistReleaseGroups(effectiveMbid, PAGE_SIZE, 0, mbCtx);
        if (cancelled) return;
        setTotal(result.total);
        if (result.groups.length < PAGE_SIZE) setAllLoaded(true);

        const mapped = result.groups.map((rg) => {
          const releaseYear = rg["first-release-date"]
            ? parseInt(rg["first-release-date"].slice(0, 4), 10)
            : undefined;
          const localImage = rg.title ? localAlbumImages.get(rg.title) ?? null : null;
          return {
            id: rg.id || `rg-${rg.title}`,
            name: rg.title,
            imageUrl: localImage,
            releaseYear,
            hasLocal: localNames.has(rg.title),
            primaryType: rg["primary-type"],
            localSongCount: rg.title ? localCounts.get(rg.title) || 0 : 0,
          };
        });
        mapped.sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
        setAlbums(mapped);
        setOffset(PAGE_SIZE);

        // Fetch remote cover art only for albums without local images
        const needsCover = mapped.filter((a) => !a.imageUrl && a.id);
        const loadingIds = new Set(needsCover.map((a) => a.id));
        setLoadingAlbumCovers(loadingIds);

        for (const album of needsCover) {
          const albumId = album.id;
          fetchAndSetCover(albumId, artist.name, album.name, setAlbums, setLoadingAlbumCovers);
        }
      } catch (err) {
        console.warn("[artist-page] fetch artist albums error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artist, resolvedMbid]);

  async function loadMore() {
    if (loadingMore || allLoaded || !resolvedMbid) return;
    setLoadingMore(true);
    try {
      const { getArtistReleaseGroups } = await import("../../services/musicbrainz-client");
      const mbCtx: MusicBrainzContext | undefined = resolvedMbid
        ? { artistName: artist.name, artistMbid: resolvedMbid }
        : undefined;
      const result = await getArtistReleaseGroups(resolvedMbid, PAGE_SIZE, offset, mbCtx);
      if (result.groups.length < PAGE_SIZE) setAllLoaded(true);

      const newAlbums = result.groups.map((rg) => {
        const releaseYear = rg["first-release-date"]
          ? parseInt(rg["first-release-date"].slice(0, 4), 10)
          : undefined;
        const localImage = rg.title ? localAlbumImagesRef.current.get(rg.title) ?? null : null;
        return {
          id: rg.id || `rg-${rg.title}`,
          name: rg.title,
          imageUrl: localImage,
          releaseYear,
          hasLocal: localAlbumNames.has(rg.title),
          primaryType: rg["primary-type"],
          localSongCount: rg.title ? localSongCountsRef.current.get(rg.title) || 0 : 0,
        };
      });

      setAlbums((prev) => {
        const combined = [...prev, ...newAlbums];
        combined.sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
        return combined;
      });
      setOffset((prev) => prev + PAGE_SIZE);

      // Fetch cover art only for albums without local images
      const needsCover = newAlbums.filter((a) => !a.imageUrl && a.id);
      setLoadingAlbumCovers((prev) => new Set([...prev, ...needsCover.map((a) => a.id)]));

      for (const album of needsCover) {
        const albumId = album.id;
        fetchAndSetCover(albumId, artist.name, album.name, setAlbums, setLoadingAlbumCovers);
      }
    } catch (err) {
      console.warn("[artist-page] loadMore error:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  // Infinite scroll observer
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || allLoaded || !resolvedMbid) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [allLoaded, loadingMore, resolvedMbid]);

  function albumToAlbumObj(a: ArtistAlbum): Album {
    return {
      id: a.id,
      originId: artist.originId,
      originType: artist.originType,
      name: a.name,
      albumArtistName: artist.name,
      imageUrl: a.imageUrl,
      mbzReleaseGroupId: a.id,
      releaseYear: a.releaseYear,
    };
  }

  function renderAlbumSection(title: string, items: ArtistAlbum[]) {
    if (items.length === 0) return null;
    return (
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-foreground">{title}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((album) => (
            <div
              key={album.id}
              className={cn(
                "group cursor-pointer",
                !album.hasLocal && "opacity-60 transition-opacity hover:opacity-100",
              )}
              onClick={() => onNavigateAlbum(albumToAlbumObj(album))}
            >
              <div className="relative">
                <ArtImage
                  src={album.imageUrl}
                  alt={album.name}
                  fallback={album.name.charAt(0)}
                  emptySvg={<AlbumEmptySvg />}
                  className="aspect-square w-full rounded-[5px]"
                />
                {!album.hasLocal ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/40 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
                    <span className="text-xs font-medium text-white drop-shadow">
                      No local songs
                    </span>
                  </div>
                ) : album.localSongCount > 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/30 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
                    <span className="text-xs font-medium text-white drop-shadow">
                      {album.localSongCount} {album.localSongCount === 1 ? "song" : "songs"}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="px-0.5 pt-2">
                <p className="truncate text-sm font-medium">{album.name}</p>
                <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  {album.releaseYear && <span>{album.releaseYear}</span>}
                  {!album.hasLocal && (
                    <Badge variant="outline" className="px-1 text-[10px] font-normal">
                      remote
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative overflow-hidden">
        <RotatingBlurBackground
          imageUrl={artistImageUrl}
          isActive={false}
          animationsEnabled={animationsEnabled}
          status={"paused"}
        />
        <div className="relative z-10 flex flex-col gap-6 p-6 md:flex-row md:items-end md:gap-8">
          <div
            className={cn("relative", artistImageUrl && "cursor-zoom-in")}
            onClick={() => artistImageUrl && setImageExpanded(!imageExpanded)}
          >
            <CoverImage
              src={artistImageUrl}
              alt={artist.name}
              fallback={artist.name.charAt(0)}
              emptySvg={<ArtistEmptySvg />}
              className="h-40 w-40 shrink-0 shadow-lg md:h-48 md:w-48"
            />
            {imageExpanded && artistImageUrl && (
              <ImageOverlay src={artistImageUrl} alt={artist.name} onClose={() => setImageExpanded(false)} />
            )}
          </div>
          <div className="flex flex-col justify-end gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Artist</p>
              <div className="flex items-center gap-2">
                <h1 className="mt-1 text-3xl font-bold text-foreground">{artist.name}</h1>
                <CachedBadge visible={isArtistCached} onClear={handleClearArtistCache} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[180px]">
                    <DropdownMenuItem onClick={() => setImageManagerOpen(true)}>
                      <span className="text-sm">🖼 Manage Artist Image</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleFetchMusicBrainz} disabled={mbzLoading}>
                      <RefreshCw className={`mr-2 h-4 w-4 ${mbzLoading ? "animate-spin" : ""}`} />
                      <span className="text-sm">Fetch MusicBrainz</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                {(() => {
                  const albumCount = albums.filter((a) => !a.primaryType || a.primaryType === "Album").length;
                  const singleCount = albums.filter((a) => a.primaryType === "Single" || a.primaryType === "EP").length;
                  const parts: string[] = [];
                  if (albumCount) parts.push(`${albumCount} ${albumCount === 1 ? "album" : "albums"}`);
                  if (singleCount) parts.push(`${singleCount} ${singleCount === 1 ? "single" : "singles"}`);
                  return parts.join(" · ") || `${albums.length} releases`;
                })()}
              </span>
            </div>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading albums...</p>
          </div>
        ) : albums.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No albums found for this artist.</p>
          </div>
        ) : (
          <>
            {renderAlbumSection("Albums", albums.filter((a) => !a.primaryType || a.primaryType === "Album"))}
            {renderAlbumSection("Singles & EPs", albums.filter((a) => a.primaryType === "Single" || a.primaryType === "EP"))}
            {loadingMore && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!allLoaded && resolvedMbid && <div ref={sentinelRef} className="h-1" />}
          </>
        )}
      </ScrollArea>

      <ArtistImageManager
        open={imageManagerOpen}
        onOpenChange={setImageManagerOpen}
        artist={artist}
        currentImageUrl={artistImageUrl}
        onImageSaved={handleImageSaved}
      />
    </div>
  );
}
