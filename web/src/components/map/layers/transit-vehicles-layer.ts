/**
 * Transit Vehicles Marker Layer
 *
 * Renders live GTFS-RT vehicle positions as animated markers on the
 * map.  Uses a distance-space interpolation model informed by
 * industry practice (OneBusAway, Google Maps patent 12163792):
 *
 *   1. Snap each GPS fix to the route polyline → distance in meters
 *   2. Exponentially smooth the speed across consecutive fixes
 *   3. On each new fix, ease-blend from the current animated distance
 *      toward a continuously advancing dead-reckoned ideal, so the
 *      handoff to pure dead-reckoning is seamless
 *   4. Monotonic distance clamp prevents backwards movement entirely
 *
 * Free-space fallback (no shape loaded yet) uses lat/lng lerp +
 * bearing-based projection with the same blend pattern.
 */

import { computed, watch, type WatchStopHandle } from 'vue'
import {
  BaseMarkerLayer,
  type MapMarkerAPI,
  type MarkerData,
} from './base-marker-layer'
import { useLayersStore } from '@/stores/layers.store'
import { useTransitVehiclesStore } from '@/stores/transit-vehicles.store'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import {
  buildPolylineDistances,
  distanceMeters,
  lerpLatLng,
  interpolateAlongPolyline,
  projectLatLng,
  snapToPolyline,
  easeOut,
  clamp,
  MIN_DR_SPEED,
  type PolylineDistances,
} from '@/lib/movement-interpolation'
import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import {
  register as registerTick,
  requestTick,
  type Tick,
} from '@/lib/animation-scheduler'
import TransitVehicleMarker from '@/components/map/TransitVehicleMarker.vue'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

// ── Constants ─────────────────────────────────────────────────────

// ~1 pixel at zoom 15. Prevents sub-pixel CSS transform jitter
// where the browser rounds fractional pixel positions differently
// each frame, making the marker visually vibrate.
const POSITION_EPSILON_DEG = 0.00003

/** Duration of the easeOut blend when a new fix arrives (ms). */
const TRANSITION_MS = 2000

/** Exponential smoothing factor for speed (0 = ignore new, 1 = ignore old). */
const SPEED_ALPHA = 0.3

/** Speed halves every this many seconds during dead-reckoning. */
const DECAY_HALF_LIFE_SEC = 20
const DECAY_TAU = DECAY_HALF_LIFE_SEC / Math.LN2

/** Stop dead-reckoning after this long without an update. */
const MAX_COAST_SEC = 60

/** Max cached shapes (LRU eviction by insertion order). */
const MAX_SHAPE_CACHE = 100

// ── Transit track types ──────────────────────────────────────────

interface ConstrainedTransitTrack {
  kind: 'constrained'
  polyline: LngLat[]
  cumulativeDistances: number[]
  totalLength: number

  /** Distance along polyline at the start of the current transition. */
  blendFromDist: number
  /** Distance along polyline where the latest GPS fix snapped to. */
  targetDist: number
  /** Wall-clock ms when the transition began. */
  transitionStartMs: number
  /** Blend duration (ms). 0 on first sample. */
  transitionDurationMs: number

  smoothedSpeed: number
  heading: number | null
  lastSampleTimestamp: number
  /** Monotonic distance clamp — never renders below this. Updated per frame. */
  highWaterDist: number
}

interface FreeTransitTrack {
  kind: 'free'

  blendFrom: LngLat
  target: LngLat
  transitionStartMs: number
  transitionDurationMs: number

  smoothedSpeed: number
  heading: number | null
  lastSampleTimestamp: number
}

type TransitTrack = ConstrainedTransitTrack | FreeTransitTrack

// ── Helpers ──────────────────────────────────────────────────────

/** Integrated distance with exponential speed decay: d(t) = v₀·τ·(1 − e^(−t/τ)) */
function decayedDist(speed: number, sec: number): number {
  if (speed < MIN_DR_SPEED) return 0
  const capped = Math.min(sec, MAX_COAST_SEC)
  return speed * DECAY_TAU * (1 - Math.exp(-capped / DECAY_TAU))
}

