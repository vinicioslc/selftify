---
title: Migration to Client-Server Architecture
version: 2.0
date_created: 2026-07-05
owner: Engineering
tags: architecture, migration, rest-api, subsonic, docker
---

# Migration to Client-Server Architecture

## 1. Purpose & Scope
Migrar Selftify de uma arquitetura **Client-Heavy** (React + Electron com toda lógica no frontend/IPC) para uma arquitetura **Client-Server** (backend Node.js/Express + frontend React thin client), com deploy unificado via Docker e compatibilidade com a API **Subsonic/OpenSubsonic**.

**Público-alvo**: Engenharia (backend, frontend, DevOps).
**Escopo**: Todo o código atualmente em `src/services/`, `src/api/`, `electron/main.ts` (handlers IPC) e `src/stores/` que será migrado ou refatorado.

---

## 2. Definições

| Termo | Definição |
| :--- | :--- |
| **Client-Heavy** | Arquitetura atual onde o frontend React executa toda a lógica de negócio via IPC com Electron |
| **ServerController** | Interface TypeScript em `src/api/controller.ts` que TODO controller (YouTube, Local) implementa |
| **Subsonic API** | API REST aberta usada por servidores de música (Navidrome, Airsonic). Documentada em `opensubsonic.netlify.app` |
| **yt-dlp** | CLI para extrair URLs de stream e metadados do YouTube |
| **music-metadata** | Lib Node.js para ler metadados de arquivos de áudio |
| **IPC** | Inter-Process Communication (Electron main ↔ renderer via `ipcMain`/`ipcRenderer`) |
| **InnerTube** | API interna do YouTube usada pelo `youtubei.js` |

---

## 3. Arquitetura por Módulo

Cada módulo abaixo descreve:
- O que **sai do frontend** (é removido/cortado)
- O que **entra no backend** (novo serviço/rota)
- O **contrato de API** (endpoint REST)
- Como o **frontend se conecta** (RemoteController, store modificada, componente)

---

### 3.1 Módulo: YouTube (Search + Stream + Download)

#### O que sai do frontend
| Arquivo | Destino |
| :--- | :--- |
| `src/services/youtube-download-service.ts` | **Removido** (lógica vai pro backend) |
| `src/services/youtube-ranking.ts` | **Move** → `server/src/services/youtube/ranking.ts` |
| `src/services/youtube-pure-search.ts` | **Move** → `server/src/services/youtube/pure-search.ts` |
| `src/api/youtube/youtube-controller.ts` | **Removido** (era stub vazio) |
| `electron/main.ts` handlers `yt:search`, `yt:stream-url`, `yt:download`, `yt:download-mp3`, `yt:process-cover`, `yt:embed-artwork`, `yt:get-video-info`, `yt:check-version`, `yt:update` | **Removido** do Electron |
| `electron/preload.ts` seção `yt:` | **Removido** do preload |

#### O que entra no backend
| Módulo Backend | Arquivo |
| :--- | :--- |
| Serviço yt-dlp | `server/src/services/youtube/yt-dlp.ts` (wrapper para CLI yt-dlp) |
| Motor de ranking | `server/src/services/youtube/ranking.ts` |
| Cache de resultados | `server/src/services/youtube/cache.ts` (in-memory TTL) |
| Fila de tasks (TaskQueue) | `server/src/lib/task-queue.ts` (copiado de `electron/queue.ts`) |

