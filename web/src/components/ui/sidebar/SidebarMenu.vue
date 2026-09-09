<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useMutationObserver, useResizeObserver } from '@vueuse/core'
import { cn } from '@/lib/utils'

/**
 * A menu list, plus the one raised chip that marks the current row.
 *
 * The chip is a single element that slides between rows rather than a
 * background on each row, so moving between destinations reads as one
 * object travelling instead of two independent fades. Rows only announce
 * themselves with `data-active`; the list finds the active one by query, so
 * an item can decide it's active for any reason without wiring state back up.
 */
const props = defineProps<{ class?: string }>()

const listRef = ref<HTMLElement | null>(null)
const chip = ref<{ top: number; height: number } | null>(null)
// Suppresses the slide on the very first measure, so the chip fades in where
// it belongs instead of flying down from the top of the list on load.
const settled = ref(false)

function measure() {
  const list = listRef.value
  if (!list) return
  const active = list.querySelector<HTMLElement>('[data-active="true"]')
  chip.value = active
    ? { top: active.offsetTop, height: active.offsetHeight }
    : null
  if (!settled.value) nextTick(() => (settled.value = true))
}

onMounted(() => nextTick(measure))
useResizeObserver(listRef, measure)
useMutationObserver(listRef, measure, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['data-active'],
})
</script>

<template>
  <ul
    ref="listRef"
    :class="cn('relative flex flex-col gap-0.5', props.class)"
  >
    <li
      v-if="chip"
      aria-hidden="true"
      class="absolute inset-x-0 rounded-md bg-card dark:bg-foreground/[0.07] depth pointer-events-none"
      :class="settled && 'motion-safe:transition-[top,height] duration-200 ease-out'"
      :style="{ top: `${chip.top}px`, height: `${chip.height}px` }"
    />
    <slot />
  </ul>
</template>
