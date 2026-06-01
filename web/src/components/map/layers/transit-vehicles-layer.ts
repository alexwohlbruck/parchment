/**
 * Transit Vehicles Marker Layer
 *
 * Renders live GTFS-RT vehicle positions as animated markers on the
 * map. Follows the FriendLocationsLayer pattern: a Track per vehicle,
 * a per-frame tick registered with the shared animation scheduler,
 * and a sample-arrival watcher that builds fresh Tracks whenever a
 * vehicle's timestamp changes.
 *
 * The layer also owns the polling lifecycle — it starts/stops the
 * transit-vehicles store's polling when the layer becomes
 * visible/hidden, passing the map strategy's getBounds as the
 * bounds supplier.
 */

import { computed, watch, type WatchStopHandle } from 'vue'
import {
  BaseMarkerLayer,
  type MapMarkerAPI,
  type MarkerData,
} from './base-marker-layer'
import { useLayersStore } from '@/stores/layers.store'
import { useTransitVehiclesStore } from '@/stores/transit-vehicles.store'
import {
  buildTrack,
  predict,
  buildConstrainedTrack,
  predictConstrained,
  buildPolylineDistances,
  type Track,
  type ConstrainedTrack,
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

const POSITION_EPSILON_DEG = 0.0000005

/** Bridges 15 s poll interval + one missed update. */
const STALENESS_CAP_SEC_OVERRIDE = 45

/** Max cached shapes (LRU eviction by insertion order). */
const MAX_SHAPE_CACHE = 100

interface ShapeCache {
  polyline: LngLat[]
  distances: PolylineDistances
}

/** Keys that are currently being fetched (prevent duplicate requests). */
const pendingShapeFetches = new Set<string>()

export class TransitVehiclesLayer extends BaseMarkerLayer {
  private layersStore = useLayersStore()
  private transitVehiclesStore = useTransitVehiclesStore()

  private tracks = new Map<string, Track | ConstrainedTrack>()
  private lastRendered = new Map<string, { lat: number; lng: number }>()
  private unregisterTick: (() => void) | null = null
  private samplesWatchStop: WatchStopHandle | null = null
  private pollingWatchStop: WatchStopHandle | null = null
  private currentMarkerSnapshots = new Map<string, string>()

  /** Cached GTFS shape geometry per feedId:routeId. */
  private shapeCache = new Map<string, ShapeCache>()

  /** Stored reference to mapStrategy.getBounds for polling. */
  private getBoundsFn: (() => {
    north: number
    south: number
    east: number
    west: number
  } | null) | null = null

  constructor() {
    const layersStore = useLayersStore()
    const isEnabled = computed(() => {
      const layer = layersStore.layers.find(
        (l) => l.configuration?.id === 'transit-vehicles',
      )
      return layer?.visible ?? false
    })

    super({
      idPrefix: 'transit-vehicle-',
      component: TransitVehicleMarker,
      enabled: isEnabled,
      zIndex: 1, // Below friends and waypoints
    })
  }

  initialize(mapAPI: MapMarkerAPI) {
    super.initialize(mapAPI)
    this.startSampleWatcher()
    this.unregisterTick = registerTick(this.tick)
  }

  /** Provide a bounds supplier so the layer can start/stop polling. */
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
    const vehicles = this.transitVehiclesStore.vehicles

    return Array.from(vehicles.values()).map((v: TransitVehiclePosition) => ({
      id: v.vehicleId,
      lngLat: { lat: v.position.lat, lng: v.position.lng },
      props: {
        vehicleId: v.vehicleId,
        routeShortName: v.routeShortName,
        routeColor: v.routeColor,
        routeTextColor: v.routeTextColor,
        routeType: v.routeType,
        bearing: v.bearing,
        timestamp: v.timestamp,
      },
    }))
  }

  // ── Polling lifecycle ────────────────────────────────────────────

  private setupPollingWatcher() {
    this.pollingWatchStop?.()

    if (!this.enabled || !this.getBoundsFn) return

    const getBounds = this.getBoundsFn

    this.pollingWatchStop = watch(
      this.enabled,
      (visible) => {
        if (visible) {
          this.transitVehiclesStore.startPolling(getBounds)
        } else {
          this.transitVehiclesStore.stopPolling()
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

  /** Lazily fetch a route shape from Barrelman. Non-blocking. */
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
        // Evict oldest if cache is full
        if (this.shapeCache.size >= MAX_SHAPE_CACHE) {
          const first = this.shapeCache.keys().next().value
          if (first) this.shapeCache.delete(first)
        }
        this.shapeCache.set(key, { polyline, distances })
        // Wake scheduler so vehicles on this route start snapping
        requestTick()
      })
      .catch(() => {
        // Shape not available — vehicle will use free-space interpolation
      })
      .finally(() => {
        pendingShapeFetches.delete(key)
      })
  }

  // ── Sample watcher (builds Tracks on new data) ──────────────────

  private startSampleWatcher() {
    this.samplesWatchStop = watch(
      () => {
        return Array.from(this.transitVehiclesStore.vehicles.values()).map(
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
          // Dedup: same sample re-delivered
          if (existing && existing.toSampleTimestamp === row.timestamp) continue

          const sample = {
            lngLat: { lat: row.lat, lng: row.lng },
            speed: row.speed,
            heading: row.heading,
            timestampMs: row.timestamp,
          }

          // Try constrained track if we have a shape
          const shapeKey =
            row.feedId && row.routeId
              ? this.shapeKey(row.feedId, row.routeId)
              : null
          const shape = shapeKey ? this.shapeCache.get(shapeKey) : null

          let track: Track | ConstrainedTrack
          if (shape) {
            const currentRendered = existing
              ? this.predictTrack(existing, now)
              : null
            track = buildConstrainedTrack({
              currentRendered,
              previousTrack:
                existing && 'polyline' in existing
                  ? (existing as ConstrainedTrack)
                  : null,
              sample,
              polyline: shape.polyline,
              polylineDistances: shape.distances,
              now,
            })
          } else {
            const currentRendered = existing
              ? this.predictTrack(existing, now)
              : null
            track = buildTrack({
              currentRendered,
              previousTrack: existing ?? null,
              sample,
              now,
            })
            // Kick off shape fetch for next time
            if (row.feedId && row.routeId) {
              this.fetchShapeIfNeeded(row.feedId, row.routeId)
            }
          }

          this.tracks.set(row.id, track)
        }

        // Remove tracks for vehicles that left the set
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

  // ── Marker reconciliation (skip recreates on position-only) ─────

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
      this.mapAPI.addVueMarker(
        fullId,
        markerData.lngLat,
        this.component,
        markerData.props,
        this.zIndex,
        markerData.dragOptions,
      )
      this.currentMarkerSnapshots.set(fullId, snapshot)
      this.lastRendered.delete(markerData.id)
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
    }
    // Position is handled by setMarkerLngLat from the rAF loop.
    // Only recreate when display-relevant props change. Bucket
    // timestamp to the minute so the tooltip isn't constantly stale.
    return [
      p.routeColor ?? '',
      p.routeShortName ?? '',
      p.routeType ?? '',
      p.timestamp
        ? Math.floor(new Date(p.timestamp).getTime() / 60_000)
        : 'na',
    ].join('|')
  }

  // ── Shared predict helper ─────────────────────────────────────

  /** Dispatch to constrained or free-space predict based on track type. */
  private predictTrack(track: Track | ConstrainedTrack, now: number): LngLat {
    if ('polyline' in track) {
      return predictConstrained(track as ConstrainedTrack, now)
    }
    return predict(track, now)
  }

  // ── Per-frame animation tick ────────────────────────────────────

  private tick: Tick = (now) => {
    if (!this.mapAPI) return 'idle'
    if (this.enabled && !this.enabled.value) return 'idle'
    if (this.tracks.size === 0) return 'idle'

    let anyMoved = false
    for (const [id, track] of this.tracks) {
      const fullId = `${this.idPrefix}${id}`
      if (!this.mapAPI.hasMarker(fullId)) continue
      const pos = this.predictTrack(track, now)
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
    this.transitVehiclesStore.stopPolling()
    this.tracks.clear()
    this.lastRendered.clear()
    this.currentMarkerSnapshots.clear()
    this.shapeCache.clear()
    this.getBoundsFn = null
    super.destroy()
  }
}
