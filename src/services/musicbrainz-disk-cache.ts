import { getPlatformService } from "./platform/factory";
import { useSettingsStore } from "../stores/settings.store";

export type MusicBrainzCacheTtl = "1min" | "15min" | "30min" | "never";

type DiskCacheEntry = {
  data: unknown;
  createdAt: number;
};

type ArtistCache = Record<string, DiskCacheEntry>;

export type MusicBrainzContext = {
  artistName: string;
  artistMbid?: string;
};

export class MusicBrainzDiskCache {
  private libraryRoot: string;
  private writeQueue = new Map<string, Promise<void>>();

  constructor(libraryRoot: string) {
    this.libraryRoot = libraryRoot.replace(/\/+$/, "");
  }

  static sanitizeArtistName(name: string): string {
    return name.replace(/[/\\?%*:|"<>]/g, "_");
  }

  static filePath(libraryRoot: string, artistName: string, artistMbid?: string): string {
    const safe = MusicBrainzDiskCache.sanitizeArtistName(artistName);
    const suffix = artistMbid ? `.${artistMbid.slice(-8)}` : "";
    return `${libraryRoot.replace(/\/+$/, "")}/${safe}/db${suffix}.selftify`;
  }

  static ttlMs(): number {
    const v = useSettingsStore.getState().musicbrainzCacheTtl;
    if (v === "never") return 0;
    const map: Record<string, number> = { "1min": 60_000, "15min": 900_000, "30min": 1_800_000 };
    return map[v] ?? 900_000;
  }

  private filePathFor(artistName: string, artistMbid?: string): string {
    return MusicBrainzDiskCache.filePath(this.libraryRoot, artistName, artistMbid);
  }

  private async read(artistName: string, artistMbid?: string): Promise<ArtistCache | null> {
    const path = this.filePathFor(artistName, artistMbid);
    const p = await getPlatformService();
    try {
      if (!(await p.fileExists(path))) return null;
      const raw = await p.readFile(path);
      if (!raw) return null;
      const text = new TextDecoder().decode(raw);
      return JSON.parse(text) as ArtistCache;
    } catch (err) {
      console.warn("[musicbrainz-disk-cache] read error, clearing corrupt file:", path, err);
      try { await p.deleteFile(path); } catch { /* ignore */ }
      return null;
    }
  }

  private async write(artistName: string, cache: ArtistCache, artistMbid?: string): Promise<void> {
    const path = this.filePathFor(artistName, artistMbid);
    const prev = this.writeQueue.get(path) ?? Promise.resolve();
    const next = prev.then(() => this.doWrite(path, artistName, cache, artistMbid));
    this.writeQueue.set(path, next);
    return next;
  }

  private async doWrite(path: string, artistName: string, cache: ArtistCache, artistMbid?: string): Promise<void> {
    const p = await getPlatformService();
    try {
      const dir = path.slice(0, path.lastIndexOf("/"));
      if (!(await p.fileExists(dir))) {
        await p.createDirectory(dir);
      }
      const json = JSON.stringify(cache);
      const bytes = new TextEncoder().encode(json);
      await p.writeFile(path, bytes);
    } catch (err) {
      console.warn("[musicbrainz-disk-cache] write error:", path, err);
    }
  }

  async get<T>(artistName: string, endpointKey: string, artistMbid?: string): Promise<T | null> {
    const ttl = MusicBrainzDiskCache.ttlMs();
    const cache = await this.read(artistName, artistMbid);
    if (!cache) return null;

    const entry = cache[endpointKey];
    if (!entry) return null;

    if (ttl > 0 && Date.now() - entry.createdAt > ttl) {
      delete cache[endpointKey];
      await this.write(artistName, cache, artistMbid);
      return null;
    }

    return entry.data as T;
  }

  async set(artistName: string, endpointKey: string, data: unknown, artistMbid?: string): Promise<void> {
    const cache = (await this.read(artistName, artistMbid)) ?? {};
    cache[endpointKey] = { data, createdAt: Date.now() };
    await this.write(artistName, cache, artistMbid);
  }
}

const instances = new Map<string, MusicBrainzDiskCache>();

export function getDiskCache(libraryRoot: string): MusicBrainzDiskCache {
  const key = libraryRoot.replace(/\/+$/, "");
  let inst = instances.get(key);
  if (!inst) {
    inst = new MusicBrainzDiskCache(key);
    instances.set(key, inst);
  }
  return inst;
}

export async function clearAllDiskCaches(libraryRoot: string): Promise<void> {
  const p = await getPlatformService();
  const root = libraryRoot.replace(/\/+$/, "");
  try {
    const entries = await p.readDirectory(root);
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const dirPath = entry.path;
      const files = await p.readDirectory(dirPath);
      for (const file of files) {
        if (!file.isFile) continue;
        if (file.name.endsWith(".selftify")) {
          await p.deleteFile(file.path);
        }
      }
    }
    const key = root;
    instances.delete(key);
  } catch (err) {
    console.warn("[musicbrainz-disk-cache] clearAllDiskCaches error:", err);
  }
}
