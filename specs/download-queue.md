# Download Queue

## Problem

Users have no way to permanently download YouTube audio as MP3 files with proper cover art. The app currently only streams audio via yt-dlp (ephemeral) and caches cover images separately. There is no offline ownership of music.

## Solution

A download queue system that:
1. Searches YouTube for the best matching video (via existing `searchAndRank`)
2. Downloads audio as MP3 (best quality, via yt-dlp --audio-format mp3 --audio-quality 0)
3. Downloads and processes cover art (crop to square, resize within 500-1000px)
4. Embeds cover into the MP3 via ffmpeg
5. Saves everything to a standardized folder structure

Each download runs **sequentially** — one at a time. Multiple download requests are queued and processed in FIFO order.

## Architecture

```
Renderer (Zustand + orchestrator) ← IPC → Electron Main (TaskQueue + yt-dlp + ffmpeg)
                                        ↘ Capacitor (youtubei.js + Canvas) [future]
```

- The **Zustand store** holds queue state (tasks, progress, errors)
- The **orchestrator** (`download-queue.ts`) runs in the renderer, calling IPC methods sequentially
- The **TaskQueue** (`electron/queue.ts`) processes each IPC task type sequentially in the main process
- Progress events flow main→renderer via `mainWindow.webContents.send('download:progress', ...)`

## Files to Create

| File | Purpose |
|------|---------|
| `src/stores/download.store.ts` | Zustand store: tasks[], activeTaskId, enqueue/cancel/retry |
| `src/services/download-queue.ts` | Orchestrator: sequential processTask() loop |
| `src/services/download-platform.ts` | Interface + Electron impl; Web/Capacitor stub |
| `src/features/download/download-queue-panel.tsx` | Dialog listing queue with progress per task |
| `src/features/download/download-button.tsx` | Reusable icon/button to enqueue a song |

## Files to Modify

| File | Change |
|------|--------|
| `electron/main.ts` | Add 3 task handlers: `yt:download-mp3`, `yt:process-cover`, `yt:embed-artwork` |
| `electron/preload.ts` | Expose 3 IPC invoke channels + `onDownloadProgress` listener |
| `src/features/player/player-bar.tsx` | Add buttons: "Download" (current track) + "Queue" (opens panel) |
| `src/features/search/search-page.tsx` | Add `DownloadButton` per search result |
| `src/features/library/library-page.tsx` | Add `DownloadButton` per song row |
| `src/features/sidebar/sidebar.tsx` | Add "Downloads" nav entry (opens queue panel) |
| `src/App.tsx` | Mount `DownloadQueuePanel` as global dialog (controlled by store) |

## Folder Structure

```
<downloadFolder>/
  <Artist>/
    <Album>/
      <NN> - <Title>.mp3   ← cover embutido via ffmpeg
      cover.jpg             ← cover processado (crop + resize, 500-1000²)
    <Song Title>/
      <Title>.mp3           ← single — pasta por música
      cover.jpg
```

`<downloadFolder>` = `Origin.downloadFolder`. Quando não há álbum, usa o nome da música como pasta.

## Cover Processing Algorithm

```
1. Fetch image bytes (CORS-free via main process fetch, or renderer-side for blob URLs)
2. Determine original dimensions using ffprobe or by decoding in Node.js
3. Compute target size:
     if any side < 500:
       scale = 500 / min(w, h)     // upscale to meet minimum
     else if any side > 1000:
       scale = 1000 / max(w, h)    // downscale to fit maximum
     else:
       scale = 1.0                 // keep as-is, just crop
4. Resize: newW = floor(w * scale), newH = floor(h * scale)
5. Center crop to square: size = min(newW, newH)
6. Save as cover.jpg (JPEG quality ~85)
```

Desktop implementation uses ffmpeg with programmatically computed parameters (not pure ffmpeg expressions). The main process handler receives the target dimensions computed in Node.js and passes them to ffmpeg.

## Cover Resolution Chain

