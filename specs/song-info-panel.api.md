# Song Info Panel — API & Data

## Database Schema (Dexie)

### `mbz_yt_mapping` — Expanded

O schema atual armazena apenas o vencedor. Precisamos expandir para armazenar
**todos os candidatos**, o tipo de selecao, e suporte a URL customizada.

```ts
// Novo schema
mbzRecordingId: string     // PK
songName: string           // denormalizado para busca
artistName: string
albumName?: string
albumImageUrl?: string     // URL do CoverArtArchive (para exibicao)

// Selecao atual
selectedVideoId: string
selectedType: "auto" | "manual" | "custom"
// auto   = selecionado pelo ranking automatico
// manual = usuario escolheu manualmente entre candidatos do ranking
// custom = usuario colou URL propria

// Candidatos completos
candidates: string         // JSON-stringified CandidateData[]

// Dados do video custom (se selectedType = "custom")
customVideoId?: string
customVideoUrl?: string

createdAt: number
updatedAt: number
```

```ts
// Novo tipo para candidato serializavel
type CandidateData = {
  videoId: string
  title: string
  uploader?: string
  duration?: number          // segundos
  thumbnailUrl?: string     // thumb do YouTube (opcional)

  // Ranking
  score: number
  titleMatch: boolean
  artistMatch: boolean
  albumMatch: boolean
  exactDuration: boolean
  closestDuration: boolean
  diff: number               // diferenca de duracao

  // Origem
  source: "ranking" | "custom"
}
```

### IndexedDB Migration

```ts
// Em search-cache.ts, atualizar a tabela existente:
db.version(currentVersion + 1).stores({
  ...prevStores,
  mbz_yt_mapping: `
    mbzRecordingId,
    songName,
    artistName,
    selectedType,
    updatedAt
  `,
});
```

## Controller / Service Changes

### `youtube-download-service.ts`

Quando `searchAndRank()` completa, salvar todos os candidatos no `mbz_yt_mapping`:

```ts
// Novo: salvar candidatos completos apos ranking
await setMbzYtMapping({
  mbzRecordingId: song.mbzRecordingId!,
  songName: song.name,
  artistName: song.artistName,
  albumName: song.albumName,
  albumImageUrl: song.imageUrl,
  selectedVideoId: best.video.id,
  selectedType: "auto",
  candidates: JSON.stringify(ranked.map(toCandidateData)),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
```

`getStreamUrl(song, manualVideoId?)` — ja aceita `manualVideoId`. Quando o usuario
seleciona manualmente via Song Info Panel, o `selectedVideoId` e passado como
`manualVideoId`. O fluxo atual ja funciona.

### `search-cache.ts`

Funcoes implementadas (nota: nomes diferentes do spec original):

```ts
// Salvar/atualizar mapping completo (com candidatos)
export async function setMbzYtMapping(mapping: MbzYtMapping): Promise<void>

// Carregar mapping completo (com candidatos) — retorna o registro inteiro, nao apenas o vencedor
export async function getMbzYtMapping(mbzRecordingId: string): Promise<MbzYtMapping | null>
```

**Nao existe** `updateMbzYtSelection`. O `SongInfoDialog` faz a atualizacao diretamente via
`handleSelect()` que:
1. Atualiza `selectedVideoId` e `selectedType` no mapping local
2. Chama `setMbzYtMapping(updated)` para persistir no IndexedDB

```ts
// Em song-info-dialog.tsx — handleSelect
async function handleSelect(videoId: string) {
    setSelectedId(videoId);
    if (!song.mbzRecordingId || !mapping) return;
    const updated = {
        ...mapping,
        selectedVideoId: videoId,
        selectedType: "manual" as const,
        updatedAt: Date.now(),
    };
    await setMbzYtMapping(updated);
    setMapping(updated);
}
```

### `youtube-download-service.ts` — Custom URL Fetch

Nova funcao para buscar metadados de um video por URL custom:

```ts
export async function fetchCustomVideoInfo(
  videoUrl: string,
): Promise<CandidateData | null> {
  // Extrair videoId da URL
  const videoId = extractYoutubeVideoId(videoUrl);
  if (!videoId) return null;

  // Buscar info via Electron IPC (yt-dlp ou youtubei.js)
  const api = getElectronApi();
  if (!api) return null;

  // Usar yt:search ou yt:stream-url para obter info basica
  const info = await api.yt.getVideoInfo(videoId);
  if (!info) return null;

  return {
    videoId,
    title: info.title,
    uploader: info.uploader,
    duration: info.duration,
    source: "custom",
    score: 0,
    titleMatch: false,
    artistMatch: false,
    albumMatch: false,
    exactDuration: false,
    closestDuration: false,
    diff: 0,
  };
}
```

