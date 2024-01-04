<script setup lang="ts">
import Map from "../components/Map.vue";
</script>

<template>
  <div class="column w-full h-full p-0">
    <router-view class="z-2" />
    <Map class="!absolute w-full h-full top-0 left-0"></Map>
  </div>
</template>
