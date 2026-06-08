# UX/UI Spec: Player Module

> **Status**: draft
> **Last update**: 2026-06-04
> **Tipos**: `SongDTO` — ver `event-hooks.md:1`
> **Eventos**: `song:play`, `song:pause`, `song:resume`, `song:end`, `song:stop`, `playlist:next`, `playlist:previous`, `seek:changed`, `volume:changed` — ver `event-hooks.md:2`

## Visão Geral

O player tem duas superfícies: **Player Bar** (barra inferior fixa) e **Full-Screen Player** (tela cheia). Nenhuma delas chama `eventHooks` ou a player store diretamente — usam `usePlaybackEvents()` (ver `event-hooks.md:6`).

---

## 1. Player Bar

### Layout (Desktop)

```
┌────────────────────────────────────────────────────────────┐
│  ◄◄  ▶╲╱  ►►     [████████████░░░░░░░]   ♫ Visualizer      │
│  [cover] Nome da Música — Artista        1:23 / 3:45  🔁 🔀 │
│           Álbum • 2026                                      │
└────────────────────────────────────────────────────────────┘
```

### Layout (Mobile)

```
┌──────────────────────────────────┐
│  ◄◄  ▶╲╱  ►►                    │
│  ───────●────────────────────── │
│  🎵 Nome da Música         3:45 │
│  Artista                        │
└──────────────────────────────────┘
```

### Estados

#### Idle (nenhuma música)

```
┌────────────────────────────────────────────────────────────┐
│  ◄◄  ▶╲╱  ►►          [desabilitados]                      │
│         Nenhuma música selecionada                          │
└────────────────────────────────────────────────────────────┘
```

- Botões desabilitados (opacos, sem click)
- Cover: fallback cinza com ícone
- Texto: "Nenhuma música selecionada"
- Seek vazia, sem interação

#### Playing

```
┌────────────────────────────────────────────────────────────┐
│  ◄◄  ⏸  ►►  ████████████░░░░░░   ♫ Visualizer animado      │
│  [cover] Nome - Artista              1:23 / 3:45       🔁 🔀│
└────────────────────────────────────────────────────────────┘
```

- Cover 40×40 (desktop) / 32×32 (mobile), arredondada
- Nome/artista rolados (marquee) se overflow
- Seek animada com progresso
- Visualizer animando (se ativo)
- Botão central: ⏸

#### Paused

```
┌────────────────────────────────────────────────────────────┐
│  ◄◄  ▶  ►►  ████████████░░░░░░                            │
│  [cover] Nome - Artista              1:23 / 3:45       🔁 🔀│
└────────────────────────────────────────────────────────────┘
```

- Visualizer congelado
- Botão central: ▶
- Cover com 80% opacidade (feedback visual)

#### Buffering

```
┌────────────────────────────────────────────────────────────┐
│  ◄◄  ⏳  ►►  ░░░░░░░░░░░░░░░░                            │
│  [cover] Nome - Artista              0:00 / Carregando...   │
└────────────────────────────────────────────────────────────┘
```

- Botão central: spinner (Loader2)
- Seek sem progresso sólido
- Duration mostra "Carregando..."

---

## 2. Full-Screen Player

### Ativação
- Desktop: clique na cover ou no texto da player bar
- Mobile: swipe up na player bar

### Layout

```
┌───────────────────────────────────────┐
│                                       │
│            ┌───────────┐              │
│            │   Cover   │              │
│            │  (grande) │   ~50% da   │
│            │           │    altura    │
│            └───────────┘              │
│                                       │
│        Nome da Música                 │
│        Artista                        │
│                                       │
│      ◄◄      ▶╲╱      ►►            │
│                                       │
│      ───────────●───────────         │
│      1:23                   3:45     │
│                                       │
│      Volume: ────●────               │
│                                       │
│      [Visualizer (se ativo)]          │
└───────────────────────────────────────┘
```

### Estados

| Estado | Cover | Botão central | Visualizer |
|---|---|---|---|
| Playing | Normal | ⏸ | Animando |
| Paused | 80% opacity | ▶ | Congelado |
| Buffering | Normal | ⏳ spinner | Congelado |
| Idle | Fallback | ▶ desab. | Desligado |

---

## 3. Controles de Navegação

### ◄◄ Anterior

| Contexto | Comportamento | Evento emitido |
|---|---|---|
| Posição > 3s | Reseta seek para 0 | `seek:changed` |
| Posição ≤ 3s, existe anterior | Vai para anterior | `playlist:previous` → `song:play` |
| Posição ≤ 3s, não existe | Nada (desabilitado) | Nenhum |

### ►► Próximo

| Contexto | Comportamento | Evento emitido |
|---|---|---|
| Existe próxima na fila | Vai para próxima | `playlist:next` → `song:play` |
| Última, repeat=ALL | Volta ao início | `playlist:next` → `song:play` |
| Última, repeat=NONE | Nada (desabilitado) | Nenhum |

### ▶ / ⏸ Play / Pause

| Estado | Ação | Evento emitido |
|---|---|---|
| Stopped / Paused | Inicia / retoma | `song:play` / `song:resume` |
| Playing | Pausa | `song:pause` |
| Buffering | Desabilitado | Nenhum |

---

## 4. Desabilitação dos Botões

A lógica de habilitação/desabilitação é unificada no hook `useCanNavigate()`:

```typescript
// src/hooks/use-can-navigate.ts
function useCanNavigate(): { canGoNext: boolean; canGoPrevious: boolean }
```

O hook consulta:
- Se `playlist.isActive === true`: valores vêm da playlist store
- Se `playlist.isActive === false`: valores vêm da player store (queue, repeat, currentIndex)

A player bar e o full-screen player usam esse hook, nunca a playlist store diretamente.

### Tabela de estados

| Estado | Próximo | Anterior |
|---|---|---|
| Fila vazia | ❌ | ❌ |
| Playlist ativa, meio | ✅ | ✅ |
| Playlist ativa, última | ❌ | ✅ |
| Avulso, repeat ALL | ✅ | ✅ |
| Avulso, repeat NONE, última | ❌ | ✅ |
| Avulso, repeat NONE, primeira, pos ≤ 3s | ✅ | ❌ |

---

## 5. Responsivo

| Breakpoint | Player Bar | Full-Screen |
|---|---|---|
| ≥ 768px | 90px altura, seek no topo | Cover ~50%, layout vertical |
| < 768px | 72px altura, seek inline | Cover ~40%, swipe down fecha |

---

## 6. Regras de Experiência

1. **Autoplay**: próxima música inicia automaticamente se houver próxima na fila ou repeat=ALL
2. **Pausa persistente**: posição preservada mesmo após horas
3. **Teclas de atalho** (desktop): `Space` (play/pause), `←` (anterior), `→` (próximo), `↑` (vol+), `↓` (vol-)
4. **Playlist ativa**: botões refletem playlist, não fila interna
5. **Visualizer**: anima só no estado PLAYING; congela no PAUSED; desliga no STOPPED
6. **Crossfade**: (futuro) fade 3s ao trocar de track
