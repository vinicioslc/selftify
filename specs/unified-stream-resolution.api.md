# Unified Stream Resolution — API & Data

## Types

### Extensoes em `MbzYtMapping` (`search-cache.ts`)

```ts
// Novos campos
selectedSource: "local" | "youtube";  // qual fonte o usuario escolheu
localSongId?: string;                 // id do DbSong no banco local (se selectedSource = "local")
```

### `StreamSourceCandidate`

```ts
type StreamSourceCandidate = {
  type: "local";
  song: Song;           // musica do banco local com path preenchido
  filePath: string;     // caminho absoluto do arquivo
  bitrate?: number;
  sampleRate?: number;
  fileSize?: number;
  fileExtension?: string;
};
```

### `ResolveResult`

```ts
type ResolveResult = {
  song: Song;           // musica com path resolvido (ou original se falhou)
  source: "local" | "youtube" | "none";
  localCandidates?: StreamSourceCandidate[];
};
```

## Stream Resolver Service (`src/services/stream-resolver.ts`)

### `resolveSong(song: Song): Promise<ResolveResult>`

Resolve o path de reproducao para uma unica musica.

```
1. Se song.path existe → retorna song como esta (source="local")
2. Se song.mbzRecordingId existe:
   a. Verifica MbzYtMapping para preferencia salva
      - Se selectedSource="local" e localSongId → getSongById() → usa path
      - Se selectedSource="youtube" → getStreamUrl()
   b. Sem preferencia salva:
      - getSongByMbid() → se achou, auto-seleciona local, salva mapping
      - Se nao achou → getStreamUrl() (YouTube)
3. Retorna { song, source }
```

### `resolveSongs(songs: Song[]): Promise<ResolveResult[]>`

Resolve multiplas musicas em paralelo via `Promise.allSettled`.

### `findLocalCandidates(mbzRecordingId: string): Promise<StreamSourceCandidate[]>`

Busca musicas locais que compartilham o mesmo `mbzRecordingId`.

```
getSongByMbid() → DbSong[]
→ mapeia para StreamSourceCandidate[]
```

### `findLocalSongByMbid(mbzRecordingId: string): Promise<Song | null>`

Retorna a primeira musica local encontrada com o MBZ ID, convertida para `Song`.

## Store Changes

Nenhuma store nova necessaria. O resolver usa os services existentes:
- `getSongByMbid()` do `local-database.ts`
- `getSongById()` do `local-database.ts`
- `getStreamUrl()` do `youtube-download-service.ts`
- `getMbzYtMapping()` / `setMbzYtMapping()` do `search-cache.ts`

## Flow: SongInfoDialog → Local Selection

```
1. Usuario abre SongInfoDialog para musica com mbzRecordingId
2. loadData() carrega:
   a. MbzYtMapping (YouTube candidates + selectedSource)
   b. Local candidates via findLocalCandidates()
3. UI exibe:
   ┌──────────────────────────────────┐
   │  Local candidates (2)            │  ← NOVA seção (acima do YouTube)
   │  ○ /music/song.mp3     320kbps   │
   │  ○ /music/song2.mp3    256kbps   │
   ├──────────────────────────────────┤
   │  YouTube candidates (20)         │
   │  ○ Video Title #1         2.50   │  (existente)
   │  ...                             │
   └──────────────────────────────────┘
4. Usuario seleciona candidato local:
   → setMbzYtMapping({ ...mapping, selectedSource: "local", localSongId: songId })
5. Proximo play() passa pelo resolver:
   → detecta selectedSource="local" → usa path do arquivo local
```

## Flow: Playback with Auto-Select Local

```
playSong(song) no album-page / search-page / home-page
  → resolveSong(song)
  → song tem mbzRecordingId?
  → getSongByMbid() → found!
  → auto-save mapping (selectedSource="local", selectedType="auto")
  → retorna song com path local
  → setQueue([song])
  → nenhuma chamada a YouTube feita
```

## Refactoring: Component Changes

### `album-page.tsx`

**Antes:**
```ts
async function playSong(song: Song) {
  if (song.path) { setQueue([song]); return; }
  const streamUrl = await getStreamUrl(song);
  setQueue(streamUrl ? [{...song, path: streamUrl}] : [song]);
}
```

**Depois:**
```ts
async function playSong(song: Song) {
  const { song: resolved, source } = await resolveSong(song);
  if (source !== "none") {
    useStatusStore.getState().addMessage(
      source === "local" ? "Playing local file" : "Streaming from YouTube",
      "info", "Player"
    );
  }
  setQueue([resolved], { type: "now" });
}
```

### `search-page.tsx`

**Antes:** `playYtPure()`, `playMbz()`, `playSong()`, `playAll()` — logica duplicada com `getStreamUrl()`.

**Depois:** Simplificar para usar `resolveSong()`:

```ts
async function playSong(song: Song) {
  if (!currentOrigin?.enableOnlineSearch) { setQueue([song]); return; }
  const { song: resolved } = await resolveSong(song);
  setQueue([resolved], { type: "now" });
}
```

### `home-page.tsx`

**Antes:** `Promise.allSettled(songs.map(getStreamUrl))`

**Depois:** `resolveSongs(songs)` — ja trata local first.
