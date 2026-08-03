<script setup lang="ts">
/**
 * A labelled metric — "Distance / 4.2 km".
 *
 * `card` is a bordered tile for a standalone grid of stats; `bare` drops the
 * border for a grid already inside a panel. Both use tabular figures so a row
 * of numbers doesn't jitter as values update.
 */
withDefaults(
  defineProps<{
    label: string
    value: string | number
    /** `bare` for a stat grid already inside a bordered container. */
    variant?: 'card' | 'bare'
  }>(),
  { variant: 'card' },
)
</script>

<template>
  <div :class="variant === 'card' ? 'border border-border/50 rounded-lg px-3 py-2.5' : ''">
    <div class="text-[11px] font-medium text-muted-foreground">{{ label }}</div>
    <div
      class="font-semibold tabular-nums tracking-tight"
      :class="variant === 'card' ? 'text-xl mt-1' : 'text-base mt-0.5'"
    >
      {{ value }}
    </div>
  </div>
</template>
