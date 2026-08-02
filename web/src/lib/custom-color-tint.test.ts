import { describe, it, expect } from 'vitest'
import { getCustomColorTint, hexToHsl } from './utils'

/** WCAG relative luminance, for the contrast assertions below. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Every colour the category palette ships, in both schemes.
const CATEGORY_COLORS = [
  ['food_and_drink', '#FF9933', '#FBCB6A'],
  ['education', 'hsl(30, 50%, 38%)', 'hsl(30, 50%, 70%)'],
  ['medical', 'hsl(0, 90%, 60%)', 'hsl(0, 70%, 70%)'],
  ['sport_and_leisure', 'hsl(190, 75%, 38%)', 'hsl(190, 60%, 70%)'],
  ['store', 'hsl(210, 75%, 53%)', 'hsl(210, 70%, 75%)'],
  ['arts_and_entertainment', 'hsl(320, 85%, 60%)', 'hsl(320, 70%, 75%)'],
  ['commercial_services', 'hsl(250, 75%, 60%)', 'hsl(260, 70%, 75%)'],
  ['park', 'hsl(110, 70%, 28%)', 'hsl(110, 55%, 65%)'],
  ['default', 'hsl(210, 20%, 43%)', 'hsl(210, 20%, 70%)'],
] as const

describe('getCustomColorTint', () => {
  it('accepts both colour notations the palette emits', () => {
    expect(getCustomColorTint('#FF9933', 'solid', false)).not.toBeNull()
    expect(getCustomColorTint('hsl(210, 75%, 53%)', 'solid', false)).not.toBeNull()
  })

  it('returns null for a colour it cannot parse, so callers can fall back', () => {
    expect(getCustomColorTint('rebeccapurple', 'solid', false)).toBeNull()
    expect(getCustomColorTint('', 'solid', false)).toBeNull()
  })

  it('keeps the source hue — a tint, not a recolour', () => {
    const source = hexToHsl('#1975d8')
    const tint = getCustomColorTint('#1975d8', 'solid', false)!
    // A couple of degrees of drift is 8-bit hex quantisation on the round trip.
    expect(Math.abs(hexToHsl(tint.background!).h - source.h)).toBeLessThan(2)
    expect(Math.abs(hexToHsl(tint.foreground).h - source.h)).toBeLessThan(2)
  })

  it('gives a light background and dark glyph, inverting in dark mode', () => {
    const light = getCustomColorTint('hsl(210, 75%, 53%)', 'solid', false)!
    const dark = getCustomColorTint('hsl(210, 70%, 75%)', 'solid', true)!

    expect(hexToHsl(light.background!).l).toBeGreaterThan(
      hexToHsl(light.foreground).l,
    )
    expect(hexToHsl(dark.background!).l).toBeLessThan(
      hexToHsl(dark.foreground).l,
    )
  })

  it('normalises wildly different source lightnesses onto one ramp', () => {
    // park is L 28, store is L 53 — the tinted backgrounds should still match.
    const park = getCustomColorTint('hsl(110, 70%, 28%)', 'solid', false)!
    const store = getCustomColorTint('hsl(210, 75%, 53%)', 'solid', false)!
    expect(hexToHsl(park.background!).l).toBeCloseTo(
      hexToHsl(store.background!).l,
      0,
    )
  })

  it('leaves the ghost background to the caller', () => {
    const tint = getCustomColorTint('#FF9933', 'ghost', false)!
    expect(tint.background).toBeNull()
    expect(tint.foreground).toMatch(/^#[0-9a-f]{6}$/)
  })

  it.each(CATEGORY_COLORS)(
    '%s clears the 3:1 non-text contrast floor in both schemes',
    (_id, lightColor, darkColor) => {
      const light = getCustomColorTint(lightColor, 'solid', false)!
      const dark = getCustomColorTint(darkColor, 'solid', true)!
      expect(contrast(light.background!, light.foreground)).toBeGreaterThan(3)
      expect(contrast(dark.background!, dark.foreground)).toBeGreaterThan(3)
    },
  )
})
