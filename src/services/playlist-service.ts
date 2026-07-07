import { useAuthStore } from "../stores/auth.store";
import { joinPaths, stripTrailingSlash } from "../lib/path-utils";

const EXTENSION = ".selftifylist";

export interface SelftifyPlaylist {
  id: string;
  name: string;
  originId: string;
  songCount: number;
  createdAt: number;
  updatedAt: number;
}

function getPlaylistsDir(): string {
  const folderPath = useAuthStore.getState().currentOrigin?.folderPath;
  if (!folderPath) {
    throw new Error("No folder path configured for current origin");
  }
  return joinPaths(stripTrailingSlash(folderPath), "playlists");
}

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

function filePath(name: string): string {
  return joinPaths(getPlaylistsDir(), `${sanitizeName(name)}${EXTENSION}`);
}

function nameFromFile(filename: string): string {
  return filename.replace(new RegExp(`${EXTENSION.replace(".", "\\.")}$`), "");
}

async function getPlatform() {
  const { getPlatformService } = await import(
    "../services/platform/factory"
  );
  return getPlatformService();
}

async function ensureDir(): Promise<void> {
  const plat = await getPlatform();
  const dir = getPlaylistsDir();
  const exists = await plat.fileExists(dir);
  if (!exists) {
    await plat.createDirectory(dir);
  }
}

async function readMbidArray(id: string): Promise<string[]> {
  const plat = await getPlatform();
  const data = await plat.readFile(id);
  if (!data || data.length === 0) return [];
  try {
    const text = new TextDecoder().decode(data);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeMbidArray(id: string, mbids: string[]): Promise<void> {
  const plat = await getPlatform();
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(mbids));
  await ensureDir();
  await plat.writeFile(id, data);
}

async function getPlaylistMeta(fp: string): Promise<SelftifyPlaylist> {
  const plat = await getPlatform();
  const name = nameFromFile(fp.split("/").pop() || "");
  const stats = await plat.getFileStats(fp);
  const mbids = await readMbidArray(fp);
  return {
    id: fp,
    name,
    originId: useAuthStore.getState().currentOrigin?.id ?? "",
    songCount: mbids.length,
    createdAt: stats?.modifiedAt || Date.now(),
    updatedAt: stats?.modifiedAt || Date.now(),
  };
}

// ── Exported API ──

export async function createPlaylist(
  name: string,
  _originId: string,
  _description?: string,
): Promise<SelftifyPlaylist> {
  const path = filePath(name);
  await writeMbidArray(path, []);
  return getPlaylistMeta(path);
}

export async function deletePlaylist(id: string): Promise<void> {
  const plat = await getPlatform();
  await plat.deleteFile(id);
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  const plat = await getPlatform();
  const newPath = filePath(name);
  const exists = await plat.fileExists(newPath);
  if (exists && newPath !== id) {
    await plat.deleteFile(newPath);
  }
  await plat.renameFile(id, newPath);
}

export async function getAllPlaylists(): Promise<SelftifyPlaylist[]> {
  const plat = await getPlatform();
  const dir = getPlaylistsDir();
  const exists = await plat.fileExists(dir);
  if (!exists) return [];

  const entries = await plat.readDirectory(dir);
  const listFiles = entries.filter(
    (e) => e.isFile && e.name.endsWith(EXTENSION),
  );

  const playlists = await Promise.all(
    listFiles.map((e) => getPlaylistMeta(e.path)),
  );

  return playlists.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getPlaylistById(
  id: string,
): Promise<SelftifyPlaylist | null> {
  const plat = await getPlatform();
  const exists = await plat.fileExists(id);
  if (!exists) return null;
  return getPlaylistMeta(id);
}

export async function addSongToPlaylist(
  playlistId: string,
  mbid: string,
): Promise<void> {
  if (!mbid) return;
  const mbids = await readMbidArray(playlistId);
  if (mbids.includes(mbid)) return;
  mbids.push(mbid);
  await writeMbidArray(playlistId, mbids);
}

export async function removeSongFromPlaylist(
  playlistId: string,
  mbid: string,
): Promise<void> {
  if (!mbid) return;
  const mbids = await readMbidArray(playlistId);
  const filtered = mbids.filter((id) => id !== mbid);
  if (filtered.length === mbids.length) return;
  await writeMbidArray(playlistId, filtered);
}

export async function getPlaylistSongIds(
  playlistId: string,
): Promise<string[]> {
  return readMbidArray(playlistId);
}

export async function reorderPlaylistSongs(
  playlistId: string,
  mbids: string[],
): Promise<void> {
  await writeMbidArray(playlistId, mbids);
}

export async function getPlaylistSongCount(
  playlistId: string,
): Promise<number> {
  const mbids = await readMbidArray(playlistId);
  return mbids.length;
}

export async function isSongInPlaylist(
  playlistId: string,
  mbid: string,
): Promise<boolean> {
  if (!mbid) return false;
  const mbids = await readMbidArray(playlistId);
  return mbids.includes(mbid);
}

export async function getPlaylistsForSong(
  mbid: string,
): Promise<SelftifyPlaylist[]> {
  if (!mbid) return [];
  const all = await getAllPlaylists();
  const result: SelftifyPlaylist[] = [];
  for (const pl of all) {
    const mbids = await readMbidArray(pl.id);
    if (mbids.includes(mbid)) {
      result.push(pl);
    }
  }
  return result;
}
