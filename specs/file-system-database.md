# File System Database (SQLiteDB) + SQLite

## Migration to SQLite (2024-06)

In phase 8, the SQLiteDB JSON-file-based storage for structured metadata was **superseded by SQLite** (via `sql.js`) while retaining the SQLiteDB JSON files for compatibility and image storage. The architecture is now layered:

| Layer | Storage | Purpose | Read by |
|-------|---------|---------|---------|
| **SQLite** | `.selftify/library.db` | Artists, albums, tracks, mappings, ranking log, search cache, query cache | `local-controller.ts`, `local-queries.ts`, `sqlite-db-*` wrappers |
| **SQLiteDB images** | `.selftify/images/{artist,album,query}/` | Binary image data (SHA-256 deduplicated) | `sqlite-db-image.ts` |
| **SQLiteDB config** | `.selftify/config.json` | Scan state (pre-DB bootstrap) | `use-local-scan.ts` |
| **SQLiteDB `.selftify.json`** | Per-artist/album `.selftify.json` | Legacy format — **no longer written** by the indexer | `readAlbumMeta`/`readArtistMeta` (fallback only) |

### Denormalized track schema (intentional)

The `tracks` table in SQLite stores `album_id` denormalized (not a separate join table). This means reading all songs for an album is a single indexed query (`SELECT * FROM tracks WHERE album_id = ?`). The `albumRepo.getAllAlbums()` method returns each album with its tracks pre-joined from this denormalized structure.

### Key behavioral changes

| Before (SQLiteDB) | After (SQLite) |
|---------------|----------------|
| `finish()` writes JSON files per artist/album | `finish()` writes to SQLite via repository pattern |
| `loadAllAlbumMetas()` scans filesystem directories | `loadAllAlbumMetas()` queries SQLite `albums` table |
| `getAllSongs()` walks directory tree | `getAllSongs()` calls `albumRepo.getAllAlbums()` |
| Cache read via `sqlite-db-cache.ts` (file IO) | Cache via `search-cache-repo`, `query-cache-repo` (SQLite) |
| Per-artist/album JSON metadata files | SQLite rows + image files retained |

## Problem

| Cache atual | Substituído por |
|---|---|
| `songs` (Dexie) | `Album/.selftify.json` → `tracks[]` |
| `artists` (Dexie) | `Artist/.selftify.json` |
| `scan_state` (Dexie) | `.selftify/config.json` |
| `scan_queue` (Dexie) | Eliminado — scan opera sobre o filesystem diretamente |
| `mbz_metadata_cache` (Dexie) | `.selftify/queries/musicbrainz/<hash>.json` |
| `mbz_search_cache` (Dexie) | `.selftify/queries/musicbrainz/<hash>.json` |
| `mbz_yt_mapping` (Dexie) | `SqliteDbAlbumTrack.youtubeCandidates[]` (embutido no álbum) |
| `ranking_log` (Dexie) | `.selftify/queries/youtube/<mbzRecordingId>.json` |
| `image-store` (IndexedDB) | `.selftify/images/{artist,album,query}/` |
| `cover.store` (Zustand + URL blobs) | Leitura direta do filesystem |
| `local-library.store` (Zustand + persist) | `.selftify/config.json` + scan em tempo real |
| `ranking-debug.store` (Zustand) | Eliminado — debug via log de arquivo opcional |
| `memory-cache` (serviço) | Eliminado — dados lidos frescos do disco, sem cache em memória |
| `cover-resolver` (serviço) | Eliminado — resolução de capa migrada para `sqlite-db-image.ts` |
| `musicbrainz-client` (cache) | Eliminado — cache via `.selftify/queries/musicbrainz/` |
| `musicbrainz-cache` (Dexie + memória) | Eliminado — substituído por `.selftify/queries/musicbrainz/` |

**O SQLiteDB é autocontido:** com a pasta da biblioteca em mãos, qualquer app consegue ler todos os metadados sem depender de IndexedDB, localStorage ou banco embedado. Basta ler arquivos JSON e imagens do disco.

### Princípios

| Princípio | Implicação |
|-----------|------------|
| **FS é a verdade** | Todo metadado persiste no filesystem. Não há cache intermediário — a leitura é sempre do disco. |
| **Dados online são eventuals** | Enriquecimento MusicBrainz/YouTube tenta mas não bloqueia. Se falha, o metadado básico (tags do arquivo) permanece. |
| **Pasta é autocontida** | Copiar a raiz da biblioteca = copiar todos os metadados e capas. |
| **Sem lock** | Múltiplos dispositivos podem ler/escrever na mesma biblioteca (ex: rede compartilhada). |

### Portabilidade (copia-e-cola)

Todo path dentro de qualquer arquivo `.selftify.json`, `.selftify/queries/*.json` ou `.selftify/config.json` é **sempre relativo à raiz da biblioteca** ou ao diretório do próprio arquivo. Nunca há:

- Caminhos absolutos (`/home/user/Music/...`, `C:\Users\...`)
- Identificadores de máquina (`hostname`, `UUID` de volume)
- Referências a drives ou mount points

Isso significa que `cp -r /origem/Music /destino/Music` funciona sem qualquer reparo. O app só precisa apontar para o novo `library_root` e todos os paths relativos resolvem.

**Regras concretas:**

| O que | Como |
|-------|------|
| `tracks[].path` no álbum | Relativo ao diretório do álbum. Ex: `"01 - Song.flac"` |
| `images[].url` para imagem local | Relativo ao library root. Ex: `".selftify/images/album/abc.jpg"` |
| `imageUrl` em cache de query | Relativo ao library root. Ex: `".selftify/images/query/hash-0.jpg"` |
| Path de playlist `.selftifylist` | Relativo ao library root. Ex: `"playlists/Minhas.m3u"` |
| `origin.folderPath` no app | Armazenado em settings (fora do SQLiteDB). Não entra nos metadados. |

---

## Estrutura de Diretórios

