import { contextBridge, ipcRenderer } from 'electron';

const api = {
  mpv: {
    isAvailable: () => ipcRenderer.invoke('mpv:is-available'),
    load: (url: string) => ipcRenderer.invoke('mpv:load', url),
    play: () => ipcRenderer.invoke('mpv:play'),
    pause: () => ipcRenderer.invoke('mpv:pause'),
    stop: () => ipcRenderer.invoke('mpv:stop'),
    seek: (secs: number) => ipcRenderer.invoke('mpv:seek', secs),
    volume: (vol?: number) => ipcRenderer.invoke('mpv:volume', vol),
    next: () => ipcRenderer.invoke('mpv:next'),
    prev: () => ipcRenderer.invoke('mpv:prev'),
    clearPlaylist: () => ipcRenderer.invoke('mpv:clear-playlist'),
    append: (url: string, play?: boolean) => ipcRenderer.invoke('mpv:append', url, play),
    getProperty: (prop: string) => ipcRenderer.invoke('mpv:get-property', prop),
    setProperty: (prop: string, val: any) => ipcRenderer.invoke('mpv:set-property', prop, val),
    listDevices: () => ipcRenderer.invoke('mpv:list-devices'),
    setDevice: (name: string) => ipcRenderer.invoke('mpv:set-device', name),
  },
  db: {
    get: (key: string) => ipcRenderer.invoke('db:get', key),
    set: (key: string, value: string, expiresAt?: number) => ipcRenderer.invoke('db:set', key, value, expiresAt),
    delete: (key: string) => ipcRenderer.invoke('db:delete', key),
    queueSave: (data: string) => ipcRenderer.invoke('db:queue-save', data),
    queueLoad: () => ipcRenderer.invoke('db:queue-load'),
    songCacheGet: (id: string) => ipcRenderer.invoke('db:song-cache-get', id),
    songCacheSet: (id: string, data: string) => ipcRenderer.invoke('db:song-cache-set', id, data),
  },
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
};

contextBridge.exposeInMainWorld('electronApi', api);

export type ElectronApi = typeof api;
