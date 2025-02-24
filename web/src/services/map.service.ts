import {
  MapCamera,
  MapEngine,
  MapProjection,
  MapTheme,
  StreetViewType,
  type Layer,
  type MapEvents,
  MarkerIds,
  type MarkerId,
  type LngLat,
} from '@/types/map.types'
import { useMapStore } from '../stores/map.store'
import { useDirectionsStore } from '@/stores/directions.store'
import { createSharedComposable, useDark } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { MapboxStrategy } from '@/components/map/map-providers/mapbox.strategy'
import { MaplibreStrategy } from '@/components/map/map-providers/maplibre.strategy'
import { mapEventBus } from '@/lib/eventBus'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { watch } from 'vue'
import router, { AppRoute } from '@/router'
import { useRouter } from 'vue-router'

const dark = useDark()

function mapService() {
  const mapStore = useMapStore()
  const directionsStore = useDirectionsStore()
  const { enabledLayers } = storeToRefs(mapStore)
  const router = useRouter()
  let mapStrategy: MapStrategy
  let mapContainer: HTMLElement

  function getMapStrategy(
    container: string | HTMLElement,
    mapEngine: MapEngine,
  ) {
    const { mapOptions, mapCamera } = mapStore

    const options = {
      ...mapOptions,
      theme: dark.value ? MapTheme.DARK : MapTheme.LIGHT,
      camera: mapCamera,
    }

    switch (mapEngine) {
      case MapEngine.MAPBOX:
        return new MapboxStrategy(container, options)
      case MapEngine.MAPLIBRE:
        return new MaplibreStrategy(container, options)
    }
  }

  function initializeMap(container: HTMLElement, mapEngine: MapEngine) {
    mapContainer = container as HTMLElement
    mapStrategy = getMapStrategy(container, mapEngine)
    mapStore.setMapStrategy(mapStrategy)

    mapEventBus.on('load', () => {
      mapStore.initializeLayers(enabledLayers.value)
    })

    mapEventBus.on('style.load', () => {
      mapStore.initializeLayers(enabledLayers.value)
    })

    mapEventBus.on('moveend', data => {
      mapStore.setMapCamera(data)
    })

    mapEventBus.on('click:mapillary-image', ({ lngLat, image }) => {
      if (image) {
        mapStrategy.flyTo({
          center: lngLat,
        })
        router.push({
          name: AppRoute.STREET,
          params: {
            id: image.id,
          },
        })
      }
    })

    mapEventBus.on('click:poi', ({ osmId, poiType, lngLat }) => {
      if (lngLat) {
        // Remove any existing POI markers
        mapStrategy.removeAllMarkers()

        // Add marker at clicked location
        mapStrategy.addMarker(MarkerIds.SELECTED_POI, lngLat)

        // Fly to location
        mapStrategy.flyTo({
          center: lngLat,
          zoom: 17,
        })
      }

      router.push({
        name: AppRoute.PLACE,
        params: {
          type: poiType,
          id: osmId,
        },
      })
    })

    return mapStrategy
  }

  function flyTo(camera: Partial<MapCamera>) {
    mapStrategy.flyTo(camera)
  }

  function jumpTo(camera: Partial<MapCamera>) {
    mapStrategy.jumpTo(camera)
  }

  function setMapEngine(mapEngine: MapEngine) {
    destroy()
    mapStore.setMapEngine(mapEngine)
    mapStrategy = initializeMap(mapContainer, mapEngine)
  }

  function setMapProjection(projection: MapProjection) {
    mapStore.setMapProjection(projection)
  }

  watch(
    () => mapStore.mapProjection,
    projection => {
      mapStrategy?.setMapProjection(projection)
    },
  )

  function toggle3dTerrain(value?: boolean) {
    mapStore.setMap3dTerrain(value)
  }

  watch(
    () => mapStore.map3dTerrain,
    value => {
      mapStrategy?.setMap3dTerrain(value)
    },
  )

  function toggle3dBuildings(value?: boolean) {
    mapStore.setMap3dBuildings(value)
  }

  watch(
    () => mapStore.map3dBuildings,
    value => {
      mapStrategy?.setMap3dBuildings(value)
    },
  )

  function togglePoiLabels(value?: boolean) {
    mapStore.setMapPoiLabels(value)
  }

  watch(
    () => mapStore.mapPoiLabels,
    value => {
      mapStrategy?.setPoiLabels(value)
    },
  )

  function toggleRoadLabels(value?: boolean) {
    mapStore.setMapRoadLabels(value)
  }

  watch(
    () => mapStore.mapRoadLabels,
    value => {
      mapStrategy?.setRoadLabels(value)
    },
  )

  function toggleTransitLabels(value?: boolean) {
    mapStore.setMapTransitLabels(value)
  }

  watch(
    () => mapStore.mapTransitLabels,
    value => {
      mapStrategy?.setTransitLabels(value)
    },
  )

  function togglePlaceLabels(value?: boolean) {
    mapStore.setMapPlaceLabels(value)
  }

  watch(
    () => mapStore.mapPlaceLabels,
    value => {
      mapStrategy?.setPlaceLabels(value)
    },
  )

  function resize() {
    mapStrategy.resize()
  }

  watch(dark, newDark => {
    mapStrategy.setMapTheme(newDark ? MapTheme.DARK : MapTheme.LIGHT)
  })

  watch(
    () => mapStore.pegman,
    (pegman, oldPegman) => {
      if (pegman) {
        mapStrategy.setPegman(pegman)
      }
    },
  )

  watch(
    () => router.currentRoute.value.name,
    (routeName, oldRouteName) => {
      if (oldRouteName === AppRoute.STREET && routeName !== AppRoute.STREET) {
        mapStrategy.removePegman()
      }
    },
  )

  watch(
    () => mapStore.mapOptions.basemap,
    basemap => {
      mapStrategy.setBasemap(basemap)
    },
  )

  watch(
    () => directionsStore.directions,
    directions => {
      if (directions) {
        mapStrategy.setDirections(directions)
      } else {
        mapStrategy.unsetDirections()
      }
    },
  )

  function toggleLayer(layerId: Layer['configuration']['id'], state?: boolean) {
    mapStore.toggleLayer(layerId, state)
  }

  function toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    state?: boolean,
  ) {
    if (state === undefined) {
      state = !mapStore.layers.find(layer => layer.configuration.id === layerId)
        ?.visible
    }
    mapStore.toggleLayerVisibility(layerId, state)
  }

  function destroy() {
    // Remove event listeners
    // TODO: Automatically remove all listeners without explicitly naming them
    mapEventBus.off('load')
    mapEventBus.off('style.load')
    mapStrategy.destroy() // Remove map instance
  }

  /**
   * Map events
   */
  function on<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    mapStore.on(event, handler)
  }

  function off<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    mapStore.off(event, handler)
  }

  function emit<K extends keyof MapEvents>(event: K, data: MapEvents[K]) {
    mapStore.emit(event, data)
  }

  return {
    initializeMap,
    resize,
    toggleLayer,
    toggleLayerVisibility,
    flyTo,
    jumpTo,
    setMapEngine,
    setMapProjection,
    toggle3dTerrain,
    toggle3dBuildings,
    togglePoiLabels,
    toggleRoadLabels,
    toggleTransitLabels,
    togglePlaceLabels,
    destroy,
    on,
    off,
    emit,
    setPegman: mapStore.setPegman,
    clearPegman: mapStore.clearPegman,
    addMarker: (id: MarkerId, lngLat: LngLat) =>
      mapStrategy.addMarker(id, lngLat),
    removeAllMarkers: () => mapStrategy.removeAllMarkers(),
  }
}

export const useMapService = createSharedComposable(mapService)
