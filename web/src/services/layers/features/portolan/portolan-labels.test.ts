/**
 * The rule, stated once:
 *
 *   white text on a dark map with a dark shadow
 *   black text on a light map with a light shadow
 *   for EVERY basemap, and it must follow a theme change
 *
 * This shipped wrong four times, each time because the code asked
 * something other than the map — the app's theme, the map store's theme,
 * the background layer (which satellite imagery does not have). So the
 * tests drive the REAL style builders for every basemap the app offers
 * and assert the invariant directly: our ink matches the ink the basemap
 * letters its own street names with.
 */
import { describe, test, expect } from 'vitest'
import { buildMapStyle, buildSatelliteStyle } from '@/lib/map-style'
import {
  basemapTextColors,
  darkFromLightPreset,
  labelPaintFor,
  luminanceOf,
  styleIsDark,
  LABEL_TEXT_DARK_MAP,
  LABEL_TEXT_LIGHT_MAP,
} from './portolan-expressions'

const opts = { tileServerUrl: 'https://example.test/tiles' }
const STYLES: Array<[string, () => any]> = [
  ['street light', () => buildMapStyle({ ...opts, theme: 'light' } as any)],
  ['street dark', () => buildMapStyle({ ...opts, theme: 'dark' } as any)],
  ['hybrid', () => buildSatelliteStyle({ ...opts, theme: 'light', hybrid: true } as any)],
  ['satellite', () => buildSatelliteStyle({ ...opts, theme: 'light', hybrid: false } as any)],
]

describe('station labels contrast on every basemap', () => {
  test.each(STYLES)('%s: our ink matches how the basemap inks its own names', (_name, make) => {
    const layers = make().layers as any[]

    // the majority, computed here independently of the implementation:
    // a style that letters most of its names light is a dark style
    let light = 0
    let dark = 0
    for (const c of basemapTextColors(layers)) {
      const lum = luminanceOf(c)
      if (lum === null) continue
      if (lum > 0.6) light++
      else if (lum < 0.45) dark++
    }

    const ours = luminanceOf(labelPaintFor(layers)['text-color'])!
    if (light !== dark) expect(ours > 0.5).toBe(light > dark)
    // and whichever way, it is a real contrast, not a grey
    expect(ours > 0.8 || ours < 0.2).toBe(true)
  })

  test.each(STYLES)('%s: the halo opposes the text', (_name, make) => {
    const layers = make().layers as any[]
    const paint = labelPaintFor(layers)
    const text = luminanceOf(paint['text-color'])!
    const halo = luminanceOf(paint['text-halo-color'])
    if (halo === null) return // an expression: the basemap's own choice
    expect(Math.abs(text - halo)).toBeGreaterThan(0.5)
  })

  test('a dark app chrome over a light map still gets dark text', () => {
    // the exact case that produced white-on-white: fallbackDark = true
    const layers = buildMapStyle({ ...opts, theme: 'light' } as any).layers as any[]
    expect(styleIsDark(layers, true)).toBe(false)
    expect(labelPaintFor(layers, true)['text-color']).toBe(LABEL_TEXT_LIGHT_MAP)
  })

  test('a light app chrome over a dark map still gets light text', () => {
    const layers = buildMapStyle({ ...opts, theme: 'dark' } as any).layers as any[]
    expect(styleIsDark(layers, false)).toBe(true)
    expect(labelPaintFor(layers, false)['text-color']).toBe(LABEL_TEXT_DARK_MAP)
  })

  test('switching theme switches the ink', () => {
    const light = labelPaintFor(buildMapStyle({ ...opts, theme: 'light' } as any).layers as any[])
    const dark = labelPaintFor(buildMapStyle({ ...opts, theme: 'dark' } as any).layers as any[])
    expect(light['text-color']).not.toBe(dark['text-color'])
    expect(luminanceOf(light['text-color'])!).toBeLessThan(luminanceOf(dark['text-color'])!)
  })
})

describe('the vote, and what happens without one', () => {
  test('a light style votes dark-ink, a dark style votes light-ink', () => {
    const light = buildMapStyle({ ...opts, theme: 'light' } as any).layers as any[]
    const dark = buildMapStyle({ ...opts, theme: 'dark' } as any).layers as any[]
    expect(styleIsDark(light)).toBe(false)
    expect(styleIsDark(dark)).toBe(true)
  })

  test('one odd label cannot swing it', () => {
    // a tan path name in an otherwise dark-inked (light) style
    const layers = buildMapStyle({ ...opts, theme: 'light' } as any).layers as any[]
    layers.unshift({ id: 'highway-name-path', type: 'symbol', paint: { 'text-color': 'hsl(30, 23%, 62%)' } })
    expect(styleIsDark(layers)).toBe(false)
  })

  test('bare imagery gets light ink even with no labels to copy', () => {
    const layers = buildSatelliteStyle({ ...opts, theme: 'light', hybrid: false } as any).layers as any[]
    expect(styleIsDark(layers)).toBe(true)
    expect(labelPaintFor(layers)['text-color']).toBe(LABEL_TEXT_DARK_MAP)
  })
})