// ── Shape cache ──────────────────────────────────────────────────

interface ShapeCache {
  polyline: LngLat[]
  distances: PolylineDistances
}

const pendingShapeFetches = new Set<string>()

// ── Layer ─────────────────────────────────────────────────────────

export class TransitVehiclesLayer extends BaseMarkerLayer {
  private layersStore = useLayersStore()
  private transitVehiclesStore = useTransitVehiclesStore()
  private routeDetailStore = useRouteDetailStore()

  private tracks = new Map<string, TransitTrack>()
  private lastRendered = new Map<string, { lat: number; lng: number }>()
  private unregisterTick: (() => void) | null = null
  private samplesWatchStop: WatchStopHandle | null = null
  private pollingWatchStop: WatchStopHandle | null = null
  private currentMarkerSnapshots = new Map<string, string>()

  private shapeCache = new Map<string, ShapeCache>()

  private getBoundsFn: (() => {
    north: number
    south: number
    east: number
    west: number
  } | null) | null = null

  constructor() {
    const layersStore = useLayersStore()
    const routeDetailStore = useRouteDetailStore()
    const isEnabled = computed(() => {
      // Enable when route detail is active (isolated line view)
      if (routeDetailStore.isActive) return true
      // Or when the legacy layer toggle is on
      const layer = layersStore.layers.find(
        (l) => l.configuration?.id === 'transit-vehicles',
      )
      if (!layer) return false
      if (layer.visible) return true
      if (layer.groupId) {
        const group = layersStore.allLayerGroups?.find(
          (g: any) => g.id === layer.groupId,
        )
        if (group?.visible) return true
      }
      return false
    })

    super({
      idPrefix: 'transit-vehicle-',
      component: TransitVehicleMarker,
      enabled: isEnabled,
      zIndex: 1,
    })
  }

  initialize(mapAPI: MapMarkerAPI) {
    super.initialize(mapAPI)
    this.startSampleWatcher()
    this.unregisterTick = registerTick(this.tick)
  }

  setGetBounds(
    fn: () => {
      north: number
      south: number
      east: number
      west: number
    } | null,
  ) {
    this.getBoundsFn = fn
    this.setupPollingWatcher()
  }

  protected getData(): MarkerData[] {
    // When route detail is active, use its filtered vehicles
    let vehicleEntries: TransitVehiclePosition[]
    if (this.routeDetailStore.isActive) {
      // Only show vehicles matching the selected direction
      const dirFilter = this.routeDetailStore.directionFilteredVehicleIds
      vehicleEntries = Array.from(this.routeDetailStore.vehicles.values())
        .filter(v => dirFilter.has(v.vehicleId))
    } else {
      vehicleEntries = Array.from(this.transitVehiclesStore.vehicles.values())
    }

    const selectedId = this.routeDetailStore.selectedVehicleId
    const hasSelection = !!selectedId

    // When in route detail mode, use the route's type (from the route-detail
    // API which has correct data) instead of the vehicle's type (from the
    // vehicles enrichment cache which may have stale/wrong GTFS data).
    const routeTypeOverride = this.routeDetailStore.isActive
      ? this.routeDetailStore.activeRoute?.routeType
      : undefined

    return vehicleEntries.map((v: TransitVehiclePosition) => ({
      id: v.vehicleId,
      lngLat: { lat: v.position.lat, lng: v.position.lng },
      props: {
        vehicleId: v.vehicleId,
        routeShortName: v.routeShortName,
        routeColor: v.routeColor,
        routeTextColor: v.routeTextColor,
        routeType: routeTypeOverride ?? v.routeType,
        bearing: v.bearing,
        timestamp: v.timestamp,
        selected: v.vehicleId === selectedId,
        dimmed: hasSelection && v.vehicleId !== selectedId,
        onSelect: (id: string) => this.routeDetailStore.selectVehicle(id),
      },
    }))
  }