O Electron precisa expor `yt:getVideoInfo` no preload:

```ts
// electron/preload.ts
getVideoInfo: (videoId: string) => ipcRenderer.invoke('yt:get-video-info', videoId)

// electron/main.ts
ipcMain.handle('yt:get-video-info', async (_, videoId) => {
  return execYtDlp(['--print', '%(title)s\t%(uploader)s\t%(duration)s', videoId]);
});
```

## Store Shape

Nenhuma store nova necessaria. O painel e um componente local que busca dados
diretamente do IndexedDB via `search-cache.ts`.

## IPC Changes

### `yt:get-video-info`

Novo handler IPC para buscar info basica de um video por ID:

```
Request:  videoId: string
Response: { title: string; uploader: string; duration: number } | null
```

Usa `yt-dlp --print '%(title)s\t%(uploader)s\t%(duration)s' {videoId}` para
extrair metadados sem baixar o video.

## Playback Integration

O fluxo de play continua o mesmo (implementado em `youtube-download-service.ts:getStreamUrl`):

```
playSong(song)
  → getStreamUrl(song, manualVideoId?)
  → 1. manualVideoId (passado pelo componente, maior prioridade)
  → 2. getMbzYtMapping(song.mbzRecordingId) → selectedVideoId (cache IndexedDB)
  → 3. searchAndRank(song)  // auto-ranking se nada salvo
  → getStreamUrl(videoId)   // extrai URL do audio
```

`selectedVideoId` pode vir de:
- **auto**: ranking automatico (selecionado pelo sistema)
- **manual**: usuario escolheu entre candidatos no Song Info Dialog
- **custom**: usuario colou URL propria (usa `customVideoId` como `selectedVideoId`)

### Implementacao Atual

`getStreamUrl` em `youtube-download-service.ts`:

1. Se `manualVideoId` foi passado (do `SongInfoDialog`), usa esse primeiro
2. Senao, verifica `getMbzYtMapping()` no IndexedDB para mapping salvo
3. Se existe mapping, usa `selectedVideoId` direto (pula ranking)
4. Se nao existe, faz auto-ranking via `searchAndRank()`
5. Fallback: se `manualVideoId` falhar, tenta auto-ranking

## Cover Provider Selection

### `ArtworkResolver` — Metodos Disponiveis

O `artwork-resolver.ts` expoe dois metodos:

| Metodo | Uso |
|--------|-----|
| `resolveAll(input)` | Busca em **todos os providers ativos** em paralelo (usado pelo fluxo "Fetch All") |
| `resolveFromProvider(name, input)` | Busca em **um provider especifico** (usado pelo SongInfoDialog — fetch individual por provider) |

`resolveAll` coleta candidatos de todos os providers ativos:

```ts
// Em src/services/artwork/artwork-resolver.ts

async resolveAll(input: ArtworkSearchInput): Promise<ArtworkResult> {
  const settings = useSettingsStore.getState();
  const enabled = this.providers.filter(p =>
    settings.isArtworkProviderEnabled(p.name),
  );

  if (enabled.length === 0) {
    return { status: "no_providers", candidates: [], elapsedMs: 0 };
  }

  const results = await Promise.allSettled(
    enabled.map(p =>
      artworkQueue.enqueue(p.name, settings.getArtworkPaceMs(p.name), (signal) =>
        p.search(input, signal),
      ),
    ),
  );

  const candidates = results
    .filter((r): r is PromiseFulfilledResult<ArtworkCandidate[]> =>
      r.status === "fulfilled",
    )
    .flatMap((r) => r.value);

  return {
    status: candidates.length > 0 ? "resolved" : "not_found",
    candidates,
    elapsedMs: Date.now() - startTime,
  };
}
```

> **Nota:** O `SongInfoDialog` nao usa `resolveAll()` — ele usa `resolveFromProvider()` individualmente
> quando o usuario clica "Fetch" em cada provider. O `resolveAll()` esta disponivel para uso futuro.

### Store de Cover no Image Store

Quando o usuário seleciona uma capa de provider no `SongInfoDialog`, o fluxo real é:

