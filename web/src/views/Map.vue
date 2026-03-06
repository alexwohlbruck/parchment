<script setup lang="ts">
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useResponsive } from '@/lib/utils'

import { TransitionSlide } from '@morev/vue-transitions'
import { useAppStore } from '@/stores/app.store'
import Map from '@/components/map/Map.vue'
import StreetView from '@/components/map/StreetView.vue'
import LayerControl from '@/components/map/controls/LayerControl.vue'
import StreetViewControl from '@/components/map/controls/StreetViewControl.vue'
import ZoomControl from '@/components/map/controls/ZoomControl.vue'
import CompassControl from '@/components/map/controls/CompassControl.vue'
import LocateControl from '@/components/map/controls/LocateControl.vue'
import ScaleControl from '@/components/map/controls/ScaleControl.vue'
import AttributionControl from '@/components/map/controls/AttributionControl.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import LeftSheet from '@/components/LeftSheet.vue'
import StreetViewPip from '@/components/map/StreetViewPip.vue'
import { useMapService } from '@/services/map.service'
import { useLayersStore } from '@/stores/layers.store'
import { storeToRefs } from 'pinia'
import { useStreetViewLayersService } from '@/services/layers/features/street-view-layers.service'

import MapChips from '@/components/map/MapChips.vue'
import WeatherControl from '@/components/map/controls/WeatherControl.vue'
import MapToolbox from '@/components/map/controls/MapToolbox.vue'
import MeasureTool from '@/components/map/measure/MeasureTool.vue'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { useMapStore } from '@/stores/map.store'
import { ControlVisibility } from '@/types/map.types'

const route = useRoute()
const router = useRouter()
const { isMobileScreen } = useResponsive()
const appStore = useAppStore()
const mapService = useMapService()
const layersStore = useLayersStore()
const { layers } = storeToRefs(layersStore)
const streetViewLayersService = useStreetViewLayersService()
const mapToolsStore = useMapToolsStore()
const mapStore = useMapStore()
const { controlSettings } = storeToRefs(mapStore)
const showToolbox = computed(
  () =>
    (controlSettings.value.toolbox ?? ControlVisibility.ALWAYS) ===
    ControlVisibility.ALWAYS,
)

const isBottomSheetView = computed(() => {
  const isSubview = route.matched.length > 1 && route.name !== AppRoute.MAP
  const isNotDialog = !route.meta.dialog
  return isSubview && isNotDialog
})
const pipSwapped = ref(false)
const mountTeleports = ref(false)
const streetView = ref(false)
const mapUIArea = computed(() => appStore.mapUIArea)
const hideUI = computed(() => !!route.meta?.hideUI)
const bottomSheetOpen = ref(false)
const isNavTransitioning = ref(isMobileScreen.value)

function navTransitioning(value: boolean) {
  isNavTransitioning.value = value
}

// Open bottom sheet when a map subview is opened
watch(isBottomSheetView, async isOpen => {
  if (isOpen) {
    // Small delay to allow other drawers to start their close animation
    // This works in conjunction with useDrawerCoordination to prevent race conditions
    await new Promise(resolve => setTimeout(resolve, 10))
    bottomSheetOpen.value = isOpen
  } else {
    bottomSheetOpen.value = isOpen
    router.push({ name: AppRoute.MAP })
  }
})

// Navigate back to map when bottom sheet is closed
function onOpenChange(value: boolean) {
  bottomSheetOpen.value = value
  if (!value) {
    router.push({ name: AppRoute.MAP })
  }
}

// Detect if left sidebar is visible
const isDrawerOpen = computed(() => {
  return appStore.obstructingComponentsMap.has('left-sheet')
})

onMounted(() => {
  nextTick(() => {
    mountTeleports.value = true
  })
})

