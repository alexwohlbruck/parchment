<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Loading placeholder matched to `PlaceCard`'s row layout. `seed` varies the
 * bar widths so a stack of them reads as distinct rows rather than a grid.
 */
const props = withDefaults(
  defineProps<{
    seed?: number
    lines?: number
  }>(),
  { seed: 0, lines: 3 },
)

const titleWidth = `${50 + ((props.seed * 13) % 40)}%`
const lastWidth = `${40 + ((props.seed * 17) % 45)}%`
</script>

<template>
  <div class="w-full rounded-xl border bg-card px-2 py-2">
    <div class="flex items-start gap-2">
      <Skeleton class="size-8 rounded-full shrink-0 mt-0.5" />
      <div class="flex-1 flex flex-col gap-1.5 min-w-0">
        <Skeleton class="h-[14px] rounded" :style="{ width: titleWidth }" />
        <Skeleton v-if="lines > 1" class="h-[11px] rounded w-20" />
        <Skeleton v-if="lines > 2" class="h-[11px] rounded" :style="{ width: lastWidth }" />
      </div>
    </div>
  </div>
</template>
