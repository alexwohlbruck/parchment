import { computed, markRaw, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { TripOption } from '@/types/directions.types'
import { buildNavRoute, type NavRoute } from '@/lib/guidance/nav-route'
import { withBoardingStep } from '@/lib/guidance/transit-progress'
import { legSegments } from '@/stores/guidance.store'

/** A step-through of a leg's maneuvers, for when the traveller isn't on the route to navigate it. */
export const useRoutePreviewStore = defineStore('routePreview', () => {
  const trip = shallowRef<TripOption | null>(null)
  const legIndex = ref(0)
  const route = shallowRef<NavRoute | null>(null)
  const segments = shallowRef<ReturnType<typeof legSegments>>([])
  /** The step on show; null is the whole-route overview. */
  const stepIndex = ref<number | null>(null)

  const steps = computed(() => route.value?.steps ?? [])
  const step = computed(() => (stepIndex.value == null ? null : steps.value[stepIndex.value] ?? null))
  const isOpen = computed(() => route.value != null)

  function open(option: TripOption, leg: number) {
    trip.value = markRaw(option)
    legIndex.value = leg
    segments.value = legSegments(option, leg)
    route.value = markRaw(buildNavRoute(segments.value.map(withBoardingStep)))
    stepIndex.value = null
  }

  function close() {
    trip.value = null
    route.value = null
    segments.value = []
    stepIndex.value = null
  }

  function select(index: number | null) {
    stepIndex.value = index == null ? null : Math.max(0, Math.min(steps.value.length - 1, index))
  }

  const hasPrevious = computed(() => stepIndex.value != null)
  const hasNext = computed(() => (stepIndex.value ?? -1) < steps.value.length - 1)

  function previous() {
    if (stepIndex.value != null) select(stepIndex.value > 0 ? stepIndex.value - 1 : null)
  }

  function next() {
    if (hasNext.value) select((stepIndex.value ?? -1) + 1)
  }

  return { trip, legIndex, route, segments, steps, step, stepIndex, isOpen, open, close, select, previous, next, hasPrevious, hasNext }
})
