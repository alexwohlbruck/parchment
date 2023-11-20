<script setup lang="ts">
import Mapbox from 'mapbox-gl'
import { MglMap } from 'vue-mapbox'

import 'mapbox-gl/dist/mapbox-gl.css'

let mapbox

console.log(import.meta.env)

const config = {
  accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
  mapStyle: 'mapbox://styles/mapbox/standard-beta'
}
</script>

<template>
  <MglMap :accessToken="config.accessToken" :mapStyle="config.mapStyle" />
</template>
