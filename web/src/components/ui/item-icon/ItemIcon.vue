<script setup lang="ts">
import { computed } from 'vue'
import {
  getThemeColorClasses,
  getThemeColorGhostClasses,
  type ThemeColor,
} from '@/lib/utils'
import * as LucideIcons from 'lucide-vue-next'
import { FolderIcon } from 'lucide-vue-next'
import MakiIcon from './MakiIcon.vue'
import { useThemeStore } from '@/stores/theme.store'

const themeStore = useThemeStore()

const props = withDefaults(
  defineProps<{
    icon?: string
    color?: ThemeColor
    size?: 'xs' | 'sm' | 'md' | 'lg'
    variant?: 'solid' | 'ghost'
    plain?: boolean
    iconPack?: 'lucide' | 'maki'
    customColor?: string // Direct CSS color value (overrides ThemeColor)
    shape?: 'square' | 'circle' // Shape of the container
  }>(),
  {
    icon: 'Folder',
    color: 'blue',
    size: 'md',
    variant: 'solid',
    plain: false,
    iconPack: 'lucide',
    shape: 'square',
  },
)

const isMaki = computed(() => props.iconPack === 'maki')

const iconComponent = computed(() => {
  if (isMaki.value) return null

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

const useCustomColor = computed(() => !!props.customColor && !props.plain)

const colorClasses = computed(() => {
  if (props.plain || useCustomColor.value) return ''

  if (props.variant === 'ghost') {
    return getThemeColorGhostClasses(props.color as ThemeColor)
  }

  return getThemeColorClasses(props.color as ThemeColor)
})

const customColorStyle = computed(() => {
  if (!useCustomColor.value) return {}

  const color = props.customColor!
  if (props.variant === 'ghost') {
    return {
      backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      color,
    }
  }
  // Solid variant with custom color — colored background, contrasting icon + ring
  const contrast = themeStore.isDark ? '#0C0C0C' : '#FFFFFF'
  return {
    backgroundColor: color,
    borderColor: contrast,
    color: contrast,
  }
})

const shapeClass = computed(() => {
  return props.shape === 'circle' ? 'rounded-full' : 'rounded-md'
})

const containerSizeClass = computed(() => {
  switch (props.size) {
    case 'xs':
      return 'size-5'
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
    case 'xs':
      return 'size-3'
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
    class="flex items-center justify-center shrink-0"
    :class="[containerSizeClass, colorClasses, shapeClass, { 'border-2': shape === 'circle' && useCustomColor }]"
    :style="customColorStyle"
  >
    <MakiIcon
      v-if="isMaki"
      :name="icon"
      :size="size"
      class="fill-current"
    />
    <component
      v-else
      :is="iconComponent as any"
      :class="iconSizeClass"
    />
  </div>
</template>
