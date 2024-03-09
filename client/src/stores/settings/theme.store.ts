import { computed, ref, watch } from 'vue'
import { toRefs, useStorage, useToggle } from '@vueuse/core'
import { type Theme, themes } from '@/lib/registry/themes'
import { type Style, styles } from '@/lib/registry/styles'
import { defineStore } from 'pinia'
import { useDark } from '@vueuse/core'

interface Config {
  accentColor: Theme['name']
  radius: number
  style: Style
}

type Color =
  | 'zinc'
  | 'slate'
  | 'stone'
  | 'gray'
  | 'neutral'
  | 'red'
  | 'rose'
  | 'orange'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'violet'

export const allColors: Color[] = [
  'zinc',
  'rose',
  'blue',
  'green',
  'orange',
  'red',
  'slate',
  'stone',
  'gray',
  'neutral',
  'yellow',
  'violet',
]

export const allRadii = [0, 0.25, 0.5, 0.75, 1]

export const useThemeStore = defineStore('theme', () => {
  const config = useStorage<Config>('config', {
    accentColor: 'zinc',
    radius: 0.5,
    style: styles[0].name,
  })

  const { accentColor, radius, style } = toRefs(config)

  /* Light/dark mode */

  const isDark = useDark()
  const toggleDark = useToggle(isDark)

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
    return `hsl(${t?.cssVars[isDark.value ? 'dark' : 'light'].primary})`
  })

  /* Corner radius */

  function setRadius(newRadius: number) {
    config.value.radius = newRadius
  }

  watch(radius, radius => {
    document.documentElement.style.setProperty('--radius', `${radius}rem`)
  })

  const test = ref(1)
  function inc() {
    console.log('test')
    test.value++
  }

  return {
    test,
    inc,

    config,
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
