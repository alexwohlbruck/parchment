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
    variant?: 'solid' | 'ghost'
    plain?: boolean
  }>(),
  {
    icon: 'Folder',
    color: 'blue',
    size: 'md',
    variant: 'solid',
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
  if (props.plain) return ''

  const baseClasses = getThemeColorClasses(props.color as ThemeColor)

  if (props.variant === 'ghost') {
    if (props.color === 'primary') {
      return 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary'
    }

    return baseClasses
      .replace(/bg-(\w+)-200/g, 'bg-$1-100')
      .replace(/dark:bg-(\w+)-800/g, 'dark:bg-$1-900')
  }

  return baseClasses
})

const containerSizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'size-8'
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
    :class="[containerSizeClass, colorClasses]"
  >
    <component :is="iconComponent as any" :class="iconSizeClass" />
  </div>
</template>
