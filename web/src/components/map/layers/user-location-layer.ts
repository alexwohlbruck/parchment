/**
 * User Location Marker Layer
 *
 * The blue dot showing the user's own position. Uses the same
 * receiver-side dead-reckoning pipeline as the friend-locations layer
 * (same `Track`/`predict` helpers in `@/lib/movement-interpolation`)
 * so the dot glides smoothly between geolocation samples instead of
 * teleporting on every `watchPosition` callback.
 *
 * Single-marker variant — one `Track`, not a Map.
 */

import { watch, type WatchStopHandle } from 'vue'
import {
  BaseMarkerLayer,
  type MapMarkerAPI,
  type MarkerData,
} from './base-marker-layer'
import { useGeolocationService } from '@/services/geolocation.service'
import {
  buildTrack,
  predict,
  type Track,
} from '@/lib/movement-interpolation'
import {
  register as registerTick,
  requestTick,
  type Tick,
} from '@/lib/animation-scheduler'
import UserLocationMarker from '@/components/map/UserLocationMarker.vue'

const MARKER_ID = 'self'

// See friend-locations-layer.ts for the rationale on this threshold.
const POSITION_EPSILON_DEG = 0.0000005

export class UserLocationLayer extends BaseMarkerLayer {
  private geolocation = useGeolocationService()

  private track: Track | null = null
  private unregisterTick: (() => void) | null = null
  private samplesWatchStop: WatchStopHandle | null = null

  /**
   * Last position pushed to maplibre. Lets the scheduler tick skip
   * `setMarkerLngLat` when the prediction hasn't moved — same dedup
   * pattern as the friend layer.
   */
  private lastRendered: { lat: number; lng: number } | null = null

  /**
   * Hash of the "stable" props the marker was last created with.
   * Skipping recreates on position-only changes is what keeps the dot
   * from flashing back to the raw sample position on every coord
   * update — same pattern as the friend layer.
   */
  private lastSnapshot: string | null = null

  constructor() {
    super({
      idPrefix: 'user-location-',
      component: UserLocationMarker,
      zIndex: 0, // Below friend markers
    })
  }

  initialize(mapAPI: MapMarkerAPI) {
    super.initialize(mapAPI)
    this.startSampleWatcher()
    this.unregisterTick = registerTick(this.tick)
  }

  protected getData(): MarkerData[] {
    const lngLat = this.geolocation.lngLat.value
    if (!lngLat) return []

    return [
      {
        id: MARKER_ID,
        lngLat,
        props: {
          accuracy: this.geolocation.accuracy.value,
          heading: this.geolocation.heading.value,
          mode: 'dot',
        },
      },
    ]
  }

  /**
   * Watch the raw geolocation `coords` for new samples. We can't use
   * the layer's data watcher for this — that fires on every prop
   * change including the per-frame setMarkerLngLat artifacts. The raw
   * `coords` ref only updates when the browser delivers a new
   * watchPosition callback, which is exactly the cadence we want.
   */
  private startSampleWatcher() {
    const coords = this.geolocation.coords
    this.samplesWatchStop = watch(
      () => {
        const c = coords.value
        if (c.latitude === Infinity || c.longitude === Infinity) return null
        return {
          lat: c.latitude,
          lng: c.longitude,
          speed: c.speed ?? null,
          heading: c.heading ?? null,
          // Browser-provided GeolocationPosition timestamp comes via the
          // VueUse-managed callback. Use Date.now() as a proxy — the
          // user location samples don't carry their own wall-clock
          // tag through the VueUse `coords` ref.
          timestampMs: Date.now(),
        }
      },
      (sample) => {
        if (!sample) return
        const now = Date.now()
        const previous = this.track
        if (previous && previous.toSampleTimestamp === sample.timestampMs) return

        const currentRendered = previous ? predict(previous, now) : null
        this.track = buildTrack({
          currentRendered,
          previousTrack: previous,
          sample: {
            lngLat: { lat: sample.lat, lng: sample.lng },
            speed: sample.speed,
            heading: sample.heading,
            timestampMs: sample.timestampMs,
          },
          now,
        })
        // New sample → there's animation to do; wake the scheduler.
        requestTick()
      },
      { immediate: true },
    )
  }

