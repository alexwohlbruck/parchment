/**
 * Friend Locations Marker Layer
 *
 * Renders friend markers and ANIMATES them between server pushes via
 * receiver-side dead reckoning. The base class still handles marker
 * create/destroy on friend list changes; this subclass adds:
 *
 *   - a `Track` per friend, holding the latest sample plus the
 *     position we're currently rendering (see `lib/movement-interpolation`)
 *   - a `requestAnimationFrame` loop that recomputes each rendered
 *     position and pushes it via `mapAPI.setMarkerLngLat` — a direct
 *     CSS-transform on the maplibre marker, ~free per frame
 *   - a sample-arrival watcher that builds a fresh `Track` (with a
 *     short tween from the currently-rendered position to the new
 *     sample) whenever a friend's `updatedAt` changes
 *
 * The layer doesn't need to know anything about decryption or realtime —
 * it just watches `useFriendLocations.locations`, which already reflects
 * the latest decrypted state from both fetch and push paths.
 */

import { computed, watch, type WatchStopHandle } from 'vue'
import {
  BaseMarkerLayer,
  type MapMarkerAPI,
  type MarkerData,
} from './base-marker-layer'
import { useLayersStore } from '@/stores/layers.store'
import { useFriendLocations } from '@/composables/useFriendLocations'
import {
  buildTrack,
  predict,
  type Track,
} from '@/lib/movement-interpolation'
import FriendLocationMarker from '@/components/map/FriendLocationMarker.vue'

export class FriendLocationsLayer extends BaseMarkerLayer {
  private layersStore = useLayersStore()
  private friendLocations = useFriendLocations()

  private tracks = new Map<string, Track>()
  private animationFrame: number | null = null
  private samplesWatchStop: WatchStopHandle | null = null

  /**
   * Hash of the "stable" props each marker was last created with.
   * Used to skip recreates when only the position changed — the rAF
   * loop handles position via `setMarkerLngLat`, so a recreate every
   * sample would be a visible jump for no benefit.
   */
  private currentMarkerSnapshots = new Map<string, string>()

  constructor() {
    const layersStore = useLayersStore()
    const isEnabled = computed(() => {
      const layer = layersStore.layers.find(
        l => l.configuration?.id === 'friends-locations'
      )
      return layer?.visible ?? false
    })

    super({
      idPrefix: 'friend-location-',
      component: FriendLocationMarker,
      enabled: isEnabled,
      zIndex: 2, // Medium priority - between waypoints and instructions
    })
  }

  /**
   * Override of base class init. We do everything the base class does
   * (mounts the create/destroy watcher), then layer on a sample
   * watcher and an rAF loop for position animation.
   */
  initialize(mapAPI: MapMarkerAPI) {
    super.initialize(mapAPI)
    this.startSampleWatcher()
    this.startAnimationLoop()
  }

  protected getData(): MarkerData[] {
    const locations = this.friendLocations.locations.value

    return locations.map(loc => ({
      id: loc.friendHandle,
      lngLat: loc.lngLat,
      props: {
        friendHandle: loc.friendHandle,
        friendAlias: loc.friendAlias,
        friendName: loc.friendName,
        friendAvatar: loc.friendPicture,
        updatedAt: loc.updatedAt,
        accuracy: loc.location.accuracy,
        battery: loc.location.battery,
        batteryCharging: loc.location.batteryCharging,
      },
    }))
  }

