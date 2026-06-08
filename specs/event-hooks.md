# Spec: Event Hooks System — Central Event Bus

> **Status**: draft
> **Last update**: 2026-06-04
> **This spec is the canonical source for SongDTO, EventMap, and EventHooks. All other specs reference this file.**

## Princípios

1. **EventHooks é o barramento central da aplicação.** Todo módulo publica e escuta eventos exclusivamente por ele.
2. **Player store é pura** — não importa `eventHooks`. A emissão de eventos de playback é feita pelo hook `usePlaybackEvents()` que envolve as ações da store.
3. **SongDTO é o tipo único que representa qualquer fonte de áudio** — arquivo local, YouTube, MusicBrainz. Todo controller transforma seus dados nativos em `SongDTO` antes de retornar à UI. A UI **nunca** vê dados brutos da fonte.
4. **`originType` em SongDTO informa a UI como manipular a música**: LOCAL → toca de `filePath`, YOUTUBE → resolve stream URL, MUSICBRAINZ → busca match no YouTube primeiro.
5. **`fileTags` nunca viaja em eventos.** Componentes que precisam de metadados estendidos chamam `enrichWithFileTags()` sob demanda.

---

## 1. SongDTO — Tipo Único de Música

`SongDTO` substitui o tipo `Song` de `domain-types.ts` em toda a aplicação. É o formato universal de retorno de **todos os controllers**, independente da fonte.

```typescript
// src/types/song-dto.ts

import { OriginType } from "./domain-types";

// OriginType reflete a fonte real de onde a música veio
// LOCAL  = arquivo no sistema de arquivos
// YOUTUBE = stream do YouTube (yt-dlp)
// MUSICBRAINZ = resultado de busca do MusicBrainz (sem áudio ainda)

export type FileTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  genres?: string[];
  year?: number;
  bpm?: number;
  composer?: string;
  lyrics?: string;
  comment?: string;
  coverArtRef?: { hash: string; format: "jpeg" | "png" | "webp" };
};

export type StreamInfo = {
  url: string;
  expiresAt?: number;
  format?: string;
};

export type SongDTO = {
  id: string;
  originId: string;
  originType: OriginType;   // ← UI usa isso para decidir como tocar

  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  duration: number;
  genres?: string[];

  /** Cover — sempre URL para exibir (blob, cache, ou remota) */
  coverUrl: string | null;
  coverFromEmbedded?: boolean;

  /** Path local OU stream — presente quando o áudio está acessível */
  filePath?: string;
  streamInfo?: StreamInfo;

  mbzRecordingId?: string;
  mbzTrackId?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;

  isVideo?: boolean;
  releaseYear?: number;
  isrc?: string;
  label?: string;
  catalogNumber?: string;

  downloadedLocally?: boolean;
  localFilePath?: string;

  /** YouTube video associado (preenchido quando originType = MUSICBRAINZ e já houve match) */
  matchedYoutubeId?: string;
  matchedYoutubeTitle?: string;
};

/** Filas internas usam QueueSong (nunca exposto em eventos) */
export type QueueSong = SongDTO & {
  queueId: string;
  queueIndex: number;
};
```

> `FileTags` NÃO é parte do `SongDTO`. É carregado sob demanda via `enrichWithFileTags()` (ver seção 7). Eventos nunca carregam `fileTags`.

---

## 2. EventMap — Todos os Eventos da Aplicação

