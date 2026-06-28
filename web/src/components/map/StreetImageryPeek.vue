<script setup lang="ts">
/**
 * Floating street imagery preview — the Apple Maps "Look Around" peek. Shows a
 * compact thumbnail of the nearest Mapillary image to the selected place,
 * floating over the map near the sheet. Tapping opens the full street view.
 *
 * Data + visuals live here; the parent (Map.vue) owns positioning and the
 * fade-out as the bottom sheet expands.
 */
import { computed, ref, watch } from 'vue'
import { LngLat } from 'mapbox-gl'
import { usePlaceService } from '@/services/place.service'
import { useStreetImagery, type Coordinates } from '@/composables/useStreetImagery'
import { mapEventBus } from '@/lib/eventBus'
import type { MapillaryImage } from '@/types/map.types'
import { Binoculars } from 'lucide-vue-next'

const { currentPlace } = usePlaceService()

const coords = computed<Coordinates | null>(() => {
  const center = currentPlace.value?.geometry?.value?.center
  if (!center) return null
  return { lat: center.lat, lng: center.lng }
})

const { preview } = useStreetImagery(coords)

const loaded = ref(false)
const failed = ref(false)

// Reset the load animation whenever the underlying image changes.
watch(
  () => preview.value?.imageId,
  () => {
    loaded.value = false
    failed.value = false
  },
)

const visible = computed(() => !!preview.value && !failed.value)

function openViewer() {
  const p = preview.value
  if (!p) return
  mapEventBus.emit('click:mapillary-image', {
    lngLat: new LngLat(p.lng, p.lat),
    point: { x: 0, y: 0 },
    image: { id: p.imageId } as MapillaryImage,
  })
}
</script>

<template>
  <button
    v-if="visible"
    type="button"
    class="group pointer-events-auto relative block size-full overflow-hidden rounded-xl bg-muted shadow-lg ring-1 ring-black/10 transition-transform active:scale-95"
    @click="openViewer"
  >
    <img
      :src="preview!.thumbUrl"
      alt="Street-level view near this place"
      class="size-full object-cover transition-all duration-500 ease-out"
      :class="loaded ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0'"
      @load="loaded = true"
      @error="failed = true"
    />

    <!-- Binoculars glyph (Apple "Look Around" affordance) -->
    <span
      class="absolute bottom-1 left-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"
    >
      <Binoculars class="size-3" />
    </span>
  </button>
</template>
