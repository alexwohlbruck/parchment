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

  map = new Map({
    accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    container: mapContainer.value,
    // style: 'mapbox://styles/mapbox/standard-beta',
    style: 'mapbox://styles/mapbox/streets-v12',
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

  // POI hover
  map.on('mousemove', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['poi-label']
    })

    if (features.length) {
      map.getCanvas().style.cursor = 'pointer'
    } else {
      map.getCanvas().style.cursor = ''
    }
  })

  // POI click popup
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point)

    if (!features.length) {
      return
    }

    const feature = features[0]

    // drop marker pin
    const marker = new Marker().setLngLat(feature.geometry.coordinates).addTo(map)
    router.push('/map/place')

    // const popup = new Popup({
    //   closeButton: false,
    //   closeOnClick: false
    // })
    //   .setLngLat(feature.geometry.coordinates)
    //   .setHTML(feature.properties.name)
    //   .addTo(map)
  })
})

onUnmounted(() => {
  map.remove()
  map = null
})
</script>
