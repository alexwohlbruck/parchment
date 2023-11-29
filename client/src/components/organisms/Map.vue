<template>
  <div ref="mapContainer"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  Marker,
  Popup,
  Layer,
  Source,
  LngLatBounds,
  LngLat
} from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const router = useRouter()

const mapContainer = ref(null)
let map = null

onMounted(() => {
  const { lng, lat, zoom, bearing, pitch } = {
    lng: -80.8432808,
    lat: 35.2205601,
    bearing: 0,
    pitch: 0,
    zoom: 14
  }

  const transitlandApiKey = import.meta.env.VITE_TRANSITLAND_API_KEY
  // transformRequest: (url, resourceType) => { if (resourceType === 'Tile' && url.startsWith('https://transit.land')) { return { url, headers: { apikey: <YOUR_API_KEY> } } } }

  map = new Map({
    accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    container: mapContainer.value,
    // style: 'mapbox://styles/mapbox/standard-beta',
    style: 'mapbox://styles/mapbox/streets-v12',
    // style: 'mapbox://styles/mapbox/light-v11',
    center: [lng, lat],
    bearing,
    pitch,
    zoom,
    attributionControl: false
  })

  map.addControl(new NavigationControl(), 'top-right')
  map.addControl(new GeolocateControl(), 'top-right')
  map.addControl(new AttributionControl(), 'bottom-right')
  map.addControl(new ScaleControl(), 'bottom-right')

  // Transit map
  map.on('style.load', () => {
    console.log(map)

    map.addSource('cycleosm', {
      type: 'raster',
      tiles: ['https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '<a href="https://www.opencyclemap.org/">© OpenCycleMap</a>'
    })

    map.addLayer({
      id: 'cycleosm-layer',
      type: 'raster',
      source: 'cycleosm',
      minzoom: 0,
      maxzoom: 22
    })

    // Add Transitland source
    // map.addSource('routes', {
    //   type: 'vector',
    //   tiles: [
    //     `https://transit.land/api/v2/tiles/routes/tiles/{z}/{x}/{y}.pbf?apikey=${transitlandApiKey}`
    //   ],
    //   maxzoom: 14
    // })

    // map.addLayer({
    //   id: 'routes',
    //   type: 'line',
    //   source: 'routes',
    //   'source-layer': 'routes',
    //   layout: {
    //     'line-cap': 'round',
    //     'line-join': 'round',
    //     'symbol-placement': 'line',
    //     'text-field': ['get', 'route_long_name'], // use the route_name property for the text
    //     'text-size': 12,
    //     'text-offset': [0, 1] // adjust the text offset if needed,
    //   },
    //   paint: {
    //     'line-width': 2.0,
    //     'line-color': [
    //       'match',
    //       ['get', 'route_type'],
    //       0, // Tram, streetcar, light rail
    //       ['coalesce', ['get', 'route_color'], 'blue'],
    //       1, // Subway, metro
    //       ['coalesce', ['get', 'route_color'], 'blue'],
    //       2, // Rail
    //       'red', // amtrak
    //       3, // Bus
    //       ['coalesce', ['get', 'route_color'], 'lightblue'], // busses
    //       4, // Ferry
    //       'blue',
    //       5, // Cable tram
    //       'purple',
    //       6, // Aerial lift, suspended cable car
    //       'pink',
    //       7, // Funicular
    //       'brown',
    //       11, // Trolleybus
    //       'black',
    //       12, // Monorail
    //       'red',
    //       'grey' // default
    //     ],
    //     'line-opacity': [
    //       'match',
    //       ['get', 'route_type'],
    //       0, // Tram, streetcar, light rail
    //       1,
    //       1, // Subway, metro
    //       1,
    //       2, // Rail
    //       1,
    //       3, // Bus
    //       0,
    //       4, // Ferry
    //       1,
    //       5, // Cable tram
    //       1,
    //       6, // Aerial lift, suspended cable car
    //       1,
    //       7, // Funicular
    //       1,
    //       11, // Trolleybus
    //       1,
    //       12, // Monorail
    //       1,
    //       0
    //     ]
    //     // 'line-blur': 1
    //     // 'line-offset': 1
    //   }
    // })

    // // Show stops from transitland
    // map.addSource('stops', {
    //   type: 'vector',
    //   tiles: [
    //     'mapbox://styles/mapbox/streets-v12',
    //     `https://transit.land/api/v2/tiles/stops/tiles/{z}/{x}/{y}.pbf?apikey=${transitlandApiKey}`
    //   ],
    //   maxzoom: 14
    // })

    // map.addLayer({
    //   id: 'stops',
    //   type: 'circle',
    //   source: 'stops',
    //   'source-layer': 'stops',
    //   layout: {},
    //   paint: {
    //     'circle-radius': 3,
    //     'circle-color': 'grey',
    //     'circle-stroke-color': 'white',
    //     'circle-stroke-width': 1
    //   }
    // })

    // const layers = map.getStyle().layers
    // const textLayerId = layers.find(
    //   (layer) => layer.type === 'symbol' && layer.layout['text-field']
    // ).id

    // if (textLayerId) {
    //   map.moveLayer('routes', textLayerId)
    //   map.moveLayer('stops', textLayerId)
    // }
  })

  // // POI hover
  // map.on('mousemove', (e) => {
  //   const features = map.queryRenderedFeatures(e.point, {
  //     layers: ['poi-label']
  //   })

  //   if (features.length) {
  //     map.getCanvas().style.cursor = 'pointer'
  //   } else {
  //     map.getCanvas().style.cursor = ''
  //   }
  // })

  // // POI click popup
  // map.on('click', (e) => {
  //   const features = map.queryRenderedFeatures(e.point)

  //   if (!features.length) {
  //     return
  //   }

  //   const feature = features[0]

  //   const marker = new Marker().setLngLat(feature.geometry.coordinates).addTo(map)
  //   router.push('/map/place')
  // })
})

onUnmounted(() => {
  map.remove()
  map = null
})
</script>
