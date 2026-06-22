# Scrobble Config — Independent Token Management for ListenBrainz

> **Scope**: General / Technical Spec
> **Status**: Draft
> **Depends on**: None (greenfield)
> **Derived specs**: `scrobble-config.ui.md`, `scrobble-config.api.md`

---

## Problem Statement

The application currently has **no scrobbling capability**. There is no way to submit track plays to an external service like ListenBrainz or Last.fm. The only references to scrobbling are:

- A roadmap item in `AGENTS.md`: *"Scrobbling: Last.fm / ListenBrainz support"*
- A throwaway note in `specs/musicbrainz-search.md`: *"ListenBrainz scrobbling: Submit plays using MBIDs"*

To add ListenBrainz support, a user must be able to:

1. **Configure** their ListenBrainz API token somewhere in the Settings UI.
2. **Enable/disable** scrobbling without losing their token.
3. **Store** the token persistently (survives page reloads).

### Why not store the token inside `Origin`?

Existing service credentials (`musicBrainzToken`, `youtubeMusicHeaders`) live inside the `Origin` type because they are **source-specific** — they relate to how a particular music source operates. Scrobbling is different:

- A scrobble happens no matter which origin the track came from (local file, YouTube, etc.).
- The same ListenBrainz token applies globally across all origins.
- Future providers (Last.fm, etc.) are also global.

Therefore the token should be stored as **global application settings**, not per-origin.

---

## Architecture

The existing `settings.store.ts` already has patterns for global provider configuration. The `artworkProviders` field is a `Record<string, ArtworkProviderSetting>` where each entry has `enabled` and `paceMs` — toggled on/off individually in the Settings UI.

Scrobble config will follow the **same pattern**: a map of provider name → config object with `enabled` + `token`.

```
┌──────────────────────────────────────────────┐
│          settings.store (Zustand + persist)    │
│  ┌──────────────────────────────────────────┐ │
│  │  scrobbleProviders: Record<string,       │ │
│  │    { enabled: boolean, token: string }    │ │
│  │  setScrobbleProvider(name, partial)       │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │  artworkProviders: Record<string, ...>   │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌──────────────────┐    ┌──────────────────────────┐
│ Scrobbling tab    │    │ ScrobbleManager (future) │
│ (Settings UI)     │    │ reads config, calls API  │
└──────────────────┘    └──────────────────────────┘
```

---

## Type Changes

### `src/types/domain-types.ts` — New enums and types

```typescript
export enum ScrobbleProviderType {
  LISTENBRAINZ = "listenbrainz",
}

export type ScrobbleProviderConfig = {
  enabled: boolean;
  token: string;
};
```

No existing types change. The `Origin` type stays untouched.

---

## Store Changes

### `src/stores/settings.store.ts`

**New state field:**

```typescript
scrobbleProviders: Record<string, ScrobbleProviderConfig>;
```

Default value:

```typescript
{
  listenbrainz: { enabled: false, token: "" },
}
```

**New action:**

```typescript
setScrobbleProvider: (name: string, partial: Partial<ScrobbleProviderConfig>) => void;
```

Implementation — identical pattern to `setArtworkProvider`:

```typescript
setScrobbleProvider: (name, partial) =>
  set((state) => ({
    scrobbleProviders: {
      ...state.scrobbleProviders,
      [name]: { ...state.scrobbleProviders[name], ...partial },
    },
  })),
```

The existing `persist` middleware automatically saves/loads `scrobbleProviders` via the `ytmusic-settings` localStorage key. No migration needed — if the key is absent on load, Zustand falls back to the default value.

---

## UI Changes

### New tab "Scrobbling" in `settings-page.tsx`

| Location | Change |
|----------|--------|
| `TabsList` | Add `<TabsTrigger value="scrobbling">Scrobbling</TabsTrigger>` |
| `TabsContent` section | Add `<TabsContent value="scrobbling">` containing card |

**Card content:**

- **Provider card** for ListenBrainz:
  - Toggle switch (enabled/disabled)
  - Token input field (type `password` or plain text)
  - Help text: *"Your ListenBrainz API token. Get it at <https://listenbrainz.org/profile/>"*
  - Link/button to open the profile page
  - Status indicator: shows "Connected" (token present) or "Not configured" (token empty)

### New component `scrobbling-settings-form.tsx` (recommended)

