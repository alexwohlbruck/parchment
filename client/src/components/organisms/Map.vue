<template>
  <div ref="mapContainer"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

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

  map = new mapboxgl.Map({
    accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    container: mapContainer.value,
    style: 'mapbox://styles/mapbox/standard-beta',
    center: [lng, lat],
    bearing,
    pitch,
    zoom
  })
})

onUnmounted(() => {
  map.remove()
  map = null
})
</script>
