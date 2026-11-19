<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useMutationObserver, useResizeObserver } from '@vueuse/core'
import { cn } from '@/lib/utils'

/**
 * A menu list, plus the one raised chip that marks the current row. Rows
 * animate in, out and to new positions as the list changes.
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
  const next = active ? { top: active.offsetTop, height: active.offsetHeight } : null
  // TransitionGroup probes each update by inserting a clone into the list, which
  // this observer sees; re-rendering on an unchanged chip would loop forever.
  if (next?.top !== chip.value?.top || next?.height !== chip.value?.height) chip.value = next
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
  <!-- The chip sits outside the group: a move animation would fight its own slide. -->
  <div ref="listRef" class="relative">
    <div
      v-if="chip"
      aria-hidden="true"
      class="absolute inset-x-0 rounded-md bg-card dark:bg-foreground/[0.07] depth pointer-events-none"
      :class="settled && 'motion-safe:transition-[top,height] duration-200 ease-out'"
      :style="{ top: `${chip.top}px`, height: `${chip.height}px` }"
    />
    <TransitionGroup
      tag="ul"
      name="sidebar-row"
      :class="cn('flex flex-col gap-0.5', props.class)"
    >
      <slot />
    </TransitionGroup>
  </div>
</template>

<!--
  Plain CSS, not utilities: tailwindcss-animate makes `duration-*` set an animation
  duration too, and Vue then treats the move as an animation and skips it.
  Unscoped because the rows belong to the slot's owner.
-->
<style>
.sidebar-row-enter-from {
  opacity: 0;
  transform: translateX(-0.5rem);
}

.sidebar-row-leave-active {
  position: absolute;
  inset-inline: 0;
}

.sidebar-row-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .sidebar-row-enter-active,
  .sidebar-row-move {
    transition:
      opacity 300ms ease-out,
      transform 300ms ease-out;
  }

  .sidebar-row-leave-active {
    transition: opacity 200ms ease-out;
  }
}
</style>
