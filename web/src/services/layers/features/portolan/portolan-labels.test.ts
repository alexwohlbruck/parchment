/**
 * The label colours, tested against the REAL basemap styles.
 *
 * This got shipped wrong three times — white text on a white map, then
 * dark text on a dark map — every time because the code asked a store
 * which theme was in force instead of asking the style what it paints.
 * So the test drives buildMapStyle itself, in both themes, and asserts
 * the only property that actually matters: the text contrasts with the
 * background it lands on.
 */
import { describe, test, expect } from 'vitest'
import { buildMapStyle } from '@/lib/basemap-style'
import {
  labelPaintFor,
  luminanceOf,
  styleIsDark,
  LABEL_TEXT_DARK_MAP,
  LABEL_TEXT_LIGHT_MAP,
} from './portolan-expressions'

const styleFor = (theme: 'light' | 'dark') =>
  buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme } as any)

describe('luminanceOf', () => {
  test('parses the colour forms a style actually uses', () => {
    expect(luminanceOf('#1c1c2e')).toBeLessThan(0.5) // the dark background
    expect(luminanceOf('rgb(239,239,239)')).toBeGreaterThan(0.5) // the light one
    expect(luminanceOf('#fff')).toBeCloseTo(1, 5)
    expect(luminanceOf('rgba(255,255,255,0.7)')).toBeGreaterThan(0.5)
    expect(luminanceOf('hsl(0, 0%, 0%)')).toBeCloseTo(0, 5)
    expect(luminanceOf(['interpolate'])).toBeNull()
    expect(luminanceOf(undefined)).toBeNull()
  })
})

describe('station label paint over the real basemap', () => {
  test('dark basemap gets LIGHT text', () => {
    const style = styleFor('dark')
    expect(styleIsDark(style.layers as any[])).toBe(true)
    const paint = labelPaintFor(style.layers as any[])
    expect(paint['text-color']).toBe(LABEL_TEXT_DARK_MAP)
    expect(luminanceOf(paint['text-color'])!).toBeGreaterThan(0.8)
  })

  test('light basemap gets DARK text', () => {
    const style = styleFor('light')
    expect(styleIsDark(style.layers as any[])).toBe(false)
    const paint = labelPaintFor(style.layers as any[])
    expect(paint['text-color']).toBe(LABEL_TEXT_LIGHT_MAP)
    expect(luminanceOf(paint['text-color'])!).toBeLessThan(0.2)
  })

  test('text always contrasts with the background it lands on', () => {
    for (const theme of ['light', 'dark'] as const) {
      const layers = styleFor(theme).layers as any[]
      const bg = layers.find(l => l.type === 'background')
      const bgLum = luminanceOf(bg.paint?.['background-color'])!
      const txtLum = luminanceOf(labelPaintFor(layers)['text-color'])!
      expect(Math.abs(txtLum - bgLum)).toBeGreaterThan(0.5)
    }
  })

  test('falls back to the given theme when no background layer is readable', () => {
    expect(labelPaintFor([], true)['text-color']).toBe(LABEL_TEXT_DARK_MAP)
    expect(labelPaintFor([], false)['text-color']).toBe(LABEL_TEXT_LIGHT_MAP)
  })
})
