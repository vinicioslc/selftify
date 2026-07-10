---
title: Selftify Server Umbrella — Feature Gating by Backend Capabilities
version: 1.0
date_created: 2026-07-08
owner: Engineering
tags: architecture, backend-detection, capabilities, ux, state-machine
---

# Selftify Server Umbrella

## 1. Purpose & Scope

Definir a arquitetura de **feature gating** do frontend Selftify com base nas capacidades do backend conectado. Toda funcionalidade **não-nativa do Subsonic** (busca online MusicBrainz, YouTube, download, lyrics LRC, organizer, ranking, artwork providers) deve ser tratada como extensão opcional, disponível apenas quando o backend as suporta — e agrupada visualmente sob o guarda-chuva **Selftify Server**.

**Público-alvo**: Engenharia frontend, backend, UX.
**Escopo**: Detecção de backend, máquina de estados da UI, stores, controllers, settings page, search page, download flow.

---

## 2. Definições

| Termo | Definição |
| :--- | :--- |
| **Subsonic API** | API REST aberta (OpenSubsonic 1.16.1) usada por Navidrome, Airsonic, Gonic. Provê apenas operações de biblioteca local (browse, search, stream). |
| **Selftify Server** | Backend Express próprio que implementa Subsonic + extensões próprias (YouTube, download, lyrics, online search). |
| **Capability** | Funcionalidade extra declarada em `GET /api/selftify/capabilities`. Ex: `"youtube"`, `"download"`, `"search-online"`, `"lyrics-lrc"`. |
| **Navidrome** | Servidor Subsonic puro — retorna 404 em `/api/selftify/capabilities`. |
| **Online Search Config** | Configuração global de MusicBrainz OAuth + YouTube Headers, independente de backend. |
| **Feature Gate** | Mecanismo que oculta/revela UI e rotas com base em capabilities detectadas. |

### Capabilities Registry

```typescript
enum SelftifyCapability {
  YouTube        = "youtube",         // YouTube search + stream + download
  LyricsLRC      = "lyrics-lrc",      // Letras sincronizadas LRC
  Download       = "download",        // Download de músicas (yt-dlp)
  Ranking        = "ranking",         // YouTube ranking weights
  Organizer      = "organizer",       // File organizer (rename, move, cover.jpg, .nfo)
  Origins        = "origins",         // Multi-biblioteca (server-side origins)
  SearchOnline   = "search-online",   // Busca MusicBrainz + YouTube integrada
  MusicBrainzOAuth = "musicbrainz-oauth", // OAuth MusicBrainz via server
  Scan           = "scan",            // Scanner de biblioteca local
  Settings       = "settings",        // Server-side settings persistence
}
```

---

## 3. Architecture — State Machine

### 3.1 Backend Detection State Machine

```
                    ┌──────────────────────┐
                    │      APP START        │
                    │  fetch backend.store  │
                    │  (Zustand persist)    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Has saved config?   │
                    │  backend.store.config │
                    └──────┬──────────┬────┘
                           │          │
                       YES │          │ NO
                           │          │
                    ┌──────▼──┐  ┌────▼──────────┐
                    │  Probe  │  │  No backend    │
                    │  saved  │  │  configured    │
                    │  URL    │  └───────┬────────┘
                    └───┬─────┘          │
                        │                │
               ┌────────▼────────┐       │
               │  GET /api/      │       │
               │  selftify/      │       │
               │  capabilities   │       │
               │  (timeout 4s)   │       │
               └────┬───────┬────┘       │
                    │       │            │
              ┌─────▼──┐ ┌──▼────────┐  │
              │  200   │ │ 404/err   │  │
              │  OK    │ │ (Navidrome│  │
              └───┬────┘ │  /pure    │  │
                  │      │  Subsonic)│  │
                  │      └─────┬─────┘  │
          ┌───────▼──────┐    │        │
          │ Selftify     │    │        │
          │ Server       │    │        │
          │ capabilities │    │        │
          │ = features[] │    │        │
          └───────┬──────┘    │        │
                  │           │        │
          ┌───────▼───────────▼────────▼──────┐
          │       UI RENDERS WITH GATES       │
          │  ┌─────────────────────────────┐  │
          │  │ Online Search Config         │◄─┼── Always available (global)
          │  │ MusicBrainz OAuth            │  │
          │  │ YouTube Headers              │  │
          │  │ Download Folder              │  │
          │  └─────────────────────────────┘  │
          │  ┌─────────────────────────────┐  │
          │  │ Selftify Features (gated)    │◄─┼── Only if Selftify server
          │  │  ✅ YouTube Search/Stream   │  │
          │  │  ✅ Download                │  │
          │  │  ✅ Lyrics LRC              │  │
          │  │  ✅ Scan Library            │  │
          │  │  ✅ Organizer               │  │
          │  │  ✅ Ranking Config          │  │
          │  │  ✅ Server Settings         │  │
          │  └─────────────────────────────┘  │
          │  ┌────────────────────────────┐   │
          │  │ Subsonic Features           │◄──┼── Always available via
          │  │  ✅ Browse Albums/Artists  │   │    Subsonic API
          │  │  ✅ Search Library         │   │
          │  │  ✅ Stream                 │   │
          │  │  ✅ Cover Art              │   │
          │  │  ✅ Playlists              │   │
          │  └────────────────────────────┘   │
          └───────────────────────────────────┘
```

