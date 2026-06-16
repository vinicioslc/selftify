export interface ElectronMpvApi {
  isAvailable(): Promise<boolean>;
  load(url: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(secs: number): Promise<void>;
  volume(vol?: number): Promise<number | void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  clearPlaylist(): Promise<void>;
  append(url: string, play?: boolean): Promise<void>;
  getProperty(prop: string): Promise<any>;
  setProperty(prop: string, val: any): Promise<void>;
  listDevices(): Promise<{ name: string; description: string }[]>;
  setDevice(name: string): Promise<void>;
}

export interface ElectronDbApi {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiresAt?: number): Promise<void>;
  delete(key: string): Promise<void>;
  queueSave(data: string): Promise<void>;
  queueLoad(): Promise<string | null>;
  songCacheGet(id: string): Promise<string | null>;
  songCacheSet(id: string, data: string): Promise<void>;
}

export interface ElectronFsApi {
  readFile(path: string): Promise<Uint8Array | null>;
  readDirectory(path: string): Promise<{ name: string; isDirectory: boolean; isFile: boolean; path: string }[]>;
  fileExists(path: string): Promise<boolean>;
  getFileStats(path: string): Promise<{ size: number; modifiedAt: number } | null>;
}

export interface ElectronDialogApi {
  openFolderPicker(): Promise<string | null>;
  openFilePicker(options?: any): Promise<string | null>;
}

export interface ElectronSettingsApi {
  get(key: string): Promise<any>;
  set(key: string, value: any): void;
}

export interface ElectronYtApi {
  fetch(url: string, init?: any): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: number[] }>;
}

export interface ElectronWindowControlsApi {
  minimize(): void;
  maximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizeChange(callback: (maximized: boolean) => void): () => void;
}

export interface ElectronImageCacheApi {
  store: (hash: string, buffer: number[], format: string, meta?: Record<string, unknown>) => Promise<void>;
  get: (hash: string) => Promise<any>;
  getBySourceUrl: (url: string) => Promise<any>;
  find: (query: Record<string, unknown>) => Promise<any[]>;
  clear: () => Promise<void>;
}

export interface ElectronLocalApi {
  parseFile: (filePath: string) => Promise<any>;
}

export interface ElectronApi {
  mpv: ElectronMpvApi;
  db: ElectronDbApi;
  fs: ElectronFsApi;
  dialog: ElectronDialogApi;
  settings: ElectronSettingsApi;
  yt: ElectronYtApi;
  windowControls: ElectronWindowControlsApi;
  imageFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: any }) => Promise<{ status: number; headers: Record<string, string>; body: number[] }>;
  imageCache: ElectronImageCacheApi;
  local: ElectronLocalApi;
  artworkSearch: (provider: string, input: any) => Promise<any[]>;
  wikiSearch: (query: string) => Promise<string | null>;
  onCookiesInvalid: (callback: () => void) => () => void;
  onDownloadProgress: (callback: (event: { taskId: string; percent: number; step: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronApi?: ElectronApi;
  }
}
