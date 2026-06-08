# Spec: Crossfade / Transition Mixing

> **Status**: proposed
> **Created**: 2026-06-04
> **Target**: `selftify` — smooth audio transitions between tracks with configurable overlap

---

## Problem

When the user plays a new track (manually or via `next()`), the current audio is **hard-stopped** immediately — the old track cuts off abruptly and the new track starts after a loading delay. This creates a jarring listening experience, especially for:

1. **Sequential album playback** — tracks meant to flow together are interrupted
2. **Playlist listening** — silence gaps between songs
3. **Electronic / ambient / classical genres** — where smooth transitions are expected

The settings store already has `crossfadeEnabled` (boolean) and `crossfadeDuration` (number, seconds) properties, but they are **not wired** to any audio logic.

---

## Solution

### Core Behavior

When **transition mixing** is enabled, instead of hard-stopping the outgoing track:

1. **Phase 1 — Fade-out** : The outgoing track's volume smoothly ramps from its current level to zero over `crossfadeDuration` seconds.
2. **Phase 2 — Overlap** : While the outgoing track is fading out, the incoming track begins loading. Once ready, it starts playing at volume 0 and ramps up to the user's target volume, also over `crossfadeDuration` seconds.
3. **Phase 3 — Cleanup**: After `crossfadeDuration` elapses, the outgoing audio element is paused and its `src` is cleared to free resources.

If **transition mixing is disabled**, the existing hard-stop behavior is preserved.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Crossfade disabled | Hard-stop (current behavior) |
| Crossfade duration = 0 | Effectively hard-stop (instant ramp) |
| User pauses during crossfade | Both tracks pause immediately |
| User seeks during crossfade | Abort crossfade, hard-switch to new position |
| Same track resumed (pause→play) | No crossfade — just resume |
| Mixed types (local ↔ stream) | Crossfade works across types (separate Audio elements) |
| Crossfade into same-type (stream→stream) | Two stream elements active simultaneously |
| Track finishes naturally (ended) | Crossfade into next track |
| User clicks new track while crossfading in progress | Abort current crossfade, start new crossfade |

---

## Architecture

### Audio Engine Changes

The existing `audio-engine.ts` already has an `AudioContext` pipeline. We add a **controllable GainNode** that the audio provider can schedule fades on.

```
┌──────────────────────────────────────────────────────────────┐
│                    Audio Pipeline (local files)               │
│                                                              │
│  HTMLAudioElement ──► createMediaElementSource ──► GainNode │
│                                                       │      │
│                                                       ▼      │
│                                              AnalyserNode    │
│                                                       │      │
│                                                       ▼      │
│                                              audioCtx.destination │
└──────────────────────────────────────────────────────────────┘
```

For **stream files** (YouTube, no AudioContext), volume fading is done by manually interpolating `HTMLAudioElement.volume` using `requestAnimationFrame`.

### Provider Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   browser-audio-provider.tsx                  │
│                                                              │
│  audioRef (local)      streamAudioRef (stream/current)       │
│  audioNextRef (local)  streamAudioNextRef (stream/next)      │
│                                                              │
│  CrossfadeController                                         │
│  ├─ startCrossfade(oldEl, newEl, duration)                   │
│  │  ├─ rampDown(oldEl, duration)                             │
│  │  └─ rampUp(newEl, duration)                               │
│  └─ abortCrossfade()                                         │
└──────────────────────────────────────────────────────────────┘
```

### IPC / mpv Provider

`ipc-audio-provider.tsx` can use mpv's native crossfade via `mpv --audiofile-gain` or by controlling volume during transition. Since mpv already gapless-plays consecutive files, crossfade there is less critical but still supported via IPC volume commands.

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/audio-engine.ts` | Add `gainNode` for fade control; expose `startFadeIn(duration, targetGain)` and `startFadeOut(duration)` |
| `src/features/player/browser-audio-provider.tsx` | Add `audioNextRef`, `streamAudioNextRef`; implement crossfade logic in track-load effect |
| `src/features/player/ipc-audio-provider.tsx` | Add crossfade via mpv IPC volume control |
| `src/features/settings/settings-page.tsx` | Already has UI — wire `transitionMixing` toggle (renamed from `crossfadeEnabled` for clarity) |
| `src/stores/settings.store.ts` | Add `transitionMixingEnabled` alongside existing `crossfadeEnabled`/`crossfadeDuration` |

---

## Data Flow

```
User clicks song B
       │
       ▼
player.store.setQueue([B], { type: "now" })
       │
       ├── currentTrack = B
       ├── status = PLAYING
       │
       ▼
browser-audio-provider: currentTrack?.id changed
       │
       ├── crossfadeEnabled? ──NO──► Hard-stop (pause A, clear src, load B)
       │                              (existing behavior)
       │
       ├── YES
       │
       ├── 1. Store ref to old audio element (element A)
       ├── 2. Start fade-out on element A: volume → 0 over duration
       ├── 3. Start loading track B on next element (async)
       ├── 4. When element B ready:
       │       ├── Set volume = 0
       │       ├── Play element B
       │       └── Start fade-in: volume → userVolume over duration
       ├── 5. After duration:
       │       ├── Pause element A
       │       ├── Clear src on element A
       │       └── Swap refs (next → current)
       │
       ▼
    Audio playing B smoothly
```

---

## Testing

| Test | Description |
|------|-------------|
| Crossfade disabled → hard-stop | Old track stops immediately |
| Crossfade enabled → smooth transition | Volume ramps over duration |
| Duration = 0 → instant switch | Behaves like hard-stop |
| Pause during crossfade | Both tracks pause |
| New track clicked during crossfade | Abort and restart |
| Same-type transition (stream→stream) | Two elements active |
| Mixed-type (local→stream) | Fade-out local, fade-in stream |
