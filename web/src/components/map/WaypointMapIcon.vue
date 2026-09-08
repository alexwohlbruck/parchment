<script setup lang="ts">
import { computed } from 'vue'
import * as LucideIcons from 'lucide-vue-next'
import { MapPinIcon } from 'lucide-vue-next'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'
import {
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultCategory,
} from '@/lib/search.utils'
import { categoryMarkerPaint } from '@/lib/place-colors'
import { markerCss } from '@/lib/map-marker'
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
 */
const props = defineProps<{
  index: number
  totalWaypoints: number
  type?: 'origin' | 'destination' | 'waypoint'
  place?: Partial<Place> | null
}>()

const themeStore = useThemeStore()

/** Only a place with a resolved category icon has a marker worth drawing. */
const poi = computed(() => (props.place?.icon ? (props.place as Place) : null))

const iconName = computed(() =>
  poi.value ? getSearchResultIconName(poi.value) : '',
)
const iconPack = computed(() =>
  poi.value ? getSearchResultIconPack(poi.value) : 'lucide',
)

const css = computed(() =>
  poi.value
    ? markerCss(
        categoryMarkerPaint(
          getSearchResultCategory(poi.value),
          themeStore.isDark,
        ),
        'disc',
      )
    : null,
)

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
    <!-- Origin: hollow circle -->
    <div
      v-else-if="index === 0 || type === 'origin'"
      class="size-4 rounded-full bg-background border-2 border-foreground/70 shadow-md"
    />
    <!-- Stops: primary circle with number -->
    <div
      v-else
      class="size-5 rounded-full bg-primary border-[1.5px] border-white flex items-center justify-center shadow-md"
    >
      <span class="text-[10px] font-bold text-white">{{ index }}</span>
    </div>
  </div>
</template>
