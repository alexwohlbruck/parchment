<script setup lang="ts">
import type { PlaceCategory } from '@/types/place.types'
import { ItemIcon } from '@/components/ui/item-icon'
import { Chip } from '@/components/ui/chip'
import { getCategoryColor } from '@/services/place/place-colors'
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
  <Chip :label="name" @click="$emit('click')">
    <template #leading>
      <ItemIcon
        :icon="icon || 'MapPin'"
        :icon-pack="iconPack"
        :custom-color="color"
        class="shadow-sm"
        size="xs"
        shape="circle"
        variant="solid"
      />
    </template>
  </Chip>
</template>
