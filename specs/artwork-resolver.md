# Spec: Artwork Resolver — Asynchronous Multi-Provider Album Art

> **Status**: implemented  
> **Last update**: 2026-06-08
> **Related**: `mp3-cover-art-cache.md` (embedded covers), `event-hooks.md` (SongDTO)

## Problem

Atualmente, capas de álbum vêm de múltiplas fontes:
1. **Tags embutidas** do MP3 (via `music-metadata`, extraídas durante o scan e cacheadas em IndexedDB com MBZ IDs)
2. **`.img/` folders** no filesystem (descobertos durante scan, enriquecidos com MBZ IDs pós-scan)
3. **Cover Art Archive** via MBID da busca MusicBrainz (`musicbrainz-client.ts`)
4. **Thumbnails do YouTube** na busca online

As fontes 1 e 2 são locais e não requerem rede, mas dependem de um sistema de resolução confiável baseado em MusicBrainz IDs. O ArtworkResolver cobre os casos onde não há capa local disponível — buscando de providers remotos como fallback.

## Solução

**Duas camadas**: a primeira é local (zero-rede), a segunda é remota com providers plugáveis:

### Camada 1 — Resolução Local + Remota (serviço centralizado)

Serviço centralizado [`cover-resolver.ts`](../src/services/cover-resolver.ts) com duas funções principais:

#### `resolveCover()` — lookup genérico com fallback artista

1. `loadFromAlbumDotImg()` — **filesystem `.img/`** (zero-rede, cacheia no IndexedDB)
2. `findImages()` — **IndexedDB** por MBZ IDs → nome da combinação → nome artista
3. `findCoverFromDeezer()` — **Deezer API** (remoto, cacheia no IndexedDB)
4. `findCoverFromItunes()` — **iTunes API** (remoto, cacheia no IndexedDB)

No Step 2, inclui queries por `{ artistName }` e `{ mbzArtistId }` como fallback — retorna qualquer imagem daquele artista. Útil para lookup genérico de artista.

#### `resolveAlbumCover()` — lookup estrito por álbum (SEM fallback artista)

1. `loadFromAlbumDotImg()` — **filesystem `.img/`** (requer artist+album)
2. `findImages()` — **IndexedDB** apenas por: `mbzArtistId+mbzReleaseGroupId`, `mbzArtistId+mbzReleaseId`, ou `artistName+albumName`
3. `findCoverFromDeezer()` — **Deezer API** (requer artist+album)
4. `findCoverFromItunes()` — **iTunes API** (requer artist+album)

Nunca faz fallback para artista — álbuns sem capa própria retornam `{ source: "none", blobUrl: null }`.

#### `findArtistImage()` — lookup de imagem de artista (dedicada, em `local-controller.ts`)

1. Busca no Image Store por `artistName`
2. Prioriza registros sem `albumName` (imagens da pasta `<artist>/.img/`)
3. Fallback para qualquer imagem do artista (capas de álbum)
4. Fallback por `mbzArtistId`

#### Usado por:

| Função | Chamador |
|--------|----------|
| `resolveCover()` | Lookups genéricos (backward compat) |
| `resolveAlbumCover()` | `local-controller.ts → resolveImageUrl()` (populateSongImages), `use-cover.ts` hook (páginas de álbum), `download-queue.ts → resolveCoverBytes()` para download |
| `findArtistImage()` | `local-controller.ts → populateArtistImages()` (busca MB, página de artista) |

Os MBZ IDs vêm das **tags ID3** dos arquivos `.mp3`, extraídos durante o scan local — sem nenhuma chamada de rede.

---

## 1. Princípios

