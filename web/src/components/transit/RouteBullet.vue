<script setup lang="ts">
/**
 * The colored route "bullet" (NYC-subway style) — e.g. 6 · 6X · N · L.
 *
 * One component for every place a route badge appears: the trip-detail
 * timeline, the departures card, the station header. Carries the same
 * lighting/bevel as a button (a white hairline border + the `depth-raised`
 * inset highlight and drop shadow) so the bullets read as physical chips.
 *
 * `color`/`textColor` are GTFS hex values without the leading '#'; they fall
 * back to the app primary on white.
 */
withDefaults(
  defineProps<{
    label?: string
    color?: string | null
    textColor?: string | null
    size?: 'sm' | 'md'
    title?: string
  }>(),
  { size: 'sm' },
)
</script>

<template>
  <span
    class="route-bullet inline-flex items-center justify-center shrink-0 rounded-full font-semibold leading-none border border-white/15 depth-raised"
    :class="size === 'md'
      ? 'min-w-[26px] h-[26px] px-2 text-sm'
      : 'min-w-[22px] h-[22px] px-1.5 text-xs'"
    :style="{
      background: color ? `#${color.replace('#', '')}` : 'hsl(var(--primary))',
      color: textColor ? `#${textColor.replace('#', '')}` : '#fff',
    }"
    :title="title ?? label"
  >
    <slot>{{ label }}</slot>
  </span>
</template>
