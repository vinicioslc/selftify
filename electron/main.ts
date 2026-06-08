import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'path';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import fs from 'fs';
import { execFile, execFileSync } from 'child_process';
import Store from 'electron-store';
import { tmpdir } from 'os';

import { electronImageStore } from './image-store';
import { TaskQueue } from './queue';

let mainWindow: BrowserWindow | null = null;

const store = new Store<any>({
  defaults: {
    window_width: 1200,
    window_height: 800,
  },
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: store.get('window_width', 1200) as number,
    height: store.get('window_height', 800) as number,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('resize', () => {
    if (mainWindow) {
      const [w, h] = mainWindow.getSize();
      store.set('window_width', w);
      store.set('window_height', h);
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// ── Dialog IPC ──

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('dialog:open-file', async (_event, options) => {
  const result = await dialog.showOpenDialog({
    ...options,
    properties: options?.properties ?? ['openFile'],
  });
  return result.filePaths[0] || null;
});

// ── Filesystem IPC ──

ipcMain.handle('fs:read-file', async (_event, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath);
    return new Uint8Array(data);
  } catch (err) {
    console.warn("[main] fs:read-file error:", err);
    return null;
  }
});

ipcMain.handle('fs:read-directory', async (_event, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
      path: join(dirPath, e.name),
    }));
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      fs.mkdirSync(dirPath, { recursive: true });
    } else {
      console.warn("[main] fs:read-directory error:", err);
    }
    return [];
  }
});

ipcMain.handle('fs:file-exists', async (_event, filePath: string) => {
  try {
    return fs.existsSync(filePath);
  } catch (err) {
    console.warn("[main] fs:file-exists error:", err);
    return false;
  }
});

ipcMain.handle('fs:file-stats', async (_event, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, modifiedAt: stat.mtimeMs };
  } catch (err) {
    console.warn("[main] fs:file-stats error:", err);
    return null;
  }
});

ipcMain.handle('fs:write-file', async (_event, filePath: string, data: number[]) => {
  try {
    fs.writeFileSync(filePath, Buffer.from(data));
    return true;
  } catch (err) {
    console.warn("[main] fs:write-file error:", err);
    return false;
  }
});

ipcMain.handle('fs:delete-file', async (_event, filePath: string) => {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.warn("[main] fs:delete-file error:", err);
    return false;
  }
});

ipcMain.handle('fs:create-directory', async (_event, dirPath: string) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  } catch (err) {
    console.warn("[main] fs:create-directory error:", err);
    return false;
  }
});

ipcMain.handle('fs:rename-file', async (_event, oldPath: string, newPath: string) => {
  try {
    fs.renameSync(oldPath, newPath);
    return true;
  } catch (err) {
    console.warn("[main] fs:rename-file error:", err);
    return false;
  }
});

// ── Settings IPC ──

ipcMain.handle('settings:get', async (_event, key: string) => {
  return store.get(key, null);
});

ipcMain.on('settings:set', (_event, key: string, value: any) => {
  store.set(key, value);
});

// ── YouTube CORS proxy (fetch through main process) ──

ipcMain.handle('yt:fetch', async (_event, { url, init }: { url: string; init?: Record<string, any> }) => {
  try {
    let body: BodyInit | undefined;
    if (init?.body != null) {
      if (typeof init.body === 'string') {
        body = init.body;
      } else if (Array.isArray(init.body)) {
        body = Buffer.from(init.body);
      } else {
        body = String(init.body);
      }
    }
    const response = await fetch(url, {
      method: init?.method || 'GET',
      headers: init?.headers || {},
      body,
    });
    const rawBody = await response.arrayBuffer();
    const headers: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => { headers[key] = value; });
    return { ok: response.ok, status: response.status, statusText: response.statusText, headers, body: Array.from(new Uint8Array(rawBody)) };
  } catch (err: any) {
    throw new Error(err.message || 'yt:fetch failed');
  }
});

// ── Image CORS proxy (fetch through main process, no CORS) ──

ipcMain.handle('image:fetch', async (_event, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string | number[] }) => {
  try {
    const mergedHeaders: Record<string, string> = {
      "User-Agent": "Selftify/1.0.0 (https://github.com/anomalyco/selftify)",
      ...(options?.headers || {}),
    };
    let body: BodyInit | undefined;
    if (options?.body != null) {
      if (typeof options.body === 'string') {
        body = options.body;
      } else if (Array.isArray(options.body)) {
        body = Buffer.from(options.body);
      }
    }
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: mergedHeaders,
      body,
    });
    const rawBody = await response.arrayBuffer();
    const headers: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => { headers[key] = value; });
    return { status: response.status, headers, body: Array.from(new Uint8Array(rawBody)) };
  } catch (err: any) {
    return { status: 0, headers: {}, body: [] };
  }
});