### 3.2 Connection Flow Detail

```
User enters URL ──► Test Connection
                        │
                        ├── GET /api/selftify/capabilities ──► 200 → Selftify
                        │                                         │
                        │                                         ▼
                        │                                   Save config
                        │                                   Show all features
                        │
                        └── 404/timeout → assume Subsonic
                                            │
                                            ▼
                                      GET /rest/ping ──► 200 → Navidrome/Subsonic
                                      (Subsonic auth)      │
                                                            ▼
                                                      Save config
                                                      Show only library features
```

---

## 4. Store Architecture

### 4.1 Global Online Search Store (always available)

```typescript
// src/stores/online-search.store.ts
type OnlineSearchConfig = {
  enabled: boolean;

  // MusicBrainz OAuth
  musicBrainzClientId?: string;
  musicBrainzClientSecret?: string;
  musicBrainzToken?: string;
  musicBrainzRefreshToken?: string;
  musicBrainzTokenExpiresAt?: number;

  // YouTube Headers (for cookie-based YouTube Music access)
  youtubeMusicHeaders?: string;

  // Download destination
  downloadFolder?: string;
};
```

**Persisted via** Zustand `persist` middleware, key `selftify-online-search`.

**Accessed by**: Search page, Download queue, MusicBrainz client.

### 4.2 Backend Connection Store (unchanged)

```typescript
// src/stores/backend.store.ts (existing)
type BackendConfig = {
  type: "selftify" | "subsonic";
  url: string;
  user: string;
  password: string;
  capabilities?: string[];  // populated after detectBackend()
};
```

### 4.3 Simplified Origin Store

```typescript
// src/stores/auth.store.ts — after simplification
type Origin = {
  id: string;
  name: string;
  type: OriginType;
  folderPath?: string;
  downloadFolder?: string;     // kept for backward compat, fallback to OnlineSearchConfig
  organizeOnScan?: boolean;
  organizeDryRun?: boolean;
};
// REMOVED: enableOnlineSearch, musicBrainzToken, musicBrainzClientId,
//          musicBrainzClientSecret, musicBrainzRefreshToken,
//          musicBrainzTokenExpiresAt, youtubeMusicHeaders
```

---

## 5. UI Layout — Settings "Servers" Tab