```typescript
// src/services/event-hooks.ts
import type { SongDTO } from "../types/song-dto";

export type EventMap = {
  // ── Playback ──
  "song:play":        { song: SongDTO; positionMs: number };
  "song:pause":       { song: SongDTO; positionMs: number };
  "song:resume":      { song: SongDTO; positionMs: number };
  "song:end":         { song: SongDTO; positionMs: number };
  "song:stop":        { song: SongDTO | null; positionMs: number };

  // ── Navegação ──
  "playlist:next":    { currentSong: SongDTO | null };
  "playlist:previous": { currentSong: SongDTO | null };

  // ── Fila ──
  "queue:changed":    { queue: SongDTO[]; currentSong: SongDTO | null };

  // ── Controles ──
  "volume:changed":   { volume: number };
  "seek:changed":     { positionMs: number };

  // ── Configurações ──
  "settings:changed": { key: string; value: unknown };

  // ── Biblioteca ──
  "library:scan-start":   { rootFolder: string };
  "library:scan-progress": { scanned: number; total: number; currentDir: string };
  "library:scan-complete": { totalSongs: number };
  "library:songs-changed": { count: number };

  // ── Busca ──
  "search:start":     { query: string; provider: string };
  "search:complete":  { query: string; provider: string; resultCount: number };
};
```

> Eventos de origem (`origin:changed`, `origin:added`, `origin:removed`) **não existem**. Cada controller transforma seus dados em `SongDTO` independentemente da origem ativa. A UI nunca precisa saber que a origem mudou — ela só vê `SongDTO` com `originType` preenchido.

---

## 3. EventHooks — API

```typescript
class EventHooks {
  on<E extends keyof EventMap>(event: E, fn: (payload: EventMap[E]) => void): Unsubscribe;
  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void;
  clear(event?: keyof EventMap): void;
}

export const eventHooks: EventHooks;
```

---

## 4. Quem Emite o Quê

### Player Store (`player.store.ts`) — via `usePlaybackEvents()`

| Evento | Quando |
|---|---|
| `song:play` | `play()` / `setCurrentTrack()` — status → PLAYING |
| `song:pause` | `pause()` — status → PAUSED |
| `song:resume` | `togglePlay()` vindo de PAUSED → PLAYING |
| `song:end` | Áudio chega ao fim (audio provider detecta `onended`) |
| `song:stop` | `stop()` / `clearQueue()` / nova track |
| `playlist:next` | `next()` — apenas se vai trocar de track |
| `playlist:previous` | `previous()` — apenas se vai trocar de track (pos ≤ 3s + existe anterior) |
| `queue:changed` | `setQueue()` / `addToQueue()` / `removeFromQueue()` / `clearQueue()` |
| `volume:changed` | `setVolume()` |
| `seek:changed` | `setSeek()` |

### Settings Store (`settings.store.ts`)

| Evento | Quando |
|---|---|
| `settings:changed` | Qualquer campo alterado |

### Scan / Indexer (`local-indexer.ts`)

| Evento | Quando |
|---|---|
| `library:scan-start` | Scan iniciado |
| `library:scan-progress` | A cada lote processado |
| `library:scan-complete` | Scan finalizado |
| `library:songs-changed` | Songs adicionadas/removidas |

### Search Page (`search-page.tsx`)

| Evento | Quando |
|---|---|
| `search:start` | Busca iniciada |
| `search:complete` | Busca concluída |

---

## 5. Quem Escuta o Quê

| Consumidor | Eventos | Reação |
|---|---|---|
| **Playlist Store** | `playlist:next`, `playlist:previous` | Se `isActive`, addToEnd |
| **Visualizer** | `song:play`, `song:pause`, `song:resume`, `song:stop` | Iniciar/parar animação |
| **Status Store** | `song:*`, `library:scan-*`, `search:*` | Publicar mensagem na TopBar |
| **Player Bar (UI)** | `song:*`, `seek:changed`, `volume:changed` | Atualizar controles |
| **Full-Screen Player** | `song:*`, `seek:changed` | Atualizar tela |
| **Audio Provider** | `song:play`, `song:pause`, `song:resume`, `song:stop`, `seek:changed`, `volume:changed` | Controlar `<audio>` |
| **Settings UI** | `settings:changed` | Reagir a mudanças (tema etc.) |
| **Library UI** | `library:scan-*`, `library:songs-changed` | Atualizar listagem |
| **Search UI** | `search:start`, `search:complete` | Mostrar/esconder loading |

---

## 6. SongDTO Pipeline — Como Cada Fonte Vira SongDTO

