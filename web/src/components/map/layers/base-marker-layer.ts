/**
 * Base Marker Layer
 * 
 * Abstract base class for reactive marker layers that automatically sync with store state.
 * Each marker layer watches a specific piece of state and updates markers on the map accordingly.
 */

import { watch, type Ref, type WatchStopHandle } from 'vue'
import type { Component } from 'vue'
import type { LngLat } from '@/types/map.types'

export interface MarkerLayerConfig {
  /** Unique prefix for marker IDs in this layer */
  idPrefix: string
  /** Vue component to render for each marker */
  component: Component
  /** Whether the layer is currently enabled */
  enabled?: Ref<boolean>
}

export interface MarkerData {
  /** Unique identifier for this marker within the layer */
  id: string
  /** Geographic coordinates */
  lngLat: LngLat
  /** Props to pass to the Vue component */
  props: Record<string, any>
}

export interface MapMarkerAPI {
  addVueMarker(id: string, lngLat: LngLat, component: Component, props: Record<string, any>): void
  removeMarker(id: string): void
  hasMarker(id: string): boolean
}

/**
 * Base class for marker layers
 * Subclasses implement `getData()` to provide reactive marker data
 */
export abstract class BaseMarkerLayer {
  protected idPrefix: string
  protected component: Component
  protected enabled: Ref<boolean> | undefined
  protected mapAPI: MapMarkerAPI | null = null
  protected watchStop: WatchStopHandle | null = null
  protected currentMarkerIds = new Set<string>()

  constructor(config: MarkerLayerConfig) {
    this.idPrefix = config.idPrefix
    this.component = config.component
    this.enabled = config.enabled
  }

  /**
   * Subclasses must implement this to provide reactive marker data
   */
  protected abstract getData(): MarkerData[]

  /**
   * Initialize the layer with map API
   */
  initialize(mapAPI: MapMarkerAPI) {
    this.mapAPI = mapAPI
    this.setupWatcher()
  }

  /**
   * Set up reactive watcher to sync markers with data
   */
  protected setupWatcher() {
    // Watch the data and update markers reactively
    this.watchStop = watch(
      () => this.getData(),
      (newData) => {
        this.updateMarkers(newData)
      },
      { deep: true, immediate: true }
    )

    // If enabled ref is provided, watch it to show/hide markers
    if (this.enabled) {
      watch(
        this.enabled,
        (isEnabled) => {
          if (!isEnabled) {
            this.clear()
          } else {
            this.updateMarkers(this.getData())
          }
        }
      )
    }
  }

  /**
   * Update markers on the map to match current data
   */
  protected updateMarkers(data: MarkerData[]) {
    if (!this.mapAPI) return
    if (this.enabled && !this.enabled.value) return

    const newMarkerIds = new Set<string>()

    // Add or update markers
    data.forEach(markerData => {
      const fullId = `${this.idPrefix}${markerData.id}`
      newMarkerIds.add(fullId)

      // Remove existing marker if it exists (to force re-render with new props)
      if (this.mapAPI!.hasMarker(fullId)) {
        this.mapAPI!.removeMarker(fullId)
      }
      
      // Add marker with current props
      this.mapAPI!.addVueMarker(
        fullId,
        markerData.lngLat,
        this.component,
        markerData.props
      )
    })

    // Remove markers that are no longer in the data
    for (const oldId of this.currentMarkerIds) {
      if (!newMarkerIds.has(oldId)) {
        this.mapAPI!.removeMarker(oldId)
      }
    }

    this.currentMarkerIds = newMarkerIds
  }

  /**
   * Clear all markers in this layer
   */
  clear() {
    if (!this.mapAPI) return

    for (const id of this.currentMarkerIds) {
      this.mapAPI.removeMarker(id)
    }
    this.currentMarkerIds.clear()
  }

  /**
   * Destroy the layer and clean up watchers
   */
  destroy() {
    this.watchStop?.()
    this.clear()
    this.mapAPI = null
  }
}
