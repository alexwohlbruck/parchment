import { MapStrategy } from './map.strategy'
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  Projection,
  Marker,
  LngLatBounds,
} from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Basemap, MapLayer, MapOptions, type MapTheme } from '@/types/map.types'
import standardStyle from '@/components/map/styles/standard.json'

import { layers } from '../layers' // TODO: Refactor layers init
import { Locale } from '@/lib/i18n'
import { Directions } from '@/types/directions.types'
import { decodeShape } from '@/lib/utils'
import colors from 'tailwindcss/colors'
import { useMapStore } from '@/stores/map.store'

const basemapUrls: {
  [key in Basemap]: string
} = {
  // standard: standardStyle as any,
  standard: 'mapbox://styles/mapbox/standard',
  hybrid: 'mapbox://styles/mapbox/satellite-streets-v11',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
}

declare module 'mapbox-gl' {
  interface Map {
    setConfigProperty: (
      importId: string,
      configName: string,
      value: any,
    ) => this
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
  map: Map

  constructor(container, options?: Partial<MapOptions>) {
    super(container, options)

    // For testing
    const { lng, lat, zoom, bearing, pitch } = {
      lng: -80.8432808,
      lat: 35.2205601,
      bearing: 0,
      pitch: 0,
      zoom: 14,
    }
    const projection: Projection['name'] =
      (localStorage.getItem('projection') as Projection['name']) || 'globe'

    const map = new Map({
      accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
      container,
      style: standardStyle as any,
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
    this.initialize()
  }

  initialize() {
    this.addControls()
    this.map.on('load', () => {
      this.setLayers(this.options.layers)
    })
    this.map.on('style.load', () => {
      this.setMapTheme(this.options.theme)
      this.setLocale('en-US')
    })
    this.configureEventListeners()
  }

  onMapLoad() {
    this.setLayers.bind(this)(this.options.layers)
  }

  onStyleLoad() {
    this.setMapTheme.bind(this)(this.options.theme)
    this.setLocale('en-US')
  }

  addControls() {
    this.map.addControl(new ScaleControl(), 'top-left')
    this.map.addControl(new NavigationControl(), 'top-right')
    this.map.addControl(new GeolocateControl(), 'top-right')
    this.map.addControl(
      new AttributionControl({
        compact: true,
      }),
      'top-left',
    )
  }

  configureEventListeners() {
    const mapStore = useMapStore()

    this.map.on('click', e => [
      mapStore.emit('map:click', {
        coordinates: e.lngLat.toArray(),
        point: e.point,
      }),
    ])
  }

  // TODO:
  listenPOIClick() {
    let selectedBuildings = []
    this.map.addInteraction('building-click', {
      type: 'click',
      target: { featuresetId: 'buildings', importId: 'basemap' },
      handler: e => {
        console.log(e.feature)
        // this.map.setFeatureState(e.feature, { select: !e.feature.state.select })
        // selectedBuildings.push(e.feature)
      },
    })

    // TODO: Handle POI Clicks
    // Watching this discussion: https://github.com/mapbox/mapbox-gl-js/issues/13332#issuecomment-2545008324
    let selectedPoi = null
    const poiMarker = new Marker({ color: 'red' })
    poiMarker.getElement().style.cursor = 'pointer'
    this.map.addInteraction('poi-click', {
      type: 'click',
      target: { featuresetId: 'poi', importId: 'basemap' },
      handler: e => {
        console.log(e.feature)
      },
    })
  }

  setLayers(layerIds: MapLayer[]) {
    const style = this.map.getStyle()
    if (!style) return
    const mapLayers = style.layers
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

  setDirections(directions: Directions) {
    this.unsetDirections()

    directions.legs.forEach((leg, index) => {
      const shape = decodeShape(leg.shape)

      this.map.addSource(`route-${index}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: shape.map(([lat, lon]) => [lon, lat]),
          },
        },
      })

      this.map.addLayer({
        id: `route-case-${index}`,
        type: 'line',
        source: `route-${index}`,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': colors.green[600],
          'line-width': 8,
          'line-emissive-strength': 1,
        },
        slot: 'middle',
      })

      this.map.addLayer({
        id: `route-${index}`,
        type: 'line',
        source: `route-${index}`,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': colors.green[400],
          'line-width': 5,
          'line-emissive-strength': 1,
        },
        slot: 'middle',
      })
    })

    // Add markers for each stop
    directions.locations.forEach((location, index) => {
      this.map.addSource(`stop-${index}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [location.lon, location.lat],
          },
        },
      })

      // Add a larger background circle
      this.map.addLayer({
        id: `stop-background-${index}`,
        type: 'circle',
        source: `stop-${index}`,
        paint: {
          'circle-radius': 7,
          'circle-color': colors.gray[50],
          'circle-opacity': 1,
          'circle-stroke-width': 1,
          'circle-stroke-color': colors.gray[600],
          'circle-blur': 0.3,
          'circle-emissive-strength': 1,
        },
        slot: 'middle',
      })
    })

    // Get all route coordinates
    const allCoordinates: mapboxgl.LngLatLike[] = directions.legs.flatMap(
      leg => {
        const shape = decodeShape(leg.shape)
        return shape.map(([lat, lon]) => [lon, lat] as mapboxgl.LngLatLike)
      },
    )

    // Create a bounds object that encompasses all coordinates
    const bounds = allCoordinates.reduce((bounds, coord) => {
      return bounds.extend(coord)
    }, new LngLatBounds(allCoordinates[0], allCoordinates[0]))

    // Fit the map to show the entire route with padding
    this.map.fitBounds(bounds, {
      padding: Math.min(window.innerWidth * 0.2, 400),
      duration: 400,
      easing: t => t * (2 - t),
      bearing: this.map.getBearing(), // Preserve current bearing
    })
  }

  unsetDirections() {
    const style = this.map.getStyle()
    if (!style) return
    const mapLayers = style.layers
    const ids = mapLayers.map(layer => layer.id)

    // Remove route and stop layers
    ids.forEach(id => {
      if (id.startsWith('route-') || id.startsWith('stop-')) {
        this.map.removeLayer(id)
      }
    })

    // Remove route sources
    const sources = Object.keys(this.map.getStyle().sources)
    sources.forEach(source => {
      if (source.startsWith('route-') || source.startsWith('stop-')) {
        this.map.removeSource(source)
      }
    })
  }

  togglePoiLabels(value: boolean) {
    this.map.setConfigProperty('basemap', 'showPointOfInterestLabels', value)
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
