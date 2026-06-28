<script setup lang="ts">
/**
 * Street imagery preview — the nearest Mapillary street-level image to a place,
 * shown as a tappable thumbnail (à la Google/Apple Maps). Tapping opens the
 * full interactive Mapillary viewer at this image.
 *
 * The card stays in its loading (skeleton) state until the thumbnail has fully
 * downloaded, then fades the image in — so the user never sees an empty dark
 * card with a caption floating over nothing.
 */
import { computed, ref } from 'vue'
import { LngLat } from 'mapbox-gl'
import type { StreetImageryPreview } from '@/types/place.types'
import type { MapillaryImage } from '@/types/map.types'
import { mapEventBus } from '@/lib/eventBus'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Orbit } from 'lucide-vue-next'

const props = defineProps<{
  preview: StreetImageryPreview
}>()

const loaded = ref(false)
const failed = ref(false)

const capturedLabel = computed(() => {
  if (!props.preview.capturedAt) return null
  const d = new Date(props.preview.capturedAt)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
})

/**
 * Open the Mapillary viewer at this image. Reuses the same map event the
 * on-map imagery dots emit, so the viewer + map-centering behave identically
 * however street view is entered.
 */
function openViewer() {
  mapEventBus.emit('click:mapillary-image', {
    lngLat: new LngLat(props.preview.lng, props.preview.lat),
    point: { x: 0, y: 0 },
    image: { id: props.preview.imageId } as MapillaryImage,
  })
}
</script>

<template>
  <Card v-if="!failed" class="relative aspect-video overflow-hidden p-0">
    <!-- Skeleton holds the loading state until the thumbnail is decoded -->
    <Skeleton
      v-if="!loaded"
      class="absolute inset-0 size-full rounded-none"
    />

    <button
      type="button"
      class="group absolute inset-0 block size-full text-left"
      @click="openViewer"
    >
      <img
        :src="preview.thumbUrl"
        alt="Street-level view near this place"
        class="size-full object-cover transition-all duration-500 ease-out group-hover:scale-105"
        :class="loaded ? 'scale-100 opacity-100' : 'scale-[1.03] opacity-0'"
        @load="loaded = true"
        @error="failed = true"
      />

      <!-- Overlay chrome only appears once the image is visible -->
      <template v-if="loaded">
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent"
        />

        <div
          v-if="preview.isPano"
          class="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
        >
          <Orbit class="size-3" />
          360°
        </div>

        <div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
          <span class="text-sm font-medium text-white drop-shadow">Street view</span>
          <span v-if="capturedLabel" class="text-xs text-white/80 drop-shadow">
            {{ capturedLabel }}
          </span>
        </div>
      </template>
    </button>
  </Card>
</template>
