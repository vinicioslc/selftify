# Download Queue — API & Data

## Types — `src/types/domain-types.ts`

```typescript
enum DownloadStatus {
  PENDING = "pending",
  SEARCHING = "searching",
  DOWNLOADING_AUDIO = "downloading-audio",
  GETTING_COVER = "getting-cover",
  PROCESSING_COVER = "processing-cover",
  EMBEDDING_COVER = "embedding-cover",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

type DownloadTask = {
  id: string;
  song: Song;
  status: DownloadStatus;
  progress: number;            // 0-100
  stepLabel: string;           // user-facing label
  error?: string;
  videoId?: string;
  audioPath?: string;
  coverPath?: string;
  createdAt: number;
  completedAt?: number;
};
```

## Store — `src/stores/download.store.ts`

Zustand store, no `persist`.

```typescript
interface DownloadStore {
  tasks: DownloadTask[];
  activeTaskId: string | null;
  isPanelOpen: boolean;

  enqueueSong: (song: Song) => void;
  enqueueMultiple: (songs: Song[]) => void;
  cancelTask: (taskId: string) => void;
  retryTask: (taskId: string) => void;
  clearCompleted: () => void;
  updateTask: (taskId: string, partial: Partial<DownloadTask>) => void;
  setPanelOpen: (open: boolean) => void;

  // Derived
  getPendingCount: () => number;
  getCompletedCount: () => number;
  getFailedCount: () => number;
}
```

**Internal actions:**
- `enqueueSong`: if `song.id` not already in tasks → push PENDING task → call `processNext()`
- `cancelTask`: set status CANCELLED → if audioPath exists, call `platform.deleteFile(audioPath)` → call `processNext()`
- `retryTask`: reset to PENDING, clear error/audioPath/coverPath → call `processNext()`
- `processNext`: find first PENDING task → set as `activeTaskId` → call `processTask(task)` → on completion/rejection, clear `activeTaskId` → call itself again

## Platform Abstraction — `src/services/download-platform.ts`

```typescript
interface DownloadPlatform {
  readonly supportsAudioConversion: boolean;   // Electron=true, Web=false
  readonly supportsCoverEmbedding: boolean;    // Electron=true, Web=false

  downloadAudio(params: {
    videoId: string;
    songName: string;
    artistName: string;
    albumName?: string;
    trackNumber?: number;
    releaseYear?: number;
    genres?: string[];
    downloadFolder: string;
  }): Promise<string>;

  processCover(params: {
    imageData: number[];           // raw image bytes (JPEG/PNG)
    outputDir: string;
  }): Promise<string | null>;

  embedCover(params: {
    audioPath: string;
    coverPath: string;
  }): Promise<void>;

  deleteFile(path: string): Promise<boolean>;
  fileExists(path: string): Promise<boolean>;
}

// Electron implementation
class ElectronDownloadPlatform implements DownloadPlatform {
  readonly supportsAudioConversion = true;
  readonly supportsCoverEmbedding = true;

  async downloadAudio(params) {
    const api = getElectronApi();
    return api!.yt.downloadMp3({ ...params });
  }

  async processCover(params) {
    const api = getElectronApi();
    return api!.yt.processCover({ imageData: params.imageData, outputDir: params.outputDir });
  }

  async embedCover(params) {
    const api = getElectronApi();
    await api!.yt.embedArtwork(params);
  }

  async deleteFile(path) { return getElectronApi()!.fs.deleteFile(path); }
  async fileExists(path) { return getElectronApi()!.fs.fileExists(path); }
}

// Web stub (future mobile usage)
class WebDownloadPlatform implements DownloadPlatform {
  readonly supportsAudioConversion = false;
  readonly supportsCoverEmbedding = false;
  // Stub: throw or no-op
}

function getDownloadPlatform(): DownloadPlatform {
  return (window as any).electronApi
    ? new ElectronDownloadPlatform()
    : new WebDownloadPlatform();
}
```

## IPC — Electron Main Process

### `yt:download-mp3` (invoke)

**Input:**
```typescript
{
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
```

**Output:** `string` — absolute path to downloaded `.mp3` file

**Handler implementation (`electron/main.ts`):**

```typescript
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
      '--no-embed-metadata',         // Nenhuma tag do yt-dlp — tags via ffmpeg
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
```

### `yt:process-cover` (invoke)

**Input:**
```typescript
{
  imageData: number[];      // raw JPEG/PNG bytes
  outputDir: string;         // absolute path, already created by yt:download-mp3
}
```

**Output:** `string | null` — path to `cover.jpg`, or null on failure