  // ── WebSocket subscription lifecycle ──────────────────────────────

  private setupPollingWatcher() {
    this.pollingWatchStop?.()

    if (!this.enabled || !this.getBoundsFn) return

    const getBounds = this.getBoundsFn

    this.pollingWatchStop = watch(
      this.enabled,
      (visible) => {
        if (visible) {
          this.transitVehiclesStore.subscribe(getBounds)
        } else {
          this.transitVehiclesStore.unsubscribe()
          this.tracks.clear()
          this.lastRendered.clear()
          this.currentMarkerSnapshots.clear()
        }
      },
      { immediate: true },
    )
  }

  // ── Shape caching ────────────────────────────────────────────────

  private shapeKey(feedId: string, routeId: string): string {
    return `${feedId}:${routeId}`
  }

  private fetchShapeIfNeeded(feedId: string, routeId: string) {
    const key = this.shapeKey(feedId, routeId)
    if (this.shapeCache.has(key) || pendingShapeFetches.has(key)) return
    pendingShapeFetches.add(key)

    api
      .get<{ coordinates: [number, number][] }>('/proxy/transit/shapes', {
        params: { feedId, routeId },
      })
      .then(({ data }) => {
        if (!data.coordinates?.length) return
        const polyline: LngLat[] = data.coordinates.map(([lng, lat]) => ({
          lat,
          lng,
        }))
        const distances = buildPolylineDistances(polyline)
        if (this.shapeCache.size >= MAX_SHAPE_CACHE) {
          const first = this.shapeCache.keys().next().value
          if (first) this.shapeCache.delete(first)
        }
        this.shapeCache.set(key, { polyline, distances })
        requestTick()
      })
      .catch(() => {})
      .finally(() => {
        pendingShapeFetches.delete(key)
      })
  }

  // ── Sample watcher ─────────────────────────────────────────────

  private startSampleWatcher() {
    this.samplesWatchStop = watch(
      () => {
        // Read from whichever store is providing vehicle data
        const source = this.routeDetailStore.isActive
          ? this.routeDetailStore.vehicles
          : this.transitVehiclesStore.vehicles

        return Array.from(source.values()).map(
          (v) => ({
            id: v.vehicleId,
            lat: v.position.lat,
            lng: v.position.lng,
            timestamp: new Date(v.timestamp).getTime(),
            speed: v.speed ?? null,
            heading: v.bearing ?? null,
            feedId: v.feedId,
            routeId: v.routeId,
          }),
        )
      },
      (rows) => {
        const now = Date.now()
        const seen = new Set<string>()

        for (const row of rows) {
          seen.add(row.id)
          const existing = this.tracks.get(row.id)

          if (existing && existing.lastSampleTimestamp === row.timestamp) continue

          const samplePos: LngLat = { lat: row.lat, lng: row.lng }
          const targetPos = existing
            ? (existing.kind === 'constrained'
                ? interpolateAlongPolyline(
                    existing.targetDist / existing.totalLength,
                    existing.polyline,
                    existing.cumulativeDistances,
                    existing.totalLength,
                  ).position
                : existing.target)
            : null
          if (existing && targetPos && distanceMeters(targetPos, samplePos) < 2) {
            existing.lastSampleTimestamp = row.timestamp
            continue
          }

          const shapeKey =
            row.feedId && row.routeId
              ? this.shapeKey(row.feedId, row.routeId)
              : null
          const shape = shapeKey ? this.shapeCache.get(shapeKey) : null

          if (shape) {
            this.tracks.set(
              row.id,
              this.buildConstrainedTrack(existing, row, shape, now),
            )
          } else {
            this.tracks.set(
              row.id,
              this.buildFreeTrack(existing, row, now),
            )
            if (row.feedId && row.routeId) {
              this.fetchShapeIfNeeded(row.feedId, row.routeId)
            }
          }
        }

        for (const id of Array.from(this.tracks.keys())) {
          if (!seen.has(id)) {
            this.tracks.delete(id)
            this.lastRendered.delete(id)
          }
        }

        if (rows.length > 0) requestTick()
      },
      { immediate: true },
    )
  }

