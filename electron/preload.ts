import { contextBridge, ipcRenderer } from 'electron';

const api = {
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
    readDirectory: (path: string) => ipcRenderer.invoke('fs:read-directory', path),
    fileExists: (path: string) => ipcRenderer.invoke('fs:file-exists', path),
    getFileStats: (path: string) => ipcRenderer.invoke('fs:file-stats', path),
  },
  dialog: {
    openFolderPicker: () => ipcRenderer.invoke('dialog:open-folder'),
    openFilePicker: (options?: any) => ipcRenderer.invoke('dialog:open-file', options),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: any) => ipcRenderer.send('settings:set', key, value),
  },
  yt: {
    fetch: (url: string, init?: any) => ipcRenderer.invoke('yt:fetch', { url, init }),
    search: (query: string) => ipcRenderer.invoke('yt:search', query),
    download: (request: any) => ipcRenderer.invoke('yt:download', request),
    getStreamUrl: (videoId: string) => ipcRenderer.invoke('yt:stream-url', videoId),
  },
  imageCache: {
    store: (hash: string, buffer: number[], format: string, meta?: Record<string, unknown>) =>
      ipcRenderer.invoke('image-cache:store', hash, buffer, format, meta),
    get: (hash: string) => ipcRenderer.invoke('image-cache:get', hash),
    getBySourceUrl: (url: string) => ipcRenderer.invoke('image-cache:get-by-url', url),
    find: (query: Record<string, unknown>) => ipcRenderer.invoke('image-cache:find', query),
    clear: () => ipcRenderer.invoke('image-cache:clear'),
  },
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (callback: (maximized: boolean) => void) => {
      const handler = (_event: any, maximized: boolean) => callback(maximized);
      ipcRenderer.on('window:maximized-changed', handler);
      return () => { ipcRenderer.removeListener('window:maximized-changed', handler); };
    },
  },
};

contextBridge.exposeInMainWorld('electronApi', api);

export type ElectronApi = typeof api;
