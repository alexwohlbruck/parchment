import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Basemap, MapLayer } from '../types/map.types'
import { MapLibrary, MapOptions } from '@/types/map.types'
import { basemaps } from '@/components/map/map.data'

export const useMapStore = defineStore('map', () => {
  const mapLibrary = ref<MapLibrary>('mapbox')

  function setMapLibrary(sdk: MapLibrary) {
    mapLibrary.value = sdk
  }

  const mapState = ref<MapOptions>({
    center: [-80.8432808, 35.2205601],
    zoom: 14,
    bearing: 0,
    pitch: 0,
    projection: 'web-mercator',
    theme: 'light',
    basemap: 'standard',
    layers: [],
  })

  function setBasemap(map: Basemap) {
    mapState.value.basemap = map
  }

  function toggleLayer(layer: MapLayer) {
    const index = mapState.value.layers.indexOf(layer)
    if (index === -1) {
      mapState.value.layers.push(layer)
    } else {
      mapState.value.layers.splice(index, 1)
    }
  }

  return {
    mapLibrary,
    setMapLibrary,
    mapState,
    setBasemap,
    toggleLayer,
    // toggleLayer,
  }
})