Toda fonte de dados implementa um mapper que transforma seu formato nativo em `SongDTO`. A UI **nunca** lida com dados brutos.

```
Local File                    MusicBrainz                   YouTube
    │                             │                            │
    ▼                             ▼                            ▼
local-indexer.ts            musicbrainz-client.ts       yt-dlp / youtubei.js
    │                             │                            │
    │  (DbSong)                   │  (MB API JSON)             │  (video metadata)
    ▼                             ▼                            ▼
local-controller.ts         musicbrainz-controller      youtube-controller
    │                             │                            │
    └─────────────┬───────────────┴──────────────┬─────────────┘
                  │                              │
                  ▼                              ▼
            SongDTO (LOCAL)                SongDTO (YOUTUBE / MUSICBRAINZ)
                  │                              │
                  └──────────────┬───────────────┘
                                 ▼
                            UI (React)
                     (decide comportamento por originType)
```

### LOCAL → SongDTO

```typescript
// local-controller.ts
function toSongDTO(row: DbSong): SongDTO {
  return {
    id: row.id,
    originId: currentOrigin.id,
    originType: OriginType.LOCAL,
    title: row.name,
    artist: row.artist_name,
    album: row.album_name ?? undefined,
    duration: row.duration ?? 0,
    coverUrl: resolveCoverUrl(row),
    filePath: row.path,            // ← disponível para tocar direto
    mbzRecordingId: row.mbz_recording_id,
    // ...
  };
}
```

### MUSICBRAINZ → SongDTO

```typescript
// musicbrainz-controller.ts
function toSongDTO(recording: MBRecording): SongDTO {
  return {
    id: `mbz-${recording.id}`,
    originId: currentOrigin.id,
    originType: OriginType.MUSICBRAINZ,  // ← avisa UI que precisa resolver stream
    title: recording.title,
    artist: recording.artistCredits?.[0]?.name ?? "Unknown",
    album: recording.releases?.[0]?.title,
    duration: recording.length ? Math.round(recording.length / 1000) : 0,
    coverUrl: null,                     // ← resolvido depois via CoverArtArchive
    mbzRecordingId: recording.id,       // ← usado para buscar YouTube match
    filePath: undefined,                // ← sem áudio ainda
    // ...
  };
}
```

### YOUTUBE → SongDTO

```typescript
// youtube-controller.ts
function toSongDTO(video: YTVideo, streamUrl: string): SongDTO {
  return {
    id: `yt-${video.id}`,
    originId: currentOrigin.id,
    originType: OriginType.YOUTUBE,     // ← avisa UI que é stream
    title: video.title,
    artist: video.channel?.name ?? "Unknown",
    duration: video.duration ?? 0,
    coverUrl: video.thumbnails?.[0]?.url ?? null,
    streamInfo: {                       // ← URL do áudio (expirável)
      url: streamUrl,
      expiresAt: Date.now() + 300_000,
    },
    // ...
  };
}
```

---

## 7. Como a UI Decide Comportamento por `originType`

A UI não precisa saber de onde veio o dado — ela inspeciona `originType` e `filePath`/`streamInfo` para decidir como tocar:

```typescript
// Hook ou serviço de playback
function getPlayableURL(song: SongDTO): string | null {
  if (song.filePath) return song.filePath;              // LOCAL → toca direto
  if (song.streamInfo?.url) return song.streamInfo.url; // YOUTUBE → stream URL
  if (song.mbzRecordingId) {                            // MUSICBRAINZ → precisa resolver
    // busca YouTube match via yt-dlp → retorna stream URL
    return resolveMBZStream(song);
  }
  return null;
}
```

A UI de listagem (biblioteca, search, playlist) simplesmente renderiza `SongDTO`. O clique em "Play" chama o serviço acima, que decide o fluxo:

| originType | filePath | streamInfo | Ação ao clicar Play |
|---|---|---|---|
| LOCAL | `/music/song.mp3` | — | Toca direto do arquivo |
| LOCAL | — | — | (fallback: busca YouTube) |
| YOUTUBE | — | `{ url: "...", expiresAt: ... }` | Toca stream URL |
| MUSICBRAINZ | — | — | Busca YouTube match → toca |

