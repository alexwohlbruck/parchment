/**
 * GPX Simulator — dev-only entry point.
 *
 * Public surface:
 *   - `install()` — installs the `navigator.geolocation` override.
 *     MUST be called before any consumer subscribes (i.e. before
 *     `useGeolocationService()` runs in main.ts).
 *   - `simulatorStore` and `parseGpx` — re-exported for the UI host
 *     (currently the dev-only `Developer.vue` settings page).
 *
 * The UI is intentionally NOT mounted here. The settings page
 * imports the store and renders its own controls inline so the
 * simulator integrates with the rest of the settings UX.
 *
 * To remove this feature entirely:
 *   1. Delete `web/src/dev/gpx-simulator/`
 *   2. Delete `web/src/views/settings/pages/Developer.vue`
 *   3. Remove the `'developer'` entry from `settingsIndex.ts`
 *   4. Remove the `DEVELOPER` route in `web/src/router/index.ts`
 *   5. Remove the conditional install in `web/src/main.ts`
 *   6. (optional) remove `settings.developer.*` keys from `en-US.json`
 */

import { installGeolocationOverride } from './geolocation-override'

let installed = false

export function install(): void {
  if (installed) return
  installed = true
  installGeolocationOverride()
}

// Re-exports so the settings page only imports from one place.
export { simulatorStore } from './simulator-store'
export type { SimulatorState, Status } from './simulator-store'
export { parseGpx, trackDurationSec } from './gpx-parser'
export type { GpxPoint } from './gpx-parser'
