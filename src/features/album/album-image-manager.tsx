import { useState, useCallback, useEffect } from "react";
import type { Album } from "../../types/domain-types";
import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { ArtImage } from "../../components/ui/art-image";
import { AlbumEmptySvg } from "../../components/ui/empty-image-svg";
import { Loader2, Search, Save, Trash2, Link, Check, Maximize2 } from "lucide-react";
import { storeImage, md5Hash, findImages, recordToBlobUrl } from "../../services/image-store";
import { platformFetch } from "../../services/platform-fetch";
import { getSongsByAlbum } from "../../api/local/local-queries";
import { artworkResolver } from "../../services/artwork/artwork-resolver";
import { ARTWORK_PROVIDER_META } from "../../services/artwork/providers/meta";
import type { ArtworkCandidate } from "../../services/artwork/providers/types";
import { fetchImageAsBlobUrl } from "../../services/image-fetch";
import { searchWikipedia } from "../../services/wiki-image-search";
import { sanitizeForPath } from "../../services/organizer/sanitizer";
import { invalidateAlbumCaches } from "../../services/invalidate-caches";
import { importFromDotImg, clearDotImgDir } from "../../services/dot-img";

import { joinPaths } from "../../lib/path-utils";
import { cn } from "../../lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  album: Album;
  currentImageUrl: string | null;
  onImageSaved: (blobUrl: string) => void;
};

type SourceType = "wikipedia" | "custom" | string;

function providerLabel(name: string): string {
  return ARTWORK_PROVIDER_META[name]?.label || name;
}

const COVER_SIZE = 1024;

function resizeImageForCover(blob: Blob): Promise<{ arrayBuffer: ArrayBuffer; blob: Blob }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const targetSize = Math.min(COVER_SIZE, side);
      const canvas = document.createElement("canvas");
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas context unavailable")); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);
      canvas.toBlob((resized) => {
        if (!resized) { reject(new Error("Failed to encode resized image")); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ arrayBuffer: reader.result as ArrayBuffer, blob: resized });
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(resized);
      }, "image/jpeg", 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to decode image")); };
    img.src = url;
  });
}

async function saveImageToStoreAndDisk(
  blob: Blob,
  album: Album,
  sourceUrl: string,
): Promise<string | null> {
  let arrayBuffer: ArrayBuffer;
  let resizedBlob: Blob;
  try {
    const resized = await resizeImageForCover(blob);
    arrayBuffer = resized.arrayBuffer;
    resizedBlob = resized.blob;
  } catch {
    return null;
  }

  const hash = await md5Hash(arrayBuffer);

  const record = {
    md5: hash,
    blob: arrayBuffer,
    format: "image/jpeg",
    size: arrayBuffer.byteLength,
    createdAt: Date.now(),
    artistName: album.albumArtistName.toLowerCase().trim(),
    albumName: album.name.toLowerCase().trim(),
    mbzReleaseGroupId: album.mbzReleaseGroupId || undefined,
    mbzReleaseId: album.mbzId || undefined,
    sourceUrl,
  };

  try { await storeImage(record); } catch {}

  const { getPlatformService } = await import("../../services/platform/factory");
  const p = await getPlatformService();
  const { origins, currentOrigin } = useAuthStore.getState();
  const albumOrigin = origins.find((o) => o.id === album.originId) ?? currentOrigin;

  if (albumOrigin?.folderPath) {
    const albumAbsDir = await getAlbumAbsDir(album, albumOrigin.folderPath);
    const filePath = joinPaths(albumAbsDir, ".img", `${hash}.jpg`);

    const exists = await p.fileExists(filePath).catch(() => false);
    if (!exists) {
      await p.createDirectory(joinPaths(albumAbsDir, ".img")).catch(() => {});
      await p.writeFile(filePath, new Uint8Array(arrayBuffer));
    }

    invalidateAlbumCaches(album);

    const api = (window as any).electronApi;
    if (api?.yt?.embedArtwork && p.isElectron) {
      getSongsByAlbum(album.albumArtistName, album.name).then((dbSongs) => {
        const paths = dbSongs.map((s) => s.path).filter(Boolean) as string[];
        Promise.allSettled(paths.map((audioPath) =>
          api.yt.embedArtwork({ audioPath, coverPath: filePath }).catch(() => {}),
        ));
      }).catch(() => {});
    }

    Promise.resolve().then(async () => {
      try {
        const { initDatabase, isReady } = await import("../../services/db/database");
        const { findAlbumByName, upsertAlbum } = await import("../../services/db/repositories/album-repo");
        const { OriginType } = await import("../../types/domain-types");
        const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
        if (root) {
          if (!isReady()) await initDatabase(root).catch(() => {});
          if (isReady()) {
            const existing = findAlbumByName(album.albumArtistName, album.name);
            if (existing) {
              const newImg = { id: hash, url: hash, width: null, height: null, format: "image/jpeg" as const };
              const updated = { ...existing, images: [newImg, ...(existing.images || []).filter((i) => i.id !== hash)], updatedAt: Date.now() };
              upsertAlbum(updated, album.albumArtistName);
            }
          }
        }
      } catch {}
    });
  }

  const blobUrl = URL.createObjectURL(resizedBlob);
  return blobUrl;
}

