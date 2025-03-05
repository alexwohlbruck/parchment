<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ref, computed, watch, onMounted, nextTick } from 'vue'
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
const preventScroll = ref(false)

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

onMounted(() => {
  // Start at hidden position
  set({ y: windowHeight.value })

  // Animate to 25% covered position
  nextTick(() => {
    const targetY = windowHeight.value * 0.75
    currentSnapPoint.value = targetY
    translateY.value = targetY
    push('y', targetY, motionProperties, {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    })
  })
})

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
    onDragStart: ({ direction: [_directionX, _directionY], event }) => {
      const isDraggingDown = _directionY > 0

      // When fully expanded, only allow drag when at top
      if (isFullyExpanded.value) {
        preventScroll.value = isAtTop.value && isDraggingDown

        // If we shouldn't prevent scroll, don't start the drag
        if (!preventScroll.value) {
          return
        }
      }

      translateY.value = motionValues.value.y?.get() ?? 0
      stopMotion()
    },
    onDrag: ({ delta: [_deltaX, deltaY], event }) => {
      // When expanded:
      // - Allow dragging down only from the top
      // - Don't allow dragging up at all
      if (isFullyExpanded.value) {
        if (!isAtTop.value || deltaY < 0) {
          return
        }
      }

      translateY.value += deltaY
      set({ y: translateY.value })
    },
    onDragEnd: () => {
      preventScroll.value = false
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
    :class="cn('h-full flex flex-col', props.class)"
    v-motion="motionProperties"
  >
    <div class="flex justify-center p-2 absolute top-0 left-0 w-full">
      <div class="h-1 w-16 rounded-full bg-muted-foreground"></div>
    </div>
    <div
      ref="scrollContainer"
      :class="
        cn('flex-1 overflow-y-auto overscroll-contain touch-pan-y', {
          'overflow-y-hidden': !isFullyExpanded,
        })
      "
    >
      <slot />
    </div>
  </Card>
</template>
