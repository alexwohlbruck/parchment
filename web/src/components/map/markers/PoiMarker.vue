<script setup lang="ts">
import { computed } from 'vue'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'
import * as LucideIcons from 'lucide-vue-next'
import { MapPinIcon } from 'lucide-vue-next'
import { categoryMarkerPaint } from '@/services/place/place-colors'
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
}>()

const themeStore = useThemeStore()

const css = computed(() =>
  markerCss(categoryMarkerPaint(category, themeStore.isDark, shape), shape),
)

const lucideIcon = computed(() => {
  if (iconPack === 'maki') return null
  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`
  return (LucideIcons[fullName as keyof typeof LucideIcons] as any) ?? MapPinIcon
})
</script>

<template>
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
</template>

<style scoped>
div {
  pointer-events: all;
}
</style>
