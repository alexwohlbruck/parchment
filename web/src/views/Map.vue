<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'

import { TransitionExpand } from '@morev/vue-transitions'
import { Button } from '@/components/ui/button'
import { Maximize2Icon, XIcon } from 'lucide-vue-next'
import Map from '@/components/map/Map.vue'
import StreetView from '@/components/map/StreetView.vue'
import LayerControls from '@/components/map/LayerControls.vue'

const route = useRoute()
const mapStore = useMapStore()
const mapService = useMapService()

const { streetView } = storeToRefs(mapStore)

const pipSwapped = ref(false)
const mountTeleports = ref(false)
const pipExists = ref(false)

function swapPip() {
  pipSwapped.value = !pipSwapped.value
}

onMounted(() => {
  nextTick(() => {
    mountTeleports.value = true
  })
})

watch(streetView, newValue => {
  if (!newValue) {
    pipSwapped.value = false
    pipExists.value = false
  } else {
    // Wait for next tick to ensure pip container is rendered
    nextTick(() => {
      pipExists.value = true
    })
  }
})
</script>

<template>
  <div
    class="relative z-20 h-full flex flex-col justify-center pointer-events-none"
  >
    <div class="pointer-events-auto w-fit">
      <router-view v-if="!route.meta.dialog" />
    </div>
  </div>

  <div class="!absolute w-full h-full top-0 left-0" id="mainContent">
    <template v-if="mountTeleports">
      <Teleport :to="pipSwapped && pipExists ? '#pipContent' : '#mainContent'">
        <Map :pip-swapped="pipSwapped" />
      </Teleport>
    </template>
  </div>

  <div
    class="w-full absolute bottom-[7.5rem] md:bottom-0 right-0 z-50 p-2 flex flex-col gap-2 items-end pointer-events-none"
  >
    <LayerControls />

    <TransitionExpand>
      <div
        v-if="streetView"
        id="pipContent"
        class="pointer-events-auto shadow-md w-full md:w-[40vw] aspect-video rounded-lg overflow-hidden relative"
      >
        <template v-if="mountTeleports && pipExists">
          <Button
            variant="ghost"
            size="icon"
            class="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white hover:text-white z-10"
            @click="mapService.clearStreetView()"
          >
            <XIcon class="size-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            class="absolute top-1 left-1 bg-black/50 hover:bg-black/70 text-white hover:text-white z-10"
            @click="swapPip()"
          >
            <Maximize2Icon class="size-5 rotate-90" />
          </Button>

          <Teleport :to="pipSwapped ? '#mainContent' : '#pipContent'">
            <StreetView
              :image="streetView"
              class="w-full h-full"
              :pip-swapped="pipSwapped"
            />
          </Teleport>
        </template>
      </div>
    </TransitionExpand>
  </div>
</template>
