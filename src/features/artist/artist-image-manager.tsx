import { useState, useCallback, useEffect } from "react";
import type { AlbumArtist } from "../../types/domain-types";
import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { CoverImage, ArtImage } from "../../components/ui/art-image";
import { Loader2, Search, Save, Trash2, Link, Check } from "lucide-react";
import { storeImage as indexDbStoreImage, md5Hash, findImages, recordToBlobUrl } from "../../services/image-store";
import { platformFetch } from "../../services/platform-fetch";
import { artistImageResolver } from "../../services/artist-image/providers/artist-resolver";
import { ARTIST_PROVIDER_META } from "../../services/artist-image/providers/types";
import type { ArtistCandidate } from "../../services/artist-image/providers/types";
import { fetchImageAsBlobUrl } from "../../services/image-fetch";
import { searchWikipedia, sanitizeForPath } from "../../services/wiki-image-search";
import { importFromDotImg, clearDotImgDir } from "../../services/dot-img";
import { cn } from "../../lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: AlbumArtist;
  currentImageUrl: string | null;
  onImageSaved: (blobUrl: string) => void;
};

function getExt(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

export function ArtistImageManager({ open, onOpenChange, artist, currentImageUrl, onImageSaved }: Props) {
  const artistOrigin = useAuthStore((s) => s.origins.find((o) => o.id === artist.originId) ?? s.currentOrigin);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [sourceType, setSourceType] = useState<string>("wikipedia");
  const [saved, setSaved] = useState(false);

  const [providerResults, setProviderResults] = useState<Record<string, ArtistCandidate[]>>({});
  const [providerLoading, setProviderLoading] = useState<Record<string, boolean>>({});
  const [activeProvider, setActiveProvider] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSearching(false);
    setSaving(false);
    setError(null);
    setCustomUrl("");
    setSourceType("wikipedia");
    setSaved(false);
    setProviderResults({});
    setProviderLoading({});
    setActiveProvider(null);
  }, []);

  async function saveImageToStoreAndDisk(
    blob: Blob,
    sourceUrl: string,
  ): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer();
    const hash = await md5Hash(arrayBuffer);

    const record = {
      md5: hash,
      blob: arrayBuffer,
      format: blob.type || "image/jpeg",
      size: arrayBuffer.byteLength,
      createdAt: Date.now(),
      artistName: artist.name.toLowerCase().trim(),
      mbzArtistId: artist.mbz || undefined,
      sourceUrl,
    };

    await indexDbStoreImage(record);

    const { getPlatformService } = await import("../../services/platform/factory");
    const p = await getPlatformService();
    const { origins, currentOrigin: fallbackOrigin } = useAuthStore.getState();
    const saveOrigin = origins.find((o) => o.id === artist.originId) ?? fallbackOrigin;

    if (saveOrigin?.folderPath) {
      const ext = getExt(blob.type);
      const filePath = `${saveOrigin.folderPath}/${sanitizeForPath(artist.name)}/.img/${hash}.${ext}`;

      const exists = await p.fileExists(filePath).catch(() => false);
      if (!exists) {
        await p.createDirectory(`${saveOrigin.folderPath}/${sanitizeForPath(artist.name)}/.img`).catch(() => {});
        await p.writeFile(filePath, new Uint8Array(arrayBuffer));
      }
    }

    return URL.createObjectURL(blob);
  }

  useEffect(() => {
    if (!open) return;
    (async () => {
      if (currentImageUrl) {
        setPreviewUrl(currentImageUrl);
        return;
      }

      const artistNorm = artist.name.toLowerCase().trim();

      // 1. Check store (artist-only, skip album covers)
      const all = await findImages();
      const saved = all.find((r) => !r.albumName);
      if (saved && saved.blob.byteLength > 0) {
        const blobUrl = await recordToBlobUrl(saved);
        if (blobUrl) { setPreviewUrl(blobUrl); return; }
      }

      // 2. Check .img folder on filesystem
      if (artistOrigin?.folderPath) {
        try {
          const { getPlatformService } = await import("../../services/platform/factory");
          const p = await getPlatformService();
          const artistDir = sanitizeForPath(artist.name);
          const blobUrl = await importFromDotImg(`${artistOrigin.folderPath}/${artistDir}/.img`, p, { artistName: artistNorm });
          if (blobUrl) setPreviewUrl(blobUrl);
        } catch {
          // .img folder doesn't exist
        }
      }
    })();
  }, [open, artist.name, currentImageUrl, artistOrigin?.folderPath]);

  async function handleSearch() {
    const addMsg = useStatusStore.getState().addMessage;
    setSearching(true);
    setError(null);
    addMsg("Saving artist image...", "info", "Artist image");
    try {
      const sourceUrl = await searchWikipedia(artist.name, "artist-image-manager");
      if (!sourceUrl) {
        setError("No image found for this artist on Wikipedia.");
        setSearching(false);
        return;
      }
      setSourceType("wikipedia");
      const resp = await platformFetch(sourceUrl, { method: "GET" });
      if (!resp.ok) { setError("Failed to download image."); setSearching(false); return; }
      const blob = await resp.blob();
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, sourceUrl);
      setPreviewUrl(savedBlobUrl);
      setSaved(true);
      onImageSaved(savedBlobUrl);
      addMsg("Artist image saved", "success", "Artist image");
    } catch (err) {
      setError("Search failed. Try again.");
      console.error("[artist-image-manager] search error:", err);
      addMsg("Failed to save artist image", "danger", "Artist image");
    } finally {
      setSearching(false);
    }
  }

  async function handleFetchProvider(providerName: string) {
    setProviderLoading((prev) => ({ ...prev, [providerName]: true }));
    setError(null);
    console.log(`[artist-image-manager] fetching from provider: "${providerName}" artist="${artist.name}"`);
    try {
      const items = await artistImageResolver.search(providerName, {
        artist: artist.name,
        musicbrainzId: artist.mbz || undefined,
      });
      console.log(`[artist-image-manager] "${providerName}" resolved ${items.length} candidate(s)`);
      if (items.length === 0) {
        console.warn(`[artist-image-manager] "${providerName}" returned no candidates`);
        setError(`No results from ${providerName}`);
        setProviderResults((prev) => ({ ...prev, [providerName]: [] }));
        return;
      }
      const candidatesWithBlobs = await Promise.all(
        items.map(async (cand) => ({
          ...cand,
          blobUrl: await fetchImageAsBlobUrl(cand.thumbnailUrl || cand.url),
        })),
      );
      setProviderResults((prev) => ({ ...prev, [providerName]: candidatesWithBlobs }));
    } catch (err) {
      console.error(`[artist-image-manager] "${providerName}" fetch error:`, err);
      setError(`Failed to search ${providerName}: ${err instanceof Error ? err.message : "unknown error"}`);
      setProviderResults((prev) => ({ ...prev, [providerName]: [] }));
    } finally {
      setProviderLoading((prev) => ({ ...prev, [providerName]: false }));
    }
  }

  async function handleSelectProviderCandidate(candidate: ArtistCandidate) {
    const addMsg = useStatusStore.getState().addMessage;
    setSaving(true);
    setError(null);
    setActiveProvider(candidate.provider);
    setSourceType(candidate.provider);
    addMsg("Saving artist image...", "info", "Artist image");
    try {
      const blobUrl = await fetchImageAsBlobUrl(candidate.url);
      if (!blobUrl) { setError("Failed to download image."); setSaving(false); return; }

      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, candidate.url);
      setPreviewUrl(savedBlobUrl);
      setSaved(true);
      onImageSaved(savedBlobUrl);
      addMsg("Artist image saved", "success", "Artist image");
    } catch (err) {
      console.error("[artist-image-manager] provider candidate error:", err);
      setError("Failed to select artist image.");
      addMsg("Failed to save artist image", "danger", "Artist image");
    } finally {
      setSaving(false);
    }
  }

  async function handleFetchCustom() {
    if (!customUrl.trim()) return;
    const addMsg = useStatusStore.getState().addMessage;
    setSearching(true);
    setError(null);
    addMsg("Saving artist image...", "info", "Artist image");
    try {
      const resp = await platformFetch(customUrl.trim(), { method: "GET" });
      if (!resp.ok) { setError("Could not fetch image from that URL."); setSearching(false); return; }
      const blob = await resp.blob();
      setSourceType("custom");
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, customUrl.trim());
      setPreviewUrl(savedBlobUrl);
      setSaved(true);
      onImageSaved(savedBlobUrl);
      addMsg("Artist image saved", "success", "Artist image");
    } catch {
      setError("Failed to fetch image.");
      addMsg("Failed to save artist image", "danger", "Artist image");
    } finally {
      setSearching(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setError(null);
    try {
      const { getPlatformService } = await import("../../services/platform/factory");
      const p = await getPlatformService();
      const { origins, currentOrigin: fallbackOrigin } = useAuthStore.getState();
      const removeOrigin = origins.find((o) => o.id === artist.originId) ?? fallbackOrigin;
      if (removeOrigin?.folderPath) {
        const artistDir = sanitizeForPath(artist.name);
        await clearDotImgDir(`${removeOrigin.folderPath}/${artistDir}/.img`, p);
      }
      setPreviewUrl(null);
      setSaved(false);
      onImageSaved("");
    } catch (err) {
      console.error("[artist-image-manager] remove error:", err);
      setError("Failed to remove image.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCurrent() {
    if (!previewUrl) return;
    const addMsg = useStatusStore.getState().addMessage;
    setSaving(true);
    setError(null);
    addMsg("Saving artist image...", "info", "Artist image");
    try {
      const response = await fetch(previewUrl);
      if (!response.ok) { setError("Failed to save image."); setSaving(false); return; }
      const blob = await response.blob();
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, "artist-image-manual");
      setPreviewUrl(savedBlobUrl);
      setSaved(true);
      onImageSaved(savedBlobUrl);
      addMsg("Artist image saved", "success", "Artist image");
    } catch (err) {
      console.error("[artist-image-manager] save error:", err);
      setError("Failed to save artist image.");
      addMsg("Failed to save artist image", "danger", "Artist image");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Artist Image — {artist.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {previewUrl && (
            <div className="flex flex-col items-center gap-2">
              <CoverImage src={previewUrl} alt={artist.name} fallback={artist.name.charAt(0)} className="h-32 w-32 rounded-full" />
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Providers */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Search from providers</p>
            {artistImageResolver.getProviderNames().map((name) => {
              const candidates = providerResults[name] || [];
              const loading = providerLoading[name];
              const meta = ARTIST_PROVIDER_META[name];
              const label = meta?.label || name;
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
                      {candidates.map((cand, idx) => (
                        <div key={`${cand.provider}-${idx}`} className="relative group">
                          <ArtImage
                            src={cand.blobUrl || cand.url}
                            alt={cand.provider}
                            fallback={cand.provider.charAt(0).toUpperCase()}
                            className={cn("h-12 w-12 rounded-md cursor-pointer ring-1 ring-transparent transition-all hover:ring-primary/50", isActive && "ring-green-500/50")}
                            onClick={() => handleSelectProviderCandidate(cand)}
                          />
                          <button className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" onClick={() => handleSelectProviderCandidate(cand)} title="Select this image">✓</button>
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
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleSearch} disabled={searching}>
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

          <div className="flex gap-2">
            {saved ? (
              <Button variant="outline" size="sm" className="flex-1 gap-2" disabled>
                <Check className="h-4 w-4" /> Saved
              </Button>
            ) : (
              <Button variant="default" size="sm" className="flex-1 gap-2" disabled={!previewUrl || saving} onClick={handleSaveCurrent}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
            <Button variant="destructive" size="sm" className="gap-2" onClick={handleRemove} disabled={!previewUrl || saving}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          </div>

          {saved && artistOrigin?.folderPath && (
            <p className="text-[10px] text-muted-foreground text-center">
              Saved to {artistOrigin.folderPath}/{sanitizeForPath(artist.name)}/.img/
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
