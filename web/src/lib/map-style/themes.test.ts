import { describe, expect, test } from 'vitest'
import { MAP_STYLE_IDS } from '@/types/map.types'
import { themeSky, themeTokens } from './themes'
import lightTokens from './tokens.light.json'
import darkTokens from './tokens.dark.json'

const BASE = { light: lightTokens as Record<string, string>, dark: darkTokens as Record<string, string> }

describe('map themes', () => {
  test.each(MAP_STYLE_IDS.flatMap(style => (['light', 'dark'] as const).map(flavor => [style, flavor] as const)))(
    '%s %s only overrides tokens the style uses',
    (style, flavor) => {
      const tokens = themeTokens(style, flavor)
      expect(Object.keys(tokens).sort()).toEqual(Object.keys(BASE[flavor]).sort())
    },
  )

  test('parchment is the generated tokens', () => {
    expect(themeTokens('parchment', 'light')).toEqual(lightTokens)
    expect(themeTokens('parchment', 'dark')).toEqual(darkTokens)
  })

  test.each(MAP_STYLE_IDS)('%s fades the horizon into its own ground', style => {
    for (const flavor of ['light', 'dark'] as const) {
      expect(themeSky(style, flavor)['fog-color']).toBe(themeTokens(style, flavor).background_background_color)
    }
  })
})
