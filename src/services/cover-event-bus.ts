export type CoverUpdateListener = (artistId: string, releaseId: string) => void;

class CoverEventBus {
  private listeners = new Map<string, Set<CoverUpdateListener>>();

  subscribe(artistId: string, releaseId: string, fn: CoverUpdateListener): () => void {
    const key = `${artistId}|${releaseId}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(fn);
    return () => {
      this.listeners.get(key)?.delete(fn);
      if (this.listeners.get(key)?.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  emit(artistId: string, releaseId: string): void {
    const key = `${artistId}|${releaseId}`;
    const fns = this.listeners.get(key);
    if (fns) {
      fns.forEach((fn) => {
        try {
          fn(artistId, releaseId);
        } catch (err) {
          console.warn("[cover-event-bus] listener error:", err);
        }
      });
    }
  }
}

export const coverEventBus = new CoverEventBus();

export function makeCoverKey(
  artistId: string | null | undefined,
  releaseId: string | null | undefined,
): string | null {
  if (!artistId || !releaseId) return null;
  return `${artistId}|${releaseId}`;
}

export function emitCoverUpdate(
  artistName?: string | null,
  albumName?: string | null,
  mbzArtistId?: string | null,
  mbzReleaseGroupId?: string | null,
  mbzReleaseId?: string | null,
): void {
  if (mbzArtistId && (mbzReleaseGroupId || mbzReleaseId)) {
    const rid = mbzReleaseGroupId || mbzReleaseId!;
    coverEventBus.emit(mbzArtistId, rid);
  }
  if (artistName && albumName) {
    coverEventBus.emit(artistName.toLowerCase().trim(), albumName.toLowerCase().trim());
  }
  if (artistName) {
    coverEventBus.emit(artistName.toLowerCase().trim(), "__all__");
  }
}
