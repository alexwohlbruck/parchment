<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ref } from 'vue'
import { cn } from '@/lib/utils'
import { useGesture } from '@vueuse/gesture'
import {
  useMotionControls,
  useMotionProperties,
  useMotionTransitions,
} from '@vueuse/motion'
import { useElementBounding } from '@vueuse/core'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const sheet = ref<HTMLElement | null>(null)
const height = ref(0)
const translateY = ref(0)

// Motion setup
const { motionProperties } = useMotionProperties(sheet)
const { push, stop, motionValues } = useMotionTransitions()
const { set, stop: stopMotion } = useMotionControls(
  motionProperties,
  {},
  { push, motionValues, stop },
)

// Get sheet dimensions
const { height: sheetHeight } = useElementBounding(sheet)

// Handle drag gestures
useGesture(
  {
    onDragStart: () => {
      translateY.value = motionValues.value.y?.get() ?? 0
      stopMotion()
    },
    onDrag: ({ delta: [_deltaX, deltaY] }) => {
      translateY.value += deltaY
      set({ y: translateY.value })
    },
    onDragEnd: () => {
      // Snap back to original position
      push('y', 0, motionProperties, {
        type: 'spring',
        stiffness: 300,
        damping: 30,
      })
      translateY.value = 0
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
    :class="cn('touch-none', props.class)"
    v-motion="motionProperties"
  >
    <slot />
  </Card>
</template>
