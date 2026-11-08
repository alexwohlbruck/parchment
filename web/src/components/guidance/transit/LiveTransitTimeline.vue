<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import TransitLegCard from '@/components/transit/trip/TransitLegCard.vue'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { formatDurationCompact } from '@/lib/time-format'
import { rideStops, type TransitStage } from '@/lib/guidance/transit-progress'
import { timelineY, type TimelineAnchor } from '@/lib/guidance/timeline-position'
import { register as registerTick, type Tick } from '@/lib/map/animation-scheduler'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { useGuidanceStore } from '@/stores/guidance.store'
import VehicleThumbnail from '../VehicleThumbnail.vue'

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segments: any[]
  /** Index of the segment the traveller is on. */
  current: number
  stage: TransitStage | null
}>()
const { t } = useI18n()
const guidance = useGuidanceStore()

const modeKey = (mode: string) => (mode === 'biking' ? 'cycling' : mode)

const root = ref<HTMLElement | null>(null)
const puck = ref<HTMLElement | null>(null)

const rides = computed(() => {
  const route = guidance.route
  return props.segments.map((segment, i) => (route && segment.mode === 'transit' ? rideStops(route, i, segment) : null))
})

let anchors: TimelineAnchor[] = []
let shownY: number | null = null

const centerY = (el: Element, top: number) => {
  const rect = el.getBoundingClientRect()
  return rect.top - top + rect.height / 2
}

/** Pins each stop, and each leg's start and end, to its height in the timeline. */
function measure() {
  const route = guidance.route
  const container = root.value
  if (!route || !container) return
  const top = container.getBoundingClientRect().top
  const next: TimelineAnchor[] = []
  for (const el of container.querySelectorAll<HTMLElement>('[data-segment]')) {
    const i = Number(el.dataset.segment)
    const span = route.segments[i]
    if (!span) continue
    const stops = rides.value[i]
    if (stops && el.querySelector('[data-stop]')) {
      const fold = el.querySelector('[data-stop-fold]')
      stops.forEach((stop, k) => {
        const dot = el.querySelector(`[data-stop="${k}"]`) ?? fold
        if (dot) next.push({ s: stop.s, y: centerY(dot, top) })
      })
      continue
    }
    const icon = el.querySelector('[data-leg-icon]') ?? el
    const following = el.nextElementSibling
    const end = following?.matches('[data-segment]') ? following.getBoundingClientRect().top - top : el.getBoundingClientRect().bottom - top
    next.push({ s: span.startDistance, y: centerY(icon, top) }, { s: span.endDistance, y: end })
  }
  anchors = next
  shownY = null
}

function place(y: number | null) {
  if (!puck.value || y === shownY) return
  shownY = y
  puck.value.style.visibility = y == null ? 'hidden' : 'visible'
  if (y != null) puck.value.style.transform = `translate(-50%, -50%) translateY(${y.toFixed(1)}px)`
}

const tick: Tick = now => {
  if (!guidanceEngine.frameDue(now)) return 'active'
  const sample = guidanceEngine.sample()
  place(sample ? timelineY(anchors, sample.s) : null)
  return 'active'
}

useResizeObserver(root, measure)
watch(rides, measure, { flush: 'post' })
let unregisterTick: (() => void) | null = null
onMounted(() => {
  measure()
  unregisterTick = registerTick(tick)
})
onBeforeUnmount(() => unregisterTick?.())
</script>

<template>
  <div ref="root" class="relative">
    <div class="space-y-2">
      <template v-for="(segment, i) in segments" :key="segment.id ?? i">
        <TransitLegCard
          v-if="segment.mode === 'transit' && segment.lineName"
          :data-segment="i"
          :segment="segment"
          :rail-above="{ class: 'bg-transparent' }"
          :passed="stage?.kind === 'riding' && stage.segmentIndex === i ? stage.passed : i < current ? Infinity : undefined"
          :class="i < current && 'opacity-50'"
        />
        <div
          v-else
          :data-segment="i"
          class="flex items-center py-1.5 pl-2 pr-2 text-sm"
          :class="i < current ? 'opacity-50' : i === current ? 'font-medium' : 'text-muted-foreground'"
        >
          <span class="flex w-7 shrink-0 justify-center">
            <component :is="getSegmentIcon(segment.mode)" data-leg-icon class="size-4" />
          </span>
          <span class="truncate pl-2.5">
            {{ t(`guidance.transit.leg.${modeKey(segment.mode)}`, { duration: formatDurationCompact(segment.duration ?? 0) }) }}
            <template v-if="segment.end?.label"> {{ t('guidance.transit.toPlace', { place: segment.end.label }) }}</template>
          </span>
        </div>
      </template>
    </div>
    <div ref="puck" class="pointer-events-none invisible absolute left-[22px] top-0 z-20 w-12 will-change-transform">
      <VehicleThumbnail
        :indicator="guidance.vehicle.indicator"
        :color="guidance.vehicle.color"
        :class="guidance.vehicle.indicator === 'arrow' && 'rotate-180'"
      />
    </div>
  </div>
</template>
