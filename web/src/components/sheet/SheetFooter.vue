<script setup lang="ts">
import {
  computed,
  inject,
  onUnmounted,
  type HTMLAttributes,
  type Ref,
} from 'vue'
import { cn } from '@/lib/utils'

/**
 * Pinned footer region of a sheet — see the layout contract in
 * `components/BottomSheet.vue`.
 *
 * Stays on the sheet's bottom edge while the content above it scrolls, so a
 * primary action stays reachable no matter how long the list is.
 *
 * A snap-point BottomSheet is a full-viewport-tall panel slid down off-screen,
 * so its own bottom edge is nowhere near the visible one — a footer placed in
 * the content flow (or stuck to the scroll surface's bottom) would sit below
 * the fold. This teleports into the layer the sheet keeps pinned to its
 * *visible* bottom edge instead. Without a host sheet (desktop LeftSheet, a
 * plain panel) the fallback sticks to the bottom of the panel's own scroll
 * surface, which is the same thing there.
 */
const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

interface SheetFooterHost {
  target: Ref<HTMLElement | null>
  register: () => void
  unregister: () => void
}

const host = inject<SheetFooterHost | null>('sheetFooter', null)
const target = computed(() => host?.target.value ?? null)

host?.register()
onUnmounted(() => host?.unregister())
</script>

<template>
  <Teleport v-if="target" :to="target">
    <div :class="props.class">
      <slot />
    </div>
  </Teleport>

  <div
    v-else
    :class="cn('sticky bottom-0 z-20 mt-auto bg-background', props.class)"
  >
    <slot />
  </div>
</template>
