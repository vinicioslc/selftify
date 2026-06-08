import { useState, useCallback, useEffect, useRef } from "react";
import type { Album } from "../../types/domain-types";
import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { ArtImage } from "../../components/ui/art-image";
import { AlbumEmptySvg } from "../../components/ui/empty-image-svg";
import { Loader2, Search, Save, Trash2, Link, Check } from "lucide-react";
import { storeImage as indexDbStoreImage, md5Hash, findImages, recordToBlobUrl } from "../../services/image-store";
import { electronStoreImage, electronFindImages, isElectronImageStore, electronRecordToBlobUrl } from "../../services/electron-image-store";
import { platformFetch } from "../../services/platform-fetch";
import { getSongsByAlbum } from "../../services/local-database";
import { artworkResolver } from "../../services/artwork/artwork-resolver";
import type { ArtworkCandidate } from "../../services/artwork/providers/types";
import { fetchImageAsBlobUrl } from "../../services/image-cache";
import { cn } from "../../lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  album: Album;
  currentImageUrl: string | null;
  onImageSaved: (blobUrl: string) => void;
};

type SourceType = "wikipedia" | "custom" | string;

const WIKI_API = "https://en.wikipedia.org/w/api.php";

type WikiPageResult = {
  query?: {
    pages?: Record<string, {
      missing?: boolean;
      thumbnail?: { source: string; width: number; height: number };
    }>;
  };
};

const PROVIDER_LABELS: Record<string, string> = {
  itunes: "iTunes",
  deezer: "Deezer",
};