```
<library_root>/
├── .selftify/                          ← Pasta oculta de controle da aplicação
│   ├── config.json                     ← Configurações da biblioteca (scan state, versão)
│   ├── queries/                        ← Cache de queries de busca
│   │   ├── musicbrainz/                ← Resultados do MusicBrainz
│   │   │   ├── <sha256-query>.json
│   │   │   └── ...
│   │   └── youtube/                    ← Resultados do YouTube Music
│   │       ├── <sha256-query>.json
│   │       └── ...
│   ├── images/                         ← Imagens normalizadas
│   │   ├── artist/
│   │   │   ├── <sha256-artist>.{jpg,png,webp}
│   │   │   └── ...
│   │   ├── album/
│   │   │   ├── <sha256-album>.{jpg,png,webp}
│   │   │   └── ...
│   │   └── query/                      ← Imagens extraídas para cache de queries
│   │       ├── mb-<sha256-query>-<N>.{jpg,png,webp}     ← prefixo "mb-" (MusicBrainz)
│   │       ├── yt-<sha256-query>-<N>.{jpg,png,webp}     ← prefixo "yt-" (YouTube)
│   │       └── ...
│   └── ...
│
├── Artist Name/                        ← Pasta do artista
│   ├── .selftify.json                  ← Metadados do artista (NAME_ARTIST)
│   │
│   ├── Album Name (Year)/              ← Pasta do álbum
│   │   ├── .selftify.json              ← Metadados do álbum (NAME_ALBUM)
│   │   ├── .img/                       ← (legado) Capas em arquivos avulsos
│   │   ├── 01 - Song Title.flac
│   │   ├── 02 - Another Song.flac
│   │   └── ...
│   │
│   ├── EP Name/                        ← EP também usa .selftify.json (NAME_ALBUM)
│   │   ├── .selftify.json
│   │   ├── 01 - Track.flac
│   │   └── ...
│   │
│   └── Single Title/                   ← Single sem álbum
│       ├── .selftify.json              ← Metadados: albumName = "Single Title"
│       └── Single Title.flac
│
├── Various Artists/                    ← Coletâneas / compilações
│   ├── Compilation Name/
│   │   ├── .selftify.json              ← albumArtist = "Various Artists"
│   │   ├── 01 - Artist A - Song.flac
│   │   └── ...
│   └── ...
│
├── .trash/                             ← (legado) Arquivos marcados para exclusão
└── playlists/                          ← (legado) Playlists .selftifylist
```

---

## Formato dos Arquivos de Metadados

### `NAME_ARTIST` — `.selftify.json` na raiz do artista

```jsonc
{
  "$schema": "selftify-artist",
  "version": 1,
  "name": "Radiohead",
  "sortName": "Radiohead",
  "mbzId": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
  "biography": "English rock band formed in 1985...",
  "genres": ["Alternative Rock", "Art Rock"],
  "country": "GB",
  "type": "Group",
  "disambiguation": null,
  "images": [
    {
      "id": "artist-cover",
      "url": ".selftify/images/artist/abc123.jpg",   // ← path relativo à raiz da biblioteca
      "width": 800,
      "height": 800,
      "format": "image/jpeg"
    }
  ],
  "updatedAt": 1717000000000,
  "enrichedAt": 1717000000000          // null se nunca enriquecido
}
```

- `images[].url` é sempre **path relativo ao library root** quando a imagem está no filesystem, ou URL HTTP completa quando é referência online não-baixada.
- A imagem física fica em `.selftify/images/artist/<sha256>.jpg` (ou `.png`/`.webp`).
- `enrichedAt` = `null` indica que o enriquecimento online nunca ocorreu (metadado veio só das tags).
- `mbzId` pode ser `null` se nenhum match do MusicBrainz foi encontrado ainda.

### `NAME_ALBUM` — `.selftify.json` na pasta do álbum

```jsonc
{
  "$schema": "selftify-album",
  "version": 1,
  "name": "OK Computer",
  "artistName": "Radiohead",
  "albumArtist": "Radiohead",
  "releaseYear": 1997,
  "mbzId": "f96c2c19-8f5b-4e3a-8f0e-3c9b5f2d7a1b",
  "mbzReleaseGroupId": "e2c9c7b3-9f8a-4d6b-b7c3-1a2d4e5f6g7h",
  "genres": ["Alternative Rock"],
  "images": [
    {
      "id": "cover",
      "url": ".selftify/images/album/def456.jpg",   // ← path relativo à raiz
      "width": 600,
      "height": 600,
      "format": "image/jpeg"
    }
  ],
  "songCount": 12,
  "duration": 4012800,       // ms
  "tracks": [
    {
      "path": "01 - Airbag.flac",
      "name": "Airbag",
      "artistName": "Radiohead",
      "trackNumber": 1,
      "discNumber": 1,
      "duration": 284000,
      "mbzRecordingId": "...",
      "genre": null,
      "youtubeCandidates": [
        {
          "videoId": "dLkH7qR83q4",
          "title": "Radiohead - Airbag",
          "uploader": "Radiohead",
          "duration": 284000,
          "thumbnailUrl": "https://i.ytimg.com/vi/dLkH7qR83q4/hqdefault.jpg",
          "score": 0.95,
          "titleMatch": true,
          "artistMatch": true,
          "albumMatch": false,
          "artistOnChannel": true,
          "exactDuration": true,
          "closestDuration": true,
          "keywordScore": 0.8,
          "source": "ranking",
          "selected": true,
          "selectedAt": 1717000000000
        }
      ]
    }
    // ...
  ],
  "updatedAt": 1717000000000,
  "enrichedAt": null
}
```

- `tracks[]` contém **apenas o sobrenome do arquivo** (`path` relativo ao diretório do álbum) para que a pasta possa ser movida sem invalidar referências.
- `images[].url` pode ser path relativo (imagem local) ou URL HTTP (imagem online não baixada). Nunca há `data` inline.
- Para **singles** (pasta com uma única música, sem nome de álbum nas tags): `albumName` e `name` da pasta coincidem, `trackNumber` = 1.
- `youtubeCandidates[]` armazena o resultado do ranking do YouTube para cada faixa. A lista completa de candidatos é mantida junto com a faixa para que a seleção sobreviva a recarregamentos da UI. O campo `selected` indica qual candidato foi escolhido (automática ou manualmente) para tocar aquela faixa.

### `NAME_ROOT` — `.selftify/config.json`

```jsonc
{
  "version": 1,
  "libraryName": "My Music",
  "createdAt": 1717000000000,
  "lastScanAt": 1717000000000,
  "scanStatus": "done" | "scanning" | "idle",
  "songCount": 4523,
  "artistCount": 423,
  "albumCount": 891
}
```

---

## Segmentação por Nível

Cada nível da árvore de diretórios armazena um tipo específico de informação. A tabela abaixo define exatamente o que vive em cada nível, o que nunca deve estar lá, e como os níveis se relacionam.

### Nível 0 — Raiz da Biblioteca (`<library_root>/`)

| Item | Presente? | Detalhes |
|------|-----------|----------|
| Arquivos de áudio | ❌ | Música nunca na raiz. Sempre dentro de pastas de artista/álbum. |
| Pastas de artista | ✅ | `Artist Name/` — diretórios nomeados com o nome do artista |
| `.selftify/` | ✅ | Pasta oculta de controle |
| `.trash/` | ❌ legado | Mantido para compatibilidade. Não faz parte do SQLiteDB. |
| `playlists/` | ❌ legado | Mantido. Playlists em `.selftifylist`. |
| `.img/` | ❌ | `.img/` só existe DENTRO de pastas de álbum, nunca na raiz. |
| `.selftify.json` | ❌ | `$schema` não faz sentido na raiz. Usar `.selftify/config.json`. |

### Nível 1 — `.selftify/` (configuração global)

```
.selftify/
├── config.json              ← Scan state, versão, contagens
├── queries/
│   ├── musicbrainz/
│   │   └── <hash>.json      ← Resultado de search no MusicBrainz
│   └── youtube/
│       └── <hash>.json      ← Resultado de search no YouTube
└── images/
    ├── artist/
    │   └── <sha256>.jpg     ← Foto do artista (deduplicada)
    ├── album/
    │   └── <sha256>.jpg     ← Capa de álbum (deduplicada)
    └── query/
        ├── mb-<hash>-<N>.jpg
        └── yt-<hash>-<N>.jpg
```