1. `song.imageUrl` is real HTTP URL → fetch through main process (CORS-free)
2. `song.imageUrl` is blob URL → orchestrator `fetch(blobUrl)` in renderer, gets ArrayBuffer, sends raw bytes to main process processCover
3. Fallback: YouTube video thumbnail via `yt:get-video-info` → `%(thumbnail)s`
4. If all fail → task proceeds without cover (non-fatal error, cover.jpg simply absent)

## Edge Cases

| Case | Behavior |
|------|----------|
| searchAndRank fails | Task → FAILED, visible error "No YouTube match found" |
| Audio download fails mid-way | Task → FAILED, delete partial file via fs:delete-file |
| Cover download fails | Task continues, no cover.jpg |
| Cover crop fails (corrupt image) | Task continues, no cover.jpg |
| Embed cover fails | Task continues, cover.jpg exists separately |
| User cancels mid-download | Task → CANCELLED, delete partial files via IPC |
| Download folder full | yt-dlp/ffmpeg fails → FAILED with error propagated |
| No download folder configured | Task → FAILED immediately on enqueue |
| Song already in queue | enqueueSong is a no-op (dedup by song.id) |
| Song already downloaded | Current behavior: no check. Future: optional skip if audioPath already exists |

## Error States

- **FAILED**: visible in queue list with red status + error message + Retry button
- **CANCELLED**: collapsed into a "Cancelled" section, can be cleared
- **COMPLETED**: green checkmark + timestamp, collapsible "Completed" section

## Mobile (Capacitor) Strategy — future

| Feature | Electron (now) | Capacitor (future) |
|---------|---------------|-------------------|
| Search | yt-dlp via execFile | youtubei.js (InnerTube) pure JS |
| Audio download | yt-dlp --audio-format mp3 | InnerTube getStreamUrl + fetch + Capacitor FS |
| Cover process | ffmpeg via execFile | Canvas 2D API (drawImage + toBlob) |
| Cover embed | ffmpeg -i audio -i cover -map... | Not possible — cover.jpg stays separate |
| Output format | `.mp3` | `.webm` (no transcoding) |

The `DownloadPlatform` interface (`download-platform.ts`) abstracts platform differences. Electron impl calls IPC. Capacitor impl (to be written later) calls youtubei.js + Canvas directly.

---

## Implementation Log

### Entry 1: Metadata enriquecido + `--no-embed-metadata` + nome de arquivo via trackNumber

**Date**: 2026-06-08

**Problem**: YouTube channel name vazava para as tags do MP3; cover usava thumbnail do YouTube antes do pipeline centralizado; discNumber não era usado no nome do arquivo; metadados MusicBrainz incompletos nas tags.

**Changes**:

1. **`resolveMbNames` → `resolveMbMetadata`** (`download-queue.ts`):
   - Busca release detail com `inc=media` para extrair track/disc number por recording ID
   - Busca MB artist tags como fallback de genres
   - Extrai: `mbzReleaseGroupId`, `mbzReleaseId`, `albumArtistName`, `trackNumber`, `discNumber`

2. **Filename**: `{trackNumber} - {title}.mp3` (com `padStart(2,'0')`). Sem discNumber.

3. **`yt:download-mp3`** (`electron/main.ts`): `--no-embed-metadata` — yt-dlp não escreve tag alguma. Tags escritas exclusivamente pelo ffmpeg no passo de embed.

4. **`yt:embed-artwork`** (`electron/main.ts`): Agora recebe `metadata` com todos os campos MB e escreve via ffmpeg:
   - `title`, `artist`, `album`, `album_artist`, `track`, `disc`, `date`, `genre`
   - `musicbrainz_trackid`, `musicbrainz_artistid`

5. **Cover resolution priority** (`resolveCoverBytes` em `download-queue.ts`):
   1º `resolveAlbumCover()` — pipeline centralizado (`.img/` → IndexedDB → Deezer → iTunes)
   2º `song.imageUrl` HTTP
   3º `song.imageUrl` blob
   4º YouTube thumbnail (último caso)

6. **`getReleaseDetail`** (`musicbrainz-client.ts`): `inc` atualizado para incluir `media`.

7. **`musicbrainz-types.ts`**: `position` adicionado ao tipo `media`.
