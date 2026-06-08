import { useState, useCallback, useEffect, useRef } from "react";
import type { AlbumArtist } from "../../types/domain-types";
import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { CoverImage } from "../../components/ui/art-image";
import { Loader2, Search, Save, Trash2, Link, Check } from "lucide-react";
import { storeImage as indexDbStoreImage, md5Hash, findImages, recordToBlobUrl } from "../../services/image-store";
import { electronStoreImage, electronFindImages, isElectronImageStore, electronRecordToBlobUrl } from "../../services/electron-image-store";
import { platformFetch } from "../../services/platform-fetch";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: AlbumArtist;
  currentImageUrl: string | null;
  onImageSaved: (blobUrl: string) => void;
};

const WIKI_API = "https://en.wikipedia.org/w/api.php";

type WikiPageResult = {
  query?: {
    pages?: Record<string, {
      missing?: boolean;
      thumbnail?: { source: string; width: number; height: number };
    }>;
  };
};

async function searchWikipedia(artistName: string): Promise<string | null> {
  const url = `${WIKI_API}?action=query&titles=${encodeURIComponent(artistName)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
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
  const [sourceType, setSourceType] = useState<"wikipedia" | "custom">("wikipedia");
  const [saved, setSaved] = useState(false);

  const reset = useCallback(() => {
    setSearching(false);
    setSaving(false);
    setError(null);
    setCustomUrl("");
    setSourceType("wikipedia");
    setSaved(false);
  }, []);

  async function saveImageToStoreAndDisk(
    blob: Blob,
    sourceType: string,
    sourceUrl: string,
  ): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer();
    const hash = await md5Hash(arrayBuffer);
    const artistNameNorm = artist.name.toLowerCase().trim();

    const record = {
      md5: hash,
      blob: arrayBuffer,
      format: blob.type || "image/jpeg",
      size: arrayBuffer.byteLength,
      createdAt: Date.now(),
      artistName: artistNameNorm,
      mbzArtistId: artist.mbz || undefined,
      sourceUrl,
    };

    if (await isElectronImageStore()) {
      await electronStoreImage(record);
    } else {
      await indexDbStoreImage(record);
    }

    const { getPlatformService } = await import("../../services/platform/factory");
    const p = await getPlatformService();
    const { origins, currentOrigin: fallbackOrigin } = useAuthStore.getState();
    const saveOrigin = origins.find((o) => o.id === artist.originId) ?? fallbackOrigin;
    if (saveOrigin?.folderPath) {
      try {
        const artistDir = sanitizeForPath(artist.name);
        const imgDir = `${artistDir}/.img`;
        const dirPath = `${saveOrigin.folderPath}/${imgDir}`;
        const mbzId = artist.mbz || "unknown";
        const ext = getExt(blob.type);
        const fileName = `${mbzId}.${sourceType}.${ext}`;
        const filePath = `${dirPath}/${fileName}`;
        await p.createDirectory(dirPath);
        const wrote = await p.writeFile(filePath, new Uint8Array(arrayBuffer));
        const stats = wrote ? await p.getFileStats(filePath) : null;
        if (!wrote || !stats || stats.size === 0) {
          console.warn("[artist-image-manager] writeFile did not persist", filePath, stats);
        }
      } catch (fsErr) {
        console.warn("[artist-image-manager] filesystem save failed (non-fatal):", fsErr);
      }
    }

    const blobUrl = URL.createObjectURL(blob);
    return blobUrl;
  }

  useEffect(() => {
    if (!open) return;
    (async () => {
      if (currentImageUrl) {
        setPreviewUrl(currentImageUrl);
        return;
      }

      const artistNorm = artist.name.toLowerCase().trim();
      const isElectron = await isElectronImageStore();

      // 1. Check store (artist-only, skip album covers)
      const all = isElectron
        ? await electronFindImages({ artistName: artistNorm })
        : await findImages({ artistName: artistNorm });
      const saved = all.find((r) => !r.albumName);
      if (saved && (saved.blob.byteLength > 0 || isElectron)) {
        const blobUrl = isElectron ? await electronRecordToBlobUrl(saved) : await recordToBlobUrl(saved);
        if (blobUrl) { setPreviewUrl(blobUrl); return; }
      }

      // 2. Check .img folder on filesystem
      if (artistOrigin?.folderPath) {
        try {
          const { getPlatformService } = await import("../../services/platform/factory");
          const p = await getPlatformService();
          const artistDir = sanitizeForPath(artist.name);
          const imgDir = `${artistOrigin.folderPath}/${artistDir}/.img`;
          const entries = await p.readDirectory(imgDir).catch(() => []);
          const imageFile = entries.find((e) => e.isFile && /\.(jpg|jpeg|png|webp)$/i.test(e.name));
          if (imageFile) {
            const raw = await p.readFile(imageFile.path);
            if (raw) {
              const blob = new Blob([raw] as BlobPart[]);
              const arrayBuffer = await blob.arrayBuffer();
              const ext = imageFile.name.endsWith(".png") ? "image/png" : imageFile.name.endsWith(".webp") ? "image/webp" : "image/jpeg";
              const hash = await md5Hash(arrayBuffer);
              const record = { md5: hash, blob: arrayBuffer, format: ext, size: arrayBuffer.byteLength, createdAt: Date.now(), artistName: artistNorm, sourceUrl: imageFile.path };
              if (isElectron) { await electronStoreImage(record); } else { await indexDbStoreImage(record); }
              const blobUrl = URL.createObjectURL(blob);
              setPreviewUrl(blobUrl);
            }
          }
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
      const sourceUrl = await searchWikipedia(artist.name);
      if (!sourceUrl) {
        setError("No image found for this artist on Wikipedia.");
        setSearching(false);
        return;
      }
      setSourceType("wikipedia");
      const resp = await platformFetch(sourceUrl, { method: "GET" });
      if (!resp.ok) { setError("Failed to download image."); setSearching(false); return; }
      const blob = await resp.blob();
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, "wikipedia", sourceUrl);
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
      const savedBlobUrl = await saveImageToStoreAndDisk(blob, "custom", customUrl.trim());
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
      if (removeOrigin?.folderPath && artist.mbz) {
        const artistDir = sanitizeForPath(artist.name);
        const imgDir = `${removeOrigin.folderPath}/${artistDir}/.img`;
        const mbzId = artist.mbz;
        for (const st of ["wikipedia", "custom"] as const) {
          for (const e of ["jpg", "png", "webp"]) {
            await p.deleteFile(`${imgDir}/${mbzId}.${st}.${e}`).catch(() => {});
          }
        }
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

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Search from Wikipedia</p>
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {searching ? "Searching..." : "Search Wikipedia"}
            </Button>
          </div>

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
              <Button variant="default" size="sm" className="flex-1 gap-2" disabled={!previewUrl || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
            <Button variant="destructive" size="sm" className="gap-2" onClick={handleRemove} disabled={!previewUrl || saving}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          </div>

          {artistOrigin?.folderPath && (
            <p className="text-[10px] text-muted-foreground text-center">
              Saved to {artistOrigin.folderPath}/{sanitizeForPath(artist.name)}/.img/{artist.mbz || "unknown"}.{sourceType}.jpg
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
