/**
 * Transit Vehicles Marker Layer
 *
 * Renders live GTFS-RT vehicle positions as animated markers on the
 * map.  Uses a distance-space interpolation model informed by
 * industry practice (OneBusAway, Google Maps patent 12163792):
 *
 *   1. Snap each GPS fix to the route polyline → distance in meters
 *   2. Smooth the speed across fixes, preferring a TripUpdate arrival
 *   3. Scale coasting by how consistently the last three fixes agree
 *   4. Glide forward to a fix ahead; hold for one behind, never reverse
 *
 * Free-space fallback (no shape loaded yet) uses lat/lng lerp +
 * bearing-based projection with the same blend pattern.
 */

import { computed, watch, type WatchStopHandle } from 'vue'
import {
  BaseMarkerLayer,
  type MapMarkerAPI,
  type MarkerData,
} from '@/services/layers/markers/base-marker-layer'
import { useLayersStore } from '@/stores/layers.store'
import { useTransitVehiclesStore } from '@/stores/transit-vehicles.store'
import { useTransitFocusStore } from '@/stores/transit-focus.store'
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
} from '@/lib/map/movement-interpolation'
import {
  alongTrack,
  arrivalSpeed,
  correctionFor,
  fixConfidence,
  measuredSpeed,
  nextSpeed,
  pushFix,
  signedProgress,
  type VehicleFix,
} from '@/lib/transit/vehicle-motion'
import { api } from '@/lib/api'
import type { LngLat } from '@/types/map.types'
import {
  register as registerTick,
  requestTick,
  type Tick,
} from '@/lib/map/animation-scheduler'
import TransitVehicleMarker from '@/components/map/markers/TransitVehicleMarker.vue'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

// ── Constants ─────────────────────────────────────────────────────

const POSITION_EPSILON_DEG = 0.0000005

/** Duration of the easeOut blend when a new fix arrives (ms). */
const TRANSITION_MS = 2000

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

/** Coasting off-shape runs straight past corners, so it never gets full trust. */
const FREE_MAX_CONFIDENCE = 0.5

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

  /** Multiplier on dead-reckoning speed, from `fixConfidence`. */
  drConfidence: number
  fixes: VehicleFix[]
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

  drConfidence: number
  fixes: VehicleFix[]
}

type TransitTrack = ConstrainedTransitTrack | FreeTransitTrack

// ── Helpers ──────────────────────────────────────────────────────

/** Integrated distance with exponential speed decay: d(t) = v₀·τ·(1 − e^(−t/τ)) */
function decayedDist(speed: number, sec: number): number {
  if (speed < MIN_DR_SPEED) return 0
  const capped = Math.min(sec, MAX_COAST_SEC)
  return speed * DECAY_TAU * (1 - Math.exp(-capped / DECAY_TAU))
}

interface SampleRow {
  lat: number
  lng: number
  timestamp: number
  speed: number | null
  heading: number | null
  routeType: number | string | null
  nextStopId: string | null
  nextStopArrival: number | null
}

function maxSpeedFor(routeType: SampleRow['routeType']): number {
  const rt = typeof routeType === 'number' ? routeType : 3
  return MAX_SPEED_BY_TYPE[rt] ?? DEFAULT_MAX_SPEED
}

function sampleFix(row: SampleRow): VehicleFix {
  return { lngLat: { lat: row.lat, lng: row.lng }, timestampMs: row.timestamp }
}

