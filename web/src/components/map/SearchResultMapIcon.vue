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
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import type { Place } from '@/types/place.types'

const { place, isHovered } = defineProps<{
  place: Place
  isHovered?: boolean
}>()

const emit = defineEmits<{
  click: [place: Place, event: MouseEvent]
  mouseenter: [place: Place, event: MouseEvent]
  mouseleave: [place: Place, event: MouseEvent]
}>()

const themeStore = useThemeStore()
const iconName = computed(() => getSearchResultIconName(place))
const iconPack = computed(() => getSearchResultIconPack(place))
const categoryColor = computed(() =>
  getCategoryColor(getSearchResultCategory(place), themeStore.isDark),
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
  <!-- Mapbox-style circular pin. Text labels are rendered by the symbol layer. -->
  <div
    class="size-[22px] border-[1.5px] border-white dark:border-[#0C0C0C] rounded-full flex items-center justify-center shadow-md transition-all duration-150 ease-out cursor-pointer select-none"
    :class="{ 'scale-[1.3] shadow-lg': isHovered }"
    :style="{ backgroundColor: categoryColor }"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <MakiIcon
      v-if="iconPack === 'maki'"
      :name="iconName"
      size="xs"
      class="fill-current text-white dark:text-[#0C0C0C]"
    />
    <component
      v-else
      :is="lucideIcon"
      class="text-white dark:text-[#0C0C0C] size-3"
    />
  </div>
</template>

<style scoped>
div {
  pointer-events: all;
}
</style>
