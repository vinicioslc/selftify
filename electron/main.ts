import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'path';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import fs from 'fs';
import Store from 'electron-store';

import './database';
import { startMpv, quitMpv, isMpvAvailable } from './mpv/manager';
import { registerMpvIpc } from './mpv/ipc';

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
    titleBarStyle: 'hiddenInset',
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

// ── App lifecycle ──

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ytmusicplayer');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerMpvIpc();

  // Attempt to start mpv; if it fails the renderer will detect
  // via mpv:is-available and fall back to Web Audio API.
  try {
    await startMpv();
    console.log('[mpv] Started successfully');
  } catch (err) {
    console.error('[mpv] Failed to start mpv:', err);
    console.log('[mpv] Renderer will use Web Audio API fallback');
  }

  // Log availability for debugging
  console.log(`[mpv] Available: ${isMpvAvailable()}`);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  quitMpv();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitMpv();
});
