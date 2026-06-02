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

const POSITION_EPSILON_DEG = 0.0000005

/** Duration of the easeOut blend when a new fix arrives (ms). */
const TRANSITION_MS = 2000

/** Exponential smoothing factor for speed (0 = ignore new, 1 = ignore old). */
const SPEED_ALPHA = 0.3

/** Speed halves every this many seconds during dead-reckoning. */
const DECAY_HALF_LIFE_SEC = 20
const DECAY_TAU = DECAY_HALF_LIFE_SEC / Math.LN2

/** Stop dead-reckoning after this long without an update. */
const MAX_COAST_SEC = 60

/** Max realistic speed (m/s) by GTFS route_type. Prevents GPS noise
 *  from making a streetcar appear to fly down the tracks at 50mph. */
const MAX_SPEED_BY_TYPE: Record<number, number> = {
  0: 14,   // tram/streetcar: ~50 km/h
  1: 36,   // subway: ~130 km/h
  2: 45,   // rail: ~160 km/h
  3: 25,   // bus: ~90 km/h
  4: 14,   // ferry: ~50 km/h
}
const DEFAULT_MAX_SPEED = 25 // m/s (~90 km/h)

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
        if (visible && !this.routeDetailStore.isActive) {
          // Only subscribe to the global WS feed when NOT in route-detail
          // mode. Route-detail has its own HTTP polling via the store.
          this.transitVehiclesStore.subscribe(getBounds)
        } else if (!visible) {
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
            routeType: v.routeType ?? null,
            nextStopId: v.nextStopId ?? null,
            nextStopArrival: v.nextStopArrival
              ? new Date(v.nextStopArrival).getTime()
              : null,
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
    row: { lat: number; lng: number; timestamp: number; speed: number | null; heading: number | null; routeType: number | string | null; nextStopId: string | null; nextStopArrival: number | null },
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
      const rt = typeof row.routeType === 'number' ? row.routeType : 3
      const initSpeed = Math.min(row.speed ?? 0, MAX_SPEED_BY_TYPE[rt] ?? DEFAULT_MAX_SPEED)
      return {
        kind: 'constrained',
        polyline,
        cumulativeDistances,
        totalLength,
        blendFromDist: newTargetDist,
        targetDist: newTargetDist,
        transitionStartMs: now,
        transitionDurationMs: 0,
        smoothedSpeed: initSpeed,
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

    // Compute interpolation speed. Priority:
    // 1. TripUpdate arrival prediction → speed to reach next stop on time
    // 2. Consecutive GPS position delta → measured speed
    // 3. Feed-reported speed (often 0)
    const rtNum = typeof row.routeType === 'number' ? row.routeType : 3
    const maxSpeed = MAX_SPEED_BY_TYPE[rtNum] ?? DEFAULT_MAX_SPEED
    let smoothedSpeed: number
    const dt = (row.timestamp - existing.lastSampleTimestamp) / 1000

    if (row.nextStopArrival && dt > 1) {
      // Best source: TripUpdate predicts when the vehicle reaches its next stop.
      // Compute speed needed to arrive on time.
      const timeToArrival = (row.nextStopArrival - now) / 1000
      if (timeToArrival > 2) {
        // Estimate distance to next stop from the route shape.
        // nextStopId may have directional suffix — try both.
        const nextStopDist = this.findStopDistOnShape(row.nextStopId, polyline, cumulativeDistances, totalLength)
        if (nextStopDist != null && nextStopDist > newTargetDist) {
          const distToStop = nextStopDist - newTargetDist
          smoothedSpeed = Math.min(distToStop / timeToArrival, maxSpeed)
        } else {
          // Can't find stop on shape — fall back to GPS delta
          const measuredSpeed = Math.max(0, (newTargetDist - (existing.kind === 'constrained' ? existing.targetDist : 0)) / dt)
          smoothedSpeed = Math.min(SPEED_ALPHA * measuredSpeed + (1 - SPEED_ALPHA) * existing.smoothedSpeed, maxSpeed)
        }
      } else {
        smoothedSpeed = Math.min(existing.smoothedSpeed, maxSpeed)
      }
    } else if (dt > 1) {
      const prevTargetDist = existing.kind === 'constrained' ? existing.targetDist : 0
      const measuredSpeed = Math.max(0, (newTargetDist - prevTargetDist) / dt)
      const alpha = (row.speed ?? 0) > 0 ? SPEED_ALPHA : 0.6
      smoothedSpeed = Math.min(alpha * measuredSpeed + (1 - alpha) * existing.smoothedSpeed, maxSpeed)
    } else {
      smoothedSpeed = Math.min(existing.smoothedSpeed, maxSpeed)
    }

    // If the GPS says we're behind where interpolation put us,
    // accept the GPS position. The interpolation overshot — that's
    // our error, not the GPS's. Glide to the GPS fix from current
    // position (may be a slight visual correction backwards, but
    // being stuck forever is much worse).
    if (newTargetDist < currentDist) {
      return {
        kind: 'constrained',
        polyline,
        cumulativeDistances,
        totalLength,
        blendFromDist: currentDist,
        targetDist: newTargetDist,
        transitionStartMs: now,
        transitionDurationMs: TRANSITION_MS,
        smoothedSpeed: smoothedSpeed * 0.5,
        heading: snap.bearing,
        lastSampleTimestamp: row.timestamp,
        // Reset highWater to GPS — trust the real data
        highWaterDist: newTargetDist,
      }
    }

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
      highWaterDist: existing.kind === 'constrained' ? existing.highWaterDist : currentDist,
    }
  }

  private buildFreeTrack(
    existing: TransitTrack | undefined,
    row: { lat: number; lng: number; timestamp: number; speed: number | null; heading: number | null; routeType: number | string | null; nextStopId: string | null; nextStopArrival: number | null },
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
        smoothedSpeed: Math.min(row.speed ?? 0, MAX_SPEED_BY_TYPE[typeof row.routeType === 'number' ? row.routeType : 3] ?? DEFAULT_MAX_SPEED),
        heading: row.heading,
        lastSampleTimestamp: row.timestamp,
      }
    }

    const currentPos = existing.kind === 'free'
      ? this.predictFree(existing, now)
      : this.predictConstrained(existing, now)

    const rtNum = typeof row.routeType === 'number' ? row.routeType : 3
    const maxSpeed = MAX_SPEED_BY_TYPE[rtNum] ?? DEFAULT_MAX_SPEED
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
      smoothedSpeed = Math.min(
        alpha * measuredSpeed + (1 - alpha) * existing.smoothedSpeed,
        maxSpeed,
      )
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

  /** Find a stop's distance along the route shape by matching stop position
   *  to the nearest point on the polyline. Returns null if stop not found. */
  private findStopDistOnShape(
    stopId: string | null,
    polyline: LngLat[],
    cumulativeDistances: number[],
    totalLength: number,
  ): number | null {
    if (!stopId || !this.routeDetailStore.activeRoute) return null
    const stops = this.routeDetailStore.activeRoute.stops
    // Try exact match and stripped-suffix match (e.g. "101N" → "101")
    const stop = stops.find(s => s.stopId === stopId)
      ?? stops.find(s => stopId.startsWith(s.stopId))
      ?? stops.find(s => s.stopId.startsWith(stopId))
    if (!stop) return null

    const snap = snapToPolyline(
      { lat: stop.lat, lng: stop.lng },
      polyline,
      cumulativeDistances,
      totalLength,
    )
    return snap.fraction * totalLength
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

    // Phase 1: glide from previous position toward the GPS target
    // over the sample interval (constant speed, no easing).
    if (track.transitionDurationMs > 0 && elapsed < track.transitionDurationMs) {
      const u = elapsed / track.transitionDurationMs
      const dist = track.blendFromDist + (track.targetDist - track.blendFromDist) * u
      // Never go backwards from high-water mark
      const clamped = Math.max(dist, track.highWaterDist)
      track.highWaterDist = clamped
      return Math.min(clamped, track.totalLength)
    }

    // Phase 2: dead-reckon forward from the GPS target at decaying speed.
    // But NEVER go ahead of where the GPS says we should be — if we've
    // overshot, just hold at the target and wait for reality to catch up.
    const sinceArrival = elapsedSec - (track.transitionDurationMs / 1000)
    if (sinceArrival > 0 && track.smoothedSpeed >= MIN_DR_SPEED && sinceArrival < MAX_COAST_SEC) {
      const drDist = decayedDist(track.smoothedSpeed, sinceArrival)
      const projected = track.targetDist + drDist

      // Only advance if we're not already ahead of the target
      // (which happens when the first interpolation frame overshoots)
      if (track.highWaterDist <= track.targetDist) {
        const dist = Math.min(projected, track.totalLength)
        track.highWaterDist = Math.max(dist, track.highWaterDist)
        return dist
      }
    }

    // We're at or past the target — hold position
    return Math.min(track.highWaterDist, track.totalLength)
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
    pendingShapeFetches.clear()
    this.getBoundsFn = null
    super.destroy()
  }
}
