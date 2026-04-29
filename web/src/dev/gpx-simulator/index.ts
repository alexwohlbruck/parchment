/**
 * GPX Simulator — dev-only entry point.
 *
 * Public surface: a single `install()` function. The main app boots
 * this conditionally on `import.meta.env.DEV`, top-level-awaited so
 * the geolocation override is in place before any consumer subscribes.
 *
 * To remove this feature entirely:
 *   1. Delete `web/src/dev/gpx-simulator/`
 *   2. Delete the conditional install in `web/src/main.ts`
 *
 * Nothing else in the app references this module.
 */

import { createApp } from 'vue'
import { installGeolocationOverride } from './geolocation-override'
import GpxSimulatorPanel from './GpxSimulatorPanel.vue'

let installed = false

export function install(): void {
  if (installed) return
  installed = true

  // Step 1: install the navigator.geolocation override BEFORE the
  // panel mounts. The panel doesn't depend on it, but the rest of the
  // app might already be racing to subscribe — better to be ready.
  installGeolocationOverride()

  // Step 2: mount the panel as its own Vue app. Separate root keeps
  // it independent of the main app's component context (no shared
  // i18n, router, or stores), which is what makes deletion clean.
  const host = document.createElement('div')
  host.id = 'gpx-simulator-host'
  document.body.appendChild(host)
  createApp(GpxSimulatorPanel).mount(host)
}
