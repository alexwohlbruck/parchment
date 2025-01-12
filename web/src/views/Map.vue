<script setup lang="ts">
import { useRoute } from 'vue-router'
import Map from '@/components/map/Map.vue'
const route = useRoute()
</script>

<template>
  <div
    class="relative z-20 h-full flex flex-col justify-center pointer-events-none"
  >
    <div class="pointer-events-auto w-fit">
      <router-view v-if="!route.meta.dialog" />
    </div>
  </div>

  <Map class="!absolute w-full h-full top-0 left-0"></Map>
</template>
