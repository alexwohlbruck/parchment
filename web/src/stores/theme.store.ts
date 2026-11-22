import { computed, ref, watch } from 'vue'
import { toRefs, useStorage, useToggle } from '@vueuse/core'
import { type Theme, themes } from '@/lib/registry/themes'
import { defineStore } from 'pinia'
import { useDark } from '@vueuse/core'
import { usePowerStore } from '@/stores/power.store'

export const colorSchemes = ['auto', 'light', 'dark'] as const
export type ColorScheme = (typeof colorSchemes)[number]

export const uiThemes = ['modern', 'parchment'] as const
export type UiTheme = (typeof uiThemes)[number]

interface Config {
  accentColor: Theme['name']
  radius: number
  uiTheme: UiTheme
  uiScale: number
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

export const uiScales = [0.9, 1, 1.1, 1.25, 1.5]

export const useThemeStore = defineStore('theme', () => {
  const config = useStorage<Config>(
    'config',
    {
      accentColor: 'parchment',
      radius: 0.5,
      uiTheme: 'modern',
      uiScale: 1,
    },
    undefined,
    { mergeDefaults: true },
  )

  const { accentColor, radius, uiTheme, uiScale } = toRefs(config)

  /* Interface size: per device, since it depends on the screen */

  function setUiScale(scale: number) {
    config.value.uiScale = scale
  }

  watch(
    uiScale,
    scale => {
      document.documentElement.style.fontSize = scale === 1 ? '' : `${scale * 100}%`
    },
    { immediate: true },
  )

  /* Interface theme */

  function setUiTheme(theme: UiTheme) {
    config.value.uiTheme = theme
  }

  watch(
    uiTheme,
    theme => {
      const { classList } = document.documentElement
      classList.remove(...uiThemes.map(t => `ui-${t}`))
      classList.add(`ui-${theme}`)
    },
    { immediate: true },
  )

  /* Light/dark mode */

  const colorScheme = useStorage<ColorScheme>('vueuse-color-scheme', 'auto')
  // Extreme battery saver goes dark for the OLED savings without touching the stored scheme.
  const power = usePowerStore()
  const shownScheme = computed<ColorScheme>({
    get: () => (power.saver === 'extreme' ? 'dark' : colorScheme.value),
    set: scheme => (colorScheme.value = scheme),
  })
  const isDark = useDark({ storageRef: shownScheme })
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
    uiScale,
    setUiScale,
    themeClass,
    uiTheme,
    setUiTheme,
    themePrimary,
  }
})