---

## 8. MusicBrainz → YouTube Resolution

### Fluxo Automático (ao clicar Play)

Quando uma música `originType: MUSICBRAINZ` é clicada para tocar, o sistema:

1. Verifica o cache `mbz_yt_mapping` (Dexie) — se existe um YouTube video ID já mapeado para `mbzRecordingId`
2. Se sim: usa direto o video ID para extrair stream URL e toca
3. Se não: executa `searchAndRank()` (yt-dlp busca no YouTube com título + artista), escolhe o melhor match, salva em `mbz_yt_mapping`, extrai stream URL e toca
4. Preenche `matchedYoutubeId` e `matchedYoutubeTitle` no SongDTO para exibição na UI

```
Play em MUSICBRAINZ song
       │
       ▼
┌──────────────────────┐
│  mbz_yt_mapping      │─── tem cache? ──sim──► extrai stream → toca
│  (Dexie:             │
│   mbzRecordingId →   │
│   youtubeVideoId)    │
└──────────┬───────────┘
           │ não
           ▼
┌──────────────────────┐
│  searchAndRank()     │
│  yt-dlp busca por    │
│  título + artista    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Melhor match salvo  │
│  em mbz_yt_mapping   │
│  + stream URL        │
└──────────┬───────────┘
           │
           ▼
         toca
```

### SongDTO após resolução

```typescript
// Antes do Play (sem cache):
{
  originType: OriginType.MUSICBRAINZ,
  mbzRecordingId: "mbz-abc-123",
  matchedYoutubeId: undefined,   // ainda não resolvido
  matchedYoutubeTitle: undefined,
  streamInfo: undefined,
  filePath: undefined,
}

// Depois do Play (com cache preenchido):
{
  originType: OriginType.MUSICBRAINZ,
  mbzRecordingId: "mbz-abc-123",
  matchedYoutubeId: "dQw4w9WgXcQ",
  matchedYoutubeTitle: "Rick Astley - Never Gonna Give You Up",
  streamInfo: {
    url: "https://rr2---sn-xxxx.googlevideo.com/...",
    expiresAt: 1749085200000,
  },
}
```

> Quando a UI exibe uma música MUSICBRAINZ que já tem `matchedYoutubeId`, ela mostra o título do vídeo do YouTube como "fonte" e permite o menu "Change YouTube Origin".

---

## 9. UI: Change YouTube Origin

### Contexto

Em toda linha de resultado que tenha `originType: MUSICBRAINZ`, a UI oferece um menu de contexto com a opção **"Change YouTube Origin"**. Isso permite ao usuário trocar o match automático do YouTube por outro resultado, útil quando o `searchAndRank()` escolheu o vídeo errado.

### Fluxo

```
Usuário clica com direito (ou long-press) em música MUSICBRAINZ
       │
       ▼
┌──────────────────────────────────────┐
│  Menu de contexto:                    │
│                                      │
│  ▶ Play                              │
│  + Adicionar à fila                  │
│  ─────────────────────────           │
│  🔗 YouTube: "Rick Astley - Never..."│ ← match atual (se existir)
│  🔄 Change YouTube Origin...         │ ← abre modal
│  ─────────────────────────           │
│  ℹ Ver detalhes                      │
└──────────────────────────────────────┘
       │
       ▼  (clicou "Change YouTube Origin")
       │
       ▼
┌──────────────────────────────────────┐
│  Modal: "Select YouTube Source"      │
│                                      │
│  ┌──────────────────────────────────┐│
│  │ ○ 1. Rick Astley - Never Gonna  ││
│  │      Give You Up (3:32)     [atual]│
│  │ ○ 2. Rick Rolled - Never Gonna  ││
│  │      Give You Up (live)   (4:01) ││
│  │ ○ 3. Rick Astley - Never Gonna  ││
│  │      Give You Up (8-bit)  (3:45) ││
│  │ ○ 4. Never Gonna Give You Up -  ││
│  │      Rick Astley (cover)  (3:30) ││
│  └──────────────────────────────────┘│
│                                      │
│  [Cancel] [Select & Play]            │
└──────────────────────────────────────┘
       │
       ▼  (usuário seleciona e confirma)
       │
┌──────────────────────────────────────┐
│  1. Salva novo match em              │
│     mbz_yt_mapping (sobrescreve)     │
│  2. Se a música está tocando agora,  │
│     recarrega stream URL e continua  │
│  3. Se está na fila, atualiza o      │
│     SongDTO na fila                  │
└──────────────────────────────────────┘
```