| O que armazena | O que NÃO armazena |
|---|---|
| Config da biblioteca (scan state, contagens) | Metadados de artista/álbum/música |
| Cache de queries de busca (MB + YT) | Capas de álbum (ficam em `images/album/`) |
| Imagens deduplicadas (artist, album, query) | Arquivos de áudio |
| Estado global: `songCount`, `artistCount`, `albumCount` | Playlists (ficam em `playlists/`) |

### Nível 2 — Artista (`<Artist>/.selftify.json`)

```
Artist Name/
├── .selftify.json           ← NAME_ARTIST (artist metadata)
├── Album Name/
│   ├── .selftify.json       ← NAME_ALBUM
│   ├── .img/                ← Capas legado (opcional)
│   └── 01 - Track.flac
└── ...
```

| Campo | Origem | Exemplo |
|-------|--------|---------|
| `name` | Tags do áudio ou nome da pasta | `"Radiohead"` |
| `sortName` | MusicBrainz (enriquecimento) | `"Radiohead"` |
| `mbzId` | MusicBrainz (enriquecimento) | `"a74b1b7f-..."` |
| `biography` | MusicBrainz (enriquecimento) | `"English rock band..."` |
| `genres` | MusicBrainz (enriquecimento) | `["Alternative Rock"]` |
| `country` | MusicBrainz (enriquecimento) | `"GB"` |
| `type` | MusicBrainz (enriquecimento) | `"Group"` |
| `disambiguation` | MusicBrainz (enriquecimento) | `"90s rock band"` |
| `images[]` | Enriquecimento ou on-demand | `url: ".selftify/images/artist/abc.jpg"` |
| `enrichedAt` | Preenchido pelo enriquecimento | `1717000000000` ou `null` |

| Armazena | Não armazena |
|---|---|
| Metadados do artista (biografia, gêneros, imagem) | Músicas (ficam nos álbuns) |
| `mbzId` para lookup futuro | Capas de álbum (ficam no álbum ou `images/album/`) |
| Timestamp de enriquecimento | Config global da biblioteca |
| `images[]` com path relativo para foto | Dados de playlist |

### Nível 3 — Álbum / Release / EP / Single (`<Artist>/<Album>/.selftify.json`)

```
Album Name/
├── .selftify.json           ← NAME_ALBUM (album metadata + tracks[])
├── .img/                    ← Capas em arquivo avulso (opcional, legado)
│   ├── cover.jpg
│   ├── back.jpg
│   └── folder.png
├── 01 - Song.flac
├── 02 - Another Song.flac
└── ...
```

| Campo | Origem | Exemplo |
|-------|--------|---------|
| `name` | Tags ou nome da pasta | `"OK Computer"` |
| `artistName` | Tags | `"Radiohead"` |
| `albumArtist` | Tags | `"Radiohead"` |
| `releaseYear` | Tags | `1997` |
| `mbzId` | MusicBrainz | `"f96c2c19-..."` |
| `mbzReleaseGroupId` | MusicBrainz | `"e2c9c7b3-..."` |
| `genres` | Tags + enriquecimento | `["Alternative Rock"]` |
| `images[]` | Capa extraída, enriquecida ou `.img/` | `url: ".selftify/images/album/def.jpg"` |
| `songCount` | Calculado do `tracks[]` | `12` |
| `duration` | Soma dos `tracks[].duration` | `4012800` |
| `tracks[]` | Scan dos arquivos no diretório | Array de `SqliteDbAlbumTrack` |
| `updatedAt` | Última modificação local | `1717000000000` |
| `enrichedAt` | Último enriquecimento de capa | `1717000000000` ou `null` |

| Armazena | Não armazena |
|---|---|
| Metadados do álbum (nome, ano, gêneros, capa) | Biografia do artista (fica no artista) |
| `tracks[]` com path relativo ao dir do álbum | Cache de queries |
| `mbzId` + `mbzReleaseGroupId` | Config global |
| Capa via `images[].url` (path relativo ao root) | Dados de playlist |

#### `tracks[]` — o que cada track contém

```typescript
interface SqliteDbAlbumTrack {
  path: string;                // "01 - Airbag.flac" — relativo ao dir do álbum
  name: string;                // "Airbag" — nome da faixa
  artistName: string;          // "Radiohead"
  albumName: string | null;    // "OK Computer" — redundante mas útil para lookup
  trackNumber: number | null;  // 1
  discNumber: number | null;   // 1
  duration: number | null;     // 284000 (ms)
  genre: string | null;        // "Alternative Rock"
  mbzRecordingId: string | null;  // UUID da gravação no MusicBrainz
  mbzTrackId: string | null;      // UUID da faixa no MusicBrainz
  youtubeCandidates?: YouTubeCandidate[];  // Candidatos YouTube mapeados para esta faixa
}

interface YouTubeCandidate {
  videoId: string;             // ID do vídeo no YouTube
  title: string;               // Título do vídeo
  uploader: string;            // Nome do canal/uploader
  duration: number;            // Duração em ms
  thumbnailUrl: string | null; // URL da thumbnail
  score: number;               // Pontuação do ranking (0-1)
  titleMatch: boolean;         // Título coincide com o nome da faixa
  artistMatch: boolean;        // Uploader coincide com o artista
  albumMatch: boolean;         // Título contém nome do álbum
  artistOnChannel: boolean;    // Artista aparece no canal
  exactDuration: boolean;      // Duração exata (±2s)
  closestDuration: boolean;    // Duração mais próxima entre os candidatos
  keywordScore: number;        // Score adicional por keywords
  source: "ranking" | "custom"; // Origem: ranking automático ou inserção manual
  selected: boolean;           // true se for o candidato atualmente selecionado
  selectedAt: number | null;   // Timestamp da seleção (null se nunca selecionado)
}
```

- `path` é o único campo obrigatório e imutável (identifica o arquivo físico)
- `name` + `artistName` + `trackNumber` vêm das tags do áudio ou do nome do arquivo
- `mbzRecordingId` + `mbzTrackId` são preenchidos por enriquecimento MusicBrainz
- `youtubeCandidates` é populado pelo `youtube-ranking.ts` quando uma busca por candidatos YouTube é feita para a faixa. A lista é atualizada incrementalmente: novas buscas substituem candidatos existentes para o mesmo `mbzRecordingId`, mas respeitam o `selected` manual do usuário.
- O álbum NÃO armazena `file_size`, `bitrate`, `sample_rate`, `file_extension` — essas são propriedades do arquivo físico e podem ser obtidas via stat do sistema

### Nível 4 — `.img/` (legado, por álbum)

```
Album/.img/
├── cover.jpg                ← Capa principal (prioridade mais baixa que .selftify/images/)
├── back.jpg                 ← Contra-capa
├── folder.png               ← Capa em PNG
├── cd.jpg                   ← CD art
└── <qualquer nome>.jpg      ← Imagens avulsas
```

