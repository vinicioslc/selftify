---
name: origin-enforcer
description: |
  Use when implementing a new feature, adding UI components, or extending API
  functionality to ensure the code follows the origin/strategy pattern. Checks
  that origin-specific logic is never called directly from UI code — always
  through the strategy or controller abstractions. Trigger keywords: feature,
  implement, add, create, origin, strategy, controller, server type, backend.
---

# Origin Enforcer — Strategy & Controller Pattern

This codebase supports multiple music server backends (called **origins**):

| Origin         | `ServerType`      | Strategy file                             | Controller file                               |
|----------------|-------------------|-------------------------------------------|-----------------------------------------------|
| Navidrome      | `navidrome`       | `navidrome-strategy.ts`                   | `navidrome-controller.ts`                     |
| Jellyfin       | `jellyfin`        | `jellyfin-strategy.ts`                    | `jellyfin-controller.ts`                      |
| Subsonic       | `subsonic`        | `subsonic-strategy.ts`                    | `subsonic-controller.ts`                      |
| YouTube Music  | `youtubeMusic`    | `youtubemusic-strategy.ts`                | `youtubemusic-controller.ts`                  |

There are **two abstraction layers** that prevent UI code from depending on any single origin:

---

## 1. API Layer — Controller Pattern

**File:** `src/renderer/api/controller.ts`  
**Contract:** `src/shared/types/domain-types.ts` → `ControllerEndpoint`

### Rule

Every data-fetching operation (list, detail, search, mutate) must be added to
`ControllerEndpoint` and implemented in **every** backend controller. The UI
**never** imports a backend controller directly — it calls the unified
`controller` object.

### How to add a new API feature

1. Add the method signature to `ControllerEndpoint` (in `shared/types/domain-types.ts`)
2. Add the corresponding signature to `InternalControllerEndpoint` (same file)
3. Implement the method in each backend controller:
   - `src/renderer/api/navidrome/navidrome-controller.ts`
   - `src/renderer/api/jellyfin/jellyfin-controller.ts`
   - `src/renderer/api/subsonic/subsonic-controller.ts`
   - `src/renderer/api/youtubemusic/youtubemusic-controller.ts`
4. Add the dispatch entry in `src/renderer/api/controller.ts` on the `controller` object
5. UI code calls `controller.yourMethod(args)` — never an origin-specific controller

### Example

```typescript
// ❌ WRONG — UI imports origin-specific code directly
import { NavidromeController } from '/@/renderer/api/navidrome/navidrome-controller';
const result = await NavidromeController.search(...);

// ✅ CORRECT — UI calls the unified controller
import { controller } from '/@/renderer/api/controller';
const result = await controller.search(...);
```

---

## 2. UI Layer — Strategy Pattern

**File:** `src/renderer/strategies/types.ts` → `UIStrategy` interface  
**Registry:** `src/renderer/strategies/registry.ts`  
**Hook:** `useUIStrategy()` from `src/renderer/strategies/strategy-provider.tsx`

### Rule

UI behavior that differs per origin (filter components, feature flags, display
options, ID resolution, search modes, etc.) must be added to the `UIStrategy`
interface and implemented in **every** origin strategy. Components use the
`useUIStrategy()` hook — never conditional logic based on `server.type`.

### How to add a new UI strategy feature

1. Add the property/method to `UIStrategy` interface in `strategies/types.ts`
2. Add a sensible default in `strategies/base-strategy.ts`
3. Override in each origin strategy:
   - `strategies/navidrome-strategy.ts`
   - `strategies/jellyfin-strategy.ts`
   - `strategies/subsonic-strategy.ts`
   - `strategies/youtubemusic-strategy.ts`
4. Register the factory in `strategies/registry.ts` (only needed for new origins)
5. UI code calls `strategy.yourProperty` or `strategy.yourMethod()` — never checks `server.type`

### Example

```typescript
// ❌ WRONG — UI branches on server type directly
function MyComponent() {
  const server = useCurrentServer();
  if (server.type === 'navidrome') return <NavidromeSpecificUI />;
  if (server.type === 'jellyfin') return <JellyfinSpecificUI />;
}

// ✅ CORRECT — UI delegates to the strategy
function MyComponent() {
  const strategy = useUIStrategy();
  const FilterComponent = strategy.filterComponentMap.album;
  return FilterComponent ? <FilterComponent /> : null;
}
```

---

## Enforcement Checklist

When implementing a feature, verify:

- [ ] Does this feature touch origin-specific logic?
- [ ] If **API** (data fetching): added to `ControllerEndpoint`, implemented in
      all 4 controllers, dispatched via `controller.ts`?
- [ ] If **UI** (behavior/display): added to `UIStrategy`, default in
      `base-strategy.ts`, implemented in all 4 strategies?
- [ ] Does any UI code import a backend controller or strategy directly? (If
      so, refactor to use `controller` or `useUIStrategy()`)
- [ ] Does any UI code branch on `server.type`? (If so, move the logic to the
      strategy)

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/shared/types/domain-types.ts` | `ServerType` enum, `ControllerEndpoint` contract |
| `src/renderer/api/controller.ts` | Unified API dispatcher |
| `src/renderer/strategies/types.ts` | `UIStrategy` interface |
| `src/renderer/strategies/base-strategy.ts` | Default strategy values |
| `src/renderer/strategies/registry.ts` | Maps `ServerType` → strategy factory |
| `src/renderer/strategies/strategy-provider.tsx` | React context + `useUIStrategy()` hook |
| `src/renderer/strategies/*-strategy.ts` | Per-origin strategy implementations |
| `src/renderer/api/*/*-controller.ts` | Per-origin controller implementations |
| `src/shared/api/*/*-normalize.ts` | Per-origin response normalization |
