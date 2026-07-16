import type { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { api } from '@/lib/api'

/**
 * Feeds the Environment vector layers (declared as default-layer templates that
 * render/toggle natively). No overlay is fetched per-frame:
 *
 * - Perimeters + smoke are small national datasets → pulled WHOLE, once, +timer.
 * - Fire hotspots can't be fetched globally (FIRMS caps area requests and the
 *   count explodes), so they're fetched by a PADDED viewport, and only when the
 *   view leaves the last fetched area — and we never clear on an empty/failed
 *   response, so panning keeps the last dots (this was the disappearing bug).
 *
 * Air quality is a raster tile layer and needs nothing here.
 */

const WHOLE_WORLD_BBOX = '-180,-85,180,85'
const REFRESH_MS = 10 * 60 * 1000
const FIRE_DEBOUNCE_MS = 600
const FIRE_DAYS = 2 // day-1 NRT is often incomplete; 2 gives recent + full

const WHOLE_DATASET = [
  { sourceId: 'env-fire-perimeters', endpoint: '/environment/wildfire/perimeters' },
  { sourceId: 'env-smoke', endpoint: '/environment/wildfire/smoke' },
] as const

type Box = { w: number; s: number; e: number; n: number }

export function useEnvironmentDataService() {
  let strategy: MapStrategy | null = null
  let map: any = null
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  let fireDebounce: ReturnType<typeof setTimeout> | null = null
  let lastFireBox: Box | null = null
  let started = false

  async function refreshWholeDatasets() {
    if (!map) return
    for (const { sourceId, endpoint } of WHOLE_DATASET) {
      const source = map.getSource(sourceId)
      if (!source) continue
      try {
        const res = await api.get(endpoint, {
          params: { bbox: WHOLE_WORLD_BBOX },
          silent: true,
        } as any)
        if (res?.data) source.setData(res.data)
      } catch {
        /* keep last-good */
      }
    }
  }

  async function refreshFire(force = false) {
    if (!map || !strategy) return
    const source = map.getSource('env-fire-hotspots')
    if (!source) return
    const b = strategy.getBounds()
    if (!b) return
    // Skip if the current view is still inside the last fetched (padded) area.
    if (
      !force &&
      lastFireBox &&
      b.west >= lastFireBox.w &&
      b.south >= lastFireBox.s &&
      b.east <= lastFireBox.e &&
      b.north <= lastFireBox.n
    ) {
      return
    }
    const padX = Math.abs(b.east - b.west) * 0.4
    const padY = Math.abs(b.north - b.south) * 0.4
    // Clamp to valid lon/lat — globe view can report out-of-range bounds, and
    // FIRMS returns nothing for a bbox outside [-180,180] / [-85,85].
    const box: Box = {
      w: Math.max(-180, b.west - padX),
      s: Math.max(-85, b.south - padY),
      e: Math.min(180, b.east + padX),
      n: Math.min(85, b.north + padY),
    }
    try {
      const res = await api.get('/environment/wildfire/hotspots', {
        params: { bbox: `${box.w},${box.s},${box.e},${box.n}`, days: FIRE_DAYS },
        silent: true,
      } as any)
      const fc = res?.data
      if (fc?.features?.length) {
        source.setData(fc)
        lastFireBox = box
      }
    } catch {
      /* keep last-good dots */
    }
  }

  function onMoveEnd() {
    if (fireDebounce) clearTimeout(fireDebounce)
    fireDebounce = setTimeout(() => refreshFire(false), FIRE_DEBOUNCE_MS)
  }

  function initializeEnvironmentData(mapStrategy: MapStrategy) {
    if (!mapStrategy?.mapInstance) return
    strategy = mapStrategy
    map = mapStrategy.mapInstance
    // Re-fill after every style/theme swap (geojson sources are re-created).
    lastFireBox = null
    refreshWholeDatasets()
    refreshFire(true)
    if (started) return
    started = true
    refreshTimer = setInterval(() => {
      refreshWholeDatasets()
      refreshFire(true)
    }, REFRESH_MS)
    map.on('moveend', onMoveEnd)
  }

  return { initializeEnvironmentData }
}
