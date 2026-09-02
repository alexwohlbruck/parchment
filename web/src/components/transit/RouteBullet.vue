<script setup lang="ts">
/**
 * The colored route "bullet" (NYC-subway style) — e.g. 6 · 6X · N · L.
 *
 * One component for every place a route badge appears: the trip-detail
 * timeline, the departures card, the station header. Carries the same
 * lighting/bevel as a button (a white hairline border + the `depth-raised`
 * inset highlight and drop shadow) so the bullets read as physical chips.
 *
 * Shape and glyph colour follow portolan's bullet baker, so a bullet in
 * the panel is the bullet on the map beside it: `shape` is portolan's
 * curated outline (`shape:` on a route or an agency — a Mexico City metro
 * numeral sits in a notched square, a Vienna U-Bahn one in a square), and
 * an unlettered bullet takes dark glyphs on a light colour rather than a
 * flat white that vanishes on the MTA's yellow.
 *
 * `color`/`textColor` are GTFS hex values, with or without the leading '#';
 * colour falls back to the app primary.
 */
import { computed } from 'vue'
import {
  bulletGeometry,
  bulletTextColor,
  isBulletShape,
  type BulletShape,
} from '@/lib/transit-bullets'

const props = withDefaults(
  defineProps<{
    label?: string
    color?: string | null
    textColor?: string | null
    /** Portolan's curated outline; anything unknown reads as a circle. */
    shape?: BulletShape | string | null
    size?: 'sm' | 'md'
    title?: string
  }>(),
  { size: 'sm' },
)

/** The baker's box heights, in CSS px. */
const HEIGHT = { sm: 22, md: 26 } as const

const shape = computed<BulletShape>(() =>
  isBulletShape(props.shape) ? props.shape : 'circle',
)

/** One or two glyphs sit in a 1:1 box; a word becomes a pill — the same
 *  rule the baker applies before it draws. */
const compact = computed(() => (props.label ?? '').length <= 2)

const geometry = computed(() =>
  bulletGeometry(shape.value, {
    compact: compact.value,
    height: HEIGHT[props.size],
  }),
)

const background = computed(() =>
  props.color ? `#${props.color.replace('#', '')}` : 'hsl(var(--primary))',
)

/** With no colour to read, the primary carries white glyphs as before. */
const ink = computed(() =>
  props.color ? bulletTextColor(props.color, props.textColor) : '#fff',
)

/** A clipped outline cannot show a border — the clip cuts it off — and
 *  the drop shadow would trace the box, not the shape. */
const clipped = computed(() => !!geometry.value.clipPath)
</script>

<template>
  <span
    class="route-bullet inline-flex items-center justify-center shrink-0 font-semibold leading-none"
    :class="[
      clipped ? '' : 'border border-white/15 depth-raised',
      shape === 'circle' && compact ? 'rounded-full' : '',
      size === 'md' ? 'px-2 text-sm' : 'px-1.5 text-xs',
    ]"
    :style="{
      background,
      color: ink,
      minWidth: geometry.minWidth,
      height: geometry.height,
      borderRadius: geometry.borderRadius,
      ...(geometry.clipPath ? { clipPath: geometry.clipPath } : {}),
    }"
    :title="title ?? label"
  >
    <span
      class="inline-block"
      :style="geometry.textShift !== '0px' ? { transform: `translateY(${geometry.textShift})` } : {}"
    >
      <slot>{{ label }}</slot>
    </span>
  </span>
</template>