| O que armazena | Regras |
|---|---|
| Capas em arquivo avulso dentro da pasta do álbum | Mantido por compatibilidade com organização manual do usuário |
| Qualquer formato de imagem (jpg, png, webp, bmp) | O scan existente já lê e cacheia estas imagens |
| Múltiplas imagens por álbum | Apenas a primeira (sorted alfabeticamente) é usada como capa |

| Não armazena | Por quê |
|---|---|
| Metadados JSON | `.img/` é raw filesystem, sem estrutura |
| Imagens de artista | Artista nunca tem `.img/` — apenas álbuns |

**Convivência com `.selftify/images/`:** na UI, `.img/` tem precedência sobre `.selftify/images/` (local-first: arquivo solto na pasta do álbum é a fonte mais local possível). Quando o enriquecimento ou on-demand baixa uma capa, ela vai para `.selftify/images/album/` e é usada apenas se não houver `.img/`.

---

## Cache de Queries

### Segmentação por plataforma

As queries são segregadas em duas plataformas independentes, cada uma em seu próprio subdiretório:

| Plataforma | Diretório | Escopo |
|------------|-----------|--------|
| **MusicBrainz** | `.selftify/queries/musicbrainz/` | Pesquisa de artistas, álbuns, músicas, MBIDs por nome |
| **YouTube Music** | `.selftify/queries/youtube/` | Pesquisa de vídeos, canais, músicas por nome |

**Por que separar?**
1. **Manutenibilidade**: Mudanças na API do MusicBrainz não afetam cache do YouTube e vice-versa.
2. **TTL diferente**: MusicBrainz raramente muda (dias/semanas), YouTube pode mudar a cada hora.
3. **Formato de resultado diferente**: MusicBrainz retorna MBIDs + metadados curados; YouTube retorna videoIds + relevância.
4. **Evolução independente**: Cada plataforma pode evoluir seu schema de cache sem quebrar a outra.

### Estrutura

```
.selftify/queries/
├── musicbrainz/
│   ├── <sha256-query-text>.json
│   └── ...
└── youtube/
    ├── <sha256-query-text>.json
    └── ...
```

- `query-text` = string exata digitada pelo usuário (case-sensitive, com espaços, sem normalização).
- `sha256-query-text` = `sha256(queryText)` — mesma query em ambas plataformas gera o mesmo nome de arquivo, mas cada plataforma tem seu próprio diretório.
- A imagem associada fica em `.selftify/images/query/` com prefixo da plataforma.

### `.selftify/queries/{musicbrainz,youtube}/<sha256>.json`

```jsonc
{
  "query": "creep",
  "queryHash": "sha256-do-texto-buscado",
  "platform": "musicbrainz",          // ou "youtube"
  "originId": "origin-uuid",
  "timestamp": 1717000000000,
  "ttl": 86400000,                    // 24h — após isso, pode re-executar
  "results": {
    "songs": [
      {
        "id": "song-id",
        "name": "Creep",
        "artistName": "Radiohead",
        "albumName": "Pablo Honey",
        "imageUrl": ".selftify/images/query/mb-a1b2c3-0.jpg"   // prefixo "mb-" ou "yt-"
      }
    ],
    "albums": [],
    "albumArtists": []
  }
}
```

**Regra de cache:** antes de chamar a API externa, o app calcula `sha256(queryText)` e verifica:

```
existe .selftify/queries/musicbrainz/<hash>.json?
  ├─ SIM e dentro do TTL → retorna cache (sem chamada de rede)
  └─ NÃO ou expirado      → chama MusicBrainz API, salva resultado
existe .selftify/queries/youtube/<hash>.json?
  ├─ SIM e dentro do TTL  → retorna cache
  └─ NÃO ou expirado      → chama YouTube, salva resultado
```

As duas verificações são independentes — uma pode estar em cache e a outra não.

### TTLs por plataforma

| Plataforma | TTL padrão | Justificativa |
|------------|-----------|---------------|
| MusicBrainz | 7 dias (`604800000 ms`) | Dados curados, mudam raramente |
| YouTube Music | 1 hora (`3600000 ms`) | Rankings mudam, novos uploads |

### Cache de Candidatos YouTube por Faixa

Diferente das queries de busca textual, os candidatos YouTube de cada faixa são armazenados **dentro do próprio álbum**, embutidos em `SqliteDbAlbumTrack.youtubeCandidates[]`.

**Motivação:**

| Problema | Solução |
|----------|---------|
| O ranking YouTube é caro de gerar (múltiplas chamadas de rede + heurísticas). | Armazenar junto com a faixa evita re-ranking a cada play. |
| O usuário pode selecionar manualmente qual candidato tocar. | `selected` + `selectedAt` preservam a escolha do usuário. |
| Candidatos são específicos de cada `mbzRecordingId`, não de uma query textual. | Agrupar por faixa (dentro do álbum) é o grain natural. |
| Uma música pode estar em múltiplos álbuns (coletâneas, compilações). | Cada instância da faixa em cada álbum tem seus próprios candidatos — uma escolha em um álbum não afeta o outro. |

**Ciclo de vida:**

```
1. Scan indexa arquivo → SqliteDbAlbumTrack sem youtubeCandidates
2. Usuário tenta tocar → youtube-ranking.ts busca candidatos para mbzRecordingId
3. Ranking é salvo em SqliteDbAlbumTrack.youtubeCandidates[] (atualiza album.json)
4. Na próxima vez, youtubeCandidates já está preenchido → salta busca
5. Refresh manual → usuário força re-ranking → novos candidatos substituem os antigos
```

**Refresh manual:** quando o usuário solicita "re-ranquear" uma faixa, o campo `youtubeCandidates` é substituído por completo. A escolha manual (`selected: true` definido pelo usuário) é perdida — o novo ranking zera todos os `selected`.

**Atualização incremental (scan/reauth):** se uma faixa já tem `youtubeCandidates` e o scan roda novamente sem alteração de metadados, os candidatos **não são recalculados**. Apenas campos como `name`, `artistName`, `duration` são atualizados das tags. Para disparar um novo ranking, o usuário deve usar a ação "re-ranquear" ou tocar a faixa sem candidatos prévios.



---

## Arquivos e Modificações Planejadas

### Novos Arquivos

| Arquivo | Propósito |
|---------|-----------|
| `src/services/sqlite-db/sqlite-db-types.ts` | Tipos compartilhados: `SqliteDbArtistMeta`, `SqliteDbAlbumMeta`, `SqliteDbQueryCache`, `SqliteDbConfig` |
| `src/services/sqlite-db/sqlite-db-artist.ts` | Ler/escrever `.selftify.json` de artista (NAME_ARTIST) |
| `src/services/sqlite-db/sqlite-db-album.ts` | Ler/escrever `.selftify.json` de álbum (NAME_ALBUM) |
| `src/services/sqlite-db/sqlite-db-query.ts` | Ler/escrever cache de queries em `.selftify/queries/{musicbrainz,youtube}/` — cada plataforma tem seu subdiretório e TTL |
| `src/services/sqlite-db/sqlite-db-config.ts` | Ler/escrever `.selftify/config.json` |
| `src/services/sqlite-db/sqlite-db-image.ts` | Gerenciar imagens em `.selftify/images/{artist,album,query}/` — salvar, ler, deduplicar por sha256 |
| `src/services/sqlite-db/sqlite-db-resolver.ts` | Resolver `SqliteDbAlbumMeta → Album`, `SqliteDbArtistMeta → AlbumArtist`, `SqliteDbAlbumTrack → Song` (substitui `dto.ts`) |
| `src/services/sqlite-db/index.ts` | Barrel |

### Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `src/api/indexer/local-indexer.ts` | Após scan, **escrever** `.selftify.json` para cada artista/álbum encontrado. Dexie e `local-database.ts` podem ser removidos — o SQLiteDB é a única fonte. |
| `src/services/local-database.ts` | **Removido.** Dexie e suas 6 tabelas são substituídos pelos arquivos SQLiteDB. |
| `src/services/local-database-types.ts` | **Removido.** Tipos migrados para `sqlite-db-types.ts`. |
| `src/services/dto.ts` | **Removido.** Conversões `dbSongToSong()` etc. são substituídas por `sqliteDbAlbumMetaToAlbum()`, `sqliteDbArtistMetaToAlbumArtist()` em `sqlite-db-types.ts`. |
| `src/services/image-store.ts` | **Removido.** IndexedDB de imagens substituído por `.selftify/images/`. |
| `src/services/electron-image-store.ts` | **Removido.** Mesma lógica, imagem vai para filesystem. |
| `src/stores/local-library.store.ts` | **Removido.** Estado de scan lido de `.selftify/config.json`. |
| `src/stores/cover.store.ts` | **Removido.** Cache de blob URLs é efêmero e desnecessário — cada leitura de imagem lê do disco e cria ObjectURL local. |
| `src/api/local/local-controller.ts` | Lê exclusivamente do SQLiteDB. Remove fallback para Dexie. |
| `src/services/memory-cache.ts` | **Removido.** Cache em memória de search — substituído por `.selftify/queries/`. |
| `src/services/cover-resolver.ts` | **Removido.** Resolução de capa migrada para `sqlite-db-image.ts`. |
| `src/services/musicbrainz-client.ts` | **Modificado.** Search cache via `sqlite-db-query.ts` (`.selftify/queries/musicbrainz/`). Detail cache mantém `musicbrainz-disk-cache.ts`. |
| `src/services/playlist-service.ts` | Playlists continuam como `.selftifylist` — sem mudança. |

---

## Fluxo de Dados

### 1. Scan completo

```
walk filesystem
  └─ para cada dir com audio files:
       ├─ extrai metadados das tags (artist, album, track, cover)
       ├─ salva cover embedded → .selftify/images/album/<sha256>.jpg
       └─ acumula em pendingAlbums (memória)
  └─ finish():
       ├─ beginTransaction()
       ├─ albumRepo.upsertAlbum() para cada álbum (SQLite)
       ├─ artistRepo.upsertArtist() para cada artista (SQLite)
       ├─ configRepo.setConfig() para scan state (SQLite)
       └─ commitTransaction() + flushSave()
```

### 2. Enriquecimento pós-scan

```
// ── Artistas ──
para cada artista sem enrichedAt ou enrichedAt > 7 dias:
  ├─ busca biography + imagem no MusicBrainz
  ├─ sucesso?
  │   ├─ baixa imagem → .selftify/images/artist/<sha256>.jpg
  │   ├─ atualiza artist/.selftify.json (biography, generos, images[].url)
  │   └─ enrichedAt = now
  └─ falha → enrichedAt permanece null (tenta na próxima)

// ── Albuns ──
para cada album sem enrichedAt ou enrichedAt > 30 dias:
  ├─ busca cover no Cover Art Archive (via mbzReleaseGroupId)
  ├─ sucesso?
  │   ├─ baixa cover → .selftify/images/album/<sha256>.jpg
  │   ├─ atualiza album/.selftify.json (images[].url)
  │   └─ enrichedAt = now
  ├─ falha? tenta iTunes / Deezer / outro provider configurado
  └─ fallback total → enrichedAt = now (evita re-tentar sem mudanca)
```

### 3. Leitura de álbum (UI)

```
getAlbumDetail(artist, album)
  ├─ loadAllAlbumMetas() → SELECT * FROM albums (SQLite)
  │   ├─ uma linha → converte AlbumRow → SqliteDbAlbumMeta → Album domain type
  │   ├─ zero linhas → retorna null (album nao indexado)
  │   └─ erro → log warning, retorna null
  │
  └─ resolve imagens (sqlite-db-image.ts / SQLite images[]):
      ├─ images[0].url é path relativo (".selftify/" ou ".img/" ou "Artist/...")
      │   └─ lê <library_root>/<url> do filesystem → ObjectURL
      │
      ├─ images[0].url começa com "http"
      │   ├─ fetch via platformFetch
      │   ├─ salva em .selftify/images/album/<sha256>.jpg
      │   ├─ atualiza images[0].url no SQLite (images column)
      │   └─ ObjectURL
      │
      └─ images[] vazio → placeholder "no art"
```

O mesmo padrão se aplica a `getAlbumArtistDetail` — a diferença é que o download on-demand salva em `.selftify/images/artist/` em vez de `album/`.

### 3b. Listagem de músicas (UI) — SQLite-based

```
getAllSongs()
  └─ albumRepo.getAllAlbums() → SELECT * FROM albums
       └─ para cada album: getTracksByAlbum(id) → SELECT * FROM tracks WHERE album_id = ?
            └─ flatten tracks[] → SqliteDbAlbumTrack[]

getSongList(offset, limit)
  └─ mesma lógica que getAllSongs() + slice em memória

getSongsByAlbum(artist, album)
  └─ albumRepo.findAlbumByName(artist, album) → SELECT * FROM albums WHERE ...
       └─ return meta.tracks (pre-joined)
```

Nota: `tracks` são denormalizadas por album_id. Não há tabela de join separada. Cada track tem `album_id` como FK para `albums.id`.

### 3c. Config (scan state) — SQLite-based

```
getScanState()
  └─ configRepo.getConfig("scanStatus") → valor da tabela `config`
  └─ configRepo.getConfig("songCount") → valor da tabela `config`

getConfig()
  └─ configurações lidas da tabela `config` via chaves nomeadas
  └─ fallback: valores padrão se chave não existir
```

### 4. Cache de queries

```
searchOnPlatform(query, platform)
  ├─ hash = sha256(query)
  ├─ cacheDir = platform === "musicbrainz" ? "musicbrainz" : "youtube"
  ├─ cacheFile = `.selftify/queries/${cacheDir}/${hash}.json`
  ├─ imagePrefix = platform === "musicbrainz" ? "mb-" : "yt-"
  │
  ├─ existe cacheFile?
  │   ├─ SIM e dentro do TTL → retorna cache
  │   └─ NÃO ou expirado → chama API da plataforma
  │       ├─ salva resultado em cacheFile
  │       ├─ baixa cada imagem → `.selftify/images/query/${imagePrefix}${hash}-<N>.jpg`
  │       └─ imageUrl = path relativo
  └─ retorna resultado

search(query)
  ├─ resultsMB = searchOnPlatform(query, "musicbrainz")
  ├─ resultsYT = searchOnPlatform(query, "youtube")
  └─ merge & rank → retorna unificado
```

