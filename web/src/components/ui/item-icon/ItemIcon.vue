<script setup lang="ts">
import { computed } from 'vue'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import * as LucideIcons from 'lucide-vue-next'
import { FolderIcon } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    icon?: string
    color?: ThemeColor
    size?: 'sm' | 'md' | 'lg'
    plain?: boolean
  }>(),
  {
    icon: 'Folder',
    color: 'blue',
    size: 'md',
    plain: false,
  },
)

const iconComponent = computed(() => {
  const fullName = props.icon.endsWith('Icon')
    ? props.icon
    : `${props.icon}Icon`

  const isValidIcon =
    fullName !== 'icons' &&
    typeof LucideIcons[fullName as keyof typeof LucideIcons] === 'function'

  return isValidIcon
    ? LucideIcons[fullName as keyof typeof LucideIcons]
    : FolderIcon
})

const colorClasses = computed(() => {
  return getThemeColorClasses(props.color as ThemeColor)
})

const containerSizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'size-6'
    case 'lg':
      return 'size-12'
    case 'md':
    default:
      return 'size-10'
  }
})

const iconSizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'size-4'
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
    class="rounded-md flex items-center justify-center shrink-0"
    :class="[containerSizeClass, props.plain ? '' : colorClasses]"
  >
    <component :is="iconComponent as any" :class="iconSizeClass" />
  </div>
</template>