  // ── Track builders ─────────────────────────────────────────────

  private buildConstrainedTrack(
    existing: TransitTrack | undefined,
    row: { lat: number; lng: number; timestamp: number; speed: number | null; heading: number | null },
    shape: ShapeCache,
    now: number,
  ): ConstrainedTransitTrack {
    const { polyline, distances } = shape
    const { cumulativeDistances, totalLength } = distances

    const snap = snapToPolyline(
      { lat: row.lat, lng: row.lng },
      polyline,
      cumulativeDistances,
      totalLength,
    )
    const newTargetDist = snap.fraction * totalLength

    if (!existing) {
      return {
        kind: 'constrained',
        polyline,
        cumulativeDistances,
        totalLength,
        blendFromDist: newTargetDist,
        targetDist: newTargetDist,
        transitionStartMs: now,
        transitionDurationMs: 0,
        smoothedSpeed: row.speed ?? 0,
        heading: snap.bearing,
        lastSampleTimestamp: row.timestamp,
        highWaterDist: newTargetDist,
      }
    }

    // Get current animated distance
    let currentDist: number
    if (existing.kind === 'constrained') {
      currentDist = this.predictConstrainedDist(existing, now)
    } else {
      // Transitioning from free → constrained: snap current rendered position
      const currentPos = this.predictFree(existing, now)
      const currentSnap = snapToPolyline(
        currentPos, polyline, cumulativeDistances, totalLength,
      )
      currentDist = currentSnap.fraction * totalLength
    }

    // Compute smoothed speed from consecutive snapped positions.
    // This is critical when the feed doesn't report speed (speed=0),
    // which is common — we derive it from how far the vehicle moved.
    let smoothedSpeed: number
    const dt = (row.timestamp - existing.lastSampleTimestamp) / 1000
    if (dt > 1) {
      const prevTargetDist = existing.kind === 'constrained'
        ? existing.targetDist
        : 0
      const measuredSpeed = Math.max(0, (newTargetDist - prevTargetDist) / dt)
      const prevSpeed = existing.smoothedSpeed
      // Use heavier weight on measured speed when feed reports 0
      const alpha = (row.speed ?? 0) > 0 ? SPEED_ALPHA : 0.6
      smoothedSpeed = alpha * measuredSpeed + (1 - alpha) * prevSpeed
    } else {
      smoothedSpeed = existing.smoothedSpeed
    }

    // Monotonic: if the new fix is behind our high-water mark,
    // hold position and reduce speed instead of going backwards
    const highWater = existing.kind === 'constrained'
      ? existing.highWaterDist
      : currentDist
    if (newTargetDist < highWater - 5) {
      return {
        kind: 'constrained',
        polyline,
        cumulativeDistances,
        totalLength,
        blendFromDist: currentDist,
        targetDist: currentDist,
        transitionStartMs: now,
        transitionDurationMs: 0,
        smoothedSpeed: smoothedSpeed * 0.3,
        heading: snap.bearing,
        lastSampleTimestamp: row.timestamp,
        highWaterDist: Math.max(currentDist, highWater),
      }
    }

    // Use the actual sample interval as transition duration so the
    // vehicle glides at constant speed toward the target. Falls back
    // to TRANSITION_MS for the first pair or very short intervals.
    const sampleInterval = dt > 2 ? dt * 1000 : TRANSITION_MS

    return {
      kind: 'constrained',
      polyline,
      cumulativeDistances,
      totalLength,
      blendFromDist: currentDist,
      targetDist: newTargetDist,
      transitionStartMs: now,
      transitionDurationMs: sampleInterval,
      smoothedSpeed,
      heading: snap.bearing,
      lastSampleTimestamp: row.timestamp,
      highWaterDist: Math.max(currentDist, highWater),
    }
  }

