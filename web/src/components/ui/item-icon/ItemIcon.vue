<script setup lang="ts">
import { computed } from 'vue'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'
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

// Ghost variant color classes using opacity for reliable rendering.
// Mirrors the keys in `getThemeColorClasses` so the type system catches
// drift if either side adds or removes a color.
const ghostColorClasses: Record<ThemeColor, string> = {
  red: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  orange: 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  amber: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  lime: 'bg-lime-500/10 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300',
  green: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  teal: 'bg-teal-500/10 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  cyan: 'bg-cyan-500/10 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  sky: 'bg-sky-500/10 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  blue: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  indigo: 'bg-indigo-500/10 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  violet: 'bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  purple: 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300',
  pink: 'bg-pink-500/10 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  rose: 'bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  slate: 'bg-slate-500/10 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  neutral: 'bg-neutral-500/10 text-neutral-700 dark:bg-neutral-500/20 dark:text-neutral-300',
  primary: 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary',
}

const useCustomColor = computed(() => !!props.customColor && !props.plain)

const colorClasses = computed(() => {
  if (props.plain || useCustomColor.value) return ''

  if (props.variant === 'ghost') {
    return ghostColorClasses[props.color as ThemeColor]
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
