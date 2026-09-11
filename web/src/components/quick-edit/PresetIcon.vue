<script setup lang="ts">
import { computed } from 'vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { getCategoryColor } from '@/services/place/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import type { PresetSummary } from '@/types/quick-edit.types'

const props = defineProps<{
  preset: Pick<PresetSummary, 'iconName' | 'iconPack' | 'iconCategory'>
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>()

const themeStore = useThemeStore()

const color = computed(() =>
  getCategoryColor(props.preset.iconCategory, themeStore.isDark),
)
</script>

<template>
  <ItemIcon
    :icon="preset.iconName"
    :icon-pack="preset.iconPack"
    :custom-color="color"
    :size="size ?? 'md'"
    shape="circle"
  />
</template>
