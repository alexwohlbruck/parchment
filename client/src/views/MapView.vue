<script setup lang="ts">
import Map from '../components/organisms/Map.vue'
</script>

<template>
  <div class="flex flex-column w-full h-full">
    <router-view class="z-2" />
    <Map class="absolute w-full h-full top-0 left-0" style="z-index: 1"></Map>
  </div>
</template>
