import { app } from "electron";
import { join, extname, resolve } from "path";
import fs from "fs";
import { TaskQueue } from "./queue";

export interface ImageMeta {
  md5: string;
  format: string;
  size: number;
  createdAt: number;
  sourceUrl?: string;
  artistName?: string;
  albumName?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzReleaseId?: string;
}

const CACHE_ROOT = "image-cache";
const META_FILE = "_meta.json";

class ElectronImageStore {
  private queue = new TaskQueue();
  private meta: Map<string, ImageMeta> = new Map();
  private cacheDir = "";
  private metaPath = "";
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    this.queue.register("store", this.handleStore.bind(this));
    this.queue.register("get", this.handleGet.bind(this));
    this.queue.register("find", this.handleFind.bind(this));
    this.queue.register("get-by-url", this.handleGetByUrl.bind(this));
    this.queue.register("delete", this.handleDelete.bind(this));
    this.queue.register("clear", this.handleClear.bind(this));
    this.queue.register("flush-meta", this.handleFlushMeta.bind(this));
  }

  private ensureInit(): void {
    if (!this.loaded && !this.loadPromise) {
      this.loadPromise = this.init();
    }
  }

  private async init(): Promise<void> {
    this.cacheDir = join(app.getPath("userData"), CACHE_ROOT);
    this.metaPath = join(this.cacheDir, META_FILE);
    fs.mkdirSync(this.cacheDir, { recursive: true });
    await this.loadMeta();
    this.loaded = true;
  }

  private async loadMeta(): Promise<void> {
    try {
      if (fs.existsSync(this.metaPath)) {
        const raw = fs.readFileSync(this.metaPath, "utf-8");
        const arr: ImageMeta[] = JSON.parse(raw);
        for (const entry of arr) {
          this.meta.set(entry.md5, entry);
        }
      }
    } catch {
      this.meta.clear();
    }
  }

  private async flushMeta(): Promise<void> {
    if (!this.cacheDir) return;
    try {
      const arr = Array.from(this.meta.values());
      const tmp = this.metaPath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(arr), "utf-8");
      fs.renameSync(tmp, this.metaPath);
    } catch {
      // non-critical
    }
  }

  private filePath(hash: string, format: string): string {
    const ext = format.startsWith("image/") ? "." + format.split("/")[1] : ".bin";
    return join(this.cacheDir, hash + ext);
  }

  private async handleStore(payload: unknown): Promise<string> {
    const { hash, buffer, format, sourceUrl, artistName, albumName, mbzArtistId, mbzReleaseGroupId, mbzReleaseId } = payload as {
      hash: string;
      buffer: number[];
      format: string;
      sourceUrl?: string;
      artistName?: string;
      albumName?: string;
      mbzArtistId?: string;
      mbzReleaseGroupId?: string;
      mbzReleaseId?: string;
    };

    if (this.meta.has(hash)) {
      // Update metadata if new fields provided
      const existing = this.meta.get(hash)!;
      let changed = false;
      if (artistName && !existing.artistName) { existing.artistName = artistName; changed = true; }
      if (albumName && !existing.albumName) { existing.albumName = albumName; changed = true; }
      if (mbzArtistId && !existing.mbzArtistId) { existing.mbzArtistId = mbzArtistId; changed = true; }
      if (mbzReleaseGroupId && !existing.mbzReleaseGroupId) { existing.mbzReleaseGroupId = mbzReleaseGroupId; changed = true; }
      if (mbzReleaseId && !existing.mbzReleaseId) { existing.mbzReleaseId = mbzReleaseId; changed = true; }
      if (sourceUrl && !existing.sourceUrl) { existing.sourceUrl = sourceUrl; changed = true; }
      if (changed) {
        await this.queue.add("flush-meta", null, "low");
      }
      return hash;
    }

    const entry: ImageMeta = {
      md5: hash,
      format,
      size: buffer.length,
      createdAt: Date.now(),
      sourceUrl,
      artistName,
      albumName,
      mbzArtistId,
      mbzReleaseGroupId,
      mbzReleaseId,
    };

    this.meta.set(hash, entry);
    fs.writeFileSync(this.filePath(hash, format), Buffer.from(buffer));
    await this.queue.add("flush-meta", null, "low");
    return hash;
  }

  private async handleGet(payload: unknown): Promise<{ meta: ImageMeta; data: number[] } | null> {
    const { hash, format } = payload as { hash: string; format?: string };
    const entry = this.meta.get(hash);
    if (!entry) return null;

    const path = this.filePath(hash, format || entry.format);
    try {
      const data = fs.readFileSync(path);
      return { meta: entry, data: Array.from(new Uint8Array(data)) };
    } catch {
      return null;
    }
  }

  private async handleGetByUrl(payload: unknown): Promise<{ meta: ImageMeta; data: number[] } | null> {
    const { url } = payload as { url: string };
    for (const entry of this.meta.values()) {
      if (entry.sourceUrl === url) {
        return this.handleGet({ hash: entry.md5, format: entry.format });
      }
    }
    return null;
  }

  private async handleFind(payload: unknown): Promise<ImageMeta[]> {
    const query = payload as Partial<ImageMeta>;
    const results: ImageMeta[] = [];
    for (const entry of this.meta.values()) {
      let match = true;
      for (const [key, val] of Object.entries(query)) {
        if (entry[key as keyof ImageMeta] !== val) {
          match = false;
          break;
        }
      }
      if (match) results.push(entry);
    }
    return results;
  }

  private async handleDelete(payload: unknown): Promise<void> {
    const { hash } = payload as { hash: string };
    const entry = this.meta.get(hash);
    if (!entry) return;
    this.meta.delete(hash);
    try {
      fs.unlinkSync(this.filePath(hash, entry.format));
    } catch {
      // already gone
    }
    await this.queue.add("flush-meta", null, "low");
  }

  private async handleClear(): Promise<void> {
    this.meta.clear();
    try {
      fs.rmSync(this.cacheDir, { recursive: true, force: true });
      fs.mkdirSync(this.cacheDir, { recursive: true });
    } catch {
      // non-critical
    }
    await this.queue.add("flush-meta", null, "low");
  }

  private async handleFlushMeta(): Promise<void> {
    await this.flushMeta();
  }

  // Public API (called from IPC handlers)

  async store(
    hash: string,
    buffer: number[],
    format: string,
    meta?: { sourceUrl?: string; artistName?: string; albumName?: string; mbzArtistId?: string; mbzReleaseGroupId?: string; mbzReleaseId?: string },
  ): Promise<string> {
    this.ensureInit();
    await this.loadPromise;
    return this.queue.add<string>("store", { hash, buffer, format, ...meta }, "normal");
  }

  async get(hash: string): Promise<{ meta: ImageMeta; data: number[] } | null> {
    this.ensureInit();
    await this.loadPromise;
    return this.queue.add("get", { hash }, "high");
  }

  async getBySourceUrl(url: string): Promise<{ meta: ImageMeta; data: number[] } | null> {
    this.ensureInit();
    await this.loadPromise;
    return this.queue.add("get-by-url", { url }, "high");
  }

  async find(query: Partial<ImageMeta>): Promise<ImageMeta[]> {
    this.ensureInit();
    await this.loadPromise;
    return this.queue.add("find", query, "normal");
  }

  async clear(): Promise<void> {
    this.ensureInit();
    await this.loadPromise;
    return this.queue.add("clear", null, "normal");
  }

  async getCacheDir(): Promise<string> {
    this.ensureInit();
    await this.loadPromise;
    return this.cacheDir;
  }
}

export const electronImageStore = new ElectronImageStore();
