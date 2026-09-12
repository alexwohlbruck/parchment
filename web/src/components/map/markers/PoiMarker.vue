<script setup lang="ts">
import { computed } from 'vue'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'
import * as LucideIcons from 'lucide-vue-next'
import { MapPinIcon } from 'lucide-vue-next'
import { categoryMarkerPaint, getCategoryColor } from '@/services/place/place-colors'
import { markerCss, type MarkerShape } from '@/lib/map-marker'
import { useThemeStore } from '@/stores/theme.store'

const {
  iconName,
  iconPack = 'lucide',
  category,
  shape = 'disc',
  isHovered,
  muted,
} = defineProps<{
  iconName: string
  iconPack?: 'lucide' | 'maki'
  /** PlaceCategory driving the plate colour. */
  category: string
  /** Transit results read better as a square plate. */
  shape?: MarkerShape
  isHovered?: boolean
  /** Draws de-emphasised, for places shown as context rather than the subject. */
  muted?: boolean
  /** Name drawn under the plate, the way the basemap labels its own POIs. */
  label?: string
}>()

const themeStore = useThemeStore()

const css = computed(() =>
  markerCss(categoryMarkerPaint(category, themeStore.isDark, shape), shape),
)

// Matches the basemap's own POI labels: category-coloured, haloed so it stays
// legible over any fill.
const labelCss = computed(() => {
  const halo = themeStore.isDark ? 'rgba(12,12,12,0.9)' : 'rgba(255,255,255,0.9)'
  return {
    color: getCategoryColor(category, themeStore.isDark),
    textShadow: `0 0 3px ${halo}, 0 0 3px ${halo}, 0 0 3px ${halo}`,
  }
})

const lucideIcon = computed(() => {
  if (iconPack === 'maki') return null
  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`
  return (LucideIcons[fullName as keyof typeof LucideIcons] as any) ?? MapPinIcon
})
</script>

<template>
  <div class="relative flex flex-col items-center">
    <div
      class="shadow-md transition-all duration-150 ease-out cursor-pointer select-none"
      :class="[
        { 'scale-[1.3] shadow-lg': isHovered },
        muted && 'opacity-50 saturate-[0.35] scale-90 shadow-none',
      ]"
      :style="css.plate"
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
    <span
      v-if="label"
      class="pointer-events-none absolute top-full mt-0.5 max-w-[120px] truncate text-center text-[11px] font-medium leading-tight"
      :class="{ 'opacity-50': muted }"
      :style="labelCss"
    >
      {{ label }}
    </span>
  </div>
</template>

<style scoped>
div {
  pointer-events: all;
}
</style>
