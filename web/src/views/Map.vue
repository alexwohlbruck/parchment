<script setup lang="ts">
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useResponsive } from '@/lib/utils'

import { TransitionSlide } from '@morev/vue-transitions'
import { useAppStore } from '@/stores/app.store'
import Palette from '@/components/palette/Palette.vue'
import Map from '@/components/map/Map.vue'
import StreetView from '@/components/map/StreetView.vue'
import LayerControl from '@/components/map/controls/LayerControl.vue'
import StreetViewControl from '@/components/map/controls/StreetViewControl.vue'
import CameraControl from '@/components/map/controls/CameraControl.vue'
import LocateControl from '@/components/map/controls/LocateControl.vue'
import ScaleControl from '@/components/map/controls/ScaleControl.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import LeftSheet from '@/components/LeftSheet.vue'
import StreetViewPip from '@/components/map/StreetViewPip.vue'
import { useMapService } from '@/services/map.service'

const route = useRoute()
const router = useRouter()
const { isMobileScreen } = useResponsive()
const appStore = useAppStore()
const mapService = useMapService()

const isMapSubview = computed(() => {
  return route.matched.length > 1 && route.name !== AppRoute.MAP
})
const pipSwapped = ref(false)
const mountTeleports = ref(false)
const streetView = ref(false)
const mapUIArea = computed(() => appStore.mapUIArea)
const isFloatingLayout = computed(() => route.meta?.layout === 'floating')
const navTransitionComplete = ref(false)

// Method to be called when nav transition completes
function onNavTransitionComplete() {
  navTransitionComplete.value = true
}

function closeSheet() {
  router.push({ name: AppRoute.MAP })
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
      if (streetView.value) {
        mapService.toggleStreetViewLayers(true)
      }
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

defineExpose({
  onNavTransitionComplete,
})
</script>

<template>
  <!-- Map UI items -->
  <div
    v-if="isFloatingLayout"
    class="fixed z-50 p-2 flex justify-between gap-2 pointer-events-none"
    :style="{
      left: `${mapUIArea.x}px`,
      top: `${mapUIArea.y}px`,
      width: `${mapUIArea.width}px`,
      height: `${mapUIArea.height}px`,
    }"
  >
    <!-- Left section -->
    <div class="flex flex-col items-start gap-2">
      <!-- Left top -->
      <transition-slide no-opacity :offset="[0, '-130%']">
        <div
          v-if="navTransitionComplete && !isMobileScreen"
          class="pointer-events-auto"
        >
          <Palette class="h-fit w-[25rem]" />
        </div>
      </transition-slide>

      <!-- Left middle -->
      <transition-slide no-opacity :offset="['-130%', 0]">
        <div
          v-if="navTransitionComplete"
          class="pointer-events-auto flex flex-col"
        ></div>
      </transition-slide>

      <!-- Left bottom -->
      <transition-slide no-opacity :offset="[0, '130%']">
        <div v-if="navTransitionComplete" class="pointer-events-auto mt-auto">
          <ScaleControl />
        </div>
      </transition-slide>
    </div>

    <!-- Right section -->
    <transition-slide no-opacity :offset="['130%', 0]">
      <div
        v-if="navTransitionComplete"
        class="flex flex-col items-end justify-between pointer-events-auto"
      >
        <!-- Right top -->
        <div class="pointer-events-auto flex flex-col gap-2">
          <CameraControl />
          <LocateControl />
        </div>

        <!-- Right bottom -->
        <div class="pointer-events-auto flex flex-col gap-2">
          <StreetViewControl />
          <LayerControl />
        </div>
      </div>
    </transition-slide>
  </div>

  <!-- Search palette -->

  <div class="flex flex-1 h-full relative overflow-hidden">
    <!-- Mobile bottom sheet container -->
    <template v-if="isMobileScreen">
      <BottomSheet
        v-if="!route.meta.dialog && isMapSubview"
        class="absolute bg-background z-30 top-0 left-0 w-full md:w-[26rem] h-full rounded-t-md shadow-lg justify-center"
        @close="closeSheet"
      >
        <router-view />
      </BottomSheet>
    </template>

    <!-- Desktop left sheet container -->
    <template v-else>
      <TransitionSlide no-opacity :offset="['-130%', 0]">
        <LeftSheet
          v-if="!route.meta.dialog && isMapSubview"
          @close="closeSheet"
        >
          <router-view />
        </LeftSheet>
      </TransitionSlide>
    </template>

    <!-- Map canvas -->
    <div id="mainContent" class="flex-1 fixed top-0 left-0 w-full h-dvh">
      <template v-if="mountTeleports">
        <Teleport
          :to="pipSwapped && streetView ? '#pipContent' : '#mainContent'"
        >
          <Map :pip-swapped="pipSwapped" />
        </Teleport>
      </template>
    </div>
  </div>

  <!-- Street view pip -->
  <StreetViewPip :layout="route.meta?.layout" v-model:pip-swapped="pipSwapped">
    <template v-if="mountTeleports && streetView">
      <Teleport :to="pipSwapped ? '#mainContent' : '#pipContent'">
        <StreetView class="w-full h-full" :pip-swapped="pipSwapped" />
      </Teleport>
    </template>
  </StreetViewPip>
</template>
