import { useState, useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useSettingsStore } from "../../stores/settings.store";
import { OriginType, type AlbumArtist, type Album } from "../../types/domain-types";
import { getController } from "../../api/controller";
import { Avatar } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { ScrollArea } from "../../components/ui/scroll-area";

import { Play, Shuffle, ArrowLeft, Loader2 } from "lucide-react";
import { RotatingBlurBackground } from "../shared/rotating-blur-background";
import { fetchCoverArt, tagImageSource } from "../../services/image-fetch";
import { fetchArtistImage } from "../../services/artist-image";

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
};

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
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Fetch artist image if not available
  useEffect(() => {
    if (!artist.imageUrl && artist.name) {
      fetchArtistImage(artist.name, artist.mbz || undefined)
        .then((url) => {
          if (url) setArtistImageUrl(url);
        })
        .catch(() => {});
    }
  }, [artist.name, artist.mbz, artist.imageUrl]);

  // Fetch first page of albums
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const controller = await getController();
        const localSongs = await controller.getArtistSongs(artist.name);
        const localNames = new Set<string>();
        for (const s of localSongs) {
          if (s.albumName) localNames.add(s.albumName);
        }
        if (!cancelled) {
          setLocalAlbumNames(localNames);
          setAlbums([]);
          setOffset(0);
          setAllLoaded(false);
          setTotal(0);
        }

        if (!artist.mbz) {
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
                });
              }
            }
            localAlbums.push(...grouped.values());
            setAlbums(localAlbums);
          }
          return;
        }

        const { getArtistReleaseGroups } = await import("../../services/musicbrainz-client");
        const result = await getArtistReleaseGroups(artist.mbz, PAGE_SIZE, 0);
        if (cancelled) return;
        setTotal(result.total);
        if (result.groups.length < PAGE_SIZE) setAllLoaded(true);

        const mapped = result.groups.map((rg) => {
          const releaseYear = rg["first-release-date"]
            ? parseInt(rg["first-release-date"].slice(0, 4), 10)
            : undefined;
          return {
            id: rg.id || `rg-${rg.title}`,
            name: rg.title,
            imageUrl: null as string | null,
            releaseYear,
            hasLocal: localNames.has(rg.title),
            primaryType: rg["primary-type"],
          };
        });
        mapped.sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
        setAlbums(mapped);
        setOffset(PAGE_SIZE);

        // Fetch cover art in background for all albums
        const loadingIds = new Set(mapped.map((a) => a.id));
        setLoadingAlbumCovers(loadingIds);

        for (const album of mapped) {
          if (!album.id) continue;
          fetchCoverArt(album.id, "release-group").then((url) => {
            setAlbums((prev) =>
              prev.map((a) => (a.id === album.id ? { ...a, imageUrl: url } : a)),
            );
            setLoadingAlbumCovers((prev) => {
              const next = new Set(prev);
              next.delete(album.id);
              return next;
            });
          });
          tagImageSource(`https://coverartarchive.org/release-group/${album.id}/front-250.jpg`, {
            artistName: artist.name,
            albumName: album.name,
            mbzArtistId: artist.mbz || undefined,
            mbzReleaseGroupId: album.id,
          });
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artist]);

  async function loadMore() {
    if (loadingMore || allLoaded || !artist.mbz) return;
    setLoadingMore(true);
    try {
      const { getArtistReleaseGroups } = await import("../../services/musicbrainz-client");
      const result = await getArtistReleaseGroups(artist.mbz, PAGE_SIZE, offset);
      if (result.groups.length < PAGE_SIZE) setAllLoaded(true);

      const newAlbums = result.groups.map((rg) => {
        const releaseYear = rg["first-release-date"]
          ? parseInt(rg["first-release-date"].slice(0, 4), 10)
          : undefined;
        return {
          id: rg.id || `rg-${rg.title}`,
          name: rg.title,
          imageUrl: null as string | null,
          releaseYear,
          hasLocal: localAlbumNames.has(rg.title),
          primaryType: rg["primary-type"],
        };
      });

      setAlbums((prev) => {
        const combined = [...prev, ...newAlbums];
        combined.sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
        return combined;
      });
      setOffset((prev) => prev + PAGE_SIZE);

      // Fetch cover art for new albums
      const loadingIds = new Set(newAlbums.map((a) => a.id));
      setLoadingAlbumCovers((prev) => new Set([...prev, ...loadingIds]));

      for (const album of newAlbums) {
        if (!album.id) continue;
        fetchCoverArt(album.id, "release-group").then((url) => {
          setAlbums((prev) =>
            prev.map((a) => (a.id === album.id ? { ...a, imageUrl: url } : a)),
          );
          setLoadingAlbumCovers((prev) => {
            const next = new Set(prev);
            next.delete(album.id);
            return next;
          });
        });
        tagImageSource(`https://coverartarchive.org/release-group/${album.id}/front-250.jpg`, {
          artistName: artist.name,
          albumName: album.name,
          mbzArtistId: artist.mbz || undefined,
          mbzReleaseGroupId: album.id,
        });
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }

  // Infinite scroll observer
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || allLoaded || !artist.mbz) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [allLoaded, loadingMore, artist.mbz]);

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
              className="group cursor-pointer"
              onClick={() => onNavigateAlbum(albumToAlbumObj(album))}
            >
              <div className="relative">
                <Avatar
                  src={album.imageUrl}
                  alt={album.name}
                  fallback={album.name.charAt(0)}
                  className="h-44 w-full md:h-52"
                />
                {loadingAlbumCovers.has(album.id) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
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
        <div className="relative z-10 border-b border-border px-4 py-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </div>
        <div className="relative z-10 flex flex-col gap-6 p-6 md:flex-row md:items-end md:gap-8">
          <Avatar
            src={artistImageUrl}
            alt={artist.name}
            fallback={artist.name.charAt(0)}
            className="h-40 w-40 shrink-0 shadow-lg md:h-48 md:w-48"
          />
          <div className="flex flex-col justify-end gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Artist</p>
              <h1 className="mt-1 text-3xl font-bold text-foreground">{artist.name}</h1>
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
            {!allLoaded && artist.mbz && <div ref={sentinelRef} className="h-1" />}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