/** Glide over the gap between fixes, so the vehicle arrives as the next one does. */
function transitionMs(row: SampleRow, existing: TransitTrack): number {
  const dt = (row.timestamp - existing.lastSampleTimestamp) / 1000
  return dt > 2 ? dt * 1000 : TRANSITION_MS
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
  private transitFocusStore = useTransitFocusStore()

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
    const transitFocusStore = useTransitFocusStore()
    const isEnabled = computed(() => {
      // Enable whenever a route or an itinerary is the map's subject
      if (transitFocusStore.isActive) return true
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
    const focus = this.transitFocusStore
    // A focused route or itinerary supplies its own vehicles, already
    // scoped to the lines it rides; otherwise the viewport feed answers.
    const visible = focus.visibleVehicleIds
    const vehicleEntries: TransitVehiclePosition[] = focus.isActive
      ? Array.from(focus.vehicles.values()).filter(v => visible.has(v.vehicleId))
      : Array.from(this.transitVehiclesStore.vehicles.values())

    // Empty emphasis means nothing on screen can be called the rider's, and
    // so nothing fades: every train at full strength beats the wrong one lit.
    const emphasized = focus.emphasizedVehicleIds
    const hasEmphasis = emphasized.size > 0

    // The focused view's own data is the authority on a line's mode; the
    // vehicle feed's enrichment cache can be stale about it.
    const routeTypeOverride = focus.routeTypeOverride

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
        selected: emphasized.has(v.vehicleId),
        dimmed: hasEmphasis && !emphasized.has(v.vehicleId),
        onSelect: (id: string) => focus.selectVehicle(id),
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
        if (visible && !this.transitFocusStore.isActive) {
          // Only subscribe to the global WS feed when nothing is focused.
          // A focused route or trip does its own HTTP polling.
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
      .get<{ coordinates: [number, number][] }>('/transit/shapes', {
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
        const source = this.transitFocusStore.isActive
          ? this.transitFocusStore.vehicles
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
            // Previous position from the prior GTFS-RT snapshot —
            // allows instant interpolation on first fetch.
            previousLat: v.previousPosition?.lat ?? null,
            previousLng: v.previousPosition?.lng ?? null,
            previousTimestamp: v.previousTimestamp
              ? new Date(v.previousTimestamp).getTime()
              : null,
          }),
        )
      },
      (rows) => {
        const now = Date.now()
        const seen = new Set<string>()

        for (const row of rows) {
          seen.add(row.id)
          let existing = this.tracks.get(row.id)

          if (existing && existing.lastSampleTimestamp === row.timestamp) continue

          const lastFix = existing?.fixes[existing.fixes.length - 1]
          if (existing && lastFix && distanceMeters(lastFix.lngLat, { lat: row.lat, lng: row.lng }) < 2) {
            // A vehicle reporting the same spot again has stopped; stop coasting.
            existing.lastSampleTimestamp = row.timestamp
            existing.fixes = pushFix(existing.fixes, sampleFix(row))
            existing.drConfidence = 0
            continue
          }

          // Hoist shape lookup — used by both bootstrap and normal path.
          const shapeKey =
            row.feedId && row.routeId
              ? this.shapeKey(row.feedId, row.routeId)
              : null
          const shape = shapeKey ? this.shapeCache.get(shapeKey) : null

          // Bootstrap: if this is the first time we see this vehicle and the
          // server provided a previousPosition, create a synthetic "prior"
          // track so the current sample becomes the second data point. This
          // gives us speed + direction immediately — no 5s wait for the next
          // poll to start interpolation.
          //
          // Staleness guard: reject previous positions older than 120s —
          // stale data produces near-zero speed and multi-minute transitions.
          const MAX_BOOTSTRAP_AGE_MS = 120_000
          if (
            !existing &&
            row.previousLat != null && row.previousLng != null && row.previousTimestamp != null &&
            (row.timestamp - row.previousTimestamp) < MAX_BOOTSTRAP_AGE_MS
          ) {
            const prevRow: SampleRow = {
              lat: row.previousLat,
              lng: row.previousLng,
              timestamp: row.previousTimestamp,
              speed: null,
              heading: null,
              routeType: row.routeType,
              nextStopId: null,
              nextStopArrival: null,
            }
            if (shape) {
              existing = this.buildConstrainedTrack(undefined, prevRow, shape, now)
            } else {
              existing = this.buildFreeTrack(undefined, prevRow, now)
            }
            // Don't set it on this.tracks yet — the current row will
            // immediately overwrite it below using this as `existing`.
          }

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
    row: SampleRow,
    shape: ShapeCache,
    now: number,
  ): ConstrainedTransitTrack {
    const { polyline, distances } = shape
    const { cumulativeDistances, totalLength } = distances
    const distAlong = (p: LngLat) =>
      snapToPolyline(p, polyline, cumulativeDistances, totalLength).fraction * totalLength

    const fixes = pushFix(existing?.fixes ?? [], sampleFix(row))
    const pathFixes = fixes.map((f) => ({ dist: distAlong(f.lngLat), timestampMs: f.timestampMs }))
    const newTargetDist = pathFixes[pathFixes.length - 1].dist
    const heading = snapToPolyline(
      { lat: row.lat, lng: row.lng }, polyline, cumulativeDistances, totalLength,
    ).bearing
    const maxSpeed = maxSpeedFor(row.routeType)

    const base = {
      kind: 'constrained' as const,
      polyline,
      cumulativeDistances,
      totalLength,
      transitionStartMs: now,
      heading,
      lastSampleTimestamp: row.timestamp,
      fixes,
    }

    if (!existing) {
      return {
        ...base,
        blendFromDist: newTargetDist,
        targetDist: newTargetDist,
        transitionDurationMs: 0,
        smoothedSpeed: Math.min(row.speed ?? 0, maxSpeed),
        highWaterDist: newTargetDist,
        drConfidence: 0,
      }
    }

    const currentDist = existing.kind === 'constrained'
      ? this.predictConstrainedDist(existing, now)
      : distAlong(this.predictFree(existing, now))

    const nextStopDist = row.nextStopArrival
      ? this.findStopDistOnShape(row.nextStopId, polyline, cumulativeDistances, totalLength)
      : null
    const smoothedSpeed = nextSpeed({
      previous: existing.smoothedSpeed,
      arrival: nextStopDist != null && row.nextStopArrival
        ? arrivalSpeed(nextStopDist - newTargetDist, row.timestamp, row.nextStopArrival)
        : null,
      measured: measuredSpeed(pathFixes),
      feedReportsSpeed: (row.speed ?? 0) > 0,
      maxSpeed,
    })

    const correction = correctionFor(newTargetDist - currentDist)
    if (correction !== 'glide') {
      const settled = correction === 'hold' ? currentDist : newTargetDist
      return {
        ...base,
        blendFromDist: settled,
        targetDist: settled,
        transitionDurationMs: 0,
        smoothedSpeed,
        highWaterDist: settled,
        drConfidence: 0,
      }
    }

    return {
      ...base,
      blendFromDist: currentDist,
      targetDist: newTargetDist,
      transitionDurationMs: transitionMs(row, existing),
      smoothedSpeed,
      highWaterDist: existing.kind === 'constrained' ? existing.highWaterDist : currentDist,
      drConfidence: fixConfidence(pathFixes),
    }
  }

  private buildFreeTrack(
    existing: TransitTrack | undefined,
    row: SampleRow,
    now: number,
  ): FreeTransitTrack {
    const samplePos: LngLat = { lat: row.lat, lng: row.lng }
    const fixes = pushFix(existing?.fixes ?? [], sampleFix(row))
    const maxSpeed = maxSpeedFor(row.routeType)

    const base = {
      kind: 'free' as const,
      transitionStartMs: now,
      heading: row.heading ?? existing?.heading ?? null,
      lastSampleTimestamp: row.timestamp,
      fixes,
    }

    if (!existing) {
      return {
        ...base,
        blendFrom: samplePos,
        target: samplePos,
        transitionDurationMs: 0,
        smoothedSpeed: Math.min(row.speed ?? 0, maxSpeed),
        drConfidence: 0,
      }
    }

    const currentPos = existing.kind === 'free'
      ? this.predictFree(existing, now)
      : this.predictConstrained(existing, now)

    const pathFixes = alongTrack(fixes)
    const smoothedSpeed = nextSpeed({
      previous: existing.smoothedSpeed,
      arrival: null,
      measured: measuredSpeed(pathFixes),
      feedReportsSpeed: (row.speed ?? 0) > 0,
      maxSpeed,
    })

    const progress = existing.heading != null
      ? signedProgress(currentPos, samplePos, existing.heading)
      : 0
    const correction = correctionFor(progress)
    if (correction !== 'glide') {
      const settled = correction === 'hold' ? currentPos : samplePos
      return {
        ...base,
        blendFrom: settled,
        target: settled,
        transitionDurationMs: 0,
        smoothedSpeed,
        drConfidence: 0,
      }
    }

    return {
      ...base,
      blendFrom: currentPos,
      target: samplePos,
      transitionDurationMs: transitionMs(row, existing),
      smoothedSpeed,
      drConfidence: Math.min(fixConfidence(pathFixes), FREE_MAX_CONFIDENCE),
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
    const stops = this.transitFocusStore.focusedStops
    if (!stopId || !stops.length) return null
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
      track.highWaterDist = Math.max(dist, track.highWaterDist)
      return Math.min(track.highWaterDist, track.totalLength)
    }

    // Phase 2: coast forward from the fix at a decaying, confidence-scaled speed.
    const sinceArrival = elapsedSec - (track.transitionDurationMs / 1000)
    const effectiveSpeed = track.smoothedSpeed * track.drConfidence
    if (sinceArrival > 0 && effectiveSpeed >= MIN_DR_SPEED && sinceArrival < MAX_COAST_SEC) {
      const projected = track.targetDist + decayedDist(effectiveSpeed, sinceArrival)
      track.highWaterDist = Math.max(track.highWaterDist, projected)
    }

    return Math.min(track.highWaterDist, track.totalLength)
  }

  private predictFree(track: FreeTransitTrack, now: number): LngLat {
    const elapsed = now - track.transitionStartMs
    const elapsedSec = elapsed / 1000

    // Where confidence-scaled dead-reckoning from the target says we should be
    let idealPos: LngLat
    const effectiveSpeed = track.smoothedSpeed * track.drConfidence
    if (effectiveSpeed >= MIN_DR_SPEED && track.heading != null) {
      const drDist = decayedDist(effectiveSpeed, elapsedSec)
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
