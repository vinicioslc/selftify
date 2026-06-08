# UX/UI Spec: Playlist Module

> **Status**: draft
> **Last update**: 2026-06-04
> **Tipos**: `SongDTO` — ver `event-hooks.md:1`
> **Eventos escutados**: `playlist:next`, `playlist:previous` — ver `event-hooks.md:2`
> **Eventos emitidos**: ver tabela em `event-hooks.md:5`

## Visão Geral

A playlist gerencia uma lista ordenada de músicas. Escuta eventos do barramento central para manter a fila sincronizada com a navegação. Não chama `eventHooks` diretamente — a inscrição é feita num `useEffect` no componente de playlist.

---

## 1. Store

```typescript
// src/stores/playlist.store.ts

type PlaylistState = {
  songs: SongDTO[];         // músicas da playlist atual
  currentIndex: number;      // índice da música tocando
  isActive: boolean;         // true = modo playlist, false = fila avulsa
  name: string | null;       // nome da playlist

  canGoNext: boolean;        // derivado de currentIndex < songs.length - 1
  canGoPrevious: boolean;    // derivado de currentIndex > 0
};
```

### Ações

| Ação | Comportamento |
|---|---|
| `loadPlaylist(songs, name?)` | Substitui lista, ativa, zera índice |
| `playSongAt(index)` | Define `currentIndex`, recalcula navegação |
| `addToEnd(song)` | Adiciona ao final de `songs` |
| `removeSong(index)` | Remove, ajusta `currentIndex` se necessário |
| `reorder(from, to)` | Move música dentro da lista |
| `clearPlaylist()` | Limpa tudo, `isActive = false` |
| `unload()` | Apenas `isActive = false`, mantém dados |

### Persistência

A store usa `persist` do Zustand (localStorage) para manter as playlists entre sessões. O schema inclui `version` para migração futura.

---

## 2. Inscrição em Eventos

A inscrição é feita no componente de playlist (ex: `PlaylistPage`) via `useEffect`:

```typescript
useEffect(() => {
  const unsubNext = eventHooks.on("playlist:next", ({ currentSong }) => {
    const { isActive } = usePlaylistStore.getState();
    if (isActive && currentSong) {
      usePlaylistStore.getState().addToEnd(currentSong);
    }
  });

  const unsubPrev = eventHooks.on("playlist:previous", ({ currentSong }) => {
    const { isActive } = usePlaylistStore.getState();
    if (isActive && currentSong) {
      usePlaylistStore.getState().addToEnd(currentSong);
    }
  });

  return () => { unsubNext(); unsubPrev(); };
}, []);
```

### Comportamento

- `playlist:next` e `playlist:previous`: se `isActive`, adiciona `currentSong` ao **fim** da lista
- Efeito: repeat-all natural — a música tocada vai pro fim, a playlist nunca acaba
- Se `currentSong` é `null` (fila vazia), nada é adicionado
- Se `isActive = false`, os eventos são ignorados

---

## 3. Ativação / Desativação

```
"Play All" em uma playlist salva
  → loadPlaylist(songs, "Minha Playlist")
  → isActive = true
  → playSongAt(0)
  → player.store.setQueue(songs) — inicia na primeira música

Tocar música avulsa (fora da playlist)
  → unload() — isActive = false
  → player.store funciona com fila interna
  → canGoNext/Previous vêm da player store
```

---

## 4. Navegação — `useCanNavigate`

A player bar e o full-screen player usam `useCanNavigate()` (ver `player.ui.md:4`), não a playlist store diretamente. Esse hook unifica as duas fontes:

```
canGoNext =
  playlist.isActive
    ? playlist.canGoNext
    : (repeat === ALL || queueIndex < queue.length - 1)

canGoPrevious =
  playlist.isActive
    ? playlist.canGoPrevious
    : queue.length > 0
```

---

## 5. Estados da Interface

### Playlist vazia

```
┌─────────────────────────────────────┐
│  Playlist                              │
│                                        │
│     Sua playlist está vazia            │
│     Adicione músicas para começar      │
│                                        │
│  [ Adicionar músicas ]                │
└─────────────────────────────────────┘
```

### Playlist com músicas

```
┌──────────────────────────────────────────┐
│  Minha Playlist (12 músicas)               │
│  [▶ Play All] [🔀 Shuffle]                │
│──────────────────────────────────────────│
│  1.  Música A          Artista       3:45 │
│  2.  Música B          Artista       4:20 │
│  3. ▶ Música C (tocando)  Artista    5:10 │
│  4.  Música D          Artista       3:30 │
│  ...                                       │
└──────────────────────────────────────────┘
```

- Música tocando destacada com ▶
- Clique em música → `playSongAt(index)` + `setQueue`
- Botão "Play All" oculto se lista vazia

---

## 6. Interações

| Ação | Comportamento |
|---|---|
| Clicar música | `playSongAt(index)` + `setQueue` no player |
| Play All | `loadPlaylist(songs)` + `playSongAt(0)` + `setQueue(songs)` |
| Próximo (player bar) | `playlist:next` emitido → playlist addToEnd |
| Arrastar reordenar | `reorder(from, to)` |
| Swipe remover (mobile) | `removeSong(index)` |
| Sair da playlist | `unload()` — player continua tocando |

---

## 7. Edge Cases

| Cenário | Comportamento |
|---|---|
| 1 música | `canGoNext = false`, `canGoPrevious = false` |
| Remover música tocando | `currentIndex` ajustado; se única, `clearPlaylist()` |
| 0 músicas | Estado vazio, "Play All" oculto |
| Música atual removida da lista | `currentIndex` aponta para a seguinte; se não houver, desativa |