---

## Tratamento de Imagens

### Regras de armazenamento

**Toda imagem é sempre arquivo no filesystem.** Nunca há base64 inline em JSON.

| Quem | Onde | Nome do arquivo |
|------|------|-----------------|
| **Artista** (baixada/enriquecida) | `.selftify/images/artist/` | `<sha256-content>.{jpg,png,webp}` |
| **Álbum** (baixada/enriquecida) | `.selftify/images/album/` | `<sha256-content>.{jpg,png,webp}` |
| **Query MusicBrainz** | `.selftify/images/query/` | `mb-<sha256-query>-<N>.{jpg,png,webp}` |
| **Query YouTube** | `.selftify/images/query/` | `yt-<sha256-query>-<N>.{jpg,png,webp}` |
| **`.img/` legado** | Mantida in-place | `Artist/Album/.img/<arquivo>` — path relativo ao library root no `images[].url` |
| **Fallback online** | Não salva | `images[].url` = URL HTTP. Resolve sob demanda. |

O nome do arquivo é sempre o **SHA-256 do conteúdo binário** para deduplicação natural: se dois álbuns têm a mesma capa (mesmo sha256), o arquivo físico é o mesmo.

Os paths em `images[].url` seguem sempre o formato:
- Imagem em `.selftify/images/`: `".selftify/images/{artist,album,query}/<nome>"`
- Imagem em `.img/` legado: `"Artist Name/Album Name/.img/cover.jpg"` (sempre relativo ao library root)
- Imagem online não baixada: URL HTTP completa

### Resolução de imagens na UI — local-first

Toda resolução de imagem segue o princípio **local-first**: fontes locais (`.img/`, SQLiteDB) têm precedência sobre cache de resultados online, que têm precedência sobre APIs externas.

#### Resolução de imagem de artista

```
fetchArtistImage(artistName, mbzArtistId?)
  ├─ 1. .img/ folder (filesystem local do artista)
  │   └─ "ArtistName/.img/<arquivo>" → ObjectURL
  │
  ├─ 2. SQLiteDB artist images (.selftify/images/artist/)
  │   └─ artistMeta.images[0].url → lê arquivo → ObjectURL
  │
  ├─ 3. IndexedDB/Electron store (cached de resultados online anteriores)
  │   └─ findImages({ artistName }) → recordToBlobUrl
  │
  ├─ 4. Wikidata via SPARQL (por MBID)
  │   └─ fetch → salva em store → ObjectURL
  │
  ├─ 5. Providers (Deezer, iTunes)
  │   └─ searchAll → fetch → salva em store → ObjectURL
  │
  └─ 6. Wikipedia thumbnail (fallback por nome)
      └─ query.pageimages → fetch → salva em store → ObjectURL
```

Usado por: `artist-page.tsx` (via `fetchArtistImage()`), `song-info-content.tsx` (via `useArtistImage()` hook).

#### Resolução de capa de álbum

```
resolveAlbumCover(input: CoverInput)
  ├─ 1. .img/ folder (filesystem local do álbum)
  │   └─ "ArtistName/AlbumName/.img/<arquivo>" → ObjectURL
  │
  ├─ 2. SQLiteDB album images (.selftify/images/album/)
  │   └─ albumMeta.images[0].url → lê arquivo → ObjectURL
  │
  ├─ 3. IndexedDB/Electron store (apenas matches exatos de álbum)
  │   └─ findImages({ mbzArtistId, mbzReleaseGroupId }) etc. → ObjectURL
  │
  ├─ 4. Deezer (se habilitado em Settings)
  │   └─ search → cacheToStore → ObjectURL
  │
  └─ 5. iTunes (se habilitado em Settings)
      └─ search → cacheToStore → ObjectURL
```

Usado por: `album-page.tsx` (via `useCover()` hook), `artist-page.tsx` (para álbums do artista).

#### Resolução via Controller (listagens)

Quando a UI exibe listas de álbuns/artistas (home, search, library), o controller local `local-controller.ts` usa:

```
resolveImageUrl(artistName, albumName?)
  ├─ 1. SQLiteDB album image (se albumName fornecido)
  │   └─ readAlbumMeta → images[0].url → sqliteDbImageToObjectUrl
  │
  └─ 2. SQLiteDB artist image (fallback se sem álbum)
      └─ readArtistMeta → images[0].url → sqliteDbImageToObjectUrl
```

```
findArtistImage(artistName)
  └─ readArtistMeta → images[0].url → sqliteDbImageToObjectUrl
```

Estes resolvers são chamados por `populateSongImages()` e `populateArtistImages()` para preencher `imageUrl` em lote. Eles NÃO incluem fontes online — o enriquecimento é responsabilidade do pós-scan.

### Enriquecimento vs leitura on-demand

| Origem da imagem | Quando baixa | Onde salva |
|---|---|---|
| MusicBrainz (pós-scan) | Scan completo | `.selftify/images/artist/<sha256>.jpg` |
| Cover Art Archive (pós-scan) | Scan completo | `.selftify/images/album/<sha256>.jpg` |
| iTunes / Deezer / outro provider (pós-scan) | Scan completo | `.selftify/images/album/<sha256>.jpg` |
| Primeiro acesso na UI (on-demand) | Quando o usuário abre o álbum/artista | `.selftify/images/{artist,album}/<sha256>.jpg` |
| `.img/` legado | Já está no disco | Permanece in-place. Referenciado por path relativo |

O enriquecimento pós-scan tenta baixar **todas** as imagens de uma vez (lote). O on-demand baixa apenas quando o usuário acessa. Ambos salvam no mesmo local e com a mesma convenção de nomenclatura, então o on-demand pode preencher lacunas que o enriquecimento não cobriu.

---

## Testes

### Estratégia de teste

O SQLiteDB é testado em dois níveis:

| Nível | O que testa | Ferramenta |
|-------|-------------|------------|
| **Unitário** | `sqlite-db-artist.ts`, `sqlite-db-album.ts`, `sqlite-db-config.ts`, `sqlite-db-query.ts`, `sqlite-db-image.ts` com filesystem mockado | Vitest + `vi.mock` no `platform` |
| **Integração** | `local-indexer.ts` → SQLiteDB → `local-controller.ts` (ciclo completo scan + leitura) | Vitest + diretório temporário real |

### Regras

- Toda função de escrita tem um teste de "escreveu → leu de volta → igual"
- Toda função de leitura tem teste de "arquivo não existe → retorna null"
- `sqlite-db-image.ts` testa deduplicação: mesmo sha256 → mesmo arquivo
- `local-indexer.ts` testa que um diretório com 3 MP3s gera 1 `.selftify.json` de álbum e 1 de artista

---

## Edge Cases