```ts
// Em song-info-dialog.tsx — handleSelectCover
async function handleSelectCover(candidate: ArtworkCandidate) {
  // 1. Download da imagem via cache global (Image Cache API + blob URL)
  const blobUrl = await fetchImageAsBlobUrl(candidate.url);
  if (!blobUrl) return;

  // 2. Converter blob URL → Blob → ArrayBuffer
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();

  // 3. Computar hash para dedup (MD5, nao SHA-256 como spec original)
  const hash = await md5Hash(buffer);

  // 4. Armazenar no IndexedDB com metadados da musica
  await storeImage({
    md5: hash,
    blob: buffer,
    format: blob.type,
    size: buffer.byteLength,
    createdAt: Date.now(),
    artistName: song.artistName.toLowerCase().trim(),
    albumName: song.albumName?.toLowerCase().trim(),
    mbzArtistId: song.mbzArtistId,
    sourceUrl: candidate.url,
  });

  // 5. Atualizar state local para feedback imediato
  setSelectedCoverUrl(blobUrl);
  setActiveCoverProvider(candidate.provider);
}
```

**Diferencas do spec original:**
- Usa `artworkResolver.resolveFromProvider(providerName, input)` (provider individual), nao `resolveAll()` (todos providers de uma vez)
- Hash usa MD5 (`md5Hash`), nao SHA-256
- Nao chama `emitCoverUpdate` explicitamente — `storeImage()` gerencia os listeners internamente
- Provider fetch e cover selection sao acoes separadas: primeiro "Fetch" (busca thumbnails), depois "Select" (download + store)

### Input Mapping: Song → ArtworkSearchInput

```ts
const input: ArtworkSearchInput = {
  artist: song.artistName,
  album: song.albumName || undefined,
  title: song.name,
  durationMs: song.duration ? song.duration * 1000 : undefined,
  // musicbrainzReleaseGroupId: não disponível em Song
  // musicbrainzReleaseId: não disponível em Song
};
```

### Provider Display Names

Para exibição na UI (mais legível que o nome interno do provider):

| Provider key | Display name | Requer API Key? |
|---|---|---|
| `embedded` | Embedded Tags | ❌ |
| `cover_art_archive` | Cover Art Archive | ❌ |
| `musicbrainz_release_group` | MusicBrainz RG | ❌ |
| `itunes` | iTunes | ❌ |
| `deezer` | Deezer | ❌ |
| `spotify` | Spotify | ✅ Client ID + Secret |
| `discogs` | Discogs | ✅ Token |
| `fanart_tv` | Fanart.tv | ✅ API Key |

---

## Types

```ts
// SongInfoPanel types (src/features/song-info/types.ts)

export type CandidateSource = "local" | "ranking" | "custom";

export type SelectionType = "auto" | "manual" | "custom";

export type CandidateData = {
  videoId: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnailUrl?: string | null;
  score: number;
  titleMatch: boolean;
  artistMatch: boolean;
  albumMatch: boolean;
  artistOnChannel: boolean;
  exactDuration: boolean;
  closestDuration: boolean;
  diff: number;
  source: CandidateSource;
};

export type SongSourceCandidate = {
  type: "local";
  song: Song;
  filePath: string;
  bitrate?: number;
  sampleRate?: number;
  fileSize?: number;
  fileExtension?: string;
};

export type SongInfoData = {
  mbzRecordingId: string;
  songName: string;
  artistName: string;
  albumName?: string;
  albumImageUrl?: string | null;
  selectedVideoId: string;
  selectedType: SelectionType;
  selectedSource: "local" | "youtube";
  localSongId?: string;
  candidates: CandidateData[];
  customVideoId?: string;
  customVideoUrl?: string;
  createdAt: number;
  updatedAt: number;
};
```

### MbzYtMapping — Novos campos (v2)

```ts
// Em search-cache.ts
export type MbzYtMapping = {
  // ... campos existentes ...

  // v2: Local candidate selection
  selectedSource: "local" | "youtube"; // qual fonte usar no playback
  localSongId?: string;                 // id do DbSong se selectedSource = "local"
};
```

`selectedSource` e `localSongId` sao atualizados quando o usuario seleciona um candidato local no SongInfoDialog.

## Stream Resolver Integration

O `resolveSong()` em `stream-resolver.ts` usa `MbzYtMapping` para decidir a fonte:

1. Se `selectedSource = "local"` e `localSongId` existe → usa caminho do arquivo local
2. Se `selectedSource = "youtube"` ou nao setado → faz fluxo YouTube normal
3. Se nao ha mapping salvo → auto-detecta: `getSongByMbid()` primeiro, YouTube como fallback