  /**
   * When a sample's `updatedAt` advances, build a new track that
   * tweens from the currently-rendered position (output of `predict`
   * for the prior track) to the new sample. The previous track's
   * post-velocity becomes the new track's entry tangent so Hermite
   * can smooth the curve through `from`. First sample for a friend
   * starts with no tween. Friends that drop off the list have their
   * tracks pruned; the base class's marker watcher removes the marker.
   */
  private startSampleWatcher() {
    this.samplesWatchStop = watch(
      () => {
        // Stable shape that only changes when a sample materially
        // differs — avoids noisy watcher fires from unrelated reactivity.
        return this.friendLocations.locations.value.map(loc => ({
          handle: loc.friendHandle,
          lat: loc.lngLat.lat,
          lng: loc.lngLat.lng,
          updatedAt: loc.updatedAt.getTime(),
          speed: loc.location.speed ?? null,
          heading: loc.location.heading ?? null,
        }))
      },
      (rows) => {
        const now = Date.now()
        const seen = new Set<string>()
        for (const row of rows) {
          seen.add(row.handle)
          const existing = this.tracks.get(row.handle)
          // Dedup: same sample re-delivered (e.g., reconnect refetch).
          if (existing && existing.toSampleTimestamp === row.updatedAt) continue

          const currentRendered = existing ? predict(existing, now) : null
          this.tracks.set(
            row.handle,
            buildTrack({
              currentRendered,
              previousTrack: existing ?? null,
              sample: {
                lngLat: { lat: row.lat, lng: row.lng },
                speed: row.speed,
                heading: row.heading,
                timestampMs: row.updatedAt,
              },
              now,
            }),
          )
        }
        // Drop tracks for friends that left the visible set.
        for (const handle of Array.from(this.tracks.keys())) {
          if (!seen.has(handle)) this.tracks.delete(handle)
        }
      },
      { immediate: true },
    )
  }

  /**
   * Override the base class's marker reconciliation to keep markers
   * mounted across sample arrivals. The base implementation calls
   * `removeMarker` then `addVueMarker` for every marker on every data
   * change, which causes a one-frame disappearance + re-snap to the
   * raw sample position — the visible "jump" we want to eliminate.
   *
   * Recreate strategy here: hash the props that actually warrant a
   * fresh component (friend identity, avatar URL, charging state, big
   * battery / accuracy buckets, coarsened updatedAt minute). Skip the
   * recreate when only those things AT THIS RESOLUTION are stable.
   * Position is excluded entirely — `setMarkerLngLat` from the rAF
   * loop animates it without touching the Vue instance.
   */
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
    }

    for (const oldId of this.currentMarkerIds) {
      if (!newMarkerIds.has(oldId)) {
        this.mapAPI.removeMarker(oldId)
        this.currentMarkerSnapshots.delete(oldId)
      }
    }
    this.currentMarkerIds = newMarkerIds
  }

  private snapshotProps(markerData: MarkerData): string {
    const p = markerData.props as {
      friendName?: string
      friendAvatar?: string
      updatedAt?: Date
      accuracy?: number
      battery?: number
      batteryCharging?: boolean
    }
    // Bucket continuous values so small sample-to-sample drift doesn't
    // trigger a recreate. The minute bucket on updatedAt also keeps the
    // tooltip "X min ago" text honest within ±1 min.
    return [
      p.friendName ?? '',
      p.friendAvatar ?? '',
      p.batteryCharging ? '1' : '0',
      p.battery != null ? Math.round(p.battery * 10) : 'na',
      p.accuracy != null ? Math.floor(p.accuracy / 10) : 'na',
      p.updatedAt != null ? Math.floor(p.updatedAt.getTime() / 60_000) : 'na',
    ].join('|')
  }

  /**
   * Per-frame: ask each track where its marker should be NOW and push
   * that to the maplibre marker via `setMarkerLngLat`. No-op when the
   * layer is hidden — the rAF still spins (cheap) but does no work.
   */
  private startAnimationLoop() {
    const tick = () => {
      this.animationFrame = requestAnimationFrame(tick)
      if (!this.mapAPI) return
      if (this.enabled && !this.enabled.value) return
      if (this.tracks.size === 0) return

      const now = Date.now()
      for (const [handle, track] of this.tracks) {
        const fullId = `${this.idPrefix}${handle}`
        const pos = predict(track, now)
        this.mapAPI.setMarkerLngLat(fullId, pos)
      }
    }
    this.animationFrame = requestAnimationFrame(tick)
  }

  destroy() {
    if (this.animationFrame != null) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }
    this.samplesWatchStop?.()
    this.samplesWatchStop = null
    this.tracks.clear()
    this.currentMarkerSnapshots.clear()
    super.destroy()
  }
}