1. **O downloader não sabe nada de capa.** O resolver é um serviço independente acionado por eventos ou chamado diretamente pela UI.
2. **Providers são plugáveis.** Cada provider implementa `ArtworkProvider`. Adicionar um novo provider é um arquivo novo — sem mexer no resolver.
3. **Modo race por padrão.** Com N providers ativos, todos são disparados em paralelo. O primeiro a retornar resultado válido vence. Os demais são abortados.
4. **Fila concorrente com pace.** Cada provider tem sua própria sub-fila, limitada por um delay configurável entre requests (100ms a 10s). Não bloqueia a UI.
5. **Providers podem ser ativados/desativados** runtime via settings store. Se todos estiverem desativados, o resolver retorna sem fazer nada.

---

## 2. Providers

### Interface

```typescript
// src/services/artwork/providers/types.ts

export type ArtworkSearchInput = {
  artist: string;
  album?: string;
  title?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  isrc?: string;
  durationMs?: number;
};

export type ArtworkCandidate = {
  provider: string;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  sourceReleaseId?: string;
  confidence: number;        // 0-1
  isFrontCover: boolean;
};

export type ArtworkResult = {
  status: "resolved" | "no_providers" | "not_found" | "error";
  asset?: ArtworkAsset;
  candidates: ArtworkCandidate[];
  winner?: string;           // provider que venceu
  elapsedMs: number;
};

export interface ArtworkProvider {
  readonly name: string;
  search(input: ArtworkSearchInput, signal?: AbortSignal): Promise<ArtworkCandidate[]>;
}
```

### Ordem de providers

| # | Provider | Prioridade | Rate limit sugerido | Fonte |
|---|---|---|---|---|
| 1 | `cover_art_archive` | Alta (confidence base 0.98) | 200ms | `coverartarchive.org` — capas indexadas por MB Release ID |
| 2 | `musicbrainz_release_group` | Alta (0.90) | 1000ms | MusicBrainz API → lista releases → CAA |
| 3 | `itunes` | Média (0.82) | 500ms | `itunes.apple.com/search` |
| 4 | `deezer` | Média (0.78) | 500ms | `api.deezer.com/album` |
| 5 | `embedded` | Baixa (0.70) | 0ms (local) | Tags ID3 do arquivo (já cacheada) |

> A ordem é definida por `confidence` base, mas na prática o modo race faz o **primeiro a responder** ser o escolhido — independentemente da ordem.

### Provider: Cover Art Archive

```typescript
// src/services/artwork/providers/cover-art-archive.provider.ts

export class CoverArtArchiveProvider implements ArtworkProvider {
  readonly name = "cover_art_archive";

  async search(input: ArtworkSearchInput, signal?: AbortSignal): Promise<ArtworkCandidate[]> {
    if (!input.musicbrainzReleaseId) return [];

    const url = `https://coverartarchive.org/release/${input.musicbrainzReleaseId}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal,
    });

    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`CAA ${res.status}`);

    const data = await res.json();

    return data.images
      .filter((img: any) => img.front || img.types?.includes("Front"))
      .map((img: any) => ({
        provider: this.name,
        url: img.image,
        thumbnailUrl: img.thumbnails?.large || img.thumbnails?.small,
        sourceReleaseId: input.musicbrainzReleaseId,
        confidence: img.approved ? 0.98 : 0.92,
        isFrontCover: true,
      }));
  }
}
```

### Provider: iTunes Search API

```typescript
// src/services/artwork/providers/itunes.provider.ts

export class ITunesProvider implements ArtworkProvider {
  readonly name = "itunes";

