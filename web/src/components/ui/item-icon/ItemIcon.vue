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

// Ghost variant color classes using opacity for reliable rendering
const ghostColorClasses: Record<ThemeColor, string> = {
  zinc: 'bg-zinc-500/10 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300',
  rose: 'bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  blue: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  green: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  orange: 'bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  red: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  slate: 'bg-slate-500/10 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  stone: 'bg-stone-500/10 text-stone-700 dark:bg-stone-500/20 dark:text-stone-300',
  gray: 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
  neutral: 'bg-neutral-500/10 text-neutral-700 dark:bg-neutral-500/20 dark:text-neutral-300',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  violet: 'bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  primary: 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary',
}

const colorClasses = computed(() => {
  if (props.plain) return ''

  if (props.variant === 'ghost') {
    return ghostColorClasses[props.color as ThemeColor]
  }

  return getThemeColorClasses(props.color as ThemeColor)
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
