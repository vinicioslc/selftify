# Scrobble Config — API & Data Spec

> **Scope**: Controller interface, store shape, data transformations, error handling
> **Audience**: Backend, state management
> **Depends on**: `scrobble-config.md`

---

## Types

### `src/types/domain-types.ts`

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

No existing types are modified. The `Origin` type remains unchanged.

---

## Store Slice

### `src/stores/settings.store.ts`

#### State Shape

```typescript
// New field added to SettingsState
scrobbleProviders: Record<string, ScrobbleProviderConfig>;
```

#### Default Value

```typescript
scrobbleProviders: {
  listenbrainz: { enabled: false, token: "" },
},
```

#### Actions

```typescript
setScrobbleProvider: (name: string, partial: Partial<ScrobbleProviderConfig>) => void;
```

#### Implementation

```typescript
setScrobbleProvider: (name, partial) =>
  set((state) => ({
    scrobbleProviders: {
      ...state.scrobbleProviders,
      [name]: { ...state.scrobbleProviders[name], ...partial },
    },
  })),
```

Follows the exact same pattern as `setArtworkProvider`.

#### Persistence

Automatically persisted via Zustand's `persist` middleware under the `ytmusic-settings` localStorage key. No custom `partialize` or `merge` needed — the field is included by default.

#### Migration

No migration script needed. If `scrobbleProviders` is absent from persisted state, Zustand's default value applies: `{ listenbrainz: { enabled: false, token: "" } }`.

---

## Selectors

No selectors are needed in this spec. The UI reads `scrobbleProviders` directly from the store and passes individual provider configs to the form component:

```typescript
const { scrobbleProviders, setScrobbleProvider } = useSettingsStore();
```

For a future `ScrobbleManager`, derived selectors could look like:

```typescript
// Future use — not implemented in this spec
const activeScrobbleProviders = useSettingsStore((s) =>
  Object.entries(s.scrobbleProviders)
    .filter(([, config]) => config.enabled && config.token.length > 0)
    .map(([name]) => name)
);
```

---

## Error Handling

| Error | Where | Handling |
|-------|-------|----------|
| Empty token with enabled=true | UI | Warning text below input, no HTTP call made |
| Token length > 0 | Store | Stored as-is, no validation |

This spec does NOT implement HTTP calls. Runtime errors (401, network failure) are handled by the future `ScrobbleManager`.

---

## Data Flow

```
User types token in Input
        │
        ▼
onChange / onBlur → setScrobbleProvider("listenbrainz", { token: value })
        │
        ▼
Zustand set() → updates state → persist middleware writes to localStorage
        │
        ▼
React re-render → Token input shows updated value
```

The toggle follows the same flow:

```
User flips Switch
        │
        ▼
onCheckedChange → setScrobbleProvider("listenbrainz", { enabled: boolean })
        │
        ▼
Zustand set() → persist → re-render
```

---

## Future Integration Points

### `ScrobbleManager` (not in this spec)

```typescript
// Proposed interface for future implementation
interface ScrobbleManager {
  getConfig(): Record<string, ScrobbleProviderConfig>;
  updateConfig(name: string, partial: Partial<ScrobbleProviderConfig>): void;
  isConfigured(name: string): boolean;
}
```

The manager would subscribe to `settings.store` changes and instantiate/destroy provider clients accordingly.

### Player Integration (not in this spec)

```typescript
// Proposed hook for future implementation
function useScrobble(song: Song | null): void {
  const scrobbleProviders = useSettingsStore((s) => s.scrobbleProviders);
  // Reads config, calls ScrobbleManager.scrobble() after threshold
}
```

### Recommendation Service (not in this spec)

```typescript
// Proposed endpoint consumption for future implementation
// GET https://api.listenbrainz.org/1/recommendations/
// Requires configured ListenBrainz token
```