watch(
  () => route.name,
  async name => {
    nextTick(async () => {
      streetView.value = name === AppRoute.STREET
      if (streetView.value) {
        await streetViewLayersService.toggleStreetViewLayers(
          layers.value,
          layersStore,
          mapService.mapStrategy,
          true,
        )
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
  navTransitioning,
})
</script>

<template>
  <!-- Debug overlay for obstructing components -->
  <div
    v-if="appStore.debugObstructingComponents"
    class="fixed inset-0 pointer-events-none z-[100]"
  >
    <!-- Show map UI area -->
    <div
      class="absolute border-4 border-green-500 bg-green-500/10"
      :style="{
        left: `${mapUIArea.x}px`,
        top: `${mapUIArea.y}px`,
        width: `${mapUIArea.width}px`,
        height: `${mapUIArea.height}px`,
      }"
    >
      <div
        class="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 text-xs font-mono rounded"
      >
        Map UI Area: {{ Math.round(mapUIArea.width) }}x{{
          Math.round(mapUIArea.height)
        }}
      </div>
    </div>

    <!-- Show each obstructing component -->
    <div
      v-for="[key, dimensions] in appStore.componentDimensions"
      :key="key"
      class="absolute border-2 border-red-500 bg-red-500/10"
      :style="{
        left: `${dimensions.x}px`,
        top: `${dimensions.y}px`,
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
      }"
    >
      <div
        class="absolute top-1 left-1 bg-red-500 text-white px-1 py-0.5 text-[10px] font-mono rounded"
      >
        {{ key }}: {{ Math.round(dimensions.width) }}x{{
          Math.round(dimensions.height)
        }}
      </div>
    </div>
  </div>

  <!-- Search palette -->

  <div class="flex flex-1 h-full relative overflow-hidden">
    <!-- Mobile bottom sheet container -->
    <template v-if="isMobileScreen">
      <bottom-sheet
        parent-id="map"
        :open="bottomSheetOpen"
        @update:open="onOpenChange"
        :default-snap-point-index="1"
        dismissable
        show-drag-handle
        show-close-button
        obstructing-key="map-content-sheet"
      >
        <router-view />
      </bottom-sheet>
    </template>

    <!-- Desktop left sheet container -->
    <template v-else>
      <TransitionSlide no-opacity :offset="['-130%', 0]">
        <LeftSheet
          v-if="!route.meta.dialog && isBottomSheetView"
          @close="() => router.push({ name: AppRoute.MAP })"
        >
          <router-view />
        </LeftSheet>
      </TransitionSlide>
    </template>

    <!-- Map canvas -->
    <div id="mainContent" class="flex-1 relative w-full h-full">
      <!-- Map UI controls positioned within map container -->
      <template v-if="!hideUI">
        <!-- z-50 above drawers -->
        <div
          class="absolute z-50 p-2 flex justify-between gap-2 pointer-events-none inset-0 safe-area-inset"
        >
          <!-- Left section -->
          <div class="flex flex-col items-start gap-2">
            <!-- Left top -->
            <transition-slide appear no-opacity :offset="[0, '-130%']">
              <div
                v-if="isNavTransitioning && !isMobileScreen"
                class="pointer-events-auto flex gap-2"
              >
                <!-- <MapChips v-if="!isDrawerOpen" /> -->
              </div>
            </transition-slide>
          </div>
          <!-- Right section (top) -->
          <div class="flex flex-col items-end gap-2" />
          <!-- Center (top): same padding/safe area as sides -->
          <div
            class="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 flex flex-col items-center justify-start pointer-events-none p-2 safe-area-inset"
          />
        </div>

        <!-- z-20 below drawers -->
        <div
          class="absolute z-20 p-2 flex justify-between gap-2 pointer-events-none inset-0 safe-area-inset"
        >
          <!-- Left section -->
          <div class="flex flex-col items-start gap-2">
            <!-- Left top -->
            <transition-slide appear no-opacity :offset="[0, '-130%']">
              <div
                v-if="isNavTransitioning"
                class="pointer-events-auto flex gap-2 items-start"
              >
                <WeatherControl />
                <ScaleControl />
              </div>
            </transition-slide>

            <!-- Left middle -->
            <transition-slide appear no-opacity :offset="['-130%', 0]">
              <div
                v-if="isNavTransitioning"
                class="pointer-events-auto flex flex-col"
              ></div>
            </transition-slide>

            <!-- Left bottom -->
            <transition-slide appear no-opacity :offset="[0, '130%']">
              <div
                v-if="isNavTransitioning"
                class="pointer-events-auto mt-auto flex flex-col gap-2"
                :class="{ 'mb-16': isMobileScreen }"
              >
                <AttributionControl />
              </div>
            </transition-slide>
          </div>

          <!-- Right section -->
          <transition-slide appear no-opacity :offset="['130%', 0]">
            <div
              v-if="isNavTransitioning"
              class="flex flex-col items-end justify-between pointer-events-auto"
            >
              <!-- Right top -->
              <div class="pointer-events-auto flex flex-col gap-2">
                <ZoomControl />
                <MapToolbox v-if="showToolbox" />
                <CompassControl />
              </div>

              <!-- Right bottom -->
              <div
                class="pointer-events-auto flex flex-col gap-2"
                :class="{ 'mb-16': isMobileScreen }"
              >
                <StreetViewControl />
                <LayerControl />
                <LocateControl />
              </div>
            </div>
          </transition-slide>

          <!-- Center (bottom): same padding/safe area as left/right -->
          <div
            class="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 flex flex-col items-center justify-end pointer-events-none p-2 safe-area-inset"
          >
            <TransitionSlide
              appear
              no-opacity
              :offset="[0, '110%']"
              :duration="350"
            >
              <div
                v-if="mapToolsStore.activeTool === 'measure'"
                class="pointer-events-auto flex flex-col gap-2"
                :class="{ 'mb-16': isMobileScreen }"
              >
                <MeasureTool />
              </div>
            </TransitionSlide>
          </div>
        </div>
      </template>

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
  <StreetViewPip :hide-ui="route.meta?.hideUI" v-model:pip-swapped="pipSwapped">
    <template v-if="mountTeleports && streetView">
      <Teleport :to="pipSwapped ? '#mainContent' : '#pipContent'">
        <StreetView class="w-full h-full" :pip-swapped="pipSwapped" />
      </Teleport>
    </template>
  </StreetViewPip>
</template>

<style scoped>
.safe-area-inset {
  padding-top: calc(0.5rem + env(safe-area-inset-top));
  padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));
  padding-left: calc(0.5rem + env(safe-area-inset-left));
  padding-right: calc(0.5rem + env(safe-area-inset-right));
}
</style>
