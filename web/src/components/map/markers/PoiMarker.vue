<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'
import * as LucideIcons from 'lucide-vue-next'
import { MapPinIcon } from 'lucide-vue-next'
import { categoryMarkerPaint } from '@/services/place/place-colors'
import { MARKER_HALO, markerCss, type MarkerShape } from '@/lib/map-marker'
import { useThemeStore } from '@/stores/theme.store'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { poiBadgeColors } from '@/lib/map-style/build'
import { poiBadgeImage, type PoiBadgeImage } from '@/lib/map-style/badge-art'

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
const paletteStore = useCategoryPaletteStore()

// Plated markers wear the basemap's own badge; a bare glyph has no badge form.
const badge = shallowRef<PoiBadgeImage | null>(null)
watchEffect(onCleanup => {
  if (shape === 'glyph') return
  let stale = false
  onCleanup(() => (stale = true))
  const isDark = themeStore.isDark
  const colors = poiBadgeColors(category, isDark ? 'dark' : 'light', paletteStore.categoryColors(isDark))
  void poiBadgeImage(
    { pack: iconPack, name: iconName, plate: shape === 'square' ? 'tile' : 'disc' },
    colors,
  ).then(image => {
    if (!stale) badge.value = image
  })
})

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
    <img
      v-if="badge"
      :src="badge.url"
      :width="badge.width"
      :height="badge.height"
      alt=""
      draggable="false"
      class="block max-w-none transition-all duration-150 ease-out cursor-pointer select-none"
      :class="[
        { 'scale-[1.3]': isHovered },
        muted && 'opacity-50 saturate-[0.35] scale-90',
      ]"
    />
    <div
      v-else-if="shape === 'glyph'"
      class="transition-all duration-150 ease-out cursor-pointer select-none"
      :class="[
        { 'scale-[1.3]': isHovered },
        muted && 'opacity-50 saturate-[0.35] scale-90',
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
      class="pointer-events-none absolute top-[calc(50%+1.1em)] w-max font-sans max-w-[7em] text-center text-[13px] font-semibold leading-[1.05]"
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