  async search(input: ArtworkSearchInput, signal?: AbortSignal): Promise<ArtworkCandidate[]> {
    const query = `${input.artist} ${input.album || input.title || ""}`.trim();
    if (!query) return [];

    const params = new URLSearchParams({
      term: query,
      entity: "album",
      media: "music",
      limit: "3",
    });

    const url = `https://itunes.apple.com/search?${params}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`iTunes ${res.status}`);

    const data = await res.json();

    return (data.results || []).map((r: any) => ({
      provider: this.name,
      url: (r.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
      thumbnailUrl: r.artworkUrl60 || r.artworkUrl100,
      confidence: 0.82,
      isFrontCover: true,
    }));
  }
}
```

### Provider: Deezer

```typescript
// src/services/artwork/providers/deezer.provider.ts

export class DeezerProvider implements ArtworkProvider {
  readonly name = "deezer";

  async search(input: ArtworkSearchInput, signal?: AbortSignal): Promise<ArtworkCandidate[]> {
    const query = `artist:"${input.artist}" album:"${input.album || input.title || ""}"`;
    const params = new URLSearchParams({ q: query, limit: "3" });

    const url = `https://api.deezer.com/search/album?${params}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Deezer ${res.status}`);

    const data = await res.json();

    return (data.data || []).map((r: any) => ({
      provider: this.name,
      url: r.cover_xl || r.cover_big || r.cover_medium,
      thumbnailUrl: r.cover_small,
      confidence: 0.78,
      isFrontCover: true,
    }));
  }
}
```

---

## 3. ArtworkQueue — Fila Concorrente com Pace

### Funcionamento

```
Provider A (200ms pace)  Provider B (500ms pace)   Provider C (0ms pace)
      │                       │                       │
  ┌───┴───┐              ┌───┴───┐              ┌───┴───┐
  │ req 1 │              │ req 1 │              │ req 1 │
  └───┬───┘              └───┬───┘              └───┬───┘
      │ 200ms                 │ 500ms                 │ 0ms
  ┌───┴───┐              ┌───┴───┐              ┌───┴───┐
  │ req 2 │              │ req 2 │              │ req 2 │
  └───────┘              └───────┘              └───────┘
```

Cada provider tem sua própria sub-fila. Requests no mesmo provider aguardam o delay configurado entre si. Providers diferentes rodam em paralelo (concorrência real via async).

```typescript
// src/services/artwork/artwork-queue.ts

type QueueTask<T> = {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  fn: () => Promise<T>;
};

class ArtworkQueue {
  private queues = new Map<string, QueueTask<any>[]>();
  private processing = new Map<string, boolean>();
  private lastRequest = new Map<string, number>();  // timestamp da última request
  private controller = new AbortController();

  enqueue<T>(provider: string, paceMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.queues.has(provider)) this.queues.set(provider, []);
      this.queues.get(provider)!.push({ resolve, reject, fn: () => fn(this.controller.signal) });

      if (!this.processing.get(provider)) {
        this.processNext(provider, paceMs);
      }
    });
  }

  private async processNext(provider: string, paceMs: number) {
    this.processing.set(provider, true);
    const queue = this.queues.get(provider)!;

    while (queue.length > 0) {
      const task = queue.shift()!;

      // Espera o pace desde a última request
      const now = Date.now();
      const last = this.lastRequest.get(provider) || 0;
      const wait = Math.max(0, paceMs - (now - last));
      if (wait > 0) await this.delay(wait);

      try {
        this.lastRequest.set(provider, Date.now());
        const result = await task.fn();
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      }
    }

    this.processing.set(provider, false);
  }

  abort() {
    this.controller.abort();
    this.controller = new AbortController();
  }

  private delay(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }
}

export const artworkQueue = new ArtworkQueue();
```

---

## 4. ArtworkResolver — Orquestrador

```typescript
// src/services/artwork/artwork-resolver.ts

class ArtworkResolver {
  constructor(private providers: ArtworkProvider[]) {}