async function getAlbumAbsDir(album: Album, folderPath: string): Promise<string> {
  try {
    const { getAlbumDir } = await import("../../api/local/local-queries");
    const result = await getAlbumDir(album.albumArtistName, album.name);
    if (result) return result;
  } catch {}
  const base = joinPaths(folderPath, sanitizeForPath(album.albumArtistName), sanitizeForPath(album.name));
  return album.releaseYear ? `${base} (${album.releaseYear})` : base;
}

export function AlbumImageManager({ open, onOpenChange, album, currentImageUrl, onImageSaved }: Props) {
  const localOrigin = useAuthStore((s) => s.origins.find((o) => o.id === album.originId) ?? s.currentOrigin);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("wikipedia");

  const [coverResults, setCoverResults] = useState<Record<string, ArtworkCandidate[]>>({});
  const [coverLoading, setCoverLoading] = useState<Record<string, boolean>>({});
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fullscreenUrl, setFullscreenUrl] = useState<string | null>(null);
  const [candidateDims, setCandidateDims] = useState<Record<string, { w: number; h: number }>>({});

  const reset = useCallback(() => {
    setSearching(false);
    setSaving(false);
    setError(null);
    setCustomUrl("");
    setSourceType("wikipedia");
    setCoverResults({});
    setCoverLoading({});
    setActiveProvider(null);
    setSaved(false);
    setFullscreenUrl(null);
    setCandidateDims({});
  }, []);

  useEffect(() => {
    return () => { setFullscreenUrl(null); };
  }, []);

  async function loadExistingPreview() {
    if (currentImageUrl) {
      setPreviewUrl(currentImageUrl);
      return;
    }

    const albumNameNorm = album.name.toLowerCase().trim();
    const artistNameNorm = album.albumArtistName.toLowerCase().trim();

    // 1. Check image store
    const records = await findImages();
    if (records.length > 0) {
      const blobUrl = await recordToBlobUrl(records[0]);
      if (blobUrl) { setPreviewUrl(blobUrl); return; }
    }

    // 2. Check .img folder on filesystem
    if (localOrigin?.folderPath) {
      try {
        const { getPlatformService } = await import("../../services/platform/factory");
        const p = await getPlatformService();
        const albumAbsDir = await getAlbumAbsDir(album, localOrigin.folderPath);
        const blobUrl = await importFromDotImg(joinPaths(albumAbsDir, ".img"), p, { artistName: artistNameNorm, albumName: albumNameNorm });
        if (blobUrl) setPreviewUrl(blobUrl);
      } catch {
        // .img folder doesn't exist — normal
      }
    }
  }

  useEffect(() => {
    if (!open) return;
    loadExistingPreview();
  }, [open, album.name, album.albumArtistName, currentImageUrl, localOrigin?.folderPath]);

  async function handleFetchProvider(providerName: string) {
    setCoverLoading((prev) => ({ ...prev, [providerName]: true }));
    setError(null);
    console.log(`[album-image-manager] fetching from provider: "${providerName}" album="${album.name}" artist="${album.albumArtistName}"`);
    try {
      const items = await artworkResolver.resolveFromProvider(providerName, {
        artist: album.albumArtistName,
        album: album.name,
        musicbrainzReleaseId: album.mbzId || undefined,
        musicbrainzReleaseGroupId: album.mbzReleaseGroupId || undefined,
      });
      console.log(`[album-image-manager] "${providerName}" resolved ${items.length} candidate(s)`);
      if (items.length === 0) {
        console.warn(`[album-image-manager] "${providerName}" returned no candidates`);
        setError(`No results from ${providerLabel(providerName)}`);
        setCoverResults((prev) => ({ ...prev, [providerName]: [] }));
        return;
      }
      const candidatesWithBlobs = await Promise.all(
        items.map(async (cand) => ({
          ...cand,
          blobUrl: await fetchImageAsBlobUrl(cand.thumbnailUrl || cand.url),
        }))
      );
      setCoverResults((prev) => ({ ...prev, [providerName]: candidatesWithBlobs }));

      // Use provider-provided dimensions (original file), fallback to loading from image
      const dims: Record<string, { w: number; h: number }> = {};
      for (const cand of candidatesWithBlobs) {
        if (cand.width && cand.height) {
          dims[cand.url] = { w: cand.width, h: cand.height };
        } else {
          const url = cand.blobUrl || cand.url;
          if (!url) continue;
          try {
            const img = new Image();
            await new Promise<void>((r) => { img.onload = () => { dims[cand.url] = { w: img.naturalWidth, h: img.naturalHeight }; r(); }; img.onerror = () => r(); img.src = url; });
          } catch { /* ignore */ }
        }
      }
      setCandidateDims((prev) => ({ ...prev, ...dims }));
    } catch (err) {
      console.error(`[album-image-manager] "${providerName}" fetch error:`, err);
      setError(`Failed to search ${providerLabel(providerName)}: ${err instanceof Error ? err.message : "unknown error"}`);
      setCoverResults((prev) => ({ ...prev, [providerName]: [] }));
    } finally {
      setCoverLoading((prev) => ({ ...prev, [providerName]: false }));
    }
  }

  async function handleSelectProviderCandidate(candidate: ArtworkCandidate) {
    setFullscreenUrl(null);
    const addMsg = useStatusStore.getState().addMessage;
    setSaving(true);
    setError(null);
    setActiveProvider(candidate.provider);
    setSourceType(candidate.provider);
    addMsg("Saving cover...", "info", "Cover");
    try {
      const blobUrl = await fetchImageAsBlobUrl(candidate.url);
      if (!blobUrl) { setError("Failed to download image."); setSaving(false); return; }

      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, album, candidate.url);
      if (!savedBlobUrl) throw new Error("saveImageToStoreAndDisk returned null");
      setPreviewUrl(savedBlobUrl);
      setSaved(true);
      onImageSaved(savedBlobUrl);
      addMsg("Cover saved", "success", "Cover");
    } catch (err) {
      console.error("[album-image-manager] provider candidate error:", err);
      setError("Failed to select cover image.");
      addMsg("Failed to save cover", "danger", "Cover");
    } finally {
      setSaving(false);
    }
  }

  async function handleSearchWikipedia() {
    setFullscreenUrl(null);
    const addMsg = useStatusStore.getState().addMessage;
    setSearching(true);
    setError(null);
    addMsg("Saving cover...", "info", "Cover");
    try {
      const query = `${album.name} ${album.albumArtistName}`;
      const sourceUrl = await searchWikipedia(query, "album-image-manager");
      if (!sourceUrl) {
        setError("No image found for this album on Wikipedia.");
        setSearching(false);
        return;
      }
      setSourceType("wikipedia");
      const resp = await platformFetch(sourceUrl, { method: "GET" });
      if (!resp.ok) { setError("Failed to download image."); setSearching(false); return; }
      const blob = await resp.blob();
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, album, sourceUrl);
      if (!savedBlobUrl) throw new Error("saveImageToStoreAndDisk returned null");
      setPreviewUrl(savedBlobUrl);
      setSaved(true);
      onImageSaved(savedBlobUrl);
      addMsg("Cover saved", "success", "Cover");
    } catch (err) {
      setError("Search failed. Try again.");
      console.error("[album-image-manager] wikipedia search error:", err);
      addMsg("Failed to save cover", "danger", "Cover");
    } finally {
      setSearching(false);
    }
  }

  async function handleFetchCustom() {
    if (!customUrl.trim()) return;
    setFullscreenUrl(null);
    const addMsg = useStatusStore.getState().addMessage;
    setSearching(true);
    setError(null);
    addMsg("Saving cover...", "info", "Cover");
    try {
      const resp = await platformFetch(customUrl.trim(), { method: "GET" });
      if (!resp.ok) { setError("Could not fetch image from that URL."); setSearching(false); return; }
      const blob = await resp.blob();
      setSourceType("custom");
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, album, customUrl.trim());
      if (!savedBlobUrl) throw new Error("saveImageToStoreAndDisk returned null");
      setPreviewUrl(savedBlobUrl);
      setSaved(true);
      onImageSaved(savedBlobUrl);
      addMsg("Cover saved", "success", "Cover");
    } catch {
      setError("Failed to fetch image.");
      addMsg("Failed to save cover", "danger", "Cover");
    } finally {
      setSearching(false);
    }
  }

  async function handleSave() {
    if (!previewUrl || saving) return;
    setFullscreenUrl(null);
    const addMsg = useStatusStore.getState().addMessage;
    setSaving(true);
    setError(null);
    addMsg("Saving cover...", "info", "Cover");
    console.log("[Selftify] [album-image-manager] handleSave: previewUrl length", previewUrl.length);
    try {
      const resp = await fetch(previewUrl);
      console.log("[Selftify] [album-image-manager] handleSave: fetch status", resp.status, resp.ok);
      if (!resp.ok) { throw new Error(`fetch preview failed: ${resp.status}`); }
      const blob = await resp.blob();
      console.log("[Selftify] [album-image-manager] handleSave: blob size", blob.size, "type", blob.type);
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, album, previewUrl);
      console.log("[Selftify] [album-image-manager] handleSave: result", savedBlobUrl ? "ok" : "null");
      if (!savedBlobUrl) {
        throw new Error("saveImageToStoreAndDisk returned null");
      }
      setPreviewUrl(savedBlobUrl);
      setSaved(true);
      onImageSaved(savedBlobUrl);
      addMsg("Cover saved", "success", "Cover");
    } catch (err) {
      console.error("[Selftify] [album-image-manager] save error:", err);
      setError("Failed to save image.");
      addMsg("Failed to save cover", "danger", "Cover");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setError(null);
    try {
      const { getPlatformService } = await import("../../services/platform/factory");
      const p = await getPlatformService();
      const { origins, currentOrigin: fallbackOrigin } = useAuthStore.getState();
      const albumOrigin = origins.find((o) => o.id === album.originId) ?? fallbackOrigin;
      if (albumOrigin?.folderPath) {
        const albumAbsDir = await getAlbumAbsDir(album, albumOrigin.folderPath);
        await clearDotImgDir(joinPaths(albumAbsDir, ".img"), p);
      }
      setPreviewUrl(null);
      setSaved(false);
      onImageSaved("");
    } catch (err) {
      console.error("[album-image-manager] remove error:", err);
      setError("Failed to remove image.");
    } finally {
      setSaving(false);
    }
  }

  const providerNames = artworkResolver.getProviderNames();

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Album Cover — {album.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {previewUrl && (
            <div className="relative flex flex-col items-center gap-2">
              <img
                src={previewUrl}
                alt={album.name}
                className="h-48 w-48 cursor-pointer rounded-lg object-cover transition-opacity hover:opacity-90"
                onClick={() => setFullscreenUrl(previewUrl)}
              />
              <button
                className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:opacity-100"
                onClick={() => setFullscreenUrl(previewUrl)}
                title="View full size"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Providers */}
          {!saved && <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Search from providers</p>
            {providerNames.map((name) => {
              const candidates = coverResults[name] || [];
              const loading = coverLoading[name];
              const label = providerLabel(name);
              const hasResults = candidates.length > 0;
              const isActive = activeProvider === name;

              return (
                <div key={name} className={cn("rounded-md border p-2", isActive ? "border-green-500/50 bg-green-500/10" : "border-border/40")}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{label}</span>
                      {hasResults && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{candidates.length} candidate{candidates.length !== 1 ? "s" : ""}</p>}
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] shrink-0" onClick={() => handleFetchProvider(name)} disabled={loading}>
                      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                    </Button>
                  </div>
                  {hasResults && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {candidates.map((cand) => {
                        const dim = candidateDims[cand.url];
                        return (
                        <div key={`${cand.provider}-${cand.url}`} className="relative group">
                          <ArtImage
                            src={cand.blobUrl || cand.url}
                            alt={cand.provider}
                            fallback={cand.provider.charAt(0).toUpperCase()}
                            emptySvg={<AlbumEmptySvg />}
                            className={cn("h-12 w-12 rounded-md cursor-pointer ring-1 ring-transparent transition-all hover:ring-primary/50", isActive && "ring-green-500/50")}
                            onClick={() => handleSelectProviderCandidate(cand)}
                          />
                          {dim && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1 text-[8px] leading-tight text-white">{dim.w}×{dim.h}</span>}
                          <button className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" onClick={() => handleSelectProviderCandidate(cand)} title="Select this cover">✓</button>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>}

          {/* Wikipedia */}
          {!saved && <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Search from Wikipedia</p>
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleSearchWikipedia} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {searching ? "Searching..." : "Search Wikipedia"}
            </Button>
          </div>}

          {/* Custom URL */}
          {!saved && <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Or paste an image URL</p>
            <div className="flex gap-2">
              <input type="text" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://example.com/image.jpg" className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" onKeyDown={(e) => e.key === "Enter" && handleFetchCustom()} />
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={handleFetchCustom} disabled={searching || !customUrl.trim()}>
                {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link className="h-3 w-3" />}
                Fetch
              </Button>
            </div>
          </div>}

          {/* Actions */}
          <div className="flex gap-2">
            {saved ? (
              <Button variant="outline" size="sm" className="flex-1 gap-2" disabled>
                <Check className="h-4 w-4" /> Saved
              </Button>
            ) : (
              <Button variant="default" size="sm" className="flex-1 gap-2" onClick={handleSave} disabled={!previewUrl || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
            <Button variant="destructive" size="sm" className="gap-2" onClick={handleRemove} disabled={!previewUrl || saving}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          </div>

          {saved && localOrigin?.folderPath && (
            <p className="text-[10px] text-muted-foreground text-center">
              Saved to {localOrigin.folderPath}/{sanitizeForPath(album.albumArtistName)}/{sanitizeForPath(album.name)}/.img/
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {fullscreenUrl && (
      <div
        className="fixed inset-0 z-[60] flex cursor-pointer items-center justify-center bg-black/90"
        onClick={() => setFullscreenUrl(null)}
        onKeyDown={(e) => { if (e.key === "Escape") setFullscreenUrl(null); }}
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        <img
          src={fullscreenUrl}
          alt={album.name}
          className="max-h-[90vh] max-w-[90vw] object-contain select-none"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}
  </>
  );
}
