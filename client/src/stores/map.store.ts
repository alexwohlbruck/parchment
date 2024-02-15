import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Basemap } from '../types/map.types'
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

  const activeBasemapName = ref<Basemap>('standard')

  const activeBasemap = computed(() => {
    return basemaps[activeBasemapName.value]
  })

  function setBasemap(map: Basemap) {
    activeBasemapName.value = map
  }

  return {
    mapLibrary,
    setMapLibrary,
    mapState,
    setBasemap,
    activeBasemapName,
    activeBasemap,
    // toggleLayer,
  }
})