  async resolve(input: ArtworkSearchInput): Promise<ArtworkResult> {
    const settings = useSettingsStore.getState();
    const startTime = Date.now();

    // Filtra providers habilitados
    const enabled = this.providers.filter(p => settings.isArtworkProviderEnabled(p.name));
    if (enabled.length === 0) {
      return { status: "no_providers", candidates: [], elapsedMs: Date.now() - startTime };
    }

    // Embora embedded seja local, processa primeiro na fila (síncrono ou 0ms pace)
    const embedded = enabled.find(p => p.name === "embedded");
    const remote = enabled.filter(p => p.name !== "embedded");

    // 1. Sempre tenta embedded primeiro (local, sem delay)
    if (embedded) {
      try {
        const result = await embedded.search(input);
        if (result.length > 0) {
          return { status: "resolved", candidates: result, winner: "embedded", elapsedMs: Date.now() - startTime };
        }
      } catch { /* segue para remote */ }
    }

    // 2. Race entre todos os providers remotos
    const candidates: ArtworkCandidate[] = [];
    const errors: string[] = [];

    try {
      const result = await Promise.any(
        remote.map(p =>
          artworkQueue.enqueue(p.name, settings.getArtworkPaceMs(p.name), async (signal) => {
            const items = await p.search(input, signal);
            if (items.length === 0) throw new Error(`${p.name}: no results`);
            return { provider: p, items };
          })
        )
      );

      candidates.push(...result.items);
      return {
        status: "resolved",
        candidates,
        winner: result.provider.name,
        elapsedMs: Date.now() - startTime,
      };
    } catch {
      // Promise.any rejeita se TODOS falharem
      return { status: "not_found", candidates, elapsedMs: Date.now() - startTime };
    }
  }

  /** Sem race — coleta candidatos de todos os providers (para debug ou seleção manual) */
  async resolveAll(input: ArtworkSearchInput): Promise<ArtworkResult> {
    const settings = useSettingsStore.getState();
    const startTime = Date.now();
    const enabled = this.providers.filter(p => settings.isArtworkProviderEnabled(p.name));

    if (enabled.length === 0) {
      return { status: "no_providers", candidates: [], elapsedMs: 0 };
    }

    const results = await Promise.allSettled(
      enabled.map(p =>
        artworkQueue.enqueue(p.name, settings.getArtworkPaceMs(p.name), (signal) =>
          p.search(input, signal)
        )
      )
    );

    const candidates = results
      .filter((r): r is PromiseFulfilledResult<ArtworkCandidate[]> => r.status === "fulfilled")
      .flatMap(r => r.value);

    return {
      status: candidates.length > 0 ? "resolved" : "not_found",
      candidates,
      elapsedMs: Date.now() - startTime,
    };
  }
}
```

---

## 5. Settings Store — Configuração Runtime

```typescript
// src/stores/settings.store.ts — campos adicionados

type ArtworkProviderSetting = {
  enabled: boolean;
  paceMs: number;     // delay entre requests (100 a 10000)
};

type SettingsState = {
  // ... campos existentes (theme, visualizer, etc.) ...

  artworkProviders: Record<string, ArtworkProviderSetting>;

  isArtworkProviderEnabled: (name: string) => boolean;
  getArtworkPaceMs: (name: string) => number;
  setArtworkProvider: (name: string, partial: Partial<ArtworkProviderSetting>) => void;
};

// Valores padrão
const DEFAULT_ARTWORK_PROVIDERS: Record<string, ArtworkProviderSetting> = {
  embedded:                 { enabled: true,  paceMs: 0 },
  cover_art_archive:        { enabled: true,  paceMs: 200 },
  musicbrainz_release_group: { enabled: true,  paceMs: 1000 },
  itunes:                   { enabled: false, paceMs: 500 },
  deezer:                   { enabled: false, paceMs: 500 },
};
```

> `embedded` com `paceMs: 0` significa sem delay — processa imediatamente (cache local).

---

## 6. Integração com o Sistema

### Evento disparado ao baixar uma música (futuro)

```
track.downloaded → artworkResolver.resolve(input) → cacheia no image-store
```

### Chamada direta pela UI

Qualquer componente pode chamar o resolver:

```typescript
import { artworkResolver } from "../services/artwork/artwork-resolver";

const result = await artworkResolver.resolve({
  artist: song.artist,
  album: song.album,
  musicbrainzReleaseId: song.mbzReleaseGroupId,
});

