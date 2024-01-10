<script setup lang="ts">
import Map from "@/components/map/Map.vue";
import Palette from "@/components/palette/Palette.vue";
</script>

<template>
  <div
    class="relative z-10 h-full flex flex-col justify-center items-start pointer-events-none"
  >
    <router-view />
  </div>

  <div
    class="absolute top-0 left-1/2 transform -translate-x-1/2 p-2 z-10 w-1/2 max-w-[30rem]"
  >
    <Palette class="h-fit" />
  </div>

  <Map class="!absolute w-full h-full top-0 left-0"></Map>
</template>