### Funcionalidades

| Aspecto | Comportamento |
|---|---|
| Abertura do menu | Botão direito (desktop) ou long-press (mobile) na linha da música |
| Condição | Só exibido se `originType === MUSICBRAINZ` |
| Match atual | Exibe o título do YouTube atual como item informativo no menu |
| Lista de alternativas | Chamada ao backend `searchAndRank()` que retorna até 5 resultados do YouTube |
| Seleção | Radio button na lista; destaque visual no item atual |
| Confirmação | Botão "Select & Play" toca imediatamente; "Select" só salva |
| Cache | Após seleção, `mbz_yt_mapping` é sobrescrito com o novo videoId |
| Se a música está tocando | Recarrega o stream URL do novo vídeo e continua a reprodução |
| Se a música está na fila | Atualiza `matchedYoutubeId` e `streamInfo` no QueueSong correspondente |

### API

```typescript
// youtube-download-service.ts

/** Retorna alternativas do YouTube para uma música MusicBrainz */
async function getYouTubeAlternatives(
  title: string,
  artist: string,
  limit?: number
): Promise<Array<{ id: string; title: string; duration: number | null }>>;

/** Atualiza o match YouTube de uma música MusicBrainz */
async function setYouTubeMatch(
  mbzRecordingId: string,
  youtubeVideoId: string,
  youtubeTitle: string
): Promise<void>;
```

### Estados da UI

| Estado | Linha da música | Menu |
|---|---|---|
| MUSICBRAINZ sem match | Mostra "🎵 MusicBrainz" como label de origem | "Change YouTube Origin..." disponível |
| MUSICBRAINZ com match | Mostra "▶ YouTube: Título do vídeo" como label | Match atual destacado, opção de troca |
| Carregando alternativas | — | Spinner no modal |
| Nenhuma alternativa encontrada | — | Mensagem "No YouTube results found" |
| Erro ao buscar alternativas | — | Mensagem de erro + retry |

---

## 12. Hook React: `usePlaybackEvents`

Para evitar acoplamento, a player store **não importa** `eventHooks`. Toda emissão de eventos de playback é feita por um hook que envolve as ações da store:

```typescript
// src/hooks/use-playback-events.ts

export function usePlaybackEvents() {
  const store = usePlayerStore();

  const play = useCallback(() => {
    store.play();
    const track = usePlayerStore.getState().currentTrack;
    if (track) {
      eventHooks.emit("song:play", {
        song: track,  // track já é SongDTO (QueueSong)
        positionMs: usePlayerStore.getState().positionMs,
      });
    }
  }, []);

  const pause = useCallback(() => {
    store.pause();
    const track = usePlayerStore.getState().currentTrack;
    if (track) {
      eventHooks.emit("song:pause", {
        song: track,
        positionMs: usePlayerStore.getState().positionMs,
      });
    }
  }, []);

  const togglePlay = useCallback(() => {
    const prev = usePlayerStore.getState().status;
    store.togglePlay();
    const cur = usePlayerStore.getState().status;
    const track = usePlayerStore.getState().currentTrack;
    if (!track) return;
    const pos = usePlayerStore.getState().positionMs;
    if (prev === "paused" && cur === "playing")
      eventHooks.emit("song:resume", { song: track, positionMs: pos });
    else if (prev === "playing" && cur === "paused")
      eventHooks.emit("song:pause", { song: track, positionMs: pos });
  }, []);

  const next = useCallback(() => {
    const { currentTrack } = usePlayerStore.getState();
    if (currentTrack) {
      eventHooks.emit("playlist:next", { currentSong: currentTrack });
    }
    store.next();
  }, []);

  const previous = useCallback(() => {
    const { currentTrack, positionMs } = usePlayerStore.getState();
    if (positionMs <= 3000 && currentTrack) {
      eventHooks.emit("playlist:previous", { currentSong: currentTrack });
    }
    store.previous();
  }, []);

  return { play, pause, togglePlay, next, previous };
}
```