if (result.status === "resolved") {
  // result.winner contém o nome do provider que respondeu primeiro
  // result.candidates[0].url é a URL da capa
}
```

### Integração com `enrichWithFileTags`

A capa resolvida é adicionada ao `coverUrl` do SongDTO:

```typescript
async function enrichWithFileTags(dto: SongDTO): Promise<SongDTO> {
  if (!dto.filePath) return dto;

  // Tenta embedded primeiro (via file-metadata-cache)
  const tags = await cachedFileTags(dto.filePath, 300_000, () => extractFileTags(dto.filePath));

  // Fallback para providers remotos se não tem capa embedada
  if (!tags?.coverArtRef && dto.album && dto.artist) {
    const art = await artworkResolver.resolve({
      artist: dto.artist,
      album: dto.album,
      musicbrainzReleaseGroupId: dto.mbzReleaseGroupId,
    });
    if (art.status === "resolved" && art.candidates[0]) {
      return { ...dto, coverUrl: art.candidates[0].url };
    }
  }

  return dto;
}
```

## 7. Cache

O resultado do resolver é cacheado em duas camadas:

1. **Image Store (IndexedDB)** — já existente em `src/services/image-store.ts`. O download da imagem feito pelo normalizer grava na store com SHA-256 dedup. Configurações de cache TTL e invalidação são gerenciadas pelo `image-store.ts` existente.
2. **Metadata cache (Dexie)** — já existente em `mbz_metadata_cache`. O mapeamento `mbzReleaseGroupId → releaseId` é cacheado com TTL de 30 dias.

O ArtworkResolver **não gerencia cache de imagem** — ele só retorna candidatos (URLs). O download, normalização e cache da imagem é responsabilidade do `image-fetch.ts` / `image-store.ts` existentes.

---

## 8. Arquivos

### Camada de Resolução Local (executada antes dos providers remotos)

A resolução local é feita diretamente por `local-controller.ts:resolveImageUrl()` sem instanciar o `ArtworkResolver`. Os arquivos relevantes:

| Arquivo | Descrição |
|---|---|
| `src/services/image-store.ts` | IndexedDB `selftify-images-v2` com `ImageRecord` + `findImages()` |
| `src/services/electron-image-store.ts` | IPC wrapper para Electron main-process |
| `src/services/image-preloader.ts` | Varredura pós-scan de pastas `.img/` + enriquecimento com MBZ IDs |
| `src/services/dot-img-loader.ts` | Leitura on-demand de `.img/` do filesystem |
| `src/services/cover-event-bus.ts` | Pub/sub para re-resolução de capas via `useCover` |
| `src/api/indexer/local-indexer.ts` | Extração de capas embutidas com MBZ IDs; descoberta de `.img/` |
| `src/api/local/local-controller.ts` | `resolveImageUrl()` com cascata MBZ ID > nome |
| `src/types/domain-types.ts` | `Song` ganha `mbzReleaseGroupId`, `mbzAlbumId` |
| `src/services/dto.ts` | Mapeia `mbz_release_group_id`, `mbz_album_id` para domínio |

### Providers Remotos

| Arquivo | Descrição |
|---|---|
| `src/services/artwork/artwork-resolver.ts` | `ArtworkResolver` — orquestrador com race mode (fallback após camada local) |
| `src/services/artwork/artwork-queue.ts` | `ArtworkQueue` — fila concorrente com pace por provider |
| `src/services/artwork/providers/types.ts` | `ArtworkProvider`, `ArtworkCandidate`, `ArtworkSearchInput`, `ArtworkResult` |
| `src/services/artwork/providers/cover-art-archive.provider.ts` | Provider Cover Art Archive |
| `src/services/artwork/providers/musicbrainz-release-group.provider.ts` | Provider MusicBrainz Release Group → CAA |
| `src/services/artwork/providers/itunes.provider.ts` | Provider iTunes Search API |
| `src/services/artwork/providers/deezer.provider.ts` | Provider Deezer API |
| `src/services/artwork/providers/embedded.provider.ts` | Provider de tags embedadas (delega para cache de FileTags) |

### Settings Store

| Arquivo | Mudança |
|---|---|
| `src/stores/settings.store.ts` | Adicionar `artworkProviders` + getters/setters |
