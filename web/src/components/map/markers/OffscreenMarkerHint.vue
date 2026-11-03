<script setup lang="ts">
import { computed, onUnmounted, shallowRef, watch } from 'vue'
import { useElementBounding } from '@vueuse/core'
import { MapPinIcon } from 'lucide-vue-next'
import type { LngLat } from 'mapbox-gl'
import { useMapService } from '@/services/map/map.service'
import { useAppStore } from '@/stores/app.store'
import { mapEventBus } from '@/lib/event-bus'
import { toContainerRect } from '@/lib/map/map-padding'
import { edgeHint, intersectRect, type Point } from '@/lib/map-marker'

const { lngLat } = defineProps<{ lngLat: LngLat | null }>()
const emit = defineEmits<{ select: [] }>()

const EDGE_INSET = 36

const mapService = useMapService()
const appStore = useAppStore()

const container = computed(() =>
  mapService.isMapReady.value ? mapService.getContainer() : null,
)
const containerBounds = useElementBounding(container)

const point = shallowRef<Point | null>(null)
const reproject = () => {
  point.value = lngLat ? mapService.project(lngLat) : null
}
watch([() => lngLat, container], reproject, { immediate: true })
mapEventBus.on('move', reproject)
onUnmounted(() => mapEventBus.off('move', reproject))

const visibleArea = computed(() => {
  const { left, top, width, height } = containerBounds
  const area = toContainerRect(appStore.visibleMapArea, { left: left.value, top: top.value })
  // The drawer's obstruction includes its button column, which only covers the map's top corner.
  const overhang = Math.min(appStore.leftSheetButtonColumnWidth, Math.max(0, area.x))
  return intersectRect(
    { ...area, x: area.x - overhang, width: area.width + overhang },
    { x: 0, y: 0, width: width.value, height: height.value },
  )
})

const hint = computed(() =>
  point.value ? edgeHint(point.value, visibleArea.value, EDGE_INSET) : null,
)

const color = computed(() =>
  container.value ? mapService.mapStrategy?.selectedMarkerColor() : undefined,
)
</script>

<template>
  <Teleport v-if="container" :to="container">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <button
        v-if="hint"
        type="button"
        :aria-label="$t('map.returnToPlace')"
        class="group absolute left-0 top-0 z-10 size-11 -ml-[22px] -mt-[22px] will-change-transform"
        :style="{ transform: `translate3d(${hint.x}px, ${hint.y}px, 0)` }"
        @click="emit('select')"
      >
        <span
          class="absolute inset-0"
          :style="{ transform: `rotate(${hint.angle}rad)` }"
        >
          <span
            class="absolute -right-1 top-1/2 size-3 -mt-1.5 rotate-45 rounded-[2px] bg-white shadow-md"
          />
        </span>
        <span
          class="relative flex size-full items-center justify-center rounded-full border-[3px] border-white shadow-md transition-[scale] group-active:scale-95"
          :style="{ backgroundColor: color }"
        >
          <MapPinIcon class="size-5 text-white" />
        </span>
      </button>
    </Transition>
  </Teleport>
</template>