  /**
   * Per-frame work, called by the shared animation scheduler. Returns
   * `'active'` when the dot actually moved this frame so the scheduler
   * keeps ticking; `'idle'` otherwise so it can sleep.
   *
   * Bound as an arrow property so the scheduler can call it without a
   * `this` reference.
   */
  private tick: Tick = (now) => {
    if (!this.mapAPI || !this.track) return 'idle'
    const fullId = `${this.idPrefix}${MARKER_ID}`
    if (!this.mapAPI.hasMarker(fullId)) return 'idle'

    const pos = predict(this.track, now)
    if (
      this.lastRendered &&
      Math.abs(pos.lat - this.lastRendered.lat) < POSITION_EPSILON_DEG &&
      Math.abs(pos.lng - this.lastRendered.lng) < POSITION_EPSILON_DEG
    ) {
      return 'idle'
    }
    this.mapAPI.setMarkerLngLat(fullId, pos)
    this.lastRendered = { lat: pos.lat, lng: pos.lng }
    return 'active'
  }

  /**
   * Override the base reconciliation to keep the marker mounted
   * across coord updates. The base class would `removeMarker` +
   * `addVueMarker` on every coord change, which removes the dot for
   * one frame and snaps it to the raw sample before the next rAF
   * tick moves it to the predicted position.
   *
   * Heading is bucketed to 5° so navigation-mode rotation still
   * updates frequently enough to feel responsive without thrashing
   * the Vue instance every sample.
   */
  protected updateMarkers(data: MarkerData[]) {
    if (!this.mapAPI) return

    const newMarkerIds = new Set<string>()

    for (const markerData of data) {
      const fullId = `${this.idPrefix}${markerData.id}`
      newMarkerIds.add(fullId)

      const snapshot = this.snapshotProps(markerData)
      if (this.mapAPI.hasMarker(fullId) && this.lastSnapshot === snapshot) {
        continue
      }

      if (this.mapAPI.hasMarker(fullId)) {
        this.mapAPI.removeMarker(fullId)
      }
      this.mapAPI.addVueMarker(
        fullId,
        markerData.lngLat,
        this.component,
        markerData.props,
        this.zIndex,
        markerData.dragOptions,
      )
      this.lastSnapshot = snapshot
      // Recreate puts the marker at the raw sample position. Drop the
      // last-rendered cache so the scheduler tick force-emits the
      // predicted position on the next frame.
      this.lastRendered = null
    }

    for (const oldId of this.currentMarkerIds) {
      if (!newMarkerIds.has(oldId)) {
        this.mapAPI.removeMarker(oldId)
      }
    }
    if (newMarkerIds.size === 0) {
      this.lastSnapshot = null
      this.lastRendered = null
    }
    this.currentMarkerIds = newMarkerIds
    if (data.length > 0) requestTick()
  }

  private snapshotProps(markerData: MarkerData): string {
    const p = markerData.props as {
      accuracy?: number | null
      heading?: number | null
      mode?: 'dot' | 'navigation'
    }
    return [
      p.mode ?? 'dot',
      // 5m accuracy buckets — the pulse ring is roughly that resolution
      // visually, so finer grain wouldn't change anything on screen.
      p.accuracy != null ? Math.floor(p.accuracy / 5) : 'na',
      // 5° heading buckets — fine enough for the navigation arrow not
      // to look snappy, coarse enough to skip recreates on tiny GPS
      // heading wobble.
      p.heading != null ? Math.round(p.heading / 5) : 'na',
    ].join('|')
  }

  destroy() {
    this.unregisterTick?.()
    this.unregisterTick = null
    this.samplesWatchStop?.()
    this.samplesWatchStop = null
    this.track = null
    this.lastSnapshot = null
    this.lastRendered = null
    super.destroy()
  }
}
