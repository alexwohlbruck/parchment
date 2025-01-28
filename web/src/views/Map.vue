<script setup lang="ts">
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import Map from '@/components/map/Map.vue'
import { TransitionExpand } from '@morev/vue-transitions'
import StreetView from '@/components/map/StreetView.vue'

const route = useRoute()
const mapStore = useMapStore()

const { streetView } = storeToRefs(mapStore)
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

  <div
    class="w-full absolute bottom-[7.5rem] md:bottom-0 right-0 z-50 p-2 flex flex-col gap-2 items-end pointer-events-none"
  >
    <LayerControls />

    <TransitionExpand>
      <StreetView
        v-if="streetView"
        :image="streetView"
        class="pointer-events-auto rounded-lg shadow-md w-full md:w-[40vw] aspect-video"
      />
    </TransitionExpand>
  </div>
</template>
