import { MapStrategy } from './map.strategy'
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  Projection,
  PointLike,
} from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Basemap, MapLayer, MapOptions, type MapTheme } from '@/types/map.types'
import standardStyle from '@/components/map/styles/standard.json'
import streets12 from '@/components/map/styles/streets-12.json'
import testStyle from '@/components/map/styles/test.json'
import maptiler from '@/components/map/styles/maptiler-streets-v2.json'

import { layers } from '../layers' // TODO: Refactor layers init
import { Locale } from '@/lib/i18n'

import trash from '@/assets/3d/trash.glb'

const basemapUrls: {
  [key in Basemap]: string
} = {
  standard: standardStyle as any,
  // standard: maptiler as any,
  // standard: testStyle as any,
  // standard: streets12 as any,
  // standard: 'mapbox://styles/mapbox/standard',
  // standard: 'mapbox://styles/mapbox/streets-v12',
  hybrid: 'mapbox://styles/mapbox/satellite-streets-v11',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
}

declare module 'mapbox-gl' {
  interface Map {
    setConfigProperty: (namespace: string, key: string, value: any) => void
  }
}

// Guard decorator to ensure the basemap is loaded
function ifBasemapLoaded(target, name, descriptor) {
  const original = descriptor.value
  descriptor.value = function (...args) {
    if (this.map.style.fragments?.some((f: any) => f.id === 'basemap')) {
      original.apply(this, args)
    }
  }
  return descriptor
}

export class MapboxStrategy extends MapStrategy {
  // instance of mapbox `Map`
  map: Map

  constructor(container, options?: Partial<MapOptions>) {
    super(container, options)

    // For testing
    const { lng, lat, zoom, bearing, pitch } = {
      lng: -80.82406421137776,
      lat: 35.21608791694442,
      bearing: 0,
      pitch: 0,
      zoom: 17.48911968031299,
    }
    const projection: Projection['name'] =
      (localStorage.getItem('projection') as Projection['name']) || 'globe'

    const map = new Map({
      accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
      container,
      style: {
        ...(standardStyle as any),
        models: {
          ...(standardStyle.models as any),
          trash,
        },
      },
      center: [lng, lat],
      bearing,
      pitch,
      zoom,
      attributionControl: false,
      projection: {
        name: projection,
      },
    })

    this.map = map
    window.m = map

    this.initialize()
  }

  initialize() {
    this.map.addControl(new ScaleControl(), 'top-left')
    this.map.addControl(new NavigationControl(), 'top-right')
    this.map.addControl(new GeolocateControl(), 'top-right')
    this.map.addControl(
      new AttributionControl({
        compact: true,
      }),
      'top-left',
    )

    // this.map.on('moveend', () => {
    //   console.log(`Position: ${this.map.getCenter()}`)
    //   console.log(`Zoom: ${this.map.getZoom()}`)
    //   console.log(`Pitch: ${this.map.getPitch()}`)
    //   console.log(`Bearing: ${this.map.getBearing()}`)
    // })

    this.map.on('load', () => {
      // this.setLayers.bind(this)(this.options.layers)
      // this.map.addSource('composite', {
      //   type: 'vector',
      //   url: 'mapbox://mapbox.mapbox-bathymetry-v2,mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2,mapbox.mapbox-models-v1',
      // })
      // ;(basemapUrls.standard as any).layers.forEach(layer => {
      //   if (layer.id === 'poi-label') {
      //     console.log(layer)
      //     this.map.addLayer(layer)
      //   }
      // })
    })
    this.map.on('style.load', () => {
      this.setMapTheme.bind(this)(this.options.theme)
      this.setLocale('en-US')
      this.enable3dTerrain()
    })
  }

  setLocale(locale: Locale) {
    // TODO:
    const languageCode = locale.split('-')[0]
    // console.log(this.map.getStyle())
    // this.language.setLanguage(this.map.getStyle(), languageCode)

    // const labelList = this.map
    //   .getStyle()
    //   .imports![0].data.layers.filter(layer => {
    //     return /-label/.test(layer.id)
    //   })

    // const labelList = [{ id: 'country-label' }]

    // console.log(this.map)

    // for (let labelLayer of labelList) {
    //   this.map.setLayoutProperty(labelLayer.id, 'text-field', [
    //     'get',
    //     'name_fr',
    //   ])
    // }
  }

  setLayers(layerIds: MapLayer[]) {
    const mapLayers = this.map.getStyle().layers
    const ids = mapLayers.map(layer => layer.id)
    ids.forEach((id: any) => {
      if (!layerIds.includes(id)) {
        this.map.removeLayer(id)
      }
    })

    layerIds.forEach(layerId => {
      const childLayers = layers[layerId].layers
      childLayers.forEach(layer => {
        const { meta, source } = layer
        const id = source.id
        if (!this.map.getSource(id)) {
          this.map.addSource(id, {
            ...source,
            id,
          } as any) // TODO: Fix type
        }

        this.map.addLayer({
          source: id,
          id,
          ...meta,
          slot: 'middle',
        })
      })
    })
  }

  togglePoiLabels(value: boolean) {
    this.map.setConfigProperty('basemap', 'showPointOfInterestLabels', value)
  }

  enable3dTerrain() {
    this.map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
    })
    this.map.setTerrain({ source: 'mapbox-dem', exaggeration: 1 })
  }

  @ifBasemapLoaded
  setMapTheme(theme: MapTheme) {
    const themeMap: { [key in MapTheme]: string } = {
      light: 'day',
      dark: 'night',
    }
    const lightPreset = themeMap[theme]
    this.map.setConfigProperty('basemap', 'lightPreset', lightPreset)
  }

  setBasemap(basemap: Basemap) {
    const url = basemapUrls[basemap]
    this.map.setStyle(url)
  }

  addDataSource() {
    console.log('MapboxStrategy: adding data source')
  }

  addLayer() {
    console.log('MapboxStrategy: adding layer')
  }

  remove() {
    this.map.remove()
  }
}