> A player store internamente já trabalha com `SongDTO`/`QueueSong`. O `songToDTO()` (seção 7) é usado apenas nos controllers. Dentro da store, os objetos já estão no formato `SongDTO`.

---

## 11. Song Mapper — `src/services/song-mapper.ts`

```typescript
// Usado APENAS nos controllers para converter dados nativos → SongDTO
function songToDTO(data: DbSong | MBRecording | YTVideo, origin: Origin, extras?: object): SongDTO;

// Enriquece SongDTO com FileTags (chamado sob demanda pela UI)
function enrichWithFileTags(dto: SongDTO, fileTags: FileTags): SongDTO;
```

---

## 13. Migração `Song` → `SongDTO`

| # | O que muda | Arquivos |
|---|---|---|
| 1 | Criar `src/types/song-dto.ts` com `SongDTO`, `FileTags`, `StreamInfo`, `QueueSong` | Novo |
| 2 | Criar `src/services/event-hooks.ts` com `EventHooks` + `EventMap` | Novo |
| 3 | Criar `src/services/song-mapper.ts` com `songToDTO()` e `enrichWithFileTags()` | Novo |
| 4 | Criar `src/hooks/use-playback-events.ts` | Novo |
| 5 | Atualizar `controller.ts` — interface retorna `SongDTO` | Modificar |
| 6 | Atualizar `local-controller.ts` — `toSongDTO()` | Modificar |
| 7 | Atualizar `player.store.ts` — usar `SongDTO`/`QueueSong` de `song-dto.ts` | Modificar |
| 8 | Atualizar `App.tsx` e todas as páginas para usar `SongDTO` | Modificar |
| 9 | Migrar player bar/fullscreen para `usePlaybackEvents()` | Modificar |
| 10 | Remover `Song` e `QueueSong` de `domain-types.ts` | Modificar |

---

## 14. Arquivos

### Criados
| Arquivo | Descrição |
|---|---|
| `src/types/song-dto.ts` | `SongDTO`, `FileTags`, `StreamInfo`, `QueueSong` |
| `src/services/event-hooks.ts` | `EventHooks` class, `EventMap`, singleton `eventHooks` |
| `src/services/song-mapper.ts` | `songToDTO()`, `enrichWithFileTags()` |
| `src/hooks/use-playback-events.ts` | Hook React que envolve player store + emite eventos |

### Modificados
| Arquivo | Mudança |
|---|---|
| `src/api/controller.ts` | Retornar `SongDTO` |
| `src/api/local/local-controller.ts` | `toSongDTO()` |
| `src/stores/player.store.ts` | Usar `SongDTO`/`QueueSong` de `song-dto.ts`; sem `eventHooks` |
| `src/stores/settings.store.ts` | Emitir `settings:changed` |
| `src/api/indexer/local-indexer.ts` | Emitir `library:scan-*` e `library:songs-changed` |
| `src/features/player/player-bar.tsx` | Usar `usePlaybackEvents()` |
| `src/features/player/full-screen-player.tsx` | Usar `usePlaybackEvents()` |
| `src/features/player/ipc-audio-provider.tsx` | Escutar eventos em vez de props |
| `src/features/search/search-page.tsx` | Emitir `search:*`; usar `SongDTO` |
| `src/App.tsx` | Usar `SongDTO` |
| `src/types/domain-types.ts` | Remover `Song` e `QueueSong` (após migração) |