// ── YouTube yt-dlp — TaskQueue + cache ──

const ytQueue = new TaskQueue();
const ytSearchCache = new Map<string, { items: YtDlpSearchItem[]; ts: number }>();
const ytStreamCache = new Map<string, { url: string; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const COOKIE_FILE = join(tmpdir(), 'selftify-cookies.txt');
const COOKIE_INVALID_MSG = "The provided YouTube account cookies are no longer valid";

function ensureCookieFile(cookies?: string): boolean {
  if (!cookies) {
    try { fs.unlinkSync(COOKIE_FILE); } catch (err) { console.warn("[main] unlink cookie file error:", err); }
    return false;
  }
  try {
    fs.writeFileSync(COOKIE_FILE, cookies, 'utf-8');
    return true;
  } catch (err) {
    console.warn("[main] write cookie file error:", err);
    return false;
  }
}

function withCookieArgs(args: string[], cookies?: string): string[] {
  if (cookies && ensureCookieFile(cookies)) {
    args.push('--cookies', COOKIE_FILE);
  }
  return args;
}

interface YtDlpSearchItem {
  id: string;
  title: string;
  duration: number | null;
  uploader: string;
  thumbnail?: string;
}

interface YoutubeDownloadRequest {
  searchQuery: string;
  videoId: string;
  downloadFolder: string;
  metadata: {
    title: string;
    artist: string;
    album?: string;
    albumArtist?: string;
    trackNumber?: number;
    discNumber?: number;
    releaseYear?: number;
    coverArtUrl?: string | null;
    mbzRecordingId?: string;
    mbzTrackId?: string;
    genres?: string[];
  };
}

function getYtDlpBinary(): string {
  try {
    execFileSync('yt-dlp', ['--version'], { timeout: 5000 });
    return 'yt-dlp';
  } catch (err) {
    console.warn("[main] yt-dlp not found, trying yt-dlp_x86:", err);
    try {
      execFileSync('yt-dlp_x86', ['--version'], { timeout: 5000 });
      return 'yt-dlp_x86';
    } catch (err2) {
      console.warn("[main] yt-dlp_x86 also not found:", err2);
      return 'yt-dlp';
    }
  }
}

const ytDlpBin = getYtDlpBinary();

ytQueue.register('yt:search', async (payload: unknown) => {
  const p = payload as { query: string; cookies?: string };
  const query = typeof payload === 'string' ? payload : p.query;
  const cookieStr = typeof payload === 'string' ? undefined : p.cookies;
  const cached = ytSearchCache.get(query);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.items;

  const args = withCookieArgs([
    `ytsearch20:${query}`,
    '--skip-download',
    '--print',
    '%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(thumbnail)s',
  ], cookieStr);
  const items = await execYtDlp<YtDlpSearchItem[]>(args, (stdout) => {
    const lines = stdout.trim().split('\n').filter(Boolean);
    return lines.map((line) => {
      const parts = line.split('\t');
      return {
        id: parts[0] || '',
        title: parts[1] || '',
        duration: parts[2] ? parseInt(parts[2], 10) || null : null,
        uploader: parts[3] || '',
        thumbnail: parts[4] || undefined,
      };
    });
  });
  ytSearchCache.set(query, { items, ts: Date.now() });
  return items;
});

ytQueue.register('yt:stream-url', async (payload: unknown) => {
  const p = payload as { videoId: string; cookies?: string };
  const videoId = typeof payload === 'string' ? payload : p.videoId;
  const cookieStr = typeof payload === 'string' ? undefined : p.cookies;
  const cached = ytStreamCache.get(videoId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.url;

  const target = `https://music.youtube.com/watch?v=${videoId}`;
  const args = withCookieArgs([
    '--print', 'url',
    '--format', 'bestaudio[ext=webm]/bestaudio',
    '--no-playlist',
    target,
  ], cookieStr);
  const url = await execYtDlp<string | null>(args, (stdout) => {
    const line = stdout.trim().split('\n')[0];
    return line || null;
  });
  if (url) ytStreamCache.set(videoId, { url, ts: Date.now() });
  return url;
});

ytQueue.register('yt:download', async (payload: unknown) => {
  const request = payload as YoutubeDownloadRequest;
  const artist = request.metadata.artist.replace(/[<>:"/\\|?*]/g, '_');
  const album = (request.metadata.album || 'Singles').replace(/[<>:"/\\|?*]/g, '_');
  const title = request.metadata.title.replace(/[<>:"/\\|?*]/g, '_');
  const trackNum = request.metadata.trackNumber
    ? `${String(request.metadata.trackNumber).padStart(2, '0')} - `
    : '';

  const outputDir = join(request.downloadFolder, artist, album);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = join(outputDir, `${trackNum}${title}.%(ext)s`);
  const args = [
    `https://music.youtube.com/watch?v=${request.videoId}`,
    '--extract-audio',
    '--audio-format', 'm4a',
    '--output', outputPath,
    '--no-playlist',
    '--embed-metadata',
  ];

  return new Promise<string>((resolve, reject) => {
    execFile(ytDlpBin, args, { timeout: 120000 }, (error) => {
      if (error) {
        reject(new Error(`yt-dlp download failed: ${error.message}`));
        return;
      }
      const finalPath = join(outputDir, `${trackNum}${title}.m4a`);
      resolve(finalPath);
    });
  });
});

interface YtVideoInfo {
  title: string;
  uploader: string;
  duration: number;
  thumbnail?: string;
}

const ytVideoInfoCache = new Map<string, { info: YtVideoInfo; ts: number }>();

ytQueue.register('yt:get-video-info', async (payload: unknown) => {
  const videoId = payload as string;
  const cached = ytVideoInfoCache.get(videoId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.info;

  const args = [
    `https://music.youtube.com/watch?v=${videoId}`,
    '--skip-download',
    '--print',
    '%(title)s\t%(uploader)s\t%(duration)s\t%(thumbnail)s',
  ];
  const info = await execYtDlp<YtVideoInfo | null>(args, (stdout) => {
    const line = stdout.trim().split('\n')[0];
    if (!line) return null;
    const parts = line.split('\t');
    return {
      title: parts[0] || '',
      uploader: parts[1] || '',
      duration: parts[2] ? parseInt(parts[2], 10) || 0 : 0,
      thumbnail: parts[3] || undefined,
    };
  });
  if (info) ytVideoInfoCache.set(videoId, { info, ts: Date.now() });
  return info;
});

function execYtDlp<T>(args: string[], parse: (stdout: string) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(ytDlpBin, args, { timeout: 60000 }, (error, stdout, stderr) => {
      // Always log stderr for diagnostics, even on success
      const stderrTrimmed = (stderr || '').trim();
      if (stderrTrimmed) {
        console.warn('[yt-dlp] stderr:', stderrTrimmed.slice(0, 500));
        if (stderrTrimmed.includes(COOKIE_INVALID_MSG)) {
          mainWindow?.webContents.send('yt:cookies-invalid');
        }
      }

      if (error) {
        // If yt-dlp failed with an error AND stdout is present, try to parse it.
        // BUT: if stdout is only whitespace/newlines OR parsing yields empty,
        // reject so the caller sees the real error instead of silently getting [].
        const hasRealStdout = !!(stdout && stdout.trim());
        let parsed: T | null = null;
        let parseError: Error | null = null;

        if (hasRealStdout) {
          try {
            parsed = parse(stdout);
          } catch (err) {
            parseError = err instanceof Error ? err : new Error(String(err));
          }
        }

        // Only resolve with parsed data if it's non-empty (meaningful results).
        // If empty or parse failed, reject with the original yt-dlp error.
        if (parsed !== null && Array.isArray(parsed) && (parsed as unknown[]).length > 0) {
          resolve(parsed);
          return;
        }

        const msg = parseError
          ? `yt-dlp parse error: ${parseError.message} (stderr: ${stderrTrimmed.slice(0, 200)})`
          : `yt-dlp failed: ${error.message}${stderrTrimmed ? ` (stderr: ${stderrTrimmed.slice(0, 200)})` : ''}`;
        reject(new Error(msg));
        return;
      }

      resolve(parse(stdout));
    });
  });
}

ipcMain.handle('yt:search', async (_event, payload: string | { query: string; cookies?: string }): Promise<YtDlpSearchItem[]> => {
  return ytQueue.add<YtDlpSearchItem[]>('yt:search', payload);
});

ipcMain.handle('yt:download', async (_event, request: YoutubeDownloadRequest): Promise<string> => {
  return ytQueue.add<string>('yt:download', request, 'normal');
});

ipcMain.handle('yt:stream-url', async (_event, payload: string | { videoId: string; cookies?: string }): Promise<string | null> => {
  return ytQueue.add<string | null>('yt:stream-url', payload);
});

ipcMain.handle('yt:get-video-info', async (_event, videoId: string): Promise<YtVideoInfo | null> => {
  return ytQueue.add<YtVideoInfo | null>('yt:get-video-info', videoId);
});

// ── Download Queue IPC ──

interface DownloadMp3Request {
  videoId: string;
  downloadFolder: string;
  metadata: {
    title: string;
    artist: string;
    album?: string;
    albumArtist?: string;
    trackNumber?: number;
    discNumber?: number;
    releaseYear?: number;
    genres?: string[];
  };
}

interface ProcessCoverRequest {
  imageData: number[];
  outputDir: string;
}

interface EmbedArtworkRequest {
  audioPath: string;
  coverPath: string;
  metadata?: {
    title: string;
    artist: string;
    album?: string;
    albumArtist?: string;
    trackNumber?: number;
    discNumber?: number;
    releaseYear?: number;
    genres?: string[];
    mbzRecordingId?: string;
    mbzArtistId?: string;
  };
}

ytQueue.register('yt:download-mp3', async (payload: unknown) => {
  const p = payload as DownloadMp3Request;
  const safeArtist = p.metadata.artist.replace(/[<>:"/\\|?*]/g, '_');
  const safeTitle = p.metadata.title.replace(/[<>:"/\\|?*]/g, '_');

  const prefix = p.metadata.trackNumber
    ? `${String(p.metadata.trackNumber).padStart(2, '0')} - `
    : '';

  let albumDir: string;
  if (p.metadata.album) {
    const safeAlbum = p.metadata.album.replace(/[<>:"/\\|?*]/g, '_');
    albumDir = safeAlbum;
  } else {
    albumDir = `${safeTitle} (Single)`;
  }

  const filename = `${prefix}${safeTitle}`;
  const outputDir = join(p.downloadFolder, safeArtist, albumDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${filename}.%(ext)s`);

  return new Promise<string>((resolve, reject) => {
    const args = [
      `https://music.youtube.com/watch?v=${p.videoId}`,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--output', outputPath,
      '--no-playlist',
      '--no-embed-metadata',
      '--no-embed-thumbnail',
    ];
    execFile(ytDlpBin, args, { timeout: 180000 }, (error) => {
      if (error) {
        reject(new Error(`yt-dlp download failed: ${error.message}`));
        return;
      }
      const finalPath = join(outputDir, `${filename}.mp3`);
      resolve(finalPath);
    });
  });
});

function getImageDimensions(filePath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0',
      filePath,
    ], { timeout: 10000 }, (err, stdout) => {
      if (err) return reject(err);
      const trimmed = stdout.trim();
      const parts = trimmed.split('x');
      if (parts.length !== 2) return reject(new Error(`ffprobe parse error: "${trimmed}"`));
      resolve({ width: parseInt(parts[0], 10), height: parseInt(parts[1], 10) });
    });
  });
}

function execFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 30000 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function detectImageFormat(bytes: number[]): string | null {
  if (bytes.length < 2) return null;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'webp';
  return null;
}

ytQueue.register('yt:process-cover', async (payload: unknown) => {
  const p = payload as ProcessCoverRequest;
  const ext = detectImageFormat(p.imageData) || 'jpg';
  const tmpIn = join(tmpdir(), `selftify-cover-in-${Date.now()}.${ext}`);
  const finalPath = join(p.outputDir, '.img', 'cover.jpg');

  fs.writeFileSync(tmpIn, Buffer.from(p.imageData));
  try {
    const dims = await getImageDimensions(tmpIn);

    let scale = 1.0;
    const minSide = Math.min(dims.width, dims.height);
    const maxSide = Math.max(dims.width, dims.height);

    if (minSide < 500) {
      scale = 500 / minSide;
    } else if (maxSide > 1000) {
      scale = 1000 / maxSide;
    }

    const newW = Math.floor(dims.width * scale);
    const newH = Math.floor(dims.height * scale);
    const cropSize = Math.min(newW, newH);

    fs.mkdirSync(join(p.outputDir, '.img'), { recursive: true });

    await execFfmpeg([
      '-y',
      '-i', tmpIn,
      '-vf', `scale=${newW}:${newH}:force_original_aspect_ratio=decrease,crop=${cropSize}:${cropSize}`,
      '-q:v', '2',
      finalPath,
    ]);

    return finalPath;
  } catch (err) {
    console.error('[yt:process-cover] failed:', err);
    try { fs.rmdirSync(join(p.outputDir, '.img')); } catch { /* ignore */ }
    return null;
  } finally {
    try { fs.unlinkSync(tmpIn); } catch { /* ignore */ }
  }
});

ytQueue.register('yt:embed-artwork', async (payload: unknown) => {
  const p = payload as EmbedArtworkRequest;
  const tmpFile = p.audioPath + '.tmp.mp3';

  const meta = p.metadata;
  const ffmpegArgs = [
    '-y',
    '-i', p.audioPath,
    '-i', p.coverPath,
    '-map', '0',
    '-map', '1',
    '-c', 'copy',
    '-id3v2_version', '3',
    '-metadata:s:v', 'title=Album cover',
    '-metadata', `title=${meta?.title ?? ''}`,
    '-metadata', `artist=${meta?.artist ?? ''}`,
    '-metadata', `album=${meta?.album ?? ''}`,
    '-metadata', `album_artist=${meta?.albumArtist ?? ''}`,
    '-metadata', `track=${meta?.trackNumber ?? ''}`,
    '-metadata', `disc=${meta?.discNumber ?? ''}`,
    '-metadata', `date=${meta?.releaseYear ?? ''}`,
    '-metadata', `genre=${meta?.genres?.join('; ') ?? ''}`,
    tmpFile,
  ];

  if (meta?.mbzRecordingId) {
    ffmpegArgs.push('-metadata', `musicbrainz_trackid=${meta.mbzRecordingId}`);
  }
  if (meta?.mbzArtistId) {
    ffmpegArgs.push('-metadata', `musicbrainz_artistid=${meta.mbzArtistId}`);
  }

  await execFfmpeg(ffmpegArgs);

  fs.renameSync(tmpFile, p.audioPath);
});

ipcMain.handle('yt:download-mp3', async (_event, request: DownloadMp3Request): Promise<string> => {
  return ytQueue.add<string>('yt:download-mp3', request, 'normal');
});

ipcMain.handle('yt:process-cover', async (_event, request: ProcessCoverRequest): Promise<string | null> => {
  return ytQueue.add<string | null>('yt:process-cover', request, 'normal');
});

ipcMain.handle('yt:embed-artwork', async (_event, request: EmbedArtworkRequest): Promise<void> => {
  return ytQueue.add<void>('yt:embed-artwork', request, 'normal');
});

// ── Image Cache IPC ──

ipcMain.handle('image-cache:store', async (_event, hash: string, buffer: number[], format: string, meta?: any) => {
  return electronImageStore.store(hash, buffer, format, meta);
});

ipcMain.handle('image-cache:get', async (_event, hash: string) => {
  return electronImageStore.get(hash);
});

ipcMain.handle('image-cache:get-by-url', async (_event, url: string) => {
  return electronImageStore.getBySourceUrl(url);
});

ipcMain.handle('image-cache:find', async (_event, query: any) => {
  return electronImageStore.find(query);
});

ipcMain.handle('image-cache:clear', async () => {
  return electronImageStore.clear();
});

// ── Local file metadata parsing (IPC so music-metadata runs in Node.js) ──

ipcMain.handle('local:parse-file', async (_event, filePath: string) => {
  try {
    const fs = require('fs');
    const { parseBuffer } = require('music-metadata');
    const data = fs.readFileSync(filePath);
    const result = await Promise.race([
      parseBuffer(data, { path: filePath }, { duration: true, skipCovers: false }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('parseBuffer timeout')), 15000)
      ),
    ]);
    const c = result.common;
    const f = result.format;

    let picture: { data: number[]; format: string } | null = null;
    if (c.picture && c.picture.length > 0) {
      const pic = c.picture[0];
      picture = {
        data: Array.from(new Uint8Array(pic.data.buffer, pic.data.byteOffset, pic.data.byteLength)),
        format: pic.format || 'image/jpeg',
      };
    }

    return {
      name: c.title || null,
      artist: c.artist || c.albumartist || null,
      album: c.album || null,
      albumArtist: c.albumartist || null,
      trackNumber: c.track?.no || null,
      discNumber: c.disk?.no || null,
      duration: f.duration ? f.duration * 1000 : null,
      bitrate: f.bitrate || null,
      sampleRate: f.sampleRate || null,
      genre: c.genre?.[0] || null,
      year: c.year || null,
      mbzRecordingId: c.musicbrainz_recordingid || null,
      mbzTrackId: c.musicbrainz_trackid || null,
      mbzAlbumId: c.musicbrainz_albumid || null,
      mbzReleaseGroupId: c.musicbrainz_releasegroupid || null,
      mbzArtistId: c.musicbrainz_artistid?.[0] || null,
      picture,
    };
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
});

// ── App lifecycle ──

// ── Window Controls IPC ──

ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:is-maximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ytmusicplayer');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
