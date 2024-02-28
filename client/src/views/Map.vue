<script setup lang="ts">
import Map from '@/components/map/Map.vue'
</script>

<template>
  <div
    class="relative z-10 h-full flex flex-col justify-center items-start pointer-events-none"
  >
    <router-view />
  </div>

  <Map class="!absolute w-full h-full top-0 left-0"></Map>
</template>