**Handler implementation:**

```typescript
ytQueue.register('yt:process-cover', async (payload: unknown) => {
  const p = payload as ProcessCoverRequest;
  const ext = detectImageFormat(p.imageData) || 'jpg';  // check JPEG vs PNG magic bytes
  const tmpIn = join(tmpdir(), `selftify-cover-in-${Date.now()}.${ext}`);
  const tmpOut = join(tmpdir(), `selftify-cover-cropped-${Date.now()}.jpg`);
  const finalPath = join(p.outputDir, 'cover.jpg');

  // Write temp input file
  fs.writeFileSync(tmpIn, Buffer.from(p.imageData));
  try {
    // Step 1: Get original dimensions via ffprobe
    const dims = await getImageDimensions(tmpIn);  // returns { width, height }

    // Step 2: Compute target size
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

    // Step 3: ffmpeg scale + crop to square in one pass
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
    return null;
  } finally {
    // Cleanup temps
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
});
```

Helper functions (also in `electron/main.ts` or a shared module):

```typescript
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
      const parts = stdout.trim().split('x');
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
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'webp';
  return null;
}
```

### `yt:embed-artwork` (invoke)

**Input:**
```typescript
{
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
```

**Output:** `void`

**Handler implementation:**

```typescript
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
```

### Progress Events (main → renderer)

Not a new IPC handle — sent from within TaskQueue handler closures via `mainWindow.webContents.send`:

```typescript
function emitDownloadProgress(taskId: string, percent: number, step: string): void {
  if (mainWindow) {
    mainWindow.webContents.send('download:progress', { taskId, percent, step });
  }
}
```

Usage inside `yt:download-mp3` handler:

```typescript
ytQueue.register('yt:download-mp3', async (payload: unknown) => {
  emitDownloadProgress(p.id, 5, 'downloading');
  // ... monitor yt-dlp stderr for progress, periodically call emit...
  emitDownloadProgress(p.id, 90, 'converting');
  // ... done
  emitDownloadProgress(p.id, 100, 'done');
  return finalPath;
});
```

**Event payload:**
```typescript
type DownloadProgressEvent = {
  taskId: string;
  percent: number;    // 0-100
  step: string;       // machine-readable: "downloading"|"converting"|"processing-cover"|"embedding"|"done"
};
```

## Preload Additions — `electron/preload.ts`

```typescript
const api = {
  // ... existing ...
  yt: {
    // ... existing ...
    downloadMp3: (request: any) => ipcRenderer.invoke('yt:download-mp3', request),
    processCover: (request: any) => ipcRenderer.invoke('yt:process-cover', request),
    embedArtwork: (request: any) => ipcRenderer.invoke('yt:embed-artwork', request),
  },
  onDownloadProgress: (callback: (event: DownloadProgressEvent) => void) => {
    const handler = (_event: any, data: DownloadProgressEvent) => callback(data);
    ipcRenderer.on('download:progress', handler);
    return () => { ipcRenderer.removeListener('download:progress', handler); };
  },
};
```

## Orchestrator Logic — `src/services/download-queue.ts`

### `resolveMbMetadata` — metadados enriquecidos do MusicBrainz

```typescript
type MbMetadata = {
  artistName: string;          // do MB artist-credit
  albumName?: string;          // do MB release
  albumArtistName?: string;    // do MB release artist-credit
  trackNumber?: number;        // do MB release media → tracks (match por recording ID)
  discNumber?: number;         // do MB release media → position
  releaseYear?: number;        // do MB release date
  genres?: string[];           // do MB artist tags
  mbzRecordingId?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzReleaseId?: string;
};

async function resolveMbMetadata(song: Song): Promise<MbMetadata>
```

- Busca recording detail com `inc=artist-credits+releases`
- Busca release detail com `inc=artist-credits+recordings+media` para extrair track/disc por recording ID
- Busca artist detail com `inc=tags` para genres (se song.genres vazio)
- Timeout de 5s por chamada MB

### `processTask` — fluxo completo