Keeps the settings page clean. Receives `scrobbleProviders` + `setScrobbleProvider` as props.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Token is empty, scrobbling enabled | Warning: "Token required — scrobbling will not work until a token is provided." The manager should skip empty-token providers silently. |
| Token saved, then cleared | Provider becomes "not configured" again. |
| Invalid/revoked token | Detected at runtime by the future `ScrobbleManager` (HTTP 401). |
| Multiple providers (future Last.fm) | UI iterates over `Object.entries(scrobbleProviders)` and renders a card per provider, same pattern as artwork providers. |
| Store migration (adding/removing providers) | Zustand `persist` merge strategy handles absent keys gracefully. If a provider key is missing from persisted state, it gets the default. |

---

## Non-Goals (explicitly out of scope)

1. **HTTP calls to ListenBrainz API** — `POST /1/submit-listens`, `GET /1/recommendations/` — not part of this spec.
2. **Recommendations UI** — generating or displaying recommendations from ListenBrainz.
3. **`ScrobbleManager` service** — the runtime engine that reads config and calls the API.
4. **Integration with the player** — hooking `scrobble()` into playback lifecycle (done in a follow-up).
5. **Last.fm or other scrobble providers** — only ListenBrainz in this spec. The architecture is extensible for future providers.
6. **MusicBrainz OAuth token migration** — existing `musicBrainzToken` stays inside `Origin`; no changes.

---

## Future Considerations

- **Last.fm support**: Add `lastfm: { enabled: false, token: "" }` to the default `scrobbleProviders`. Last.fm uses a session key rather than a simple token — the `ScrobbleProviderConfig` type may need a `sessionKey` or `username` field, or we version the config shape per provider.
- **Scrobble rules**: Some users may want to scrobble only from certain origins, or only tracks with a minimum duration. This could be a follow-up filter layer.
- **Offline queue**: If the app is offline, scrobbles could be queued locally and submitted when connectivity is restored.

---

## Files Changed Summary

| File | Change Type | What |
|------|-------------|------|
| `src/types/domain-types.ts` | **Edit** | Add `ScrobbleProviderType` enum, `ScrobbleProviderConfig` type |
| `src/stores/settings.store.ts` | **Edit** | Add `scrobbleProviders` state + `setScrobbleProvider` action + import |
| `src/features/settings/settings-page.tsx` | **Edit** | Add `scrobbling` tab trigger + tab content card |
| `src/features/settings/scrobbling-settings-form.tsx` | **Create** | Form component for scrobble provider config |

### Line-level details

#### `src/types/domain-types.ts`

Insert after `Origin` type definition:

```typescript
// ── Scrobble providers ──

export enum ScrobbleProviderType {
  LISTENBRAINZ = "listenbrainz",
}

export type ScrobbleProviderConfig = {
  enabled: boolean;
  token: string;
};
```

#### `src/stores/settings.store.ts`

1. Import `ScrobbleProviderConfig` from types (add to existing import line or add a new one).
2. After `artworkProviders` in the state interface, add:

```typescript
scrobbleProviders: Record<string, ScrobbleProviderConfig>;
```

1. After `setArtworkProvider` in the state interface, add:

```typescript
setScrobbleProvider: (name: string, partial: Partial<ScrobbleProviderConfig>) => void;
```

1. In the default state object, after `artworkProviders: { ...DEFAULT_ARTWORK_PROVIDERS },` add:

```typescript
scrobbleProviders: { listenbrainz: { enabled: false, token: "" } },
```

1. After `setArtworkProvider` action implementation, add:

```typescript
setScrobbleProvider: (name, partial) =>
  set((state) => ({
    scrobbleProviders: {
      ...state.scrobbleProviders,
      [name]: { ...state.scrobbleProviders[name], ...partial },
    },
  })),
```

#### `src/features/settings/settings-page.tsx`

1. Import `ScrobbleProviderConfig` if needed (handled through the store type).
2. Destructure `scrobbleProviders` and `setScrobbleProvider` from `useSettingsStore()`.
3. In `TabsList`, add `<TabsTrigger value="scrobbling">Scrobbling</TabsTrigger>` (order: after "Ranking", before "Artwork").
4. In the `TabsContent` section, add a new block for `value="scrobbling"`.

#### `src/features/settings/scrobbling-settings-form.tsx`

New component. See [UI spec](scrobble-config.ui.md) for full layout.
