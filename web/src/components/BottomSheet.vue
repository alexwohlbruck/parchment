<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ref, computed, watch } from 'vue'
import { cn } from '@/lib/utils'
import { useGesture } from '@vueuse/gesture'
import {
  useMotionControls,
  useMotionProperties,
  useMotionTransitions,
} from '@vueuse/motion'
import { useElementBounding, useWindowSize, useScroll } from '@vueuse/core'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const sheet = ref<HTMLElement | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
const translateY = ref(0)
const currentSnapPoint = ref(0)

// Get window and sheet dimensions
const { height: windowHeight } = useWindowSize()
const { height: sheetHeight } = useElementBounding(sheet)

// Track scroll position
const { y: scrollY } = useScroll(scrollContainer)
const isAtTop = computed(() => scrollY.value === 0)

watch(scrollY, value => {
  console.log({ scrollY: value })
})

watch(isAtTop, value => {
  console.log({ isAtTop: value })
})

// Define snap points as percentages of window height
const snapPoints = computed(() => [
  0, // Fully expanded
  windowHeight.value * 0.5, // 50% height
  windowHeight.value * 0.75, // 25% height
  windowHeight.value, // hidden
])

// Motion setup
const { motionProperties } = useMotionProperties(sheet)
const { push, stop, motionValues } = useMotionTransitions()
const { set, stop: stopMotion } = useMotionControls(
  motionProperties,
  {},
  { push, motionValues, stop },
)

// Computed to check if sheet is fully expanded
const isFullyExpanded = computed(() => currentSnapPoint.value === 0)

// Find closest snap point
function getClosestSnapPoint(y: number) {
  return snapPoints.value.reduce((prev, curr) =>
    Math.abs(curr - y) < Math.abs(prev - y) ? curr : prev,
  )
}

// Handle drag gestures
useGesture(
  {
    onDragStart: ({ event }) => {
      // Prevent drag if not at top and fully expanded
      if (!isAtTop.value && isFullyExpanded.value) {
        event.preventDefault()
        return
      }

      translateY.value = motionValues.value.y?.get() ?? 0
      stopMotion()
    },
    onDrag: ({ delta: [_deltaX, deltaY], event }) => {
      // Extra check during drag
      if (!isAtTop.value && isFullyExpanded.value) {
        return
      }

      translateY.value += deltaY
      set({ y: translateY.value })
    },
    onDragEnd: () => {
      const snapPoint = getClosestSnapPoint(translateY.value)
      currentSnapPoint.value = snapPoint

      // Emit close event if snapping to hidden position
      if (snapPoint === windowHeight.value) {
        emit('close')
      }

      push('y', snapPoint, motionProperties, {
        type: 'spring',
        stiffness: 300,
        damping: 30,
      })
      translateY.value = snapPoint
    },
  },
  {
    domTarget: sheet,
    drag: {
      filterTaps: true,
      axis: 'y',
    },
  },
)
</script>

<template>
  <Card
    ref="sheet"
    :class="cn('touch-none h-full flex flex-col', props.class)"
    v-motion="motionProperties"
  >
    <div
      ref="scrollContainer"
      :class="
        cn('flex-1 overflow-y-auto', { 'overflow-y-hidden': !isFullyExpanded })
      "
    >
      <slot />
    </div>
  </Card>
</template>
