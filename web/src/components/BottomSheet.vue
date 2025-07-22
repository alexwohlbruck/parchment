<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ref, computed, onMounted, nextTick } from 'vue'
import { cn } from '@/lib/utils'
import { useGesture, Vector2 } from '@vueuse/gesture'
import {
  useMotionControls,
  useMotionProperties,
  useMotionTransitions,
} from '@vueuse/motion'
import { useElementBounding, useWindowSize, useScroll } from '@vueuse/core'
import { useObstructingComponent } from '@/composables/useObstructingComponent'

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

useObstructingComponent(sheet, 'bottom-sheet')
const { height: windowHeight } = useWindowSize()
const { height: sheetHeight } = useElementBounding(sheet)

const { y: scrollY } = useScroll(scrollContainer)
const isAtTop = computed(() => scrollY.value === 0)

enum SnapPointName {
  EXPANDED = 'EXPANDED',
  HALF = 'HALF',
  PEEK = 'PEEK',
  HIDDEN = 'HIDDEN',
}

interface SnapPoint {
  name: SnapPointName
  value: number
}

const snapPoints = computed<SnapPoint[]>(() => [
  { name: SnapPointName.EXPANDED, value: 0 },
  { name: SnapPointName.HALF, value: windowHeight.value * 0.45 },
  { name: SnapPointName.PEEK, value: windowHeight.value * 0.75 },
  { name: SnapPointName.HIDDEN, value: windowHeight.value },
])

function getClosestSnapPoint(y: number): SnapPoint {
  return snapPoints.value.reduce((prev, curr) => {
    return Math.abs(curr.value - y) < Math.abs(prev.value - y) ? curr : prev
  })
}

function getTargetSnapPoint(
  y: number,
  velocity: number,
  direction: Vector2,
): SnapPoint {
  if (Math.abs(velocity) < 0.5) {
    return getClosestSnapPoint(y)
  }

  const closestSnapPoint = getClosestSnapPoint(y)
  const currentIndex = snapPoints.value.indexOf(closestSnapPoint)
  const [_dirX, dirY] = direction
  const isDraggingDown = dirY > 0

  const getTargetIndex = (offset: number) => {
    return isDraggingDown
      ? Math.min(currentIndex + offset, snapPoints.value.length - 1)
      : Math.max(currentIndex - offset, 0)
  }

  const velocityOffset = Math.abs(velocity) > 2 ? 2 : 1
  const targetIndex = getTargetIndex(velocityOffset)

  return snapPoints.value[targetIndex]
}

const { motionProperties } = useMotionProperties(sheet)
const { push, stop, motionValues } = useMotionTransitions()
const { set, stop: stopMotion } = useMotionControls(
  motionProperties,
  {},
  { push, motionValues, stop },
)

onMounted(() => {
  const hidden = snapPoints.value.find(
    point => point.name === SnapPointName.HIDDEN,
  )!
  set({ y: hidden.value })

  nextTick(() => {
    const peek = snapPoints.value.find(
      point => point.name === SnapPointName.HALF,
    )!
    const targetY = peek.value
    currentSnapPoint.value = targetY
    translateY.value = targetY
    push('y', targetY, motionProperties, {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    })
  })
})

const isFullyExpanded = computed(() => {
  const expanded = snapPoints.value.find(
    point => point.name === SnapPointName.EXPANDED,
  )!
  return currentSnapPoint.value === expanded.value
})

useGesture(
  {
    onDragStart: ({ direction: [_directionX, _directionY] }) => {
      const isDraggingDown = _directionY > 0

      if (isFullyExpanded.value) {
        preventScroll.value = isAtTop.value && isDraggingDown

        if (!preventScroll.value) {
          return
        }
      }

      translateY.value = motionValues.value.y?.get() ?? 0
      stopMotion()
    },
    onDrag: ({ delta: [_deltaX, deltaY] }) => {
      if (isFullyExpanded.value) {
        if (!isAtTop.value || deltaY < 0) {
          return
        }
      }

      translateY.value += deltaY
      set({ y: translateY.value })
    },
    onDragEnd: ({ velocity, direction }) => {
      if (!isAtTop.value) {
        return
      }

      preventScroll.value = false

      const snapPoint = getTargetSnapPoint(
        translateY.value,
        velocity,
        direction,
      )
      const targetY = snapPoint.value
      currentSnapPoint.value = targetY

      const shouldClose = snapPoint.name === SnapPointName.HIDDEN
      const stiffness = Math.abs(velocity) > 2 ? 200 : 300
      const damping = Math.abs(velocity) > 2 ? 20 : 25

      push('y', targetY, motionProperties, {
        type: 'spring',
        stiffness,
        damping,
        velocity: velocity * 1000,
      })
      translateY.value = targetY

      setTimeout(() => {
        if (shouldClose) {
          emit('close')
        }
      }, 300)
    },
  },
  {
    domTarget: sheet,
    drag: {
      filterTaps: false,
      axis: 'y',
    },
  },
)
</script>

<template>
  <Card
    ref="sheet"
    :class="cn('h-full flex flex-col pt-2', props.class)"
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
