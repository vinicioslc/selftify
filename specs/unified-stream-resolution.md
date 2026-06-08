# Unified Stream Resolution

## Problem

Atualmente, a resolucao de stream URL para playback esta espalhada em 5 componentes diferentes (album-page, search-page, home-page, playlist-detail-page, playlist-list-page), cada um com sua propria logica de `getStreamUrl()` + `setQueue()`. Nao ha um ponto central que decida qual fonte usar (local vs YouTube).

Quando uma musica tem `mbzRecordingId`, o sistema nunca verifica se ja existe um arquivo local indexado com o mesmo MBZ ID — vai direto para YouTube, mesmo que o audio ja esteja no disco.

## Solution

Criar um servico centralizado `resolveSong()` que:

1. Se `song.path` ja existe e e acessivel → retorna a musica como esta (fonte local)
2. Se `song.mbzRecordingId` existe → consulta `getSongByMbid()` no banco local
   - Se encontrou arquivo local → usa o path do arquivo local
   - Se nao encontrou → faz fallback para YouTube `getStreamUrl()`
3. A escolha do usuario no SongInfoDialog (local vs YouTube) e persistida no `MbzYtMapping` e respeitada pelo resolver

## Stream Resolution Flow

```
resolveSong(song)
  │
  ├─ song.path exists? ──> YES ──> return song (local)
  │
  ├─ song.mbzRecordingId? ──> NO ──> return song as-is
  │
  ├─ Check MbzYtMapping.selectedSource
  │   ├─ "local" AND localSongId exists
  │   │   └─ getSongById(localSongId) → use file path
  │   ├─ "youtube"
  │   │   └─ getStreamUrl(song) → YouTube
  │   └─ not set (no saved preference)
  │       ├─ getSongByMbid() → found?
  │       │   ├─ YES → auto-select local, save preference, return local path
  │       │   └─ NO  → getStreamUrl(song) → YouTube
  │
  └─ return Song with resolved path (or unchanged if nothing worked)
```

## Files Changed

| File | Change |
|------|--------|
| `src/services/stream-resolver.ts` | **Create** — `resolveSong()`, `resolveSongs()`, `findLocalCandidates()` |
| `src/services/search-cache.ts` | Modify — add `selectedSource`, `localSongId` to `MbzYtMapping` |
| `src/features/song-info/song-info-dialog.tsx` | Modify — add local candidates section above YouTube |
| `src/features/album/album-page.tsx` | Refactor — use `resolveSong()` / `resolveSongs()` |
| `src/features/search/search-page.tsx` | Refactor — use `resolveSong()` / `resolveSongs()` |
| `src/features/home/home-page.tsx` | Refactor — use `resolveSongs()` |
| `specs/unified-stream-resolution.api.md` | **Create** — API contracts |
| `specs/song-info-panel.md` | Update — local candidates |
| `specs/song-info-panel.api.md` | Update — new types |

## Behavior

- **Playlists** ja carregam musicas do banco local via `getSongByMbid()` — musicas ja vem com `path`. Nao precisam de `resolveSong()`.
- **LocalPage** so exibe arquivos locais — nao precisa de `resolveSong()`.
- **Album page, search page, home page** — usam `resolveSong()` / `resolveSongs()` em vez de `getStreamUrl()` direto.
- **SongInfoDialog** — exibe candidatos locais (arquivos no DB com mesmo `mbzRecordingId`) acima dos candidatos YouTube.
- **Selecao do usuario** — ao escolher um candidato local no SongInfoDialog, o `MbzYtMapping.selectedSource = "local"` e `localSongId` = id do song no DB.