  private buildFreeTrack(
    existing: TransitTrack | undefined,
    row: { lat: number; lng: number; timestamp: number; speed: number | null; heading: number | null },
    now: number,
  ): FreeTransitTrack {
    const samplePos: LngLat = { lat: row.lat, lng: row.lng }

    if (!existing) {
      return {
        kind: 'free',
        blendFrom: samplePos,
        target: samplePos,
        transitionStartMs: now,
        transitionDurationMs: 0,
        smoothedSpeed: row.speed ?? 0,
        heading: row.heading,
        lastSampleTimestamp: row.timestamp,
      }
    }

    const currentPos = existing.kind === 'free'
      ? this.predictFree(existing, now)
      : this.predictConstrained(existing, now)

    let smoothedSpeed: number
    const dt = (row.timestamp - existing.lastSampleTimestamp) / 1000
    if (dt > 1) {
      const prevTarget = existing.kind === 'free'
        ? existing.target
        : interpolateAlongPolyline(
            existing.targetDist / existing.totalLength,
            existing.polyline,
            existing.cumulativeDistances,
            existing.totalLength,
          ).position
      const measuredSpeed = distanceMeters(prevTarget, samplePos) / dt
      const alpha = (row.speed ?? 0) > 0 ? SPEED_ALPHA : 0.6
      smoothedSpeed = alpha * measuredSpeed + (1 - alpha) * existing.smoothedSpeed
    } else {
      smoothedSpeed = existing.smoothedSpeed
    }

    const sampleInterval = dt > 2 ? dt * 1000 : TRANSITION_MS

    return {
      kind: 'free',
      blendFrom: currentPos,
      target: samplePos,
      transitionStartMs: now,
      transitionDurationMs: sampleInterval,
      smoothedSpeed,
      heading: row.heading ?? existing.heading,
      lastSampleTimestamp: row.timestamp,
    }
  }

  // ── Prediction ─────────────────────────────────────────────────
  //
  // The core idea: blend from the current animated position toward a
  // continuously-advancing dead-reckoned ideal. During the transition,
  // the vehicle eases from where it was to where pure DR says it
  // should be. After the transition, it's seamlessly on pure DR.
  // This naturally accelerates when behind and decelerates when ahead.

  private predictTransit(track: TransitTrack, now: number): LngLat {
    if (track.kind === 'constrained') {
      return this.predictConstrained(track, now)
    }
    return this.predictFree(track, now)
  }

  private predictConstrained(track: ConstrainedTransitTrack, now: number): LngLat {
    const dist = this.predictConstrainedDist(track, now)
    const fraction = track.totalLength > 0 ? dist / track.totalLength : 0
    return interpolateAlongPolyline(
      clamp(fraction, 0, 1),
      track.polyline,
      track.cumulativeDistances,
      track.totalLength,
    ).position
  }

  private predictConstrainedDist(track: ConstrainedTransitTrack, now: number): number {
    const elapsed = now - track.transitionStartMs
    const elapsedSec = elapsed / 1000

    // Where pure dead-reckoning says we should be
    const idealDist = track.targetDist + decayedDist(track.smoothedSpeed, elapsedSec)

    let dist: number
    if (track.transitionDurationMs > 0 && elapsed < track.transitionDurationMs) {
      // Ease-blend from starting position toward the moving ideal
      const u = easeOut(elapsed / track.transitionDurationMs)
      dist = track.blendFromDist + (idealDist - track.blendFromDist) * u
    } else {
      dist = idealDist
    }

    // Monotonic clamp and polyline bounds
    dist = Math.max(dist, track.highWaterDist)
    dist = Math.min(dist, track.totalLength)
    track.highWaterDist = dist

    return dist
  }

