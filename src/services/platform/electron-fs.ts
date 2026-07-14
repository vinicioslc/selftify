import type { DirEntry } from "./types";

/**
 * Typed bridge to Electron filesystem IPC.
 * Only available when platform.isElectron is true.
 * On web, all methods return safe defaults (false/null/[]) and log a warning.
 */

type FsHandlers = {
  readDirectory(path: string): Promise<DirEntry[]>;
  fileExists(path: string): Promise<boolean>;
  getFileStats(path: string): Promise<{ size: number; modifiedAt: number } | null>;
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  deleteFile(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<boolean>;
  renameFile(oldPath: string, newPath: string): Promise<boolean>;
};

function getFs(): FsHandlers | null {
  const api = (window as any).electronApi;
  if (!api?.fs) return null;
  return api.fs as FsHandlers;
}

export const electronFs: FsHandlers = {
  async readDirectory(path) {
    const fs = getFs();
    if (!fs) { console.warn("[electron-fs] readDirectory not available"); return []; }
    return fs.readDirectory(path);
  },
  async fileExists(path) {
    const fs = getFs();
    if (!fs) { console.warn("[electron-fs] fileExists not available"); return false; }
    return fs.fileExists(path);
  },
  async getFileStats(path) {
    const fs = getFs();
    if (!fs) { console.warn("[electron-fs] getFileStats not available"); return null; }
    return fs.getFileStats(path);
  },
  async writeFile(path, data) {
    const fs = getFs();
    if (!fs) { console.warn("[electron-fs] writeFile not available"); return false; }
    return fs.writeFile(path, data);
  },
  async deleteFile(path) {
    const fs = getFs();
    if (!fs) { console.warn("[electron-fs] deleteFile not available"); return false; }
    return fs.deleteFile(path);
  },
  async createDirectory(path) {
    const fs = getFs();
    if (!fs) { console.warn("[electron-fs] createDirectory not available"); return false; }
    return fs.createDirectory(path);
  },
  async renameFile(oldPath, newPath) {
    const fs = getFs();
    if (!fs) { console.warn("[electron-fs] renameFile not available"); return false; }
    return fs.renameFile(oldPath, newPath);
  },
};
