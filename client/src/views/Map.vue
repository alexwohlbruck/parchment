<script setup lang="ts">
import Map from "../components/Map.vue";
import Palette from "../components/Palette.vue";
</script>

<template>
  <div class="column w-full h-full p-0">
    <div
      class="absolute top-0 left-1/2 transform -translate-x-1/2 p-2 z-10 w-1/2 max-w-[30rem]"
    >
      <Palette class="h-fit" />
    </div>

    <router-view class="z-2" />
    <Map class="!absolute w-full h-full top-0 left-0"></Map>
  </div>
</template>
