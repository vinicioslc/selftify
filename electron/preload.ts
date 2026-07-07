import { contextBridge, ipcRenderer } from 'electron';

const api = {
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
    readDirectory: (path: string) => ipcRenderer.invoke('fs:read-directory', path),
    fileExists: (path: string) => ipcRenderer.invoke('fs:file-exists', path),
    getFileStats: (path: string) => ipcRenderer.invoke('fs:file-stats', path),
    writeFile: (path: string, data: number[]) => ipcRenderer.invoke('fs:write-file', path, data),
    deleteFile: (path: string) => ipcRenderer.invoke('fs:delete-file', path),
    createDirectory: (path: string) => ipcRenderer.invoke('fs:create-directory', path),
    renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename-file', oldPath, newPath),
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
    search: (query: string, cookies?: string) => ipcRenderer.invoke('yt:search', cookies ? { query, cookies } : query),
    download: (request: any) => ipcRenderer.invoke('yt:download', request),
    getStreamUrl: (videoId: string, cookies?: string) => ipcRenderer.invoke('yt:stream-url', cookies ? { videoId, cookies } : videoId),
    getVideoInfo: (videoId: string, cookies?: string) => ipcRenderer.invoke('yt:get-video-info', cookies ? { videoId, cookies } : videoId),
    downloadMp3: (request: any) => ipcRenderer.invoke('yt:download-mp3', request),
    processCover: (request: any) => ipcRenderer.invoke('yt:process-cover', request),
    embedArtwork: (request: any) => ipcRenderer.invoke('yt:embed-artwork', request),
    checkVersion: () => ipcRenderer.invoke('yt:check-version'),
    update: () => ipcRenderer.invoke('yt:update'),
  },
  onCookiesInvalid: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('yt:cookies-invalid', handler);
    return () => { ipcRenderer.removeListener('yt:cookies-invalid', handler); };
  },
  onDownloadProgress: (callback: (event: { taskId: string; percent: number; step: string }) => void) => {
    const handler = (_event: any, data: { taskId: string; percent: number; step: string }) => callback(data);
    ipcRenderer.on('download:progress', handler);
    return () => { ipcRenderer.removeListener('download:progress', handler); };
  },
  onMediaAction: (callback: (action: string) => void) => {
    const handler = (_event: any, action: string) => callback(action);
    ipcRenderer.on('media:action', handler);
    return () => { ipcRenderer.removeListener('media:action', handler); };
  },
  sendMediaPlaybackState: (playing: boolean) => {
    ipcRenderer.send('media:playback-state', playing);
  },

  download: {
    enqueueSong: (song) => ipcRenderer.invoke('download:enqueue', song),
    enqueueMultiple: (songs) => ipcRenderer.invoke('download:enqueue-multiple', songs),
    cancelTask: (taskId) => ipcRenderer.invoke('download:cancel', taskId),
    retryTask: (taskId) => ipcRenderer.invoke('download:retry', taskId),
    getAllTasks: () => ipcRenderer.invoke('download:list'),
    clearCompleted: () => ipcRenderer.invoke('download:clear-completed'),
    updateTask: (taskId, partial) => ipcRenderer.invoke('download:update-task', taskId, partial),
    onTaskUpdate: (callback: (task: any) => void) => {
      const handler = (_event: any, task: any) => callback(task);
      ipcRenderer.on('download:task-update', handler);
      return () => { ipcRenderer.removeListener('download:task-update', handler); };
    },
  },
  local: {
    parseFile: (filePath: string) => ipcRenderer.invoke('local:parse-file', filePath),
    replaceCover: (request: { audioPath: string; coverPath: string; metadata?: Record<string, unknown> }) =>
      ipcRenderer.invoke('local:replace-cover', request),
    updateMetadata: (request: { audioPath: string; metadata?: Record<string, unknown> }) =>
      ipcRenderer.invoke('local:update-metadata', request),
  },
  platformFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: any }) =>
    ipcRenderer.invoke('platform:fetch', url, options),
  imageFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: any }) =>
    ipcRenderer.invoke('image:fetch', url, options),
  artworkSearch: (provider: string, input: any) =>
    ipcRenderer.invoke('artwork:search', provider, input),
  wikiSearch: (query: string) =>
    ipcRenderer.invoke('wiki:search', query),

  lyrics: {
    getRemoteLyricsBySong: (song: any) => ipcRenderer.invoke('lyric:by-song', song),
    searchRemoteLyrics: (params: any) => ipcRenderer.invoke('lyric:search', params),
    getRemoteLyricsByRemoteId: (query: any) => ipcRenderer.invoke('lyric:by-remote-id', query),
  },

  mbz: {
    fetch: (url: string, headers: Record<string, string>) =>
      ipcRenderer.invoke('mbz:fetch', url, headers),
  },

  musicbrainzOAuth: {
    authorize: (clientId: string) =>
      ipcRenderer.invoke('oauth:musicbrainz:authorize', clientId),
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
