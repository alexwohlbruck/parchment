<script setup lang="ts">
import type { PlaceCategory } from '@/types/place.types'
import { ItemIcon } from '@/components/ui/item-icon'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    presetId: string
    name: string
    icon?: string
    iconPack?: 'lucide' | 'maki'
    iconCategory?: PlaceCategory | string
  }>(),
  {
    iconPack: 'maki',
  },
)

defineEmits<{
  click: []
}>()

const themeStore = useThemeStore()

const color = computed(() => {
  return getCategoryColor(props.iconCategory || 'default', themeStore.isDark)
})
</script>

<template>
  <button
    class="inline-flex items-center gap-1 rounded-full border border-border pl-0.5 pr-2 py-0.5 bg-background transition-colors"
    @click="$emit('click')"
  >
    <ItemIcon
      :icon="icon || 'MapPin'"
      :icon-pack="iconPack"
      :custom-color="color"
      class="shadow-sm"
      size="xs"
      shape="circle"
      variant="solid"
    />
    <span class="text-xs font-medium">{{ name }}</span>
  </button>
</template>