```typescript
async function processTask(task: DownloadTask): Promise<void> {
  const platform = getDownloadPlatform();
  const store = useDownloadStore.getState();
  const folder = getDownloadFolder(task.song);
  if (!folder) {
    throw new Error('No download folder configured for this origin');
  }

  // ── Step 1: Search YouTube ──
  store.updateTask(task.id, {
    status: DownloadStatus.SEARCHING,
    progress: 5,
    stepLabel: 'Searching YouTube...',
  });
  const match = await searchAndRank(task.song);
  if (!match) {
    throw new Error('No YouTube match found for this song');
  }
  store.updateTask(task.id, { videoId: match.videoId, progress: 10 });

  // Resolve canonical MusicBrainz metadata
  const meta = await resolveMbMetadata(task.song);

  // ── Step 2: Download MP3 ──
  store.updateTask(task.id, {
    status: DownloadStatus.DOWNLOADING_AUDIO,
    stepLabel: 'Downloading audio...',
  });
  const audioPath = await platform.downloadAudio({
    videoId: match.videoId,
    songName: task.song.name,
    artistName: meta.artistName,       // ← MB canonical name, nunca YouTube channel
    albumName: meta.albumName,
    trackNumber: meta.trackNumber,
    discNumber: meta.discNumber,
    releaseYear: meta.releaseYear,
    genres: meta.genres,
    downloadFolder: folder,
  });
  store.updateTask(task.id, { audioPath, progress: 60 });

  // ── Step 3: Resolve cover source ──
  store.updateTask(task.id, {
    status: DownloadStatus.GETTING_COVER,
    stepLabel: 'Fetching cover art...',
  });
  const coverBytes = await resolveCoverBytes(task.song, match.videoId, meta.artistName, meta.albumName);
  if (!coverBytes) {
    complete(store, task.id);
    return;
  }
  store.updateTask(task.id, { progress: 70 });

  // ── Step 4: Process cover ──
  store.updateTask(task.id, {
    status: DownloadStatus.PROCESSING_COVER,
    stepLabel: 'Processing cover image...',
  });
  const outputDir = dirname(audioPath);
  const coverPath = await platform.processCover({ imageData: coverBytes, outputDir });
  if (!coverPath) {
    complete(store, task.id);
    return;
  }
  store.updateTask(task.id, { coverPath, progress: 85 });

  // ── Step 5: Embed cover + full MB metadata into MP3 ──
  if (platform.supportsCoverEmbedding) {
    store.updateTask(task.id, {
      status: DownloadStatus.EMBEDDING_COVER,
      stepLabel: 'Embedding into MP3...',
    });
    try {
      await platform.embedCover({
        audioPath,
        coverPath,
        metadata: {
          title: task.song.name,
          artist: meta.artistName,
          album: meta.albumName,
          albumArtist: meta.albumArtistName || meta.artistName,
          trackNumber: meta.trackNumber,
          discNumber: meta.discNumber,
          releaseYear: meta.releaseYear,
          genres: meta.genres,
          mbzRecordingId: meta.mbzRecordingId,
          mbzArtistId: meta.mbzArtistId,
        },
      });
    } catch {
      console.warn('[download-queue] cover embed failed, cover.jpg saved separately');
    }
  }

  complete(store, task.id);
}
```

### `resolveCoverBytes` — cover resolution (pipeline centralizado primeiro)

```typescript
async function resolveCoverBytes(
  song: Song,
  videoId: string,
  mbArtistName: string,
  mbAlbumName?: string,
): Promise<number[] | null> {
  // 1. Centralized resolveAlbumCover pipeline — .img/ → IndexedDB → Deezer → iTunes
  if (mbArtistName) {
    const result = await resolveAlbumCover({
      artistName: mbArtistName,
      albumName: mbAlbumName,
      mbzArtistId: song.mbzArtistId,
      mbzReleaseGroupId: song.mbzReleaseGroupId,
      mbzReleaseId: song.mbzAlbumId,
    });
    if (result.blobUrl) {
      const resp = await fetch(result.blobUrl);
      const buf = await resp.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    }
  }

  // 2. song.imageUrl (HTTP) → fetch via main process (CORS-free)
  if (song.imageUrl?.startsWith('http')) { ... }

  // 3. song.imageUrl (blob) → fetch in renderer
  if (song.imageUrl?.startsWith('blob:')) { ... }

  // 4. Last resort: YouTube video thumbnail
  if (api?.yt?.getVideoInfo) { ... }

  return null;
}
```

### `resolveCoverBytes` — cover resolution in renderer

