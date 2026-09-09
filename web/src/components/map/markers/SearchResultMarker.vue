<script setup lang="ts">
import { computed } from 'vue'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'
import * as LucideIcons from 'lucide-vue-next'
import { MapPinIcon } from 'lucide-vue-next'
import {
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultCategory,
} from '@/lib/search.utils'
import { categoryMarkerPaint } from '@/lib/place-colors'
import { markerCss, type MarkerShape } from '@/lib/map-marker'
import { useThemeStore } from '@/stores/theme.store'
import type { Place } from '@/types/place.types'

const { place, isHovered, shape = 'disc' } = defineProps<{
  place: Place
  isHovered?: boolean
  /** How the marker draws. Transit results read better as a square plate. */
  shape?: MarkerShape
}>()

const emit = defineEmits<{
  click: [place: Place, event: MouseEvent]
  mouseenter: [place: Place, event: MouseEvent]
  mouseleave: [place: Place, event: MouseEvent]
}>()

const themeStore = useThemeStore()
const iconName = computed(() => getSearchResultIconName(place))
const iconPack = computed(() => getSearchResultIconPack(place))

// The same plate, glyph and ring the basemap POI underneath wears, at the same
// size — both now come out of `map-marker`.
const css = computed(() =>
  markerCss(
    categoryMarkerPaint(getSearchResultCategory(place), themeStore.isDark, shape),
    shape,
  ),
)

const lucideIcon = computed(() => {
  if (iconPack.value === 'maki') return null
  const fullName = iconName.value.endsWith('Icon') ? iconName.value : `${iconName.value}Icon`
  return (LucideIcons[fullName as keyof typeof LucideIcons] as any) ?? MapPinIcon
})

function handleClick(event: MouseEvent) {
  emit('click', place, event)
}

function handleMouseEnter(event: MouseEvent) {
  emit('mouseenter', place, event)
}

function handleMouseLeave(event: MouseEvent) {
  emit('mouseleave', place, event)
}
</script>

<template>
  <div
    class="shadow-md transition-all duration-150 ease-out cursor-pointer select-none"
    :class="{ 'scale-[1.3] shadow-lg': isHovered }"
    :style="css.plate"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <MakiIcon
      v-if="iconPack === 'maki'"
      :name="iconName"
      size="xs"
      class="fill-current"
      :style="css.glyph"
    />
    <component v-else :is="lucideIcon" :style="css.glyph" />
  </div>
</template>

<style scoped>
div {
  pointer-events: all;
}
</style>
