import { computed, ref, watch } from 'vue'
import { toRefs, useStorage, useToggle } from '@vueuse/core'
import { type Theme, themes } from '@/lib/registry/themes'
import { type Style, styles } from '@/lib/registry/styles'
import { defineStore } from 'pinia'
import { useDark } from '@vueuse/core'

export const colorSchemes = ['auto', 'light', 'dark'] as const
export type ColorScheme = (typeof colorSchemes)[number]

interface Config {
  accentColor: Theme['name']
  radius: number
  style: Style
}

type Color =
  | 'parchment'
  | 'ink'
  | 'compass'
  | 'coral'
  | 'amber'
  | 'peach'
  | 'citrine'
  | 'olive'
  | 'forest'
  | 'moss'
  | 'teal'
  | 'sky'
  | 'cobalt'
  | 'periwinkle'
  | 'indigo'
  | 'violet'
  | 'iris'
  | 'magenta'

export const allColors: Color[] = [
  'parchment',
  'ink',
  'compass',
  'coral',
  'amber',
  'peach',
  'citrine',
  'olive',
  'forest',
  'moss',
  'teal',
  'sky',
  'cobalt',
  'periwinkle',
  'indigo',
  'violet',
  'iris',
  'magenta',
]

export const allRadii = [0, 0.25, 0.5, 0.75, 1]

export const useThemeStore = defineStore('theme', () => {
  const config = useStorage<Config>('config', {
    accentColor: 'parchment',
    radius: 0.5,
    style: styles[0].name,
  })

  const { accentColor, radius, style } = toRefs(config)

  /* Light/dark mode */

  const colorScheme = useStorage<ColorScheme>('vueuse-color-scheme', 'auto')
  const isDark = useDark({ storageRef: colorScheme })
  const toggleDark = useToggle(isDark)

  function setColorScheme(scheme: ColorScheme) {
    colorScheme.value = scheme
  }

  /* Color */

  function initAccentColor() {
    document.documentElement.style.setProperty('--radius', `${radius.value}rem`)
    document.documentElement.classList.add(`theme-${accentColor.value}`)
  }

  function setAccentColor(color: Theme['name']) {
    console.log('color changed')
    config.value.accentColor = color
  }

  watch(accentColor, accentColor => {
    document.documentElement.classList.remove(
      ...allColors.map(color => `theme-${color}`),
    )
    document.documentElement.classList.add(`theme-${accentColor}`)
  })

  const themeClass = computed(() => `theme-${config.value.accentColor}`)

  const themePrimary = computed(() => {
    const t = themes.find(t => t.name === accentColor.value)
    return `hsl(${t?.primary[isDark.value ? 'dark' : 'light']})`
  })

  /* Corner radius */

  function setRadius(newRadius: number) {
    config.value.radius = newRadius
  }

  watch(radius, radius => {
    document.documentElement.style.setProperty('--radius', `${radius}rem`)
  })

  return {
    config,
    colorScheme,
    setColorScheme,
    isDark,
    toggleDark,
    initAccentColor,
    accentColor,
    setAccentColor,
    radius,
    setRadius,
    themeClass,
    style,
    themePrimary,
  }
})