#### Endpoints REST

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/youtube/search` | Busca vídeos no YouTube | `?q=artist+song&limit=20` | `YtDlpSearchItem[]` |
| `GET` | `/api/youtube/stream-url` | Extrai URL de stream | `?videoId=abc123` | `{ url: string }` |
| `GET` | `/api/youtube/video-info` | Metadados do vídeo | `?videoId=abc123` | `VideoInfo` |
| `POST` | `/api/youtube/download` | Enfileira download | body: `DownloadRequest` | `{ taskId }` |
| `POST` | `/api/youtube/download-mp3` | Download MP3 completo | body: `DownloadMp3Request` | `{ path }` |
| `POST` | `/api/youtube/process-cover` | Processa cover art | body: `ProcessCoverRequest` | `{ path }` ou `null` |
| `POST` | `/api/youtube/embed-artwork` | Embeda artwork no áudio | body: `EmbedArtworkRequest` | `void` |
| `GET` | `/api/youtube/check-version` | Versão do yt-dlp | — | `{ found, version }` |
| `POST` | `/api/youtube/update` | Atualiza yt-dlp | — | `{ success, message }` |

#### Conexão Frontend

```
Frontend (RemoteController)           Backend (Express)
        │                                   │
        │  fetch('/api/youtube/search?q=…') │
        │──────────────────────────────────►│
        │                                   │──► yt-dlp search
        │  YtDlpSearchItem[]                │◄──
        │◄──────────────────────────────────│
        │                                   │
        │  fetch('/api/youtube/stream-url?  │
        │        videoId=abc123')           │
        │──────────────────────────────────►│
        │                                   │──► yt-dlp stream-url
        │  { url: "https://googlevideo…" }  │◄──
        │◄──────────────────────────────────│
```

**Arquivos frontend afetados:**
- `src/services/youtube-download-service.ts` → **removido**. Toda chamada a `window.electronApi.yt.search()` vira `fetch('/api/youtube/search')`.
- `src/api/remote-controller.ts` (novo) implementa `ServerController.search()` chamando o backend.
- `src/stores/player.store.ts`: `setQueue()` e `play()` continuam iguais, mas o resolvedor de stream chama o backend agora.

---

### 3.2 Módulo: Search (MusicBrainz + YouTube integrado)

#### O que sai do frontend
| Arquivo | Destino |
| :--- | :--- |
| `src/services/search-service.ts` | **Move** → `server/src/services/search/index.ts` |
| `src/services/musicbrainz-api.ts` | **Move** → `server/src/services/musicbrainz/api.ts` |
| `src/services/musicbrainz-client.ts` | **Move** → `server/src/services/musicbrainz/client.ts` |
| `src/services/musicbrainz-oauth.ts` | **Move** → `server/src/services/musicbrainz/oauth.ts` |
| `src/services/musicbrainz-types.ts` | **Move** → `server/src/services/musicbrainz/types.ts` |
| `electron/main.ts` handlers `mbz:fetch`, `wiki:search` | **Removido** do Electron |

#### Endpoints REST

**Busca local (biblioteca indexada)**: Usar Subsonic `/rest/search3?query=...&songCount=20&albumCount=20&artistCount=20`. Endpoint único e compatível com qualquer cliente Subsonic.

**Busca online (MusicBrainz + YouTube)**: Subsonic `search3` só busca na biblioteca **local**. Para busca online de streams:

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/search/online` | Busca online (MusicBrainz + YouTube) | `?q=query&limit=50` | `{ songs, albums, albumArtists }` |

#### Conexão Frontend

```
src/features/search/search-page.tsx
  ├── Aba "Biblioteca" → SubsonicController.search3() → /rest/search3
  └── Aba "Online"     → SelftifyController.searchOnline() → /api/search/online
```

**Arquivos frontend afetados:**
- `src/services/search-service.ts` → **removido**.
- `src/features/search/search-page.tsx` → **modificado**: usa Subsonic para busca local, `/api/search/online` para YouTube/MusicBrainz. Cover art removida do frontend (server resolve).

---

### 3.3 Módulo: Artwork (Cover Art + Artist Images + Artist Providers)

#### O que sai do frontend

| Arquivo | Destino |
| :--- | :--- |
| `src/services/image-fetch.ts` | **Move** → `server/src/services/artwork/image-fetch.ts` |
| `src/services/artist-image.ts` | **Move** → `server/src/services/artwork/artist-image.ts` |
| `src/services/artist-image/providers/artist-resolver.ts` | **Move** → `server/src/services/artwork/providers/artist-resolver.ts` |
| `src/services/artist-image/providers/types.ts` | **Move** → `server/src/services/artwork/providers/types.ts` |
| `src/services/artist-image/providers/deezer.provider.ts` | **Move** → `server/src/services/artwork/providers/deezer.provider.ts` |
| `src/services/artist-image/providers/itunes.provider.ts` | **Move** → `server/src/services/artwork/providers/itunes.provider.ts` |
| `src/services/wiki-image-search.ts` | **Move** → `server/src/services/artwork/wiki-image-search.ts` |
| `src/services/wikidata-image.ts` | **Move** → `server/src/services/artwork/wikidata-image.ts` |
| `src/services/cover-resolver.ts` | **Move** → `server/src/services/artwork/resolver.ts` |
| `src/services/cover-event-bus.ts` | **Move** → `server/src/services/artwork/event-bus.ts` |
| `src/services/invalidate-caches.ts` | **Move** → `server/src/services/artwork/invalidate-caches.ts` |
| `src/services/artwork/artwork-resolver.ts` | **Move** → `server/src/services/artwork/resolver.ts` |
| `src/services/artwork/artwork-queue.ts` | **Move** → `server/src/services/artwork/queue.ts` |
| `src/services/artwork/resolve-cover.ts` | **Move** → `server/src/services/artwork/resolve-cover.ts` |
| `src/services/artwork/providers/*` | **Move** → `server/src/services/artwork/providers/` |
| `src/services/dot-img.ts` | **Move** → `server/src/services/artwork/dot-img.ts` |
| `src/services/dot-img-loader.ts` | **Move** → `server/src/services/artwork/dot-img-loader.ts` |
| `src/services/image-store.ts` | **Move** → `server/src/services/artwork/image-store.ts` |
| `src/services/image-preloader.ts` | **Move** → `server/src/services/artwork/image-preloader.ts` |
| `electron/main.ts` handlers `image:fetch`, `artwork:search` | **Removido** do Electron |

#### Endpoints REST

**Cover de álbum/música**: Usar Subsonic `/rest/getCoverArt?id=<id>` — é o padrão e funciona com qualquer cliente Subsonic. O backend implementa `getCoverArt` chamando o mesmo `resolveAlbumCover()`.

**Imagem de artista**: Subsonic **não tem** endpoint dedicado. Endpoint customizado:

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/artwork/artist` | Imagem do artista | `?name=Nirvana&mbzId=abc` | `{ url }` ou `null` |
| `POST` | `/api/artwork/search` | Busca em provedores | `{ provider, artist, album }` | `ArtworkResult[]` |
| `POST` | `/api/local/embed-artwork` | Embede cover no arquivo | `{ audioPath, coverPath }` | `void` |
| `POST` | `/api/local/replace-cover` | Substitui cover (ffmpeg) | `{ audioPath, coverPath }` | `boolean` |

> **Importante**: `/rest/getCoverArt` e `/api/artwork/artist` compartilham a mesma engine de resolução (`resolveCover()`). Não há duplicação de implementação.

#### Conexão Frontend

```
src/features/shared/song-cover-image.tsx
        │
        ▼
  Antes: resolveImageUrl() local (SQLite)
  Depois: SubsonicController.getCoverArt(id) → /rest/getCoverArt?id=<id>
        │
        ▼
  Caso artista: SelftifyController.getArtistImage() → /api/artwork/artist?name=...
```
A engine de artwork (providers, cache, `.img` dirs) roda **no backend**, nunca no frontend.

---

### 3.5 Módulo: Lyrics

#### O que sai do frontend
| Arquivo | Destino |
| :--- | :--- |
| `src/services/lyrics/lyrics-service.ts` | **Move** → `server/src/services/lyrics/service.ts` |
| `src/services/lyrics/lyrics-ranking.ts` | **Move** → `server/src/services/lyrics/ranking.ts` |
| `src/services/lyrics/lrc-parser.ts` | **Move** → `server/src/services/lyrics/lrc-parser.ts` |
| `src/services/lyrics/providers/*` | **Move** → `server/src/services/lyrics/providers/` |
| `electron/main.ts` handlers `lyric:by-song`, `lyric:search`, `lyric:by-remote-id` | **Removido** do Electron |
| `electron/preload.ts` seção `lyrics:` | **Removido** do preload |

#### Endpoints REST

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/lyrics/by-song` | Letra de uma música | body: `Song` (JSON) | `LyricsResult` |
| `GET` | `/api/lyrics/search` | Busca letras | body: `{ artist, title }` | `LyricsResult[]` |
| `GET` | `/api/lyrics/by-remote-id` | Letra por ID remoto | body: `{ provider, id }` | `LyricsResult` |

#### Conexão Frontend

```
src/features/lyrics/lyrics-panel.tsx   (unchanged layout)
        │
        ▼
  Antes: window.electronApi.lyrics.getRemoteLyricsBySong()
  Depois: fetch('/api/lyrics/by-song', { method: 'GET', body: JSON.stringify(song) })
```

O frontend mantém as telas de letras sincronizadas/ não sincronizadas intactas. Apenas a camada de fetching muda.

---

### 3.6 Módulo: Download Queue

#### O que sai do frontend
| Arquivo | Destino |
| :--- | :--- |
| `src/services/download-queue.ts` | **Move** → `server/src/services/download/queue.ts` |
| `src/services/download-platform.ts` | **Move** → `server/src/services/download/platform.ts` |
| `electron/main.ts` handlers `download:*` | **Removido** do Electron |
| `electron/download-db.ts` | **Move** → `server/src/services/download/db.ts` |
| `electron/download-queue-service.ts` | **Move** → `server/src/services/download/queue-service.ts` |

#### Endpoints REST

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/download/enqueue` | Enfileira download | body: `Song` | `{ taskId }` |
| `POST` | `/api/download/enqueue-multiple` | Múltiplos downloads | body: `Song[]` | `{ taskIds[] }` |
| `GET` | `/api/download/list` | Lista tasks | — | `DownloadTask[]` |
| `POST` | `/api/download/cancel/:taskId` | Cancela task | — | `void` |
| `POST` | `/api/download/retry/:taskId` | Retenta task | — | `void` |
| `DELETE` | `/api/download/clear-completed` | Limpa concluídas | — | `void` |
| `WebSocket` | `/ws/download/progress` | Progresso em tempo real | — | Eventos de progresso |

#### Conexão Frontend

```
src/features/download/download-button.tsx
src/features/download/download-queue-panel.tsx
        │
        ▼
  Antes: window.electronApi.download.enqueueSong()
  Depois: fetch('/api/download/enqueue', { method: 'POST', body: JSON.stringify(song) })

Progresso via WebSocket em vez de IPC `download:progress`.
```

---

### 3.7 Módulo: Stream Resolution (Playback)

#### O que sai do frontend
| Arquivo | Destino |
| :--- | :--- |
| `src/services/stream-resolver.ts` | **Move** → `server/src/services/stream/resolver.ts` |
| `src/services/stream-buffer.ts` | **Move** → `server/src/services/stream/buffer.ts` |

#### Endpoints REST

**Stream de arquivo local**: Usar Subsonic `/rest/stream?id=<songId>`. Qualquer cliente Subsonic entende.

**Resolução para YouTube (local → stream URL)**: Quando o backend precisa buscar no YouTube para encontrar um stream, usa-se o endpoint customizado:

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/stream/resolve-batch` | Resolve múltiplas músicas (play all) | body: `Song[]` | `ResolveResult[]` |

> O caso de música única usa a mesma lógica internamente, mas via `SubsonicController.getStreamUrl()` que resolve 1 item.

#### Conexão Frontend

```
src/features/player/web-audio-provider.tsx
        │
        ▼
  Se local:  SubsonicController.getStreamUrl(id) → /rest/stream?id=<id>
  Se online: SelftifyController.resolveStream(song) → chama lógica yt-dlp internamente no server
        │
        ▼
Resultado: song.path = streamURL (googlevideo ou file://)
```

O fluxo de "dual audio" (stream vs local) **permanece no frontend**. A resolução de URL (local→Subsonic, YouTube→lógica yt-dlp) acontece no backend.

---

### 3.8 Módulo: Auth & Origins

#### O que sai do frontend
| Arquivo | Destino |
| :--- | :--- |
| `src/stores/auth.store.ts` | **Modificado** → não persiste mais credenciais. Só cacheia `currentOrigin.id` |
| `src/services/musicbrainz-oauth.ts` | **Move** → `server/src/services/musicbrainz/oauth.ts` |
| `electron/main.ts` handler `oauth:musicbrainz:authorize` | **Removido** do Electron |
| `electron/preload.ts` seção `musicbrainzOAuth:` | **Removido** do preload |

#### Endpoints REST

**Login**: Usar auth Subsonic (`/rest/ping` com `?u=&t=&s=`). **Não** criar endpoint `/api/auth/login` — o frontend Se lftify usa auth Subsonic como qualquer outro cliente.

**Gerenciamento de Origins** (multi-biblioteca, específico Selftify):

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/origins` | Lista origins configuradas | — | `Origin[]` |
| `POST` | `/api/origins` | Adiciona origin | body: `Origin` | `Origin` |
| `PUT` | `/api/origins/:id` | Atualiza origin | body: `Partial<Origin>` | `Origin` |
| `DELETE` | `/api/origins/:id` | Remove origin | — | `void` |
| `POST` | `/api/origins/:id/set-current` | Define origin ativo | — | `void` |

#### Subsonic API Compatibility (Navidrome-compatible)

O backend deve implementar os endpoints **Subsonic/OpenSubsonic** para compatibilidade com players terceiros (DSub, Ultrasonic, Symfonium, Navidrome Web, etc.).

**Versão alvo**: OpenSubsonic 1.16.1 (ou mais recente).
**Formato**: Suportar `?f=json` e `?f=xml`. Default JSON.

##### 3.8.1 Auth Subsonic (padronizado)

Todos os endpoints `/rest/*` usam autenticação Subsonic:

```
GET /rest/ping.view?u=username&t=md5hex(password+salt)&s=salt&v=1.16.1&c=selftify
```

| Parâmetro | Descrição |
| :--- | :--- |
| `u` | Username |
| `t` | Token = `md5(password + salt)` em hex lowercase |
| `s` | Salt aleatório (string) |
| `v` | Versão da API (ex: `1.16.1`) |
| `c` | Nome do cliente (ex: `selftify`) |
| `f` | Formato: `json` ou `xml` |

**Recomendado também suportar**: `?p=md5hex(password)` (legacy) ou JWT Bearer para o frontend Selftify.

##### 3.8.2 Endpoints Subsonic OBRIGATÓRIOS (MVP)

| Método | Endpoint | Descrição | Mapeia para backend |
| :--- | :--- | :--- | :--- |
| `GET` | `/rest/ping` | Health check | `health.ts` |
| `GET` | `/rest/getMusicFolders` | Bibliotecas (origins) | `auth/origins` |
| `GET` | `/rest/getIndexes` | Artistas indexados | `local/artists` |
| `GET` | `/rest/getArtists` | Todos artistas | `local/artists` |
| `GET` | `/rest/getArtist` | Detalhe do artista | `local/artists/:id` |
| `GET` | `/rest/getAlbum` | Detalhe do álbum | `local/albums/:id` |
| `GET` | `/rest/getSong` | Detalhe da música | `local/songs/:id` |
| `GET` | `/rest/getAlbumList2` | Lista álbuns (filtros) | `local/albums` |
| `GET` | `/rest/getMusicDirectory` | Conteúdo de pasta/artista | `local/artists/:id/songs` |
| `GET` | `/rest/getRandomSongs` | Músicas aleatórias | `local/songs?random=1` |
| `GET` | `/rest/search3` | Busca na biblioteca local | `search?scope=library` |
| `GET` | `/rest/getCoverArt` | Capa de álbum/artista | `artwork` (mesma lógica de `/api/artwork/*`) |
| `GET` | `/rest/stream` | Stream de áudio | `stream/resolve` (redirect) |
| `GET` | `/rest/getPlaylists` | Lista playlists | `local/playlists` |
| `GET` | `/rest/getPlaylist` | Detalhe da playlist | `local/playlists/:id` |
| `GET` | `/rest/getLyrics` | Letras (texto puro) | `lyrics/by-song` (modo simples) |
| `GET` | `/rest/scrobble` | Registro de playback | `player/store` update |

##### 3.8.3 Endpoints Subsonic OPCIONAIS (fase 2+)

| Método | Endpoint | Descrição |
| :--- | :--- | :--- |
| `GET` | `/rest/getArtistInfo2` | Bio + imagens do artista (Wikipedia) |
| `GET` | `/rest/getAlbumInfo` | Info do álbum (MusicBrainz) |
| `GET` | `/rest/getTopSongs` | Top músicas do artista |
| `GET` | `/rest/getSimilarSongs2` | Músicas similares |
| `GET` | `/rest/getGenres` | Lista de gêneros |
| `GET` | `/rest/getSongsByGenre` | Músicas por gênero |
| `GET` | `/rest/getStarred2` | Favoritos |
| `POST` | `/rest/star` / `/rest/unstar` | Marcar favorito |
| `POST` | `/rest/setRating` | Avaliar |
| `GET` | `/rest/getBookmarks` | Bookmarks de playback |
| `POST` | `/rest/createBookmark` | Criar bookmark |
| `POST` | `/rest/deleteBookmark` | Remover bookmark |
| `POST` | `/rest/createPlaylist` | Criar playlist |
| `POST` | `/rest/updatePlaylist` | Atualizar playlist |
| `POST` | `/rest/deletePlaylist` | Deletar playlist |
| `GET` | `/rest/getAvatar` | Avatar do usuário |
| `GET` | `/rest/getNowPlaying` | O que está tocando (multi-client) |
| `GET` | `/rest/getInternetRadioStations` | Estações de rádio (usar p/ canais YouTube) |
| `POST` | `/rest/createInternetRadioStation` | Adicionar "rádio" (canal YouTube) |
| `GET` | `/rest/getChatMessages` | Chat (multi-usuário) |
| `POST` | `/rest/addChatMessage` | Enviar mensagem |

##### 3.8.4 Resposta de erro Subsonic

Todos os endpoints retornam erro no formato:

```json
{
  "subsonic-response": {
    "status": "failed",
    "version": "1.16.1",
    "error": { "code": 40, "message": "Wrong username or password" }
  }
}
```

**Códigos de erro**: 0=OK, 10=Required parameter missing, 20=Client too old, 30=User not authorized, 40=Wrong credentials, 50=Token expired, 60=Trial expired, 70=Data not found, 80=Contact support.

#### Conexão Frontend

```
src/stores/auth.store.ts
        │
        ▼
  Antes: persist(origins, currentOrigin) no localStorage
  Depois: fetch('/api/auth/origins') no startup; fetch('/api/auth/login') no login
          localStorage guarda apenas o token JWT

src/features/auth/auth-page.tsx
src/features/settings/origin-edit-dialog.tsx
  → chamam as novas funções da store modificada
```

---

### 3.9 Módulo: Settings

#### O que sai do frontend
| Arquivo | Destino |
| :--- | :--- |
| `src/stores/settings.store.ts` | **Modificado** → mantém cache local, mas sync com backend |

#### Endpoints REST

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/settings` | Busca configurações | — | `SettingsState` |
| `PUT` | `/api/settings` | Atualiza configurações | body: `Partial<SettingsState>` | `SettingsState` |

#### Conexão Frontend

```
src/stores/settings.store.ts
        │
        ▼
  Antes: persist para localStorage apenas
  Depois: GET /api/settings no startup → cache local
          PUT /api/settings em cada mudança
```

---

### 3.10 Módulo: Platform (Electron thin client)

#### O que permanece no Electron

O Electron **não é removido**. Ele se torna um **thin client** que:
1. Abre a janela apontando para o backend (`http://localhost:3001` ou servidor remoto)
2. Mantém atalhos de mídia (MediaPlayPause, etc.)
3. Mantém botões da thumbar (Windows)
4. Mantém controle de janela (minimize, maximize, close)
5. **Remove** toda lógica de negócio (yt-dlp, musicbrainz, artwork, lyrics, download)

#### Arquivos Electron modificados

| Arquivo | Mudança |
| :--- | :--- |
| `electron/main.ts` | Remove todos handlers IPC exceto `dialog:*`, `window:*`, `media:*`, `fs:*` (para playback local) |
| `electron/preload.ts` | Remove `yt:`, `mbz:`, `artwork:`, `wiki:`, `lyrics:`, `download:`, `platformFetch`, `musicbrainzOAuth` |
| `src/services/platform/electron.ts` | Remove métodos não relacionados a file system ou janela |
| `src/services/platform/types.ts` | Simplifica interface |

#### Fallback Multi-Backend

O frontend Electron deve suportar múltiplos endereços de backend para fallback:

```typescript
// src/api/backend-chooser.ts
const BACKENDS = [
  'http://localhost:3001',     // Docker local
  'http://192.168.1.100:3001', // IP local (fallback sem internet)
  'https://music.meuservidor.com', // Remoto
];

async function getAvailableBackend(): Promise<string> {
  for (const url of BACKENDS) {
    try {
      const resp = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) return url;
    } catch { continue; }
  }
  throw new Error('Nenhum backend disponível');
}
```

---

### 3.11 Módulo: Docker & Deploy

#### Dockerfile (multi-stage)

> Ver Dockerfile completo com usuário não-root, HEALTHCHECK e STOPSIGNAL em **seção 3.19.4**.

```dockerfile
# Stage 1: Frontend
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:web

# Stage 2: Backend
FROM node:20-alpine AS backend
WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Stage 3: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y yt-dlp ffmpeg nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /app/dist ./server
COPY --from=frontend /app/dist ./dist
RUN mkdir -p /app/data
EXPOSE 3001
VOLUME ["/app/data", "/music"]
CMD ["node", "server/index.js"]
```

#### docker-compose.yml

```yaml
version: "3.8"
services:
  selftify:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - /caminho/para/musica:/music:ro   # Música local (montado RO)
      - ./data:/app/data                  # Persistência: DB, cookies, temp, logs
    environment:
      - PORT=3001
      - MUSIC_PATH=/music
      - DATA_PATH=/app/data
      - CORS_ORIGIN=*
      - YTDLP_PATH=yt-dlp
      - LOG_LEVEL=info
      - MAX_CONCURRENT_DOWNLOADS=2
      - JWT_SECRET=change-me-in-prod
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped
```

---

### 3.12 Módulo: Local Indexer (Scanner de Biblioteca)

#### O que sai do frontend
| Arquivo | Destino |
| :--- | :--- |
| `src/api/indexer/indexer.ts` | **Move** → `server/src/services/local/indexer/indexer.ts` |
| `src/api/indexer/local-indexer.ts` (764 linhas) | **Move** → `server/src/services/local/indexer/local-indexer.ts` |
| `src/api/indexer/noop-indexer.ts` | **Move** → `server/src/services/local/indexer/noop-indexer.ts` |
| `src/services/sqlite-db/sqlite-db-cache.ts` | **Move** → `server/src/db/legacy-sqlite/sqlite-db-cache.ts` |
| `src/services/sqlite-db/sqlite-db-config.ts` | **Move** → `server/src/db/legacy-sqlite/sqlite-db-config.ts` |
| `src/lib/sqlite-db-helpers.ts` | **Move** → `server/src/lib/sqlite-db-helpers.ts` |
| `src/hooks/use-local-scan.ts` | **Refatorado** → usa `POST /api/local/scan` |
| `src/hooks/auto-scan-logic.ts` | **Copiado** para backend (lógica de decisão de scan) |

#### Endpoints REST

| Método | Endpoint | Descrição | Request | Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/local/scan/start` | Inicia scan da biblioteca | body: `{ rootFolder }` | `{ scanId }` |
| `POST` | `/api/local/scan/pause` | Pausa scan | — | `void` |
| `POST` | `/api/local/scan/resume` | Resume scan | — | `void` |
| `POST` | `/api/local/scan/abort` | Aborta scan | — | `void` |
| `GET` | `/api/local/scan/status` | Status do scan | — | `IndexerStatus` |
| `WebSocket` | `/ws/local/scan/progress` | Progresso em tempo real | — | Eventos de progresso |

#### Conexão Frontend

```
src/hooks/use-local-scan.ts
        │
        ▼
  Antes: getIndexer(origin) → Indexer.start() (IPC + fs local)
  Depois: POST /api/local/scan/start + GET /api/local/scan/status +
          WebSocket para progresso
```

---

### 3.13 Módulo: Itens Removidos do Frontend

Arquivos que **não têm substituto** no backend porque a funcionalidade foi eliminada ou o componente era puramente Electron/MPV:

| Arquivo | Motivo |
| :--- | :--- |
| `src/features/player/ipc-audio-provider.tsx` | Substituído por `web-audio-provider.tsx` / `browser-audio-provider.tsx` |
| `src/services/electron-audio.ts` | MPV bridge obsoleto. Todo áudio via Web Audio API |
| `src/services/audio-output/desktop-audio-output.ts` | MPV bridge. `browser-audio-output.ts` permanece |

---

### 3.14 Módulo: Detecção de Backend (Selftify vs Navidrome)

O frontend precisa saber se está conectado a um backend **Selftify** (que suporta extensões como YouTube, download, LRC) ou a um **Navidrome/Subsonic puro** (apenas biblioteca local).

#### Mecanismo de Detecção

O backend Selftify expõe um arquivo/endpoint que servidores Subsonic comuns **não têm**:

| Método | Endpoint | Descrição | Response (Selftify) | Response (Navidrome) |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/selftify/capabilities` | Lista extensões suportadas | `{ type: "selftify", features: ["youtube","lyrics-lrc","download","ranking","organizer","origins","search-online"] }` | `404 Not Found` |
| `GET` | `/selftify.txt` | Arquivo marcador no root | `"selftify"` (string) | `404` |

#### Fluxo de Conexão

```typescript
// src/api/backend-detector.ts
enum SelftifyFeature {
  YouTube = "youtube",
  LyricsLRC = "lyrics-lrc",
  Download = "download",
  Ranking = "ranking",
  Organizer = "organizer",
  Origins = "origins",
  SearchOnline = "search-online",
  MusicBrainzOAuth = "musicbrainz-oauth",
}

type BackendInfo = { type: "selftify"; features: SelftifyFeature[]; baseUrl: string }
                 | { type: "navidrome"; baseUrl: string };

async function detectBackend(baseUrl: string): Promise<BackendInfo> {
  try {
    const resp = await fetch(`${baseUrl}/api/selftify/capabilities`);
    if (resp.ok) {
      const data = await resp.json();
      return { type: "selftify", features: data.features, baseUrl };
    }
  } catch {}
  // Fallback: assume Navidrome/Subsonic puro
  return { type: "navidrome", baseUrl };
}
```

#### Arquivos no frontend

| Arquivo | Propósito |
| :--- | :--- |
| `src/api/backend-detector.ts` | Lógica de detecção (novo) |
| `src/api/subsonic-controller.ts` | Controller Subsonic (substitui `remote-controller.ts`) |
| `src/api/selftify-controller.ts` | Controller para extensions Selftify (condicional) |
| `src/App.tsx` | Chama `detectBackend()` no startup e define qual controller usar |

---

### 3.15 Módulo: Camada Frontend Subsonic Client

O frontend opera em **2 modos**:

1. **Modo Subsonic** (sempre ativo) — browse, search local, stream, playlist, cover art
2. **Modo Selftify** (ativo apenas se `detectBackend()` retornar `type: "selftify"`) — YouTube, download, LRC, ranking, organizer, origins

#### Controller Duality

```typescript
// src/api/subsonic-controller.ts — implementa ServerController via Subsonic API
class SubsonicController implements ServerControllerBase {
  private baseUrl: string;
  private auth: string; // "u=user&t=token&s=salt&v=1.16.1&c=selftify-web"

  async searchLocal(query: string): Promise<SearchResult> {
    const resp = await fetch(
      `${this.baseUrl}/rest/search3?query=${query}&songCount=50&albumCount=20&artistCount=20&f=json&${this.auth}`
    );
    return parseSubsonicSearchResponse(await resp.json());
  }

  async getAlbumList(): Promise<Album[]> {
    const resp = await fetch(
      `${this.baseUrl}/rest/getAlbumList2?type=alphabeticalByName&size=100&f=json&${this.auth}`
    );
    return parseSubsonicAlbumList(await resp.json());
  }

  async getStreamUrl(songId: string): Promise<string> {
    return `${this.baseUrl}/rest/stream?id=${songId}&${this.auth}`;
  }

  async getCoverArtUrl(albumId: string): Promise<string> {
    return `${this.baseUrl}/rest/getCoverArt?id=${albumId}&${this.auth}`;
  }

  // ... + getArtist, getSong, getPlaylists, search3, scrobble, star, etc.
}

// src/api/selftify-controller.ts — implementa extensões
class SelftifyController {
  constructor(private baseUrl: string) {}

  async searchOnline(query: string): Promise<SearchResult> { /* GET /api/search/online */ }
  async getYoutubeStreamUrl(videoId: string): Promise<string> { /* GET /api/youtube/stream-url */ }
  async enqueueDownload(song: Song): Promise<string> { /* POST /api/download/enqueue */ }
  async getLyricsLrc(song: Song): Promise<LyricsResult> { /* GET /api/lyrics/by-song */ }
  async getArtistImage(name: string): Promise<string> { /* GET /api/artwork/artist */ }
  async getRankingCandidates(songId: string): Promise<YoutubeCandidate[]> { /* GET /api/youtube/ranking */ }
  // ...
}
```

#### UI Conditional

| Feature | Backend Navidrome | Backend Selftify |
| :--- | :--- | :--- |
| Browse library | ✅ Subsonico | ✅ Subsonic |
| Stream local | ✅ `/rest/stream` | ✅ `/rest/stream` |
| Cover art | ✅ `/rest/getCoverArt` | ✅ `/rest/getCoverArt` |
| Search (local) | ✅ `/rest/search3` | ✅ `/rest/search3` |
| **Search (YouTube)** | ❌ oculto | ✅ `/api/search/online` |
| **Download YT** | ❌ oculto | ✅ `/api/download/*` |
| **Lyrics LRC** | ❌ oculto | ✅ `/api/lyrics/*` |
| **Artist image** | ❌ oculto | ✅ `/api/artwork/artist` |
| **Ranking/MBZ** | ❌ oculto | ✅ `/api/mbz/mapping/*` |
| **File organizer** | ❌ oculto | ✅ `/api/local/organize/*` |
| **Multi-origin** | ❌ oculto | ✅ `/api/origins` |

---

### 3.16 Módulo: Lista Canônica de Extensões Customizadas

Abaixo a **única lista definitiva** de endpoints customizados `/api/*` (não Subsonic). Nenhuma duplicação com os endpoints nas seções anteriores — eles referenciam esta lista.

#### 3.16.1 YouTube Operations

| Método | Endpoint | Descrito em |
| :--- | :--- | :--- |
| `GET` | `/api/youtube/search` | Seção 3.1 |
| `GET` | `/api/youtube/stream-url` | Seção 3.1 |
| `GET` | `/api/youtube/video-info` | Seção 3.1 |
| `POST` | `/api/youtube/download` | Seção 3.1 |
| `POST` | `/api/youtube/download-mp3` | Seção 3.1 |
| `POST` | `/api/youtube/process-cover` | Seção 3.1 |
| `POST` | `/api/youtube/embed-artwork` | Seção 3.1 |
| `GET` | `/api/youtube/check-version` | Seção 3.1 |
| `POST` | `/api/youtube/update` | Seção 3.1 |
| `POST` | `/api/youtube/select` | Seleção manual de vídeo |
| `GET` | `/api/youtube/ranking` | Candidatos rankeados |

#### 3.16.2 Search (Online)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/search/online` | Busca MusicBrainz + YouTube (além da busca local Subsonic) |

#### 3.16.3 Stream (Batch)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/stream/resolve-batch` | Resolve múltiplas músicas para play-all |

#### 3.16.4 Artwork (extensões)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/artwork/artist` | Imagem de artista por nome (Subsonic não tem) |
| `POST` | `/api/artwork/search` | Busca em provedores externos |
| `POST` | `/api/local/embed-artwork` | Embede cover no arquivo |
| `POST` | `/api/local/replace-cover` | Substitui cover via ffmpeg |

#### 3.16.5 Lyrics (LRC)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/lyrics/by-song` | Letra com LRC (Subsonic `getLyrics` é only plain) |
| `GET` | `/api/lyrics/search` | Busca em provedores |
| `GET` | `/api/lyrics/by-remote-id` | Letra por ID remoto |
| `GET` | `/api/lyrics/sync` | LRC parse |

#### 3.16.6 Download Queue

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| Tabela completa | `/api/download/*` + WebSocket | Seção 3.6 |

#### 3.16.7 Ranking & MusicBrainz

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| Tabela completa | `/api/mbz/*` | Seção 3.1 |

#### 3.16.8 File Organizer

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| Tabela completa | `/api/local/organize/*` | Seção 3.11 |

#### 3.16.9 Origins

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| Tabela completa | `/api/origins` | Seção 3.8 |

#### 3.16.10 Settings

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/settings` | Settings.store sync |
| `PUT` | `/api/settings` | Settings.store sync |

#### 3.16.11 Local Indexer

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| Tabela completa | `/api/local/scan/*` + WebSocket | Seção 3.12 |

---

### 3.17 Módulo: Persistência & Runtime Docker



O usuário pediu: **"uma coisa que essa imagem docker deve ter é uma fia persistida para os trabalhos resistirem a reinicio do servidor"**.

#### 3.19.1 O que deve ser persistente

| Dado | Atual (Electron) | Novo (Docker) | Volume |
| :--- | :--- | :--- | :--- |
| **Banco principal** (músicas, álbuns, artistas) | `userData/selftify.db` | `/app/data/selftify.db` | `/app/data` |
| **Download tasks DB** | `userData/selftify-downloads.db` | `/app/data/downloads.db` | `/app/data` |
| **Cookies yt-dlp** | `os.tmpdir()/selftify-cookies.txt` | `/app/data/cookies.txt` | `/app/data` |
| **Temp covers (ffmpeg)** | `os.tmpdir()/selftify-cover-in-*.jpg` | `/app/data/tmp/` | `/app/data` |
| **Ranking logs** | Dentro do DB principal | `/app/data/selftify.db` | `/app/data` |
| **Scan cache** | `sqlite-db-cache.ts` (no DB) | `/app/data/selftify.db` | `/app/data` |
| **Search cache** | `sqlite-db-search-store.ts` (no DB) | `/app/data/selftify.db` | `/app/data` |
| **Logs da aplicação** | stdout | `/app/data/logs/` (opcional) | `/app/data` |
| **Música local** | Pasta do usuário | `/music` (montado RO) | `/music` |

#### 3.19.2 Download Tasks sobrevivem a reinício

O `download-db.ts` já tem `resetInterruptedTasks()` (linhas 69-92) que, na inicialização, redefine tarefas nos estados `searching`, `downloading-audio`, `getting-cover`, `processing-cover`, `embedding-cover` de volta para `pending`. **Isso garante que downloads interrompidos por restart do container recomeçam automaticamente.**

No backend, o `server/src/services/download/db.ts` deve:
1. Usar `DATA_PATH` env var (default `/app/data`)
2. Caminho: `join(DATA_PATH, 'downloads.db')`
3. Chamar `resetInterruptedTasks()` no `initDownloadDb()`
4. O backend deve, no startup, re-enfileirar tarefas `pending` na TaskQueue

```typescript
// server/src/services/download/db.ts
import Database from "better-sqlite3";
import { join } from "path";

const DATA_PATH = process.env.DATA_PATH || "/app/data";
const dbPath = join(DATA_PATH, "downloads.db");

export function initDownloadDb(): void {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  resetInterruptedTasks();  // ← recomeça downloads interrompidos
}

// No startup do server:
initDownloadDb();
const pending = getAllTasks().filter(t => t.status === "pending");
for (const task of pending) {
  downloadQueue.add(task);  // re-enfileira
}
```

#### 3.19.3 Cookies e Temp fora de `os.tmpdir()`

`electron/main.ts` usa `tmpdir()` (linha 361, 719) que em container Docker é efêmero. No backend, usar `DATA_PATH`:

```typescript
// server/src/services/youtube/yt-dlp.ts
const COOKIE_FILE = join(process.env.DATA_PATH || "/app/data", "cookies.txt");
const TMP_COVER = join(process.env.DATA_PATH || "/app/data", "tmp");
```

#### 3.19.4 Dockerfile runtime (não-crítico mas importante)

```dockerfile
# ... (stages anteriores)

FROM debian:bookworm-slim

# Cria usuário não-root para segurança
RUN groupadd -r selftify && useradd -r -g selftify selftify

RUN apt-get update && apt-get install -y --no-install-recommends \
    yt-dlp ffmpeg nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=backend /app/dist ./server
COPY --from=frontend /app/dist ./dist

# Volumes persistentes
RUN mkdir -p /app/data /app/data/tmp /app/data/logs /music \
    && chown -R selftify:selftify /app/data

VOLUME ["/app/data", "/music"]

EXPOSE 3001

# Healthcheck: falha se /api/health não responder
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Graceful shutdown no SIGTERM (Docker stop)
STOPSIGNAL SIGTERM

USER selftify

CMD ["node", "server/index.js"]
```

#### 3.19.5 Variáveis de ambiente

| Var | Default | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3001` | Porta do servidor |
| `DATA_PATH` | `/app/data` | Diretório persistente (DB, cookies, temp) |
| `MUSIC_PATH` | `/music` | Diretório da biblioteca local |
| `CORS_ORIGIN` | `*` | Origem permitida (ex: `https://app.exemplo.com`) |
| `YTDLP_PATH` | `yt-dlp` | Caminho do binário yt-dlp |
| `LOG_LEVEL` | `info` | Nível de log |
| `MAX_CONCURRENT_DOWNLOADS` | `2` | Limite de downloads paralelos |
| `JWT_SECRET` | (gerado) | Segredo para JWT (deve ser fixo em prod) |

#### 3.19.6 Middleware não-crítico (boas práticas)

| Middleware | Propósito |
| :--- | :--- |
| `cors()` | Permitir origem do frontend (CORS_ORIGIN) |
| `helmet()` | Headers de segurança |
| `compression()` | Gzip para respostas JSON grandes |
| `express-rate-limit()` | Evitar abuso da API (ex: 100 req/min) |
| `morgan()` ou `pino()` | Log de requisições |
| `static` com `maxAge` | Cache de assets do frontend |

#### 3.19.7 Backup

O SQLite em `/app/data/selftify.db` deve ser backupeado periodicamente:

```bash
# Exemplo: cron no host
0 4 * * * docker exec selftify cp /app/data/selftify.db /backup/selftify-$(date +%F).db
```

Ou usar `sqlite3 .backup` para backup quente (WAL mode permite).

---

## 4. Resumo: O que o Frontend PERDE vs GANHA

### Perde (removido do frontend)
| Módulo | Linhas removidas (estimado) |
| :--- | ---: |
| YouTube download service | ~350 |
| YouTube ranking | ~200 |
| YouTube pure search | ~50 |
| Local controller | ~340 |
| Search service | ~230 |
| MusicBrainz API + client | ~200 |
| MusicBrainz OAuth | ~80 |
| Stream resolver | ~200 |
| Stream buffer | ~50 |
| Image fetch / artist image | ~200 |
| Wiki/Wikidata image | ~100 |
| Cover resolver | ~150 |
| Cover event bus | ~30 |
| Invalidates caches | ~20 |
| Artwork module + providers | ~500 |
| Artist-image providers | ~150 |
| Lyrics + providers | ~400 |
| Playlist service | ~100 |
| Download queue | ~200 |
| Download platform | ~100 |
| DB layer + repositories | ~800 |
| SQLite DB service (10+ arquivos) | ~600 |
| File organizer (6+ arquivos) | ~500 |
| Delete album / move to trash | ~100 |
| Dot-img / image-store / preloader | ~200 |
| Platform fetch | ~50 |
| Audio engine / output | ~200 |
| **Local Indexer** (local-indexer.ts) | **~764** |
| **SQLite DB helpers** (lib) | **~50** |
| **electron/queue.ts** | **~109** |
| **electron/download-db.ts** | **~50** |
| **electron/download-queue-service.ts** | **~100** |
| **IpcAudioProvider** (removido) | **~214** |
| **Electron audio service** (removido) | **~40** |
| **Desktop audio output** (removido) | **~100** |
| **Total removido** | **~7.500+** |

### Ganha (adicionado/modificado no frontend)
| Módulo | Linhas adicionadas |
| :--- | ---: |
| `src/api/remote-controller.ts` | ~150 |
| `src/api/backend-chooser.ts` | ~50 |
| `src/stores/auth.store.ts` (mod) | ~20 |
| `src/stores/settings.store.ts` (mod) | ~20 |
| `src/hooks/use-local-scan.ts` (mod) | ~30 |
| `src/hooks/use-cover.ts` (mod) | ~20 |
| `src/hooks/use-artist-image.ts` (mod) | ~20 |
| `src/features/settings/settings-page.tsx` (mod) | ~20 |
| `src/features/lyrics/lyrics-panel.tsx` (mod) | ~20 |
| `src/features/search/search-page.tsx` (mod) | ~10 |
| `src/features/album/album-image-manager.tsx` (mod) | ~10 |
| `src/stores/download.store.ts` (mod) | ~30 |
| **Total adicionado** | **~400** |

---

## 5. Fases de Migração

### Fase 1: Setup do Backend (1-2 semanas)
- [ ] Criar `server/` com Node.js + Express + TypeScript
- [ ] Copiar `src/types/domain-types.ts` para server
- [ ] Implementar `GET /api/health`
- [ ] Dockerfile multi-stage básico (frontend build + server)
- [ ] Copiar `electron/queue.ts` → `server/src/lib/task-queue.ts`

### Fase 2: Search + Stream (2 semanas)
- [ ] Mover `youtube-ranking.ts` para server
- [ ] Implementar `yt-dlp-service.ts` no server (copiar lógica de `electron/main.ts`)
- [ ] Endpoints: `GET /api/youtube/search`, `GET /api/youtube/stream-url`
- [ ] Endpoint: `GET /api/search` (MusicBrainz)
- [ ] Copiar `electron/download-db.ts` → server
- [ ] Copiar `electron/download-queue-service.ts` → server
- [ ] Refatorar `src/api/controller.ts` → `RemoteController`
- [ ] `docker-compose.yml` funcional

### Fase 3: Library + Database + Indexer (3-4 semanas)
- [ ] Mover `src/services/db/` + `src/services/sqlite-db/` para server
- [ ] Mover `src/api/local/local-controller.ts` para server
- [ ] **Mover `src/api/indexer/` para server** (local-indexer.ts, 764 linhas)
- [ ] **Mover `electron/download-db.ts` → `server/src/services/download/db.ts`** (com `resetInterruptedTasks()`)
- [ ] Endpoints REST para CRUD de músicas/álbuns/artistas
- [ ] Endpoints REST para scan (`POST /api/local/scan/start`, etc.)
- [ ] **Configurar `DATA_PATH` env para persistência** (DB, cookies, temp)
- [ ] Remover lógica local do Electron

### Fase 4: Artwork + Lyrics + Downloads + Artist Images (2 semanas)
- [ ] Mover artwork providers para server (`src/services/artwork/`)
- [ ] **Mover artist-image providers para server** (`src/services/artist-image/providers/`)
- [ ] Mover lyrics providers para server
- [ ] Mover download queue para server + WebSocket
- [ ] Remover handlers IPC correspondentes do Electron

### Fase 5: Auth + Subsonic + Custom Extensions (2-3 semanas)
- [ ] Implementar JWT ou Subsonic auth (`/rest/ping` com `u/t/s/v/c`)
- [ ] Implementar endpoints Subsonic OBRIGATÓRIOS (seção 3.8.2)
- [ ] Implementar endpoints Subsonic OPCIONAIS (seção 3.8.3) conforme necessário
- [ ] **Implementar extensões customizadas** (seção 3.17):
  - [ ] `/api/search/online` (busca YouTube + MB)
  - [ ] `/api/artwork/*` (cover por nome/artista)
  - [ ] `/api/lyrics/*` (LRC + multi-provider)
  - [ ] `/api/download/*` (YouTube download queue)
  - [ ] `/api/mbz/mapping/*` (MBZ→YT mapping)
  - [ ] `/api/local/organize/*` (file organizer)
  - [ ] `/api/origins` (multi-origin)
- [ ] Garantir que `/rest/getCoverArt` e `/rest/getLyrics` reusam a mesma impl de `/api/artwork/*` e `/api/lyrics/*`
- [ ] Simplificar `src/stores/auth.store.ts`

### Fase 6: Cleanup (1-2 semanas)
- [ ] Remover `src/services/` inteiramente (tudo no server)
- [ ] Remover `src/api/youtube/`, `src/api/local/` e `src/api/indexer/`
- [ ] **Remover `src/features/player/ipc-audio-provider.tsx`** (obsoleto)
- [ ] **Remover `src/services/electron-audio.ts`** (MPV bridge)
- [ ] **Remover `src/services/audio-output/desktop-audio-output.ts`** (MPV)
- [ ] **Refatorar todas features que usam `window.electronApi` diretamente** (settings, lyrics, search, album-image-manager, download.store)
- [ ] Simplificar `electron/main.ts` e `electron/preload.ts`
- [ ] Testar fallback multi-backend
- [ ] Atualizar README.md

---

## 6. Edge Cases & Riscos

| Risco | Mitigação |
| :--- | :--- |
| **Latência** (search 8-15s via yt-dlp) | Backend cacheia resultados (TTL 55 min). Frontend usa skeleton loading. |
| **Stream via servidor** (banda alta) | Backend retorna redirect 302 para `googlevideo.com`. Sem proxy de áudio. |
| **Música local não acessível** | Volume Docker `/music:/music:ro`. Usuário monta o diretório. |
| **Offline** | Online-only + fallback para IP local da rede quando sem internet. |
| **Compatibilidade Subsonic** | Implementar apenas endpoints essenciais primeiro. Expandir conforme demanda. |
| **DB migration** | Script de migração para copiar SQLite existente para `/app/data`. |
| **Persistência de jobs** | Volume `/app/data` montado. `downloads.db` + `resetInterruptedTasks()` garante que downloads recomeçam após restart. Cookies e temp fora de `os.tmpdir()`. |