describe('overlays drawn over the basemap cannot vote', () => {
  // Taken from the live map: the only symbol layer exposing a plain
  // text-color was a parchment overlay lettered in slate — a dark ink,
  // which outvoted an entire dark basemap and put black names on it.
  const OVERLAY = {
    id: 'bookmarks-labels-internal',
    type: 'symbol',
    source: 'bookmarks-source-internal',
    paint: { 'text-color': '#334155' },
  }

  test.each(STYLES)('%s: verdict survives a slate-lettered overlay', (_name, make) => {
    const clean = make().layers as any[]
    const polluted = [...clean, OVERLAY]
    expect(styleIsDark(polluted)).toBe(styleIsDark(clean))
    expect(labelPaintFor(polluted)['text-color']).toBe(labelPaintFor(clean)['text-color'])
  })

  test('the exact live case: dark basemap plus slate overlay stays light-inked', () => {
    const layers = [...(buildMapStyle({ ...opts, theme: 'dark' } as any).layers as any[]), OVERLAY]
    expect(labelPaintFor(layers)['text-color']).toBe(LABEL_TEXT_DARK_MAP)
  })

  test('imagery with an overlay still reads as dark', () => {
    const layers = [...(buildSatelliteStyle({ ...opts, theme: 'light', hybrid: false } as any).layers as any[]), OVERLAY]
    expect(labelPaintFor(layers)['text-color']).toBe(LABEL_TEXT_DARK_MAP)
  })
})

/**
 * Mapbox Standard is the case no amount of reading the style can solve:
 * its basemap is an import, so `getStyle().layers` holds no background,
 * no street labels, nothing of the map at all — only what the app itself
 * added. Every layer a reader CAN see there is an overlay. So the engine
 * is asked outright, via the same `lightPreset` the theme switch sets.
 */
describe('a style whose basemap is an import', () => {
  // what mapbox-gl actually reports on Standard: our own layers, plus
  // parchment's overlays. No background. No basemap symbol.
  const STANDARD_LAYERS = [
    { id: 'portolan-ribbon-15', type: 'line', source: 'portolan-tiles-mta' },
    { id: 'bookmarks-labels-internal', type: 'symbol', source: 'bookmarks-source-internal', paint: { 'text-color': '#334155' } },
  ]

  test('night and dusk letter light; day and dawn letter dark', () => {
    expect(darkFromLightPreset('night')).toBe(true)
    expect(darkFromLightPreset('dusk')).toBe(true)
    expect(darkFromLightPreset('day')).toBe(false)
    expect(darkFromLightPreset('dawn')).toBe(false)
  })

  test('an unknown or absent preset is no answer, not "light"', () => {
    expect(darkFromLightPreset(undefined)).toBe(null)
    expect(darkFromLightPreset('')).toBe(null)
    expect(darkFromLightPreset('twilight')).toBe(null)
  })

  test('night gets light ink even though the style looks empty and slate', () => {
    const dark = darkFromLightPreset('night')!
    expect(labelPaintFor(STANDARD_LAYERS, false, dark)['text-color']).toBe(LABEL_TEXT_DARK_MAP)
  })

  test('day gets dark ink even when the app chrome is dark', () => {
    const dark = darkFromLightPreset('day')!
    expect(labelPaintFor(STANDARD_LAYERS, true, dark)['text-color']).toBe(LABEL_TEXT_LIGHT_MAP)
  })

  test('the preset switching switches the ink', () => {
    const at = (preset: string) =>
      labelPaintFor(STANDARD_LAYERS, false, darkFromLightPreset(preset)!)['text-color']
    expect(at('day')).not.toBe(at('night'))
  })

  test('with no preset to read, the style still decides', () => {
    // satellite on Mapbox: no basemap import, so undefined — and the
    // reader falls through to the raster rule rather than the chrome
    const layers = buildSatelliteStyle({ ...opts, theme: 'light', hybrid: false } as any).layers as any[]
    expect(labelPaintFor(layers, false, undefined)['text-color']).toBe(LABEL_TEXT_DARK_MAP)
  })

  test('the halo still opposes the ink under an override', () => {
    for (const preset of ['day', 'night']) {
      const paint = labelPaintFor(STANDARD_LAYERS, false, darkFromLightPreset(preset)!)
      const text = luminanceOf(paint['text-color'])!
      const halo = luminanceOf(paint['text-halo-color'])
      if (halo === null) continue
      expect(Math.abs(text - halo)).toBeGreaterThan(0.5)
    }
  })
})