  private predictFree(track: FreeTransitTrack, now: number): LngLat {
    const elapsed = now - track.transitionStartMs
    const elapsedSec = elapsed / 1000

    // Where pure dead-reckoning from the target says we should be
    let idealPos: LngLat
    if (track.smoothedSpeed >= MIN_DR_SPEED && track.heading != null) {
      const drDist = decayedDist(track.smoothedSpeed, elapsedSec)
      idealPos = projectLatLng(track.target, 1, track.heading, drDist)
    } else {
      idealPos = track.target
    }

    if (track.transitionDurationMs > 0 && elapsed < track.transitionDurationMs) {
      const u = easeOut(elapsed / track.transitionDurationMs)
      return lerpLatLng(track.blendFrom, idealPos, u)
    }

    return idealPos
  }

  // ── Marker reconciliation ──────────────────────────────────────

  protected updateMarkers(data: MarkerData[]) {
    if (!this.mapAPI) return
    if (this.enabled && !this.enabled.value) return

    const newMarkerIds = new Set<string>()

    for (const markerData of data) {
      const fullId = `${this.idPrefix}${markerData.id}`
      newMarkerIds.add(fullId)

      const snapshot = this.snapshotProps(markerData)
      const previous = this.currentMarkerSnapshots.get(fullId)

      if (this.mapAPI.hasMarker(fullId) && previous === snapshot) {
        continue
      }

      if (this.mapAPI.hasMarker(fullId)) {
        this.mapAPI.removeMarker(fullId)
      }
      const lastPos = this.lastRendered.get(markerData.id)
      const createPos = lastPos
        ? { lat: lastPos.lat, lng: lastPos.lng }
        : markerData.lngLat

      this.mapAPI.addVueMarker(
        fullId,
        createPos,
        this.component,
        markerData.props,
        this.zIndex,
        markerData.dragOptions,
      )
      this.currentMarkerSnapshots.set(fullId, snapshot)
    }

    for (const oldId of this.currentMarkerIds) {
      if (!newMarkerIds.has(oldId)) {
        this.mapAPI.removeMarker(oldId)
        this.currentMarkerSnapshots.delete(oldId)
      }
    }
    this.currentMarkerIds = newMarkerIds
    if (data.length > 0) requestTick()
  }

  private snapshotProps(markerData: MarkerData): string {
    const p = markerData.props as {
      routeColor?: string
      routeShortName?: string
      routeType?: string
      timestamp?: string
      selected?: boolean
      dimmed?: boolean
    }
    return [
      p.routeColor ?? '',
      p.routeShortName ?? '',
      p.routeType ?? '',
      p.selected ? 's' : '',
      p.dimmed ? 'd' : '',
      p.timestamp
        ? Math.floor(new Date(p.timestamp).getTime() / 60_000)
        : 'na',
    ].join('|')
  }

  // ── Per-frame animation tick ────────────────────────────────────

  private tick: Tick = (_rafTime) => {
    if (!this.mapAPI) return 'idle'
    if (this.enabled && !this.enabled.value) return 'idle'
    if (this.tracks.size === 0) return 'idle'

    const now = Date.now()

    let anyMoved = false
    for (const [id, track] of this.tracks) {
      const fullId = `${this.idPrefix}${id}`
      if (!this.mapAPI.hasMarker(fullId)) continue
      const pos = this.predictTransit(track, now)
      const prev = this.lastRendered.get(id)
      if (
        prev &&
        Math.abs(pos.lat - prev.lat) < POSITION_EPSILON_DEG &&
        Math.abs(pos.lng - prev.lng) < POSITION_EPSILON_DEG
      ) {
        continue
      }
      this.mapAPI.setMarkerLngLat(fullId, pos)
      this.lastRendered.set(id, { lat: pos.lat, lng: pos.lng })
      anyMoved = true
    }
    return anyMoved ? 'active' : 'idle'
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  destroy() {
    this.pollingWatchStop?.()
    this.pollingWatchStop = null
    this.unregisterTick?.()
    this.unregisterTick = null
    this.samplesWatchStop?.()
    this.samplesWatchStop = null
    this.transitVehiclesStore.unsubscribe()
    this.tracks.clear()
    this.lastRendered.clear()
    this.currentMarkerSnapshots.clear()
    this.shapeCache.clear()
    this.getBoundsFn = null
    super.destroy()
  }
}
