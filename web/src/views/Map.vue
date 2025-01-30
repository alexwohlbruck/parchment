<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'

import { TransitionExpand } from '@morev/vue-transitions'
import { Button } from '@/components/ui/button'
import { Maximize2Icon, XIcon } from 'lucide-vue-next'
import Map from '@/components/map/Map.vue'
import StreetView from '@/components/map/StreetView.vue'
import LayerControls from '@/components/map/LayerControls.vue'

const route = useRoute()
const router = useRouter()

const pipSwapped = ref(false)
const mountTeleports = ref(false)
const streetView = ref(false)

function swapPip() {
  pipSwapped.value = !pipSwapped.value
}

onMounted(() => {
  nextTick(() => {
    mountTeleports.value = true
  })
})

watch(
  () => route.name,
  name => {
    nextTick(() => {
      streetView.value = name === AppRoute.STREET
    })
  },
  { immediate: true },
)

watch(
  () => route.params.id,
  id => {
    if (!id) {
      pipSwapped.value = false
    }
  },
)
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
      <Teleport :to="pipSwapped && streetView ? '#pipContent' : '#mainContent'">
        <Map :pip-swapped="pipSwapped" />
      </Teleport>
    </template>
  </div>

  <div
    class="w-full absolute right-0 z-50 p-2 flex flex-col gap-2 items-end pointer-events-none"
    :class="{
      'bottom-[7.5rem] md:bottom-0': route.meta.layout === 'floating',
      'bottom-0': route.meta.layout !== 'floating',
    }"
  >
    <LayerControls />

    <TransitionExpand>
      <div
        v-if="route.name === AppRoute.STREET"
        id="pipContent"
        class="pointer-events-auto shadow-md aspect-video rounded-lg overflow-hidden relative transition-width duration-300"
        :class="
          pipSwapped
            ? 'w-full sm:w-[40vw] md:w-[30vw]'
            : 'w-full sm:w-[50vw] md:w-[40vw]'
        "
      >
        <template v-if="mountTeleports && streetView">
          <Button
            variant="ghost"
            size="icon"
            class="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white hover:text-white z-10"
            @click="router.push({ name: AppRoute.MAP })"
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
            <StreetView class="w-full h-full" :pip-swapped="pipSwapped" />
          </Teleport>
        </template>
      </div>
    </TransitionExpand>
  </div>
</template>