| Caso | Comportamento |
|------|---------------|
| `.selftify.json` corrompido (JSON mal formatado) | Loga warning, ignora o arquivo, trata como inexistente. Recreate na próxima escrita. |
| Dois processos escrevendo simultaneamente | `writeFile` atômico: escreve em `.selftify.json.tmp` → rename. Leitura vê arquivo completo ou não vê. |
| Pasta de artista renomeada no filesystem | Detectado no scan incremental. O `.selftify.json` dentro dela carrega o nome real. |
| Música movida entre pastas | Scan detecta path novo + path ausente. Remove track do álbum antigo, adiciona no novo. |
| `.selftify.json` sem `enrichedAt` | Assume que precisa enriquecimento. Tenta na próxima janela de idle. |
| Query cache expirado | Reexecuta busca apenas na plataforma expirada. MusicBrainz pode estar em cache enquanto YouTube expira. |
| Query cache offline | Se a API da plataforma falha (sem rede), usa cache expirado com warning. Cada plataforma independente. |
| Mesma query em MusicBrainz e YouTube | Cada plataforma tem seu próprio arquivo no mesmo hash, em diretórios diferentes. Não há conflito. |
| Library root em rede (NFS/SMB) | Operações de escrita são lentas mas seguras. Sem locks distribuídos. |
| `.img/` legado + `.selftify/images/` convivência | Precedência na UI: `.img/` > `.selftify/images/` > store cache > URL online. No SQLiteDB, a prioridade se reflete em `images[].url` que sempre aponta para o local mais prioritário disponível. Path do `.img/` é relativo ao library root: `"Artist/Album/.img/cover.jpg"`. |
| Imagem HTTP baixada on-demand durante leitura | Salva em `.selftify/images/{artist,album}/<sha256>.jpg` e atualiza o `images[].url` no `.selftify.json`. A próxima leitura lê direto do filesystem. |
| Dois álbuns com mesma capa (mesmo sha256) | Apenas um arquivo em `.selftify/images/album/<sha256>.jpg`. Ambos os `.selftify.json` apontam para o mesmo path. |
| Enriquecimento baixa imagem, mas on-demand já tinha baixado | SHA256 resolve duplicata — `sqlite-db-image.ts` sobrescreve com o mesmo conteúdo. Sem efeito colateral. |
| Biblioteca copiada para outro sistema | Todos os paths são relativos. O app só precisa receber o novo `library_root`. Nenhum arquivo interno contém `/home/` ou `C:\`. |
| Playlist `.selftifylist` com paths antigos | Playlists armazenam MBIDs, não paths. São portáveis por definição. |

---

## Tipos (esboço `sqlite-db-types.ts`)

```typescript
// ── Schema identifiers ──

type SqliteDbSchemaVersion = 1;

// ── Artist Metadata (NAME_ARTIST) ──

interface SqliteDbImage {
  id: string;
  url: string | null;          // path relativo ao library root ou URL HTTP
  width: number | null;
  height: number | null;
  format: "image/jpeg" | "image/png" | "image/webp";
}

interface SqliteDbArtistMeta {
  $schema: "selftify-artist";
  version: SqliteDbSchemaVersion;
  name: string;
  sortName: string | null;
  mbzId: string | null;
  biography: string | null;
  genres: string[];
  country: string | null;
  type: string | null;
  disambiguation: string | null;
  images: SqliteDbImage[];
  updatedAt: number;           // última modificação local
  enrichedAt: number | null;   // última vez que dados online foram buscados
}

// ── Album Metadata (NAME_ALBUM) ──

interface SqliteDbAlbumTrack {
  path: string;                // relativo ao dir do álbum
  name: string;
  artistName: string;
  albumName: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  duration: number | null;     // ms
  genre: string | null;
  mbzRecordingId: string | null;
  mbzTrackId: string | null;
  youtubeCandidates?: YouTubeCandidate[];
}

interface YouTubeCandidate {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;            // ms
  thumbnailUrl: string | null;
  score: number;               // 0-1
  titleMatch: boolean;
  artistMatch: boolean;
  albumMatch: boolean;
  artistOnChannel: boolean;
  exactDuration: boolean;
  closestDuration: boolean;
  keywordScore: number;
  source: "ranking" | "custom";
  selected: boolean;
  selectedAt: number | null;
}

interface SqliteDbAlbumMeta {
  $schema: "selftify-album";
  version: SqliteDbSchemaVersion;
  name: string;
  artistName: string;
  albumArtist: string | null;
  releaseYear: number | null;
  mbzId: string | null;
  mbzReleaseGroupId: string | null;
  genres: string[];
  images: SqliteDbImage[];
  songCount: number;
  duration: number;            // ms, soma dos tracks
  tracks: SqliteDbAlbumTrack[];
  updatedAt: number;
  enrichedAt: number | null;
}

// ── Query Cache ──

interface SqliteDbSearchResultItem {
  id: string;
  name: string;
  artistName: string;
  albumName: string | null;
  imageUrl: string | null;     // path relativo ou URL HTTP
}

interface SqliteDbQueryCache {
  query: string;
  queryHash: string;           // sha256(query) — mesma hash em ambas plataformas
  platform: "musicbrainz" | "youtube";
  originId: string;
  timestamp: number;
  ttl: number;                 // ms
  results: {
    songs: SqliteDbSearchResultItem[];
    albums: SqliteDbSearchResultItem[];
    albumArtists: SqliteDbSearchResultItem[];
  };
  raw?: Record<string, unknown>;  // Dado bruto da API, usado por musicbrainz-client.ts para search cache
}

// ── Root Config ──

