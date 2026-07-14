# Resume Playback on Reload

## Problem

The player store (`src/stores/player.store.ts`) has no persistence. On a page
reload the whole player state is lost: the current song, the queue, the volume
and the playback position all reset. The user must find the song again and
restart it from the beginning.

Goal: after a reload, restore the previous session so the player bar shows the
last song at the position where it stopped, and pressing play continues from
there.

## Behavior

- Persist: `currentTrack`, `queue`, `originalQueue`, `volume`, `repeat`,
  `shuffle`, `duration`, and a saved position `resumeMs`.
- Do **NOT** auto-play on reload (browser autoplay policy requires a user
  gesture). The restored session is `PAUSED` with the progress bar at
  `resumeMs`. Pressing play continues from that position.
- On reload, the provider seeks the audio element to `resumeMs` once the track
  is loaded, then clears the pending-resume flag.
- The saved position is updated throttled (~2.5s) during playback, immediately
  on `pause`, and flushed on `visibilitychange`/`beforeunload`.

## State changes (`player.store.ts`)

Add persisted fields:

- `resumeMs: number` — position (ms) to restore.
- `pendingResume: boolean` — true when a restored position must be applied on
  the next track load.

Persist via `persist` middleware (`name: "ytmusic-player"`) with `partialize`
to store only the data above, and a `merge` that forces `status: PAUSED`,
`positionMs: resumeMs`, `isBuffering: false`, `transitionProgress: 0`, and
`pendingResume: resumeMs > 0` after rehydration.

Actions touched:

- `pause()` also sets `resumeMs = positionMs`.
- `setResumeMs(ms)` sets `resumeMs` (throttled by the caller).
- `next/previous/setQueue/addToQueue/setCurrentTrack/clearQueue/stop` reset
  `resumeMs = 0` and `pendingResume = false` (fresh track).

## Provider changes

`browser-audio-provider.tsx` and `ipc-audio-provider.tsx`:

- In the load effect, after the track is loaded/ready, if `pendingResume` and
  `resumeMs > 0`, seek to `resumeMs` and clear `pendingResume`.
- In the progress handler (timeupdate / poll), throttle writing `resumeMs`
  every ~2.5s via `setResumeMs`.
- Add a `visibilitychange` + `beforeunload` listener that flushes
  `setResumeMs(positionMs)`.

## Edge cases

- No previous session (`resumeMs === 0`): behavior unchanged, starts empty.
- Streams with no CORS: resume still works because seeking is applied to the
  standalone `<audio>` element after metadata load.
- `stop()` / `clearQueue()`: clears persisted position so a fresh session
  doesn't resume a dead track.
- Corrupted persisted state: `merge` guards with `?? 0` defaults.
