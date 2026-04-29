# GPX Simulator (dev only)

Replays a recorded GPX track as if it were live GPS. Used for testing
location-aware features (friend-locations, navigation, etc.) without
having to physically move.

## How it works

This module installs a transparent override over `navigator.geolocation`.
The rest of the app (VueUse `useGeolocation`, broadcast composable,
anything else) keeps using the standard W3C API and gets either real GPS
or simulated points depending on whether the simulator is currently
playing.

When the simulator is **stopped**, all geolocation calls pass through
to real GPS. When it's **playing**, calls receive coordinates derived
from the loaded GPX track at the current playback position.

## How to use

1. Run the dev server (`bun run dev` in `web/`).
2. A small "GPX SIM" chip appears bottom-right. Click to expand.
3. Drop a `.gpx` file (or click "Open"). The track loads.
4. Hit play. The rest of the app sees simulated GPS.

Toggle via `Cmd+Shift+G` (Mac) / `Ctrl+Shift+G` (Win/Linux).

## How to record a GPX

Any tracker that produces standard GPX with `<trkpt>` elements works:

- **OsmAnd** (free, iOS/Android) — best raw GPS recorder
- **Strava** — records workouts, export as GPX from web
- **GPS Logger** (Android, free)
- **Gaia GPS**

Drop the exported `.gpx` into the panel.

## How to remove this feature

This module is fully decoupled from app logic. To remove it:

1. Delete this directory: `web/src/dev/gpx-simulator/`
2. Delete the conditional import in `web/src/main.ts` (search for
   `'@/dev/gpx-simulator'`).

That's it — no other touches needed.

## Files

- `gpx-parser.ts` — pure-function parser that extracts `<trkpt>` elements
  and synthesizes per-point speed + heading from successive samples.
- `simulator-store.ts` — playback state (load / play / pause / seek /
  rate / loop) with a tiny pub-sub. No Vue, no Pinia.
- `geolocation-override.ts` — installs the `navigator.geolocation`
  proxy. Forwards real GPS through when the simulator is stopped.
- `GpxSimulatorPanel.vue` — the floating UI. Independent Vue app —
  doesn't share component context with the main app.
- `index.ts` — `install()` entry point.