interface SqliteDbConfig {
  version: SqliteDbSchemaVersion;
  libraryName: string;
  createdAt: number;
  lastScanAt: number | null;
  scanStatus: "idle" | "scanning" | "done" | "error";
  songCount: number;
  artistCount: number;
  albumCount: number;
}
```

---

## Nomeclatura dos Arquivos

| Constante | Valor | Uso |
|-----------|-------|-----|
| `NAME_ARTIST` | `".selftify.json"` | Na raiz de cada pasta de artista |
| `NAME_ALBUM` | `".selftify.json"` | Dentro de cada pasta de álbum/EP/single |
| `NAME_ROOT` | `"config.json"` | Dentro de `.selftify/` |
| `DIR_SELFTIFY` | `".selftify"` | Pasta oculta na raiz da biblioteca |
| `DIR_QUERIES` | `"queries"` | Subpasta de `DIR_SELFTIFY` |
| `DIR_QUERIES_MB` | `"queries/musicbrainz"` | Cache de queries do MusicBrainz |
| `DIR_QUERIES_YT` | `"queries/youtube"` | Cache de queries do YouTube |
| `DIR_IMAGES` | `"images"` | Subpasta de `DIR_SELFTIFY` |
| `DIR_IMAGES_ARTIST` | `"images/artist"` | Imagens de artista |
| `DIR_IMAGES_ALBUM` | `"images/album"` | Imagens de álbum |
| `DIR_IMAGES_QUERY` | `"images/query"` | Imagens de query (ambas plataformas) |

**Por que o mesmo nome `.selftify.json` para artista e álbum?**
- Um diretório ou é de artista (tem subdiretórios de álbuns) ou é de álbum (tem arquivos de áudio).
- A diferenciação é feita pelo campo `$schema`: `"selftify-artist"` vs `"selftify-album"`.
- Isso simplifica a detecção: ao entrar num diretório, lê `.selftify.json` e verifica `$schema`.

---

## Checklist de Implementação

O SQLiteDB substitui toda a camada de armazenamento anterior. Abaixo, a sequência de implementação:

### 1. Criar `src/services/sqlite-db/` (8 arquivos)

| Ordem | Arquivo | Depende de |
|-------|---------|------------|
| 1 | `sqlite-db-types.ts` | Nenhum |
| 2 | `sqlite-db-config.ts` | `sqlite-db-types`, `platform` |
| 3 | `sqlite-db-image.ts` | `sqlite-db-types`, `platform` |
| 4 | `sqlite-db-artist.ts` | `sqlite-db-types`, `sqlite-db-image`, `platform` |
| 5 | `sqlite-db-album.ts` | `sqlite-db-types`, `sqlite-db-image`, `platform` |
| 6 | `sqlite-db-query.ts` | `sqlite-db-types`, `sqlite-db-image`, `platform` |
| 7 | `sqlite-db-resolver.ts` | `sqlite-db-types`, `domain-types` |
| 8 | `index.ts` | Todos acima |

### 2. Remover arquivos obsoletos (8 de 11 arquivos)

| Arquivo | Status | Substituído por |
|---------|--------|----------------|
| `src/services/local-database.ts` | ✅ Removido | SQLiteDB + `sqlite-db-config.ts` |
| `src/services/local-database-types.ts` | ✅ Removido | `sqlite-db-types.ts` |
| `src/services/dto.ts` | ✅ Removido | `sqlite-db-resolver.ts` (inline mapping em alguns consumers) |
| `src/services/image-store.ts` | ❌ **Mantido** | `sqlite-db-image.ts` — ainda tem 11 consumidores ativos (fase 2) |
| `src/services/electron-image-store.ts` | ❌ **Mantido** | `sqlite-db-image.ts` — ainda tem 10 consumidores ativos (fase 2) |
| `src/services/memory-cache.ts` | ✅ Removido | `sqlite-db-query.ts` |
| `src/services/cover-resolver.ts` | ❌ **Mantido** | `sqlite-db-image.ts` + `sqlite-db-resolver.ts` — 1 consumidor ativo (fase 2) |
| `src/services/musicbrainz-cache.ts` | ✅ Removido | `sqlite-db-query.ts` |
| `src/stores/local-library.store.ts` | ✅ Removido | `sqlite-db-config.ts` |
| `src/stores/cover.store.ts` | ✅ Removido | `sqlite-db-image.ts` (leitura direta) |
| `src/stores/ranking-debug.store.ts` | ✅ Removido | Eliminado (sem substituto) |

### 3. Modificar arquivos existentes (9 arquivos)

| Arquivo | Status | Mudança |
|---------|--------|---------|
| `src/api/indexer/local-indexer.ts` | ✅ | Escreve `.selftify.json` no scan. Usa `sqlite-db-album`, `sqlite-db-artist`, `sqlite-db-image`. |
| `src/api/local/local-controller.ts` | ✅ | Lê do SQLiteDB exclusivamente. Usa `sqlite-db-resolver`. |
| `src/services/musicbrainz-client.ts` | ✅ | Search cache via `sqlite-db-query.ts` (`.selftify/queries/musicbrainz/`). Detail cache mantém `musicbrainz-disk-cache.ts`. |
| `src/hooks/use-local-scan.ts` | ✅ | Usa `sqlite-db-config` para estado de scan. |
| `src/hooks/auto-scan-logic.ts` | ✅ | Sem refs a `local-database` (abstraído via parâmetro). |
| `src/stores/index.ts` | ✅ | Sem exports de stores deletadas. |
| `src/lib/status-labels.ts` | ✅ | Sem refs a `LocalScanStatus`. |
| `src/main.tsx` | ✅ | Sem import de `image-store`. |
| `src/tests/setup.ts` | ✅ | Sem Dexie mock. |

### 4. Atualizar imports em todos os arquivos consumidores

| Import antigo | Novo import | Status |
|---------------|-------------|--------|
| `local-database` → `getAllSongs`, `searchSongs`, etc. | `local-queries.ts` + `sqlite-db-resolver.ts` | ✅ |
| `dto` → `dbSongToSong`, `dbRowToAlbum`, etc. | `sqlite-db-resolver` → `sqliteDbTrackToSong`, etc. | ✅ |
| `image-store` → `findImages`, etc. | `sqlite-db-image` → `resolveSqliteDbImageObjectUrl`, etc. | ❌ Fase 2 |
| `cover.store` → `useCoverStore` | Removido | ✅ |
| `local-library.store` → `useLocalLibraryStore` | Removido | ✅ |
| `ranking-debug.store` → `useRankingDebugStore` | Removido | ✅ |
| `memory-cache` → `getCachedResult`, etc. | `sqlite-db-query` → `getCachedQuery`, etc. | ✅ |

### 5. SQLite Migration (Phase 8)

#### 8.1 — Infrastructure
- [x] `sql.js` installed + WASM config in `public/sql-wasm.wasm`
- [x] `src/services/db/database.ts` — sql.js singleton with save debounce, corruption recovery
- [x] `src/services/db/schema.ts` — 9 tables (artists, albums, tracks, mappings, ranking_log, search_cache, query_cache, config, _meta)
- [x] 8 repositories: config-repo, artist-repo, album-repo, track-repo, mapping-repo, ranking-repo, search-cache-repo, query-cache-repo

#### 8.2 — Writer (indexer)
- [x] `local-indexer.ts`: `finish()` writes albums/artists/config to SQLite (not JSON files)
- [x] Removed `enrichArtistsFromMusicBrainz()` from scan pipeline (scan is 100% local)
- [x] Removed legacy `dirExists` check (wrong path, not needed for SQLite)

#### 8.3 — Readers (controller, queries)
- [x] `local-controller.ts`: `loadAllAlbumMetas()` queries SQLite instead of directory scan
- [x] `local-queries.ts`: all functions use SQLite repos (getAllSongs, getScanState, etc.)
- [x] `cover-resolver.ts` reads album metadata from SQLite
- [x] `artist-image.ts` / `use-artist-image.ts` read artist metadata from SQLite

#### 8.4 — Cache & persistence (SQLiteDB → SQLite delegation)
- [x] `sqlite-db-mappings.ts` → delegates to SQLite `mapping-repo`
- [x] `sqlite-db-ranking-log.ts` → delegates to SQLite `ranking-repo`
- [x] `sqlite-db-search-store.ts` → delegates to SQLite `search-cache-repo` (localStorage fallback retained)
- [x] `sqlite-db-query.ts` → delegates to SQLite `query-cache-repo`

#### 8.5 — Final checks
- [x] `npx tsc --noEmit` (typecheck clean)
- [x] `npx vite build` (build clean)
- [x] Local page uses `initialLoadDoneRef` to prevent mount-time flicker
