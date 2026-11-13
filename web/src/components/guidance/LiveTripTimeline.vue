<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import TripTimeline from '@/components/directions/trip/TripTimeline.vue'
import TripStrip from '@/components/directions/trip/TripStrip.vue'
import { useRouteWaypoints } from '@/composables/directions/useRouteWaypoints'
import { rideStops, type TransitStage } from '@/lib/guidance/transit-progress'
import { timelineY, type TimelineAnchor } from '@/lib/guidance/timeline-position'
import { register as registerTick, type Tick } from '@/lib/map/animation-scheduler'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { useDirectionsStore } from '@/stores/directions.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import VehicleThumbnail from './VehicleThumbnail.vue'

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segments: any[]
  /** Leading segments already travelled and no longer on `guidance.route`. */
  passed: number
  /** Index of the segment the traveller is on. */
  current: number
  stage: TransitStage | null
}>()
const guidance = useGuidanceStore()
const directionsStore = useDirectionsStore()

const waypoints = useRouteWaypoints(() => {
  const planned = directionsStore.trips
  const ours = planned?.trips.some(trip => trip.id === guidance.tripId)
  const leg = guidance.legIndex
  return {
    waypoints: ours ? planned?.request?.waypoints?.slice(leg, leg + 2) : undefined,
    startTime: props.segments[0]?.startTime,
    endTime: props.segments.at(-1)?.endTime,
  }
})

/** Metres into the current leg, in 5 m steps so the cards don't redraw every frame. */
const progress = computed(() => {
  const span = guidance.route?.segments[props.current - props.passed]
  const s = guidance.progress?.puck.s
  return span && s != null ? Math.max(0, Math.round((s - span.startDistance) / 5) * 5) : null
})

const root = ref<HTMLElement | null>(null)
const puck = ref<HTMLElement | null>(null)

const rides = computed(() => {
  const route = guidance.route
  return props.segments.map((segment, i) =>
    route && i >= props.passed && segment.mode === 'transit' ? rideStops(route, i - props.passed, segment) : null,
  )
})

const stage = computed(() => props.stage && { ...props.stage, segmentIndex: props.stage.segmentIndex + props.passed })

let anchors: TimelineAnchor[] = []
let shownY: number | null = null

const centerY = (el: Element, top: number) => {
  const rect = el.getBoundingClientRect()
  return rect.top - top + rect.height / 2
}

/** Pins every node on the rail to the point of the route it stands for. */
function measure() {
  const route = guidance.route
  const container = root.value
  if (!route || !container) return
  const top = container.getBoundingClientRect().top
  const next: TimelineAnchor[] = []
  for (const el of container.querySelectorAll<HTMLElement>('[data-node-segment], [data-segment-card]')) {
    if (!el.getClientRects().length) continue
    if (el.dataset.segmentCard != null) {
      const fold = el.querySelector('[data-stop-fold]')
      rides.value[Number(el.dataset.segmentCard)]?.forEach((stop, k) => {
        const dot = el.querySelector(`[data-stop="${k}"]`) ?? fold
        if (dot) next.push({ s: stop.s, y: centerY(dot, top) })
      })
      continue
    }
    const span = route.segments[Number(el.dataset.nodeSegment) - props.passed]
    if (span) next.push({ s: el.dataset.nodeAt === 'end' ? span.endDistance : span.startDistance + Number(el.dataset.nodeOffset ?? 0), y: centerY(el, top) })
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
  <div>
    <TripStrip
      :segments="segments"
      :waypoints="waypoints"
      :progress="progress != null ? { segment: current, offset: progress } : null"
      class="mb-4"
    />
    <div ref="root" class="relative">
      <TripTimeline :segments="segments" :waypoints="waypoints" :current="current" :progress="progress" :stage="stage" />
      <div ref="puck" class="pointer-events-none invisible absolute left-[22px] top-0 z-20 w-12 will-change-transform">
        <VehicleThumbnail
          :indicator="guidance.vehicle.indicator"
          :color="guidance.vehicle.color"
          :class="guidance.vehicle.indicator === 'arrow' && 'rotate-180'"
        />
      </div>
    </div>
  </div>
</template>