### 5.1 Moodboard / Layout

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                                 │
│  ┌─ Servers ──┬─ Library ──┬─ Playback ─┬─ ... ─┐        │
│  └────────────┴────────────┴────────────┴───────┘        │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Backend Connection                                │    │
│  │  ─────────────────                                 │    │
│  │  Server URL  [http://localhost:3000           ]    │    │
│  │  Username    [admin                           ]    │    │
│  │  Password    [••••••••••                      ]    │    │
│  │                                                    │    │
│  │  Capabilities detected:                             │    │
│  │    ├─ Music Library    ✅ (Subsonic)               │    │
│  │    ├─ YouTube Search   ✅ (Selftify)               │    │
│  │    ├─ Download         ✅ (Selftify)               │    │
│  │    ├─ Lyrics LRC       ✅ (Selftify)               │    │
│  │    ├─ Online Search    ✅ (Selftify)               │    │
│  │    └─ Scan Library     ✅ (Selftify)               │    │
│  │                                                    │    │
│  │  [Test Connection]        [Disconnect]             │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Online Search (always available)                   │    │
│  │  ─────────────────                                  │    │
│  │  [✓] Enable MusicBrainz search                      │    │
│  │  [✓] Enable YouTube search                          │    │
│  │                                                    │    │
│  │  ── MusicBrainz OAuth ──                            │    │
│  │  Client ID:    [••••••••••••••••••••••••        ]  │    │
│  │  Client Secret:[••••••••••••••••••••••••        ]  │    │
│  │  [Login with MusicBrainz]     [✓ Authenticated]     │    │
│  │                                                    │    │
│  │  ── YouTube Headers ──                              │    │
│  │  [Edit Headers]  [✓ Configured]                    │    │
│  │                                                    │    │
│  │  Download folder: [~/Music/selftify-downloads    ]  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Local Library (standalone mode)                    │    │
│  │  ─────────────────                                  │    │
│  │  (only shown when NO backend is connected)          │    │
│  │                                                    │    │
│  │  Connected Sources:                                 │    │
│  │    My Music  • /home/user/Music                     │    │
│  │      [Select] [Edit] [Delete]                       │    │
│  │                                                    │    │
│  │  Add Source:                                        │    │
│  │  Music Folder [/home/user/Music              ]      │    │
│  │  [Scan Now]                                         │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 5.2 Feature Gating Rules

| Component / Route | Subsonic only (Navidrome) | Selftify Server | No backend |
|:---|:---:|:---:|:---:|
| Library (browse albums/artists) | ✅ | ✅ | ✅ (local origin) |
| Search local library | ✅ | ✅ | ✅ |
| Stream audio | ✅ | ✅ | ✅ |
| Playlists | ✅ | ✅ | ✅ |
| Cover art | ✅ | ✅ | ✅ |
| **Online Search (MusicBrainz + YouTube)** | ✅ * | ✅ | ✅ * |
| **Download** | ❌ | ✅ | ❌ |
| **Lyrics LRC** | ❌ | ✅ | ❌ |
| **Scan Library** | ❌ | ✅ | ✅ (client-side) |
| **Organizer** | ❌ | ✅ | ❌ |
| **Ranking config** | ❌ | ✅ | ❌ |
| **Server Settings** | ❌ | ✅ | ❌ |

> \* Online Search usa a **Online Search Config global** — funciona independente do backend, desde que MusicBrainz OAuth e YouTube Headers estejam configurados.

---

## 6. Data Flow

### 6.1 Search Flow

```
User types query
       │
       ▼
SearchPage
  ├── Tab "Library" → getController().search(query)
  │     ├── Selftify backend: SubsonicController → /rest/search3
  │     └── Local origin: LocalController → SQLite scan
  │
  ├── Tab "MusicBrainz" → searchMusicBrainz(query)
  │     └── Reads OnlineSearchConfig.musicBrainzToken
  │         (global store, independent of backend)
  │
  └── Tab "YouTube" → searchYouTube(query)
        └── Reads OnlineSearchConfig.youtubeMusicHeaders
            If Selftify backend → POST /api/search/online
            If no backend → YouTube pure search via yt-dlp IPC
```

### 6.2 Download Flow

```
User clicks Download
       │
       ▼
DownloadButton
  ├── Backend is Selftify → POST /api/download/enqueue
  │     (server handles yt-dlp, metadata, cover, file write)
  │
  └── Backend is Navidrome / none → status "Download requires Selftify Server"
        (button disabled with tooltip)
```

### 6.3 Lyrics Flow

```
User opens Lyrics panel
       │
       ▼
LyricsPanel
  ├── Backend has "lyrics-lrc" capability → GET /api/lyrics/by-song
  └── Backend is Navidrome / none → status "Lyrics require Selftify Server"
```

---

## 7. Interfaces & Data Contracts

### 7.1 Backend Detection API

```
GET /api/selftify/capabilities

Response (Selftify Server):
{
  "type": "selftify",
  "features": [
    "youtube",
    "lyrics-lrc",
    "download",
    "ranking",
    "organizer",
    "origins",
    "search-online",
    "musicbrainz-oauth",
    "scan",
    "settings"
  ]
}

Response (Navidrome/Subsonic): 404 Not Found
```

### 7.2 Online Search Config API (server-persisted, optional)

```
GET /api/selftify/online-search-config
Response: { enabled, musicBrainzToken?, youtubeMusicHeaders?, downloadFolder? }

PUT /api/selftify/online-search-config
Body: { musicBrainzToken?, youtubeMusicHeaders?, downloadFolder? }
Response: updated config
```

Note: Quando não há backend, a config é persisted apenas no frontend (Zustand localStorage).

### 7.3 Store Shape (frontend)

```typescript
// Zustand stores after refactor:

// backend.store.ts
type BackendState = {
  config: BackendConfig | null;  // null = standalone mode
  capabilities: string[];        // populated after detection
  setConfig: (config) => void;
  clearConfig: () => void;
  hasCapability: (cap: string) => boolean;
};

// online-search.store.ts
type OnlineSearchState = {
  enabled: boolean;
  musicBrainzClientId: string;
  musicBrainzClientSecret: string;
  musicBrainzToken: string;
  musicBrainzRefreshToken: string;
  musicBrainzTokenExpiresAt: number;
  youtubeMusicHeaders: string;
  downloadFolder: string;
  setEnabled: (v: boolean) => void;
  updateMusicBrainz: (partial) => void;
  setYoutubeHeaders: (headers: string) => void;
  setDownloadFolder: (path: string) => void;
  clearAuth: () => void;
};

// auth.store.ts (simplified)
type AuthState = {
  currentOrigin: Origin | null;
  origins: Origin[];
  // REMOVED: musicBrainz fields, youtubeMusicHeaders, enableOnlineSearch
};
```

---

## 8. Acceptance Criteria

**AC-001**: When app starts with a saved backend URL, it probes `/api/selftify/capabilities`. On 200, it stores `capabilities[]`. On error, it treats backend as Subsonic-only.

**AC-002**: `useCapability(cap)` hook returns `true` when connected to Selftify server that declares the capability, `false` otherwise.

**AC-003**: Online Search Config (MusicBrainz + YouTube) is configurable **even with no backend connected**. Fields persist in localStorage via Zustand.

**AC-004**: The "Add Source" form no longer shows MusicBrainz token or YouTube headers. These are exclusively configured in the "Online Search" card.

**AC-005**: The Search page's `hasOnlineSearch` logic reads from the global `OnlineSearchConfig` store, not from `currentOrigin.enableOnlineSearch`.

**AC-006**: Download button is disabled (with tooltip) when backend is Navidrome or no backend is connected.

**AC-007**: Lyrics panel shows "requires Selftify Server" message when backend lacks `lyrics-lrc` capability.

**AC-008**: "Local Library" card in Settings is hidden entirely when a backend connection is active.

**AC-009**: When migrating from old schema, `auth.store` auto-extracts `musicBrainzToken`, `youtubeMusicHeaders` etc. into `OnlineSearchConfig` and removes them from `Origin`.

**AC-010**: The "Selftify Server" config card (library root + scan) is shown only when the connected backend is a Selftify server.

---

## 9. Migration Path (Old → New)

### 9.1 Data Migration

```typescript
// In online-search.store.ts constructor / on app init
function migrateFromAuthStore() {
  const auth = useAuthStore.getState();
  const legacyOrigin = auth.origins.find(o =>
    o.musicBrainzToken || o.youtubeMusicHeaders
  );
  if (!legacyOrigin) return;

  const onlineSearch = useOnlineSearchStore.getState();
  onlineSearch.setEnabled(legacyOrigin.enableOnlineSearch ?? false);
  if (legacyOrigin.musicBrainzToken) {
    onlineSearch.updateMusicBrainz({
      musicBrainzToken: legacyOrigin.musicBrainzToken,
      musicBrainzClientId: legacyOrigin.musicBrainzClientId,
      musicBrainzClientSecret: legacyOrigin.musicBrainzClientSecret,
      musicBrainzRefreshToken: legacyOrigin.musicBrainzRefreshToken,
      musicBrainzTokenExpiresAt: legacyOrigin.musicBrainzTokenExpiresAt,
    });
  }
  if (legacyOrigin.youtubeMusicHeaders) {
    onlineSearch.setYoutubeHeaders(legacyOrigin.youtubeMusicHeaders);
  }
  if (legacyOrigin.downloadFolder) {
    onlineSearch.setDownloadFolder(legacyOrigin.downloadFolder);
  }

  // Clean up old Origin fields
  auth.origins.forEach(o => {
    auth.updateOrigin(o.id, {
      enableOnlineSearch: undefined,
      musicBrainzToken: undefined,
      musicBrainzClientId: undefined,
      musicBrainzClientSecret: undefined,
      musicBrainzRefreshToken: undefined,
      musicBrainzTokenExpiresAt: undefined,
      youtubeMusicHeaders: undefined,
    });
  });
}
```

### 9.2 Files Changed

| File | Change |
|:---|:---|
| `src/stores/auth.store.ts` | Remove MusicBrainz/YouTube fields from `Origin` + `migrateOrigin()` |
| `src/stores/online-search.store.ts` | **New** — Zustand persist for global online search config |
| `src/stores/backend.store.ts` | Add `capabilities[]` + `hasCapability()` |
| `src/api/controller.ts` | `getContext()` reads online-search from global store |
| `src/api/backend-detector.ts` | Store capabilities in backend store |
| `src/features/settings/settings-page.tsx` | Reorganize Servers tab into 3 cards |
| `src/features/settings/online-search-card.tsx` | **New** — extract from existing Add Source form |
| `src/features/settings/backend-connection-card.tsx` | **New** — extract from existing Server Config |
| `src/features/settings/origin-edit-dialog.tsx` | Remove MusicBrainz/YouTube fields |
| `src/features/search/search-page.tsx` | `hasOnlineSearch` → global store |
| `src/services/musicbrainz-client.ts` | `ensureValidToken()` → global store |
| `src/services/download-queue.ts` | Download folder → global store fallback |
| `src/types/domain-types.ts` | Simplify `Origin` type |
| `src/lib/build-navigation.ts` | Remove MusicBrainz/YouTube params from `buildLocalOrigin()` |

---

## 10. Edge Cases

| Scenario | Behavior |
|:---|:---|
| Backend URL saved but server offline | Probe fails → "Server unreachable" banner. Connect button shows. Stored config preserved. |
| Backend switches from Selftify to Navidrome | Re-probe on reconnect → capabilities update. Feature-gated UI elements hide. |
| No backend + local origins exist | "Local Library" card visible. Online Search card visible. Search page shows "local" + "musicbrainz" + "youtube" tabs. |
| YouTube search without headers | Search still works (unauthenticated, lower quality). Warning badge in UI. |
| MusicBrainz token expired | Auto-refresh (OAuth). If refresh fails → "Re-authenticate" prompt in Online Search card. Search still works (rate-limited, 1200ms). |
| User removes all origins | Same as "no backend" + "no origins". App shows welcome/setup screen. |
| Online search disabled | MusicBrainz + YouTube tabs hidden from search page. Download button hidden. |

---

## 11. Related Specifications

- `specs/migration-client-server.md` — Full migration plan (parent spec)
- `specs/origin-config-editor.md` — Origin edit dialog (deprecated fields removed)
- `specs/musicbrainz-search.md` — MusicBrainz search integration
- `specs/search-refactor.md` — Search page architecture
- `specs/download-queue.md` — Download system
- `specs/lyrics.md` — Lyrics system
- `specs/file-organizer.md` — File organizer
