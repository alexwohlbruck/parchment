<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue'
import { MapPinIcon } from 'lucide-vue-next'
import type { LngLat } from 'mapbox-gl'
import { useMapService } from '@/services/map/map.service'
import { useAppStore } from '@/stores/app.store'
import { mapEventBus } from '@/lib/event-bus'
import { toContainerRect } from '@/lib/map/map-padding'
import { edgeHint, intersectRect } from '@/lib/map-marker'

const { lngLat } = defineProps<{ lngLat: LngLat | null }>()
const emit = defineEmits<{ select: [] }>()

const EDGE_INSET = 36

const mapService = useMapService()
const appStore = useAppStore()

const cameraTick = shallowRef(0)
const onMove = () => cameraTick.value++
mapEventBus.on('move', onMove)
onUnmounted(() => mapEventBus.off('move', onMove))

const container = computed(() =>
  mapService.isMapReady.value ? mapService.getContainer() : null,
)

const hint = computed(() => {
  void cameraTick.value
  const el = container.value
  if (!lngLat || !el) return null

  const point = mapService.project(lngLat)
  if (!point) return null

  const visible = intersectRect(
    toContainerRect(appStore.visibleMapArea, el.getBoundingClientRect()),
    { x: 0, y: 0, width: el.clientWidth, height: el.clientHeight },
  )
  return edgeHint(point, visible, EDGE_INSET)
})
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
        class="absolute left-0 top-0 z-10 size-11 -ml-[22px] -mt-[22px] active:scale-95 transition-transform"
        :style="{ translate: `${hint.x}px ${hint.y}px` }"
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
          class="relative flex size-full items-center justify-center rounded-full border-[3px] border-white shadow-md"
          :style="{ backgroundColor: mapService.mapStrategy?.selectedMarkerColor() }"
        >
          <MapPinIcon class="size-5 text-white" />
        </span>
      </button>
    </Transition>
  </Teleport>
</template>
