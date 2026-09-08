<script setup lang="ts">
import { computed } from 'vue'
import * as LucideIcons from 'lucide-vue-next'
import { MapPinIcon } from 'lucide-vue-next'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'
import { useI18n } from 'vue-i18n'
import { waypointToDisplay } from '@/lib/place-display'
import { markerPaint, markerCss, MARKER_HALO, MARKER_PLATE_SIZE } from '@/lib/map-marker'
import { useThemeStore } from '@/stores/theme.store'
import type { Place } from '@/types/place.types'

/**
 * A directions stop on the map.
 *
 * A stop that is a real place wears that place's own marker — the same plate,
 * glyph and ring a search result or a saved place gets, so a route through a
 * cafe and a hardware store reads as those two things rather than as "1" and
 * "2". Stops with nothing to draw (a dropped pin, the origin, an unresolved
 * coordinate) keep the plain dot, which is still what says "start here".
 *
 * Named stops carry that name under the mark, lettered exactly as the map's own
 * POI labels are — the icon's glyph colour on the basemap's halo, Geist Medium
 * at 13px, 1.1em below the icon's centre. A stop is a POI, so it should not be
 * possible to tell which of the two labels the style drew.
 */
const props = defineProps<{
  index: number
  totalWaypoints: number
  type?: 'origin' | 'destination' | 'waypoint'
  place?: Partial<Place> | null
}>()

const themeStore = useThemeStore()
const { t } = useI18n()

/**
 * The same derivation the waypoint fields and the trip timeline read, so a
 * stop is the same mark wherever it is drawn — including when it has no place
 * of its own and falls back to the pin.
 */
const mark = computed(() =>
  waypointToDisplay(props.place, { isDark: themeStore.isDark, t }),
)

/** The origin is the one stop that isn't a place; the rest all draw a plate. */
const drawsPlate = computed(
  () => mark.value.ownIcon || (props.index > 0 && props.type !== 'origin'),
)

const iconName = computed(() => mark.value.display.icon)
const iconPack = computed(() => mark.value.display.iconPack)

/**
 * The stop's name, when it has one worth showing. An unnamed pin falls back to
 * its formatted address, which is long and says little at a glance — the mark
 * itself already says "a stop is here", so that gets no label.
 */
const label = computed(() => {
  const place = props.place
  if (!place?.name?.value && !place?.bookmark) return ''
  return mark.value.display.title
})

const css = computed(() =>
  drawsPlate.value && mark.value.display.customColor
    ? markerCss(
        markerPaint(mark.value.display.customColor, 'disc', themeStore.isDark),
        'disc',
      )
    : null,
)

/**
 * `text-color` is the badge's glyph colour and `text-halo-color` the basemap's
 * `poi_halo`, at width 1 — the same pair `convert-basemap-style` gives the POI
 * symbol layer. A stop with no category (the origin, a dropped pin) has no
 * glyph colour to borrow, so its name is lettered in the text colour instead.
 *
 * `-webkit-text-stroke` centres its stroke on the glyph edge, so it takes twice
 * the width to put 1px of halo outside the letter.
 */
const labelStyle = computed(() => ({
  color: css.value ? css.value.glyph.color : 'var(--color-foreground)',
  paintOrder: 'stroke fill',
  WebkitTextStrokeWidth: '2px',
  WebkitTextStrokeColor: themeStore.isDark ? MARKER_HALO.dark : MARKER_HALO.light,
}))

/** 1.1em of a 13px label below the icon's centre, as `text-offset` states. */
const LABEL_TOP = `${MARKER_PLATE_SIZE / 2 + 13 * 1.1}px`

const lucideIcon = computed(() => {
  if (iconPack.value === 'maki') return null
  const fullName = iconName.value.endsWith('Icon')
    ? iconName.value
    : `${iconName.value}Icon`
  return (
    (LucideIcons[fullName as keyof typeof LucideIcons] as unknown) ?? MapPinIcon
  )
})
</script>

<template>
  <div class="relative size-8 shrink-0 cursor-move flex items-center justify-center">
    <!-- The place's own marker -->
    <div v-if="css" class="shadow-md select-none" :style="css.plate">
      <MakiIcon
        v-if="iconPack === 'maki'"
        :name="iconName"
        size="xs"
        class="fill-current"
        :style="css.glyph"
      />
      <component v-else :is="lucideIcon" :style="css.glyph" />
    </div>
    <!-- Where the trip starts, drawn as the fields and the timeline draw it -->
    <div
      v-else
      class="size-4 rounded-full bg-background border-[1.5px] border-foreground/60 shadow-md"
    />

    <!-- Out of flow, so the mark stays centred on the coordinate however long
         the name is, and inert, so it never swallows a drag meant for the
         marker. It wraps at 8em rather than truncating, as `text-max-width`
         does. -->
    <div
      v-if="label"
      class="absolute left-1/2 -translate-x-1/2 max-w-[104px] w-max text-center text-[13px] font-medium leading-tight pointer-events-none"
      :style="{ top: LABEL_TOP, ...labelStyle }"
    >
      {{ label }}
    </div>
  </div>
</template>
