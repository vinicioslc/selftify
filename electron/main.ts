import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'path';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import fs from 'fs';
import { execFile, execFileSync } from 'child_process';
import Store from 'electron-store';

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
  } catch {
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
  } catch {
    return [];
  }
});

ipcMain.handle('fs:file-exists', async (_event, filePath: string) => {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
});

ipcMain.handle('fs:file-stats', async (_event, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, modifiedAt: stat.mtimeMs };
  } catch {
    return null;
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

// ── YouTube yt-dlp — TaskQueue + cache ──

const ytQueue = new TaskQueue();
const ytSearchCache = new Map<string, { items: YtDlpSearchItem[]; ts: number }>();
const ytStreamCache = new Map<string, { url: string; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  } catch {
    try {
      execFileSync('yt-dlp_x86', ['--version'], { timeout: 5000 });
      return 'yt-dlp_x86';
    } catch {
      return 'yt-dlp';
    }
  }
}

const ytDlpBin = getYtDlpBinary();

ytQueue.register('yt:search', async (payload: unknown) => {
  const query = payload as string;
  const cached = ytSearchCache.get(query);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.items;

  const args = [
    `ytsearch20:${query}`,
    '--skip-download',
    '--print',
    '%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(thumbnail)s',
  ];
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
  const videoId = payload as string;
  const cached = ytStreamCache.get(videoId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.url;

  const target = `https://music.youtube.com/watch?v=${videoId}`;
  const args = [
    '--print', 'url',
    '--format', 'bestaudio[ext=webm]/bestaudio',
    '--no-playlist',
    target,
  ];
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

function execYtDlp<T>(args: string[], parse: (stdout: string) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(ytDlpBin, args, { timeout: 60000 }, (error, stdout) => {
      if (error) {
        reject(new Error(`yt-dlp failed: ${error.message}`));
        return;
      }
      resolve(parse(stdout));
    });
  });
}

ipcMain.handle('yt:search', async (_event, query: string): Promise<YtDlpSearchItem[]> => {
  return ytQueue.add<YtDlpSearchItem[]>('yt:search', query);
});

ipcMain.handle('yt:download', async (_event, request: YoutubeDownloadRequest): Promise<string> => {
  return ytQueue.add<string>('yt:download', request, 'normal');
});

ipcMain.handle('yt:stream-url', async (_event, videoId: string): Promise<string | null> => {
  return ytQueue.add<string | null>('yt:stream-url', videoId);
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
