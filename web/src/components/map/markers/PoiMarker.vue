<script setup lang="ts">
import { computed } from 'vue'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'
import * as LucideIcons from 'lucide-vue-next'
import { MapPinIcon } from 'lucide-vue-next'
import { categoryMarkerPaint } from '@/services/place/place-colors'
import { MARKER_HALO, markerCss, type MarkerShape } from '@/lib/map-marker'
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

const paint = computed(() =>
  categoryMarkerPaint(category, themeStore.isDark, shape),
)
const css = computed(() => markerCss(paint.value, shape))

// Mirrors the basemap's POI label layers: ink colour, 1.5px halo.
const labelCss = computed(() => {
  const halo = themeStore.isDark ? MARKER_HALO.dark : MARKER_HALO.light
  return {
    color: paint.value.ink,
    textShadow: `0 0 1.5px ${halo}, 0 0 1.5px ${halo}, 0 0 1.5px ${halo}, 0 0 1.5px ${halo}`,
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
      class="pointer-events-none absolute top-full mt-1 w-max font-sans max-w-[7em] text-center text-[13px] font-semibold leading-[1.05]"
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
