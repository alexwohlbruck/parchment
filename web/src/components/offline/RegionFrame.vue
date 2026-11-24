<script setup lang="ts">
/**
 * The square the user frames an area with. It stays put on screen and the
 * map moves under it, so zooming is how the area grows or shrinks.
 */
import { computed, onUnmounted, watch } from 'vue'
import { useElementBounding } from '@vueuse/core'
import { useMapService } from '@/services/map/map.service'
import { useAppStore } from '@/stores/app.store'
import { mapEventBus } from '@/lib/event-bus'
import { toContainerRect } from '@/lib/map/map-padding'
import type { Bounds } from '@/types/offline.types'
import type { LngLat } from 'maplibre-gl'

const SIDE_FRACTION = 0.8

defineProps<{ tooLarge?: boolean }>()
const bounds = defineModel<Bounds | null>('bounds', { required: true })

const mapService = useMapService()
const appStore = useAppStore()

const container = computed(() => (mapService.isMapReady.value ? mapService.getContainer() : null))
const containerBounds = useElementBounding(container)

const square = computed(() => {
  const { left, top, width, height } = containerBounds
  const area = toContainerRect(appStore.visibleMapArea, { left: left.value, top: top.value })
  const x0 = Math.max(0, area.x)
  const y0 = Math.max(0, area.y)
  const w = Math.min(width.value, area.x + area.width) - x0
  const h = Math.min(height.value, area.y + area.height) - y0
  const side = Math.max(0, Math.min(w, h) * SIDE_FRACTION)
  return { x: x0 + (w - side) / 2, y: y0 + (h - side) / 2, side }
})

let resizing = false
let framed: { side: number; center: LngLat } | null = null

function measure() {
  const map = mapService.mapStrategy?.mapInstance
  const { x, y, side } = square.value
  if (resizing || !map?.unproject || !side) return
  const corners = [
    [x, y],
    [x + side, y],
    [x, y + side],
    [x + side, y + side],
  ].map(p => map.unproject(p as [number, number]))
  const lngs = corners.map(c => c.lng)
  const lats = corners.map(c => c.lat)
  bounds.value = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
  framed = { side, center: map.unproject([x + side / 2, y + side / 2]) }
}

/** Resizing the square (a drawer opening, a rotation) zooms the map so the same area stays in it. */
function keepArea() {
  const map = mapService.mapStrategy?.mapInstance
  const { x, y, side } = square.value
  if (!framed || !map?.project || !side) return measure()
  const { center } = framed
  resizing = true
  try {
    map.jumpTo({ zoom: map.getZoom() + Math.log2(side / framed.side) })
    const p = map.project(center)
    map.panBy([p.x - (x + side / 2), p.y - (y + side / 2)], { duration: 0 })
  } finally {
    resizing = false
  }
  framed = { side, center }
}

watch(square, keepArea, { immediate: true })
mapEventBus.on('move', measure)
onUnmounted(() => {
  mapEventBus.off('move', measure)
  bounds.value = null
})
</script>

<template>
  <Teleport v-if="container" :to="container">
    <div
      class="pointer-events-none absolute left-0 top-0 z-10 rounded-2xl border-2 transition-colors"
      :class="tooLarge ? 'border-destructive' : 'border-white'"
      :style="{
        width: `${square.side}px`,
        height: `${square.side}px`,
        transform: `translate3d(${square.x}px, ${square.y}px, 0)`,
        boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.35)',
      }"
    />
  </Teleport>
</template>
