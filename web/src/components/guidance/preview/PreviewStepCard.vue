<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LngLat } from 'mapbox-gl'
import { ChevronLeftIcon, ChevronRightIcon, MapIcon, XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import { maneuverKind } from '@/lib/directions/maneuver'
import { formatDurationLong } from '@/lib/time-format'
import { mapEventBus } from '@/lib/event-bus'
import { useDistanceLabel } from '@/composables/guidance/useDistanceLabel'
import { useStreetImagery } from '@/composables/place/useStreetImagery'
import { useRoutePreviewStore } from '@/stores/route-preview.store'
import type { MapillaryImage } from '@/types/map.types'

const props = defineProps<{ metric: boolean }>()
defineEmits<{ close: [] }>()
const { t } = useI18n()
const preview = useRoutePreviewStore()
const distanceLabel = useDistanceLabel(() => props.metric)

const step = computed(() => preview.step)
const stepLength = computed(() => {
  const current = step.value
  const route = preview.route
  if (!current || !route) return 0
  return (preview.steps[current.index + 1]?.startDistance ?? route.length) - current.startDistance
})
const destination = computed(() => preview.segments.at(-1)?.end?.label ?? null)
const duration = computed(() => formatDurationLong(preview.segments.reduce((sum, s) => sum + (s.duration ?? 0), 0)))

const { preview: imagery } = useStreetImagery(computed(() => step.value?.instruction.coordinate ?? null))
const imageLoaded = ref(false)
const imageFailed = ref(false)
watch(() => imagery.value?.imageId, () => {
  imageLoaded.value = false
  imageFailed.value = false
})

function openStreetView() {
  const image = imagery.value
  if (!image) return
  mapEventBus.emit('click:mapillary-image', {
    lngLat: new LngLat(image.lng, image.lat),
    point: { x: 0, y: 0 },
    image: { id: image.imageId } as MapillaryImage,
  })
}
</script>

<template>
  <div class="nav-surface pointer-events-auto overflow-hidden rounded-[28px] bg-background/95 shadow-xl ring-1 ring-foreground/5 backdrop-blur-md">
    <div class="flex items-start gap-3.5 px-5 pb-3 pt-4">
      <template v-if="step">
        <ManeuverIcon :kind="maneuverKind(step.instruction)" :exit="step.instruction.exitNumber" class="mt-0.5 size-9 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="line-clamp-2 text-[17px] font-semibold leading-snug">{{ step.instruction.text }}</div>
          <div v-if="stepLength > 0" class="mt-0.5 text-[15px] text-muted-foreground tabular-nums">
            {{ t('guidance.preview.for', { distance: distanceLabel(stepLength) }) }}
          </div>
        </div>
      </template>
      <div v-else class="min-w-0 flex-1">
        <div class="text-[17px] font-semibold leading-snug">{{ destination ?? t('guidance.preview.title') }}</div>
        <div v-if="preview.route" class="mt-0.5 text-[15px] text-muted-foreground tabular-nums">
          {{ duration }} · {{ distanceLabel(preview.route.length) }}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" class="-mr-2 -mt-1 shrink-0 rounded-full" :aria-label="t('guidance.preview.close')" @click="$emit('close')">
        <XIcon class="size-5" />
      </Button>
    </div>

    <button
      v-if="step && imagery && !imageFailed"
      type="button"
      class="mx-4 mb-1 block aspect-[16/9] w-[calc(100%-2rem)] overflow-hidden rounded-2xl bg-muted"
      :aria-label="t('guidance.preview.streetView')"
      @click="openStreetView"
    >
      <img
        :src="imagery.thumbUrl"
        alt=""
        class="size-full object-cover transition-opacity duration-300"
        :class="imageLoaded ? 'opacity-100' : 'opacity-0'"
        @load="imageLoaded = true"
        @error="imageFailed = true"
      />
    </button>

    <div class="flex items-center gap-2 px-3 pb-3 pt-1">
      <Button variant="ghost" size="sm" class="gap-1.5 rounded-full" :disabled="!step" @click="preview.select(null)">
        <MapIcon class="size-4" />
        {{ t('guidance.preview.overview') }}
      </Button>
      <div class="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" class="rounded-full" :disabled="!preview.hasPrevious" :aria-label="t('guidance.preview.previous')" @click="preview.previous()">
          <ChevronLeftIcon class="size-5" />
        </Button>
        <span class="min-w-16 text-center text-sm text-muted-foreground tabular-nums">
          {{ step ? t('guidance.preview.stepOf', { n: step.index + 1, total: preview.steps.length }) : t('guidance.preview.steps', { n: preview.steps.length }) }}
        </span>
        <Button variant="secondary" size="icon" class="rounded-full" :disabled="!preview.hasNext" :aria-label="t('guidance.preview.next')" @click="preview.next()">
          <ChevronRightIcon class="size-5" />
        </Button>
      </div>
    </div>
  </div>
</template>
