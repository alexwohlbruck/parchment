<script setup lang="ts">
import { useRoute } from 'vue-router'
import Map from '@/components/map/Map.vue'

const route = useRoute()
</script>

<template>
  <div
    class="relative z-10 h-full flex flex-col justify-center items-start pointer-events-none"
  >
    <router-view v-if="!route.meta.modal" />
  </div>

  <Map class="!absolute w-full h-full top-0 left-0"></Map>
</template>
