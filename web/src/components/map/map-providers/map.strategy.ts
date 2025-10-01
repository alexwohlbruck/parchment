import {
  Basemap,
  Layer,
  MapCamera,
  MapSettings,
  MapProjection,
  MapTheme,
  MapColorTheme,
  Pegman,
  LngLat,
  Waypoint,
} from '@/types/map.types'
import { Directions, TripsResponse } from '@/types/directions.types'
import { Component } from 'vue'
import { destroyVueMarkerElement } from '@/lib/vue-marker.utils'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'

export class MapStrategy {
  mapInstance: any
  container: HTMLElement
  options: MapSettings
  accessToken?: string
  markers: Map<string, any> = new Map() // Track active markers

  constructor(container, options: MapSettings, accessToken?: string) {
    this.container = container
    this.options = options
    this.accessToken = accessToken
  }

  resize() {}
  addDataSource() {}
  flyTo(camera: Partial<MapCamera>) {}
  jumpTo(camera: Partial<MapCamera>) {}
  fitBounds(bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, options?: any) {}
  setDirections(directions: Directions) {}
  unsetDirections() {}
  setPegman(pegman: Pegman) {}
  removePegman() {}
  setPoiLabels(value: boolean) {}
  setRoadLabels(value: boolean) {}
  setTransitLabels(value: boolean) {}
  setPlaceLabels(value: boolean) {}
  setLandmarkIcons(value: boolean) {}
  setMapProjection(projection: MapProjection) {}
  setMap3dTerrain(value: boolean) {}
  setMap3dObjects(value: boolean) {}
  setMapTheme(theme: MapTheme) {}
  setMapColorTheme(theme: MapColorTheme) {}
  setBasemap(basemap: Basemap) {}
  addSource(sourceId: string, source: any) {}
  removeSource(sourceId: string) {}
  addLayer(layer: Layer, overwrite: boolean = false) {}
  removeLayer(layerId: Layer['configuration']['id']) {}
  updateLayer(layerId: Layer['configuration']['id'], updates: Partial<Layer>) {}
  toggleLayer(layerId: string, state?: boolean) {}
  toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    state?: boolean,
  ) {}
  destroy() {}
  locate() {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by your browser')
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        this.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 16,
        })
      },
      error => {
        console.error('Error getting location:', error)
      },
      {
        enableHighAccuracy: true,
      },
    )
  }

  zoomIn() {}
  zoomOut() {}
  resetNorth() {}

  getBounds(): {
    north: number
    south: number
    east: number
    west: number
  } | null {
    // This method should be overridden by specific implementations
    return null
  }

  addMarker(id: string, lngLat: LngLat) {}

  addVueMarker(
    id: string,
    lngLat: LngLat,
    component: Component,
    props: Record<string, any> = {},
  ) {}

  removeMarker(id: string) {
    const marker = this.markers.get(id)
    if (marker) {
      if (marker.getElement) {
        const element = marker.getElement()
        destroyVueMarkerElement(element)
      }
      marker.remove()
      this.markers.delete(id)
    }
  }

  removeAllMarkers() {
    this.markers.forEach(marker => {
      if (marker.getElement) {
        const element = marker.getElement()
        destroyVueMarkerElement(element)
      }
      marker.remove()
    })
    this.markers.clear()
  }

  // Trip visualization methods
  setTrips(trips: TripsResponse, visibleTripIds: Set<string>) {}
  unsetTrips() {}

  // Waypoint marker methods (separate from trip routes)
  setWaypointMarkers(waypoints: Waypoint[]) {
    // Remove existing waypoint markers
    this.clearWaypointMarkers()

    // Add new waypoint markers for all waypoints with coordinates
    waypoints.forEach((waypoint, index) => {
      if (waypoint.lngLat) {
        this.addVueMarker(
          `waypoint-${index}`,
          waypoint.lngLat,
          WaypointMapIcon,
          {
            index,
            totalWaypoints: waypoints.length,
            type:
              index === 0
                ? 'origin'
                : index === waypoints.length - 1
                ? 'destination'
                : 'waypoint',
          },
        )
      }
    })
  }

  clearWaypointMarkers() {
    // Remove waypoint markers
    const waypointMarkerIds = Array.from(this.markers.keys()).filter(id =>
      id.startsWith('waypoint-'),
    )
    waypointMarkerIds.forEach(id => this.removeMarker(id))
  }

  unsetWaypointMarkers() {
    this.clearWaypointMarkers()
  }
}
