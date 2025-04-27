<script setup lang="ts">
import { computed } from 'vue'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import * as LucideIcons from 'lucide-vue-next'
import { FolderIcon } from 'lucide-vue-next'

const props = defineProps<{
  icon?: string
  color?: ThemeColor
  size?: 'sm' | 'md' | 'lg'
}>()

// Default props
const iconName = computed(() => props.icon || 'Folder')
const iconColor = computed(() => props.color || 'blue')
const iconSize = computed(() => props.size || 'md')

// Get the icon component
const iconComponent = computed(() => {
  // Add "Icon" suffix if not already present
  const fullName = iconName.value.endsWith('Icon')
    ? iconName.value
    : `${iconName.value}Icon`

  // Check if the key exists and is not the index export
  const isValidIcon =
    fullName !== 'icons' &&
    typeof LucideIcons[fullName as keyof typeof LucideIcons] === 'function'

  return isValidIcon
    ? LucideIcons[fullName as keyof typeof LucideIcons]
    : FolderIcon
})

// Get color classes
const colorClasses = computed(() => {
  return getThemeColorClasses(iconColor.value as ThemeColor)
})

// Calculate container size based on the size prop
const containerSizeClass = computed(() => {
  switch (iconSize.value) {
    case 'sm':
      return 'size-6'
    case 'lg':
      return 'size-12'
    case 'md':
    default:
      return 'size-10'
  }
})

// Calculate icon size based on the size prop
const iconSizeClass = computed(() => {
  switch (iconSize.value) {
    case 'sm':
      return 'size-3.5'
    case 'lg':
      return 'size-6'
    case 'md':
    default:
      return 'size-5'
  }
})
</script>

<template>
  <div
    class="rounded-md flex items-center justify-center flex-shrink-0"
    :class="[containerSizeClass, colorClasses]"
  >
    <component :is="iconComponent" :class="iconSizeClass" />
  </div>
</template>
