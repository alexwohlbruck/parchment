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

import geojson from '../../assets/charlotte.json'

const router = useRouter()

const mapContainer = ref(null)
let map = null

onMounted(() => {
  const { lng, lat, zoom, bearing, pitch } = {
    // lng: -80.8432808,
    // lat: 35.2205601,
    lng: -80.3759767,
    lat: 35.4976205,
    bearing: 0,
    pitch: 0,
    zoom: 10
  }

  const transitlandApiKey = import.meta.env.VITE_TRANSITLAND_API_KEY
  // transformRequest: (url, resourceType) => { if (resourceType === 'Tile' && url.startsWith('https://transit.land')) { return { url, headers: { apikey: <YOUR_API_KEY> } } } }

  map = new Map({
    accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    container: mapContainer.value,
    // style: 'mapbox://styles/mapbox/standard-beta',
    // style: 'mapbox://styles/mapbox/streets-v12',
    style: 'mapbox://styles/mapbox/light-v11',
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

  map.on('style.load', () => {
    console.log(map)

    map.addLayer({
      id: 'polygon',
      type: 'fill',
      source: {
        type: 'vector',
        url: 'http://localhost:3000/planet_osm_polygon'
      },
      'source-layer': 'planet_osm_polygon',
      paint: {
        'fill-outline-color': 'lightgrey'
      }
    })

    map.addLayer({
      id: 'line',
      type: 'line',
      source: {
        type: 'vector',
        url: 'http://localhost:3000/planet_osm_line'
      },
      'source-layer': 'planet_osm_line',
      paint: {
        'line-color': 'green',
        'line-width': 1
      }
    })

    map.addLayer({
      id: 'point',
      type: 'circle',
      source: {
        type: 'vector',
        url: 'http://localhost:3000/planet_osm_point'
      },
      'source-layer': 'planet_osm_point',
      paint: {
        'circle-color': 'blue',
        'circle-radius': 2
      }
    })

    map.addLayer({
      id: 'roads',
      type: 'line',
      source: {
        type: 'vector',
        url: 'http://localhost:3000/planet_osm_roads'
      },
      'source-layer': 'planet_osm_roads',
      paint: {
        'line-color': 'red',
        'line-width': 1
      }
    })

    //////////////////// // // LOOM maps
    // map.addSource('transit-source', {
    //   type: 'vector',
    //   tiles: ['https://loom.cs.uni-freiburg.de/tiles/subway-lightrail/geo/{z}/{x}/{y}.mvt'],
    //   minzoom: 0,
    //   maxzoom: 20
    // })

    // // // Add layers using loomStyles
    // const loomStyles = {
    //   lines: {
    //     type: 'line',
    //     'line-cap': 'round',
    //     'line-join': 'round',
    //     'line-width': 5,
    //     'line-color': ['concat', '#', ['get', 'color']],
    //     'line-opacity': 1
    //   },
    //   'inner-connections': {
    //     type: 'line',
    //     'line-cap': 'round',
    //     'line-join': 'round',
    //     'line-width': 5,
    //     'line-color': ['concat', '#', ['get', 'color']],
    //     'line-opacity': 1
    //   },
    //   stations: {
    //     type: 'fill',
    //     'line-cap': ['get', 'lineCap'],
    //     weight: ['get', 'weight'],
    //     'line-color': ['concat', '#', ['get', 'color']],
    //     'line-opacity': ['get', 'opacity'],
    //     'fill-color': ['concat', '#', ['get', 'fillColor']],
    //     'fill-opacity': 1,
    //     fill: true
    //   }
    // }

    // for (const layerId in loomStyles) {
    //   map.addLayer({
    //     id: layerId,
    //     type: loomStyles[layerId].type,
    //     source: 'transit-source',
    //     'source-layer': layerId,
    //     layout: {},
    //     paint: loomStyles[layerId]
    //   })
    // }

    //////////////// Custom .mbtiles vector tiles
    // http://localhost:3650/api/tiles/nc-racks-2024-01-25-21-49-55/tiles.json
    // map.addSource('racks', {
    //   type: 'vector',
    //   tiles: ['http://localhost:3650/api/tiles/nc-racks-2024-01-25-21-49-55/{z}/{x}/{y}'],
    //   tileSize: 512
    // })

    // map.addLayer({
    //   id: 'racks-layer',
    //   type: 'circle',
    //   source: 'racks',
    //   'source-layer': 'points',
    //   minzoom: 0,
    //   maxzoom: 22,
    //   paint: {
    //     'circle-radius': 4,
    //     'circle-color': 'red',
    //     'circle-stroke-color': 'white',
    //     'circle-stroke-width': 1
    //   }
    // })

    // https://transitapp-data.com/tile/android/transit/tile-262-381.tile

    // map.addSource('custom-tile-source', {
    //   type: 'vector',
    //   tiles: ['https://transitapp-data.com/tile/android/transit/tile-{x}-{y}.tile'],
    //   tileSize: 256
    // })

    // // Add a layer using the custom tile source
    // map.addLayer({
    //   id: 'custom-tile-layer',
    //   type: 'line',
    //   source: 'custom-tile-source',
    //   'source-layer': 'your-source-layer', // Replace with the actual source layer name from your vector tiles
    //   paint: {
    //     'fill-color': 'rgba(255, 0, 0, 0.5)', // Replace with your desired fill color
    //     'fill-outline-color': 'rgba(255, 0, 0, 1)' // Replace with your desired outline color
    //   }
    // })

    // // CyclOSM
    // map.addSource('cycleosm', {
    //   type: 'raster',
    //   tiles: ['https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'],
    //   tileSize: 256,
    //   attribution: '<a href="https://www.opencyclemap.org/">© OpenCycleMap</a>'
    // })

    // map.addLayer({
    //   id: 'cycleosm-layer',
    //   type: 'raster',
    //   source: 'cycleosm',
    //   minzoom: 0,
    //   maxzoom: 22
    // })

    ///////

    ///////////////////// MapTiler vector cycle paths
    //https://api.maptiler.com/maps/6c3893ea-7a3b-4ece-bddf-fb11520ac347/style.json?key=UBdoOia18CaufO2hbWyZ
    // map.addSource('cycle-paths', {
    //   type: 'vector',
    //   tiles: [
    //     'https://api.maptiler.com/maps/6c3893ea-7a3b-4ece-bddf-fb11520ac347/tiles/{z}/{x}/{y}.pbf?key=UBdoOia18CaufO2hbWyZ'
    //   ],
    //   minzoom: 0,
    //   maxzoom: 22
    // })

    // map.addLayer({
    //   id: 'cycle-paths',
    //   type: 'line',
    //   source: 'cycle-paths',
    //   'source-layer': 'roads',
    //   filter: ['==', 'class', 'path'],
    //   paint: {
    //     'line-color': cyclewayColor,
    //     'line-width': cyclePathWidth
    //   },
    //   minzoom: 10
    // })

    ////////////////////

    // Show cycle paths from mapbox streets

    const cyclewayColor = '#66cb6e'
    const cyclePathWidth = 4
    const cycleLaneWidth = 3

    // Create zoom-dependent offset for cycle lanes
    // Smaller value for lower
    // Interpolate cycleLaneOffsetRight, cycleLaneOffsetLeft based on zoom level
    // Keep the cycle lanes on the sides of the road
    // Use cycleLaneOffsetFactor to adjust the offset
    const cycleLaneOffsetFactor = 8

    // get larger with higher zoom
    const cycleLaneOffsetRight = [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      0,
      22,
      ['/', ['zoom'], cycleLaneOffsetFactor]
    ]

    const cycleLaneDashArray = [2, 2]

    // Show OSM cycle paths and cycle/foot paths
    // map.addLayer({
    //   id: 'cycle-paths',
    //   type: 'line',
    //   source: 'composite',
    //   'source-layer': 'road',
    //   // filter class path, type cycleway
    //   filter: ['all', ['==', 'class', 'path'], ['==', 'type', 'cycleway']],
    //   paint: {
    //     'line-color': cyclewayColor,
    //     'line-width': cyclePathWidth
    //   },
    //   minzoom: 10
    // })

    // Set source layer road to always show cycle lanes no matter the zoom level

    // map.addLayer({
    //   id: 'bike-lanes-right',
    //   type: 'line',
    //   source: 'composite',
    //   'source-layer': 'road',
    //   filter: ['==', 'bike_lane', 'right'],
    //   paint: {
    //     'line-color': cyclewayColor,
    //     'line-width': cycleLaneWidth,
    //     'line-offset': cycleLaneOffsetRight,
    //     'line-dasharray': cycleLaneDashArray
    //   }
    // })
    // map.addLayer({
    //   id: 'bike-lanes-left',
    //   type: 'line',
    //   source: 'composite',
    //   'source-layer': 'road',
    //   filter: ['==', 'bike_lane', 'left'],
    //   paint: {
    //     'line-color': cyclewayColor,
    //     'line-width': cycleLaneWidth,
    //     'line-offset': cycleLaneOffsetLeft,
    //     'line-dasharray': cycleLaneDashArray
    //   }
    // })
    // map.addLayer({
    //   id: 'bike-lanes-both',
    //   type: 'line',
    //   source: 'composite',
    //   'source-layer': 'road',
    //   filter: ['==', 'bike_lane', 'both'],
    //   paint: {
    //     'line-color': cyclewayColor,
    //     'line-width': cycleLaneWidth,
    //     'line-dasharray': cycleLaneDashArray
    //     // TODO: Add two lines, one on each side of the road.
    //   }
    // })

    ////////

    // // Add transit geojson from local file
    // map.addSource('geojson-source', {
    //   type: 'geojson',
    //   data: geojson
    // })

    // // Add bus lines from GTFS
    // map.addLayer({
    //   id: 'geojson-layer',
    //   type: 'line',
    //   source: 'geojson-source',
    //   layout: {},
    //   paint: {
    //     // fill color of the line
    //     'fill-color': ['get', 'color'],
    //     'fill-opacity': 0.8
    //   }
    // })

    // // Add Transitland source
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
    //   slot: 'middle',
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
    //       1,
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