```typescript
async function resolveCoverBytes(
  song: Song,
  videoId: string,
): Promise<number[] | null> {
  // 1. Real HTTP URL → fetch via main process (CORS-free)
  if (song.imageUrl?.startsWith('http')) {
    const resp = await fetchImageThroughMain(song.imageUrl);
    if (resp) return resp;
  }

  // 2. Blob URL → fetch in renderer (same origin), get bytes
  if (song.imageUrl?.startsWith('blob:')) {
    try {
      const resp = await fetch(song.imageUrl);
      const buf = await resp.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    } catch {
      // blob may have been revoked — fall through
    }
  }

  // 3. Fallback: YouTube video thumbnail
  const api = getElectronApi();
  if (api?.yt?.getVideoInfo) {
    const info = await api.yt.getVideoInfo(videoId);
    if (info?.thumbnail) {
      const resp = await fetchImageThroughMain(info.thumbnail);
      if (resp) return resp;
    }
  }

  return null;
}

async function fetchImageThroughMain(url: string): Promise<number[] | null> {
  try {
    const api = getElectronApi();
    if (api?.imageFetch) {
      const result = await api.imageFetch(url);
      if (result?.body?.length > 0) return result.body;
    }
    // Fallback: direct fetch (may fail if CORS)
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  } catch {
    return null;
  }
}
```

### `getDownloadFolder`

```typescript
function getDownloadFolder(song: Song): string {
  const origin = useAuthStore.getState().origins.find(o => o.id === song.originId);
  return origin?.downloadFolder || '';
}
```

### `enqueueSong` dedup

```typescript
enqueueSong: (song: Song) => {
  const { tasks } = get();
  // Dedup by song.id
  if (tasks.some(t => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED)) {
    useStatusStore.getState().addMessage(
      'Song is already in download queue', 'info', 'Download'
    );
    return;
  }
  const task: DownloadTask = {
    id: generateId(),
    song,
    status: DownloadStatus.PENDING,
    progress: 0,
    stepLabel: 'Waiting...',
    createdAt: Date.now(),
  };
  set(state => ({ tasks: [...state.tasks, task] }));
  processNext();
},
```

## Data Flow Diagram (IPC)

```
Renderer                             Main Process
──────────────────────────────────────────────────────────
download-queue.ts
  │
  ├─ searchAndRank(song)
  │     └─ IPC: yt:search ─────────→ TaskQueue → yt-dlp
  │
  ├─ platform.downloadAudio(...)
  │     └─ IPC: yt:download-mp3 ───→ TaskQueue → yt-dlp
  │         ←── event: download:progress ──→ updateStore
  │         ←── return: audioPath
  │
  ├─ resolveCoverBytes(song, videoId)
  │     └─ IPC: yt:get-video-info ──→ TaskQueue → yt-dlp
  │         (if fallback to thumbnail)
  │
  ├─ platform.processCover({imageData, outputDir})
  │     └─ IPC: yt:process-cover ───→ TaskQueue → ffmpeg
  │         ←── return: coverPath | null
  │
  └─ platform.embedCover({audioPath, coverPath})
        └─ IPC: yt:embed-artwork ───→ TaskQueue → ffmpeg
            ←── return: void

download.store.ts ←── event: download:progress (taskId, percent, step)
```

## Logging

All IPC handlers log with `[yt-dlp]` / `[download-queue]` prefix:

```
[download-queue] enqueued: <song.name> — <song.artist>
[download-queue] processTask: <task.id> — starting
[download-queue] searchAndRank: <query> — found <videoId>
[download-queue] downloadMp3: <videoId> → <audioPath>
[download-queue] processCover: <outputDir/cover.jpg>
[download-queue] embedArtwork: <audioPath>
[download-queue] completed: <task.id>
[yt-dlp] stderr: ...
```

Use the existing pattern with `console.log` for info and `console.error` for failures.

## IPC — Local File Metadata Parsing

### `local:parse-file` (invoke)

Parses audio file metadata in the Electron main process (Node.js). Avoids Vite bundling issues with `music-metadata` in the renderer context.

**Input:** `string` — absolute file path

**Output:**
```typescript
{
  name?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;         // milliseconds
  bitrate?: number;
  sampleRate?: number;
  genre?: string;
  year?: number;
  mbzRecordingId?: string;
  mbzTrackId?: string;
  mbzAlbumId?: string;
  mbzReleaseGroupId?: string;
  mbzArtistId?: string;
  picture?: { data: number[]; format: string } | null;
  error?: string;            // set if parsing failed
}
```

The handler includes a 15-second timeout via `Promise.race` to prevent hanging on corrupt files. If parsing fails, `{ error: "<message>" }` is returned so the renderer can fall back to path-based metadata.

**Handler location:** `electron/main.ts`

**Implementation:**
```typescript
ipcMain.handle('local:parse-file', async (_event, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath);
    const result = await Promise.race([
      parseBuffer(data, { path: filePath }, { duration: true, skipCovers: false }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('parseBuffer timeout')), 15000)
      ),
    ]);
    // ...extract and return metadata...
  } catch (err) {
    return { error: err.message };
  }
});
```