async function searchWikipedia(query: string): Promise<string | null> {
  const url = `${WIKI_API}?action=query&titles=${encodeURIComponent(query)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
  try {
    const res = await platformFetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data: WikiPageResult = await res.json();
    const page = Object.values(data?.query?.pages ?? {})[0];
    return page && !page.missing ? (page.thumbnail?.source ?? null) : null;
  } catch {
    return null;
  }
}

function sanitizeForPath(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim();
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
  sourceType: string,
  sourceUrl: string,
): Promise<string | null> {
  console.log("[Selftify] [album-image-manager] saveImageToStoreAndDisk: blob size", blob.size, "type", blob.type);
  let arrayBuffer: ArrayBuffer;
  let resizedBlob: Blob;
  try {
    const resized = await resizeImageForCover(blob);
    arrayBuffer = resized.arrayBuffer;
    resizedBlob = resized.blob;
    console.log("[Selftify] [album-image-manager] resize ok: arrayBuffer", arrayBuffer.byteLength, "bytes");
  } catch (err) {
    console.error("[Selftify] [album-image-manager] resize failed:", err);
    return null;
  }

  const hash = await md5Hash(arrayBuffer);
  const albumNameNorm = album.name.toLowerCase().trim();
  const artistNameNorm = album.albumArtistName.toLowerCase().trim();
  console.log("[Selftify] [album-image-manager] md5 hash", hash);

  const record = {
    md5: hash,
    blob: arrayBuffer,
    format: "image/jpeg",
    size: arrayBuffer.byteLength,
    createdAt: Date.now(),
    artistName: artistNameNorm,
    albumName: albumNameNorm,
    mbzReleaseGroupId: album.mbzReleaseGroupId || undefined,
    mbzReleaseId: album.mbzId || undefined,
    sourceUrl,
  };

  try {
    if (await isElectronImageStore()) {
      await electronStoreImage(record);
      console.log("[Selftify] [album-image-manager] electronStoreImage ok");
    } else {
      await indexDbStoreImage(record);
      console.log("[Selftify] [album-image-manager] indexDbStoreImage ok");
    }
  } catch (err) {
    console.error("[Selftify] [album-image-manager] store save failed:", err);
  }

  console.log("[Selftify] [album-image-manager] origin lookup: album.originId", album.originId);
  const { getPlatformService } = await import("../../services/platform/factory");
  const p = await getPlatformService();
  console.log("[Selftify] [album-image-manager] platform", p.isElectron ? "electron" : p.isWeb ? "web" : "capacitor");
  const { origins, currentOrigin } = useAuthStore.getState();
  const albumOrigin = origins.find((o) => o.id === album.originId) ?? currentOrigin;
  console.log("[Selftify] [album-image-manager] albumOrigin", albumOrigin?.id, "folderPath", albumOrigin?.folderPath);
  if (albumOrigin?.folderPath) {
    const artistDir = sanitizeForPath(album.albumArtistName);
    const albumDir = sanitizeForPath(album.name);
    const imgDir = `${artistDir}/${albumDir}/.img`;
    const dirPath = `${albumOrigin.folderPath}/${imgDir}`;
    const prefix = album.mbzId ? `${album.mbzId}.` : "";
    const fileName = `${prefix}${sourceType}.jpg`;
    const filePath = `${dirPath}/${fileName}`;
    console.log("[Selftify] [album-image-manager] mkdir:", dirPath);
    try {
      await p.createDirectory(dirPath);
      console.log("[Selftify] [album-image-manager] mkdir ok");
      console.log("[Selftify] [album-image-manager] write:", filePath);
      const wrote = await p.writeFile(filePath, new Uint8Array(arrayBuffer));
      console.log("[Selftify] [album-image-manager] write result:", wrote);
      const stats = wrote ? await p.getFileStats(filePath) : null;
      if (wrote && stats && stats.size > 0) {
        console.log(`[Selftify] [album-image-manager] cover saved to ${filePath}`);
      } else {
        console.warn("[Selftify] [album-image-manager] writeFile did not persist", filePath, stats);
      }
    } catch (fsErr) {
      console.error("[Selftify] [album-image-manager] filesystem save failed:", fsErr);
    }

    // Embed cover into all local audio files for this album (Electron only)
    const electronApi = (window as any).electronApi;
    if (electronApi?.yt?.embedArtwork && p.isElectron) {
      try {
        const dbSongs = await getSongsByAlbum(album.albumArtistName, album.name);
        const audioPaths = dbSongs.map((s) => s.path).filter(Boolean) as string[];
        if (audioPaths.length > 0) {
          console.log(`[Selftify] [album-image-manager] embedding cover into ${audioPaths.length} audio files`);
          for (const audioPath of audioPaths) {
            try {
              await electronApi.yt.embedArtwork({ audioPath, coverPath: filePath });
              console.log(`[Selftify] [album-image-manager] embedded cover into ${audioPath}`);
            } catch (embedErr) {
              console.warn(`[album-image-manager] embed failed for ${audioPath}:`, embedErr);
            }
          }
        }
      } catch (dbErr) {
        console.warn("[album-image-manager] failed to fetch local songs for embedding:", dbErr);
      }
    }
  } else {
    console.warn("[Selftify] [album-image-manager] no folderPath for origin", albumOrigin?.id ?? album.originId);
  }

  const blobUrl = URL.createObjectURL(resizedBlob);
  return blobUrl;
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
  }, []);

  async function loadExistingPreview() {
    if (currentImageUrl) {
      setPreviewUrl(currentImageUrl);
      return;
    }

    const albumNameNorm = album.name.toLowerCase().trim();
    const artistNameNorm = album.albumArtistName.toLowerCase().trim();

    // 1. Check IndexedDB / Electron store
    const isElectron = await isElectronImageStore();
    const records = isElectron
      ? await electronFindImages({ artistName: artistNameNorm, albumName: albumNameNorm })
      : await findImages({ artistName: artistNameNorm, albumName: albumNameNorm });
    if (records.length > 0) {
      const blobUrl = isElectron ? await electronRecordToBlobUrl(records[0]) : await recordToBlobUrl(records[0]);
      if (blobUrl) { setPreviewUrl(blobUrl); return; }
    }

    // 2. Check .img folder on filesystem
    if (localOrigin?.folderPath) {
      try {
        const { getPlatformService } = await import("../../services/platform/factory");
        const p = await getPlatformService();
        const artistDir = sanitizeForPath(album.albumArtistName);
        const albumDir = sanitizeForPath(album.name);
        const imgDir = `${localOrigin.folderPath}/${artistDir}/${albumDir}/.img`;
        const entries = await p.readDirectory(imgDir).catch(() => []);
        const imageFile = entries.find((e) => e.isFile && /\.(jpg|jpeg|png|webp)$/i.test(e.name));
        if (imageFile) {
          const raw = await p.readFile(imageFile.path);
          if (raw) {
            const blob = new Blob([raw] as BlobPart[]);
            const arrayBuffer = await blob.arrayBuffer();
            const ext = imageFile.name.endsWith(".png") ? "image/png" : imageFile.name.endsWith(".webp") ? "image/webp" : "image/jpeg";
            const hash = await md5Hash(arrayBuffer);
            const record = { md5: hash, blob: arrayBuffer, format: ext, size: arrayBuffer.byteLength, createdAt: Date.now(), artistName: artistNameNorm, albumName: albumNameNorm, sourceUrl: imageFile.path };
            if (isElectron) { await electronStoreImage(record); } else { await indexDbStoreImage(record); }
            const blobUrl = URL.createObjectURL(blob);
            setPreviewUrl(blobUrl);
          }
        }
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
    try {
      const items = await artworkResolver.resolveFromProvider(providerName, {
        artist: album.albumArtistName,
        album: album.name,
        musicbrainzReleaseId: album.mbzId || undefined,
        musicbrainzReleaseGroupId: album.mbzReleaseGroupId || undefined,
      });
      const candidatesWithBlobs = await Promise.all(
        items.map(async (cand) => ({
          ...cand,
          blobUrl: await fetchImageAsBlobUrl(cand.thumbnailUrl || cand.url),
        }))
      );
      setCoverResults((prev) => ({ ...prev, [providerName]: candidatesWithBlobs }));
    } catch {
      setCoverResults((prev) => ({ ...prev, [providerName]: [] }));
    } finally {
      setCoverLoading((prev) => ({ ...prev, [providerName]: false }));
    }
  }

  async function handleSelectProviderCandidate(candidate: ArtworkCandidate) {
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
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, album, candidate.provider, candidate.url);
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
    const addMsg = useStatusStore.getState().addMessage;
    setSearching(true);
    setError(null);
    addMsg("Saving cover...", "info", "Cover");
    try {
      const query = `${album.name} ${album.albumArtistName}`;
      const sourceUrl = await searchWikipedia(query);
      if (!sourceUrl) {
        setError("No image found for this album on Wikipedia.");
        setSearching(false);
        return;
      }
      setSourceType("wikipedia");
      const resp = await platformFetch(sourceUrl, { method: "GET" });
      if (!resp.ok) { setError("Failed to download image."); setSearching(false); return; }
      const blob = await resp.blob();
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, album, "wikipedia", sourceUrl);
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
    const addMsg = useStatusStore.getState().addMessage;
    setSearching(true);
    setError(null);
    addMsg("Saving cover...", "info", "Cover");
    try {
      const resp = await platformFetch(customUrl.trim(), { method: "GET" });
      if (!resp.ok) { setError("Could not fetch image from that URL."); setSearching(false); return; }
      const blob = await resp.blob();
      setSourceType("custom");
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, album, "custom", customUrl.trim());
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
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, album, sourceType, previewUrl);
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
        const artistDir = sanitizeForPath(album.albumArtistName);
        const albumDir = sanitizeForPath(album.name);
        const imgDir = `${albumOrigin.folderPath}/${artistDir}/${albumDir}/.img`;
        const prefix = album.mbzId ? `${album.mbzId}.` : "";
        const allSources = ["wikipedia", "custom", ...artworkResolver.getProviderNames()];
        for (const st of allSources) {
          for (const e of ["jpg", "png", "webp"]) {
            await p.deleteFile(`${imgDir}/${prefix}${st}.${e}`).catch(() => {});
          }
        }
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Album Cover — {album.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {previewUrl && (
            <div className="flex flex-col items-center gap-2">
              <img src={previewUrl} alt={album.name} className="h-48 w-48 rounded-lg object-cover" />
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Providers */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Search from providers</p>
            {providerNames.map((name) => {
              const candidates = coverResults[name] || [];
              const loading = coverLoading[name];
              const label = PROVIDER_LABELS[name] || name;
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
                      {candidates.map((cand) => (
                        <div key={`${cand.provider}-${cand.url}`} className="relative group">
                          <ArtImage
                            src={cand.blobUrl || cand.url}
                            alt={cand.provider}
                            fallback={cand.provider.charAt(0).toUpperCase()}
                            emptySvg={<AlbumEmptySvg />}
                            className={cn("h-12 w-12 rounded-md cursor-pointer ring-1 ring-transparent transition-all hover:ring-primary/50", isActive && "ring-green-500/50")}
                            onClick={() => handleSelectProviderCandidate(cand)}
                          />
                          <button className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" onClick={() => handleSelectProviderCandidate(cand)} title="Select this cover">✓</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Wikipedia */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Search from Wikipedia</p>
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleSearchWikipedia} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {searching ? "Searching..." : "Search Wikipedia"}
            </Button>
          </div>

          {/* Custom URL */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Or paste an image URL</p>
            <div className="flex gap-2">
              <input type="text" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://example.com/image.jpg" className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" onKeyDown={(e) => e.key === "Enter" && handleFetchCustom()} />
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={handleFetchCustom} disabled={searching || !customUrl.trim()}>
                {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link className="h-3 w-3" />}
                Fetch
              </Button>
            </div>
          </div>

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
              Saved to {localOrigin.folderPath}/{sanitizeForPath(album.albumArtistName)}/{sanitizeForPath(album.name)}/.img/{album.mbzId ? `${album.mbzId}.` : ""}{sourceType}.jpg
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
