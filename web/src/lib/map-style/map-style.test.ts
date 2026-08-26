/**
 * The basemap's invariants.
 *
 * The spec and both token maps are generated from MapTiler's styles by
 * `scripts/convert-basemap-style.mjs`, so these assert the things a
 * regeneration could quietly break — an unresolved token, a font stack we
 * have no glyphs for, an icon the sprite lacks. Each of those still renders
 * *something*, which is exactly why they need asserting rather than eyeballing.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { validateStyleMin, featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { buildMapStyle, buildSatelliteStyle, buildLayers, layerGroups } from './build'
import spec from './spec.json'
import lightTokens from './tokens.light.json'
import darkTokens from './tokens.dark.json'

const opts = { tileServerUrl: 'https://example.test/tiles' } as any
const HERE = resolvePath(__dirname)
const WEB = resolvePath(HERE, '../../..')

const layers = (spec as any).layers as any[]
const light = lightTokens as Record<string, string>
const dark = darkTokens as Record<string, string>

/** Source-layers present in our OpenMapTiles basemap.pmtiles. */
const OMT_SOURCE_LAYERS = new Set([
  'aerodrome_label', 'aeroway', 'boundary', 'building', 'housenumber',
  'landcover', 'landuse', 'mountain_peak', 'park', 'place', 'poi',
  'transportation', 'transportation_name', 'water', 'water_name', 'waterway',
])

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(v => collectStrings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach(v => collectStrings(v, out))
  return out
}

describe('converted spec', () => {
  test('every layer targets a source-layer our tiles actually carry', () => {
    for (const l of layers) {
      if (!l['source-layer']) continue
      expect(OMT_SOURCE_LAYERS, `${l.id} → ${l['source-layer']}`).toContain(l['source-layer'])
    }
  })

  test('every layer reads our tile source', () => {
    for (const l of layers) {
      if (!l.source) continue
      expect(l.source, l.id).toBe('openmaptiles')
    }
  })

  test('layer ids are unique', () => {
    const ids = layers.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * An unresolved `"@token"` reaches MapLibre as a literal string, which is
   * not a colour — the layer is rejected and silently never draws.
   */
  test('every token the spec references resolves in both flavors', () => {
    const referenced = new Set(
      collectStrings(layers).filter(s => s.startsWith('@')).map(s => s.slice(1)),
    )
    expect(referenced.size).toBeGreaterThan(50)
    const missingLight = [...referenced].filter(t => !(t in light))
    const missingDark = [...referenced].filter(t => !(t in dark))
    expect(missingLight).toEqual([])
    expect(missingDark).toEqual([])
  })

  test('the two flavors define exactly the same tokens', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
  })
})

describe('flavors', () => {
  /**
   * Dark is read out of MapTiler's own Streets Dark rather than derived, so
   * the ground genuinely differs. If a regeneration ever fell back to light
   * values wholesale this would catch it.
   */
  test('dark is not a copy of light', () => {
    const differing = Object.keys(light).filter(t => light[t] !== dark[t])
    expect(differing.length).toBeGreaterThan(Object.keys(light).length * 0.6)
  })

  test('the ground inverts between flavors', () => {
    const bg = Object.keys(light).filter(k => k.startsWith('background_'))
    expect(bg.length).toBeGreaterThan(0)
    for (const token of bg) {
      // Light grounds are pale, dark grounds are not. hsl lightness is the
      // third component of every value MapTiler writes.
      const l = Number(/,\s*([\d.]+)%\)/.exec(light[token])?.[1])
      const d = Number(/,\s*([\d.]+)%\)/.exec(dark[token])?.[1])
      expect(l, `light ${token}`).toBeGreaterThan(60)
      expect(d, `dark ${token}`).toBeLessThan(40)
    }
  })

  test('POI tints come from the app category palette, not a literal', () => {
    const categories = Object.keys(light).filter(k => k.startsWith('poi_'))
    expect(categories).toContain('poi_food_and_drink')
    expect(categories).toContain('poi_default')
    for (const c of categories) expect(light[c]).toMatch(/^@@category:/)
  })
})

describe('assembled styles', () => {
  const cases: Array<[string, () => any]> = [
    ['light', () => buildMapStyle({ ...opts, theme: 'light' })],
    ['dark', () => buildMapStyle({ ...opts, theme: 'dark' })],
    ['minimal', () => buildMapStyle({ ...opts, theme: 'dark', mapStyle: 'parchment-minimal' })],
    ['hybrid', () => buildSatelliteStyle({ ...opts, theme: 'dark', hybrid: true })],
    ['satellite', () => buildSatelliteStyle({ ...opts, theme: 'dark', hybrid: false })],
  ]

  test.each(cases)('%s validates against the MapLibre style spec', (_name, make) => {
    expect(validateStyleMin(make()).map(e => e.message)).toEqual([])
  })

  test.each(cases)('%s leaves no unresolved token behind', (_name, make) => {
    const stray = collectStrings(make().layers).filter(s => /^@/.test(s))
    expect(stray).toEqual([])
  })

  test('every filter compiles and evaluates', () => {
    for (const l of buildLayers({ flavor: 'dark' }) as any[]) {
      if (!l.filter) continue
      const f = featureFilter(l.filter)
      const run = () => f.filter({ zoom: 15 } as any, { type: 1, properties: {} } as any, {} as any)
      expect(run, l.id).not.toThrow()
    }
  })

  test('the tile URL carries the auth token when we have one', () => {
    const withKey = buildMapStyle({ ...opts, theme: 'light', tileKey: 'abc' })
    expect((withKey.sources.openmaptiles as any).tiles[0]).toContain('token=abc')
    const without = buildMapStyle({ ...opts, theme: 'light' })
    expect((without.sources.openmaptiles as any).tiles[0]).not.toContain('token=')
  })

  test('a live category palette overrides the fallback tints', () => {
    const style = buildMapStyle({
      ...opts,
      theme: 'light',
      categoryColors: { food_and_drink: '#123456' },
    })
    expect(JSON.stringify(style.layers)).toContain('#123456')
  })

  test('minimal drops POIs, house numbers and buildings', () => {
    const ids = buildLayers({ flavor: 'light', mapStyle: 'parchment-minimal' }).map(l => l.id)
    const full = buildLayers({ flavor: 'light' })
    const dropped = full.filter(l => !ids.includes(l.id))
    expect(dropped.length).toBeGreaterThan(5)
    for (const l of dropped as any[]) {
      expect(['poi', 'housenumber', 'building'], l.id).toContain(
        l['source-layer'] ?? 'building',
      )
    }
  })

  test('hybrid keeps labels and arterials over the imagery, nothing else', () => {
    const style = buildSatelliteStyle({ ...opts, theme: 'dark', hybrid: true })
    const ids = style.layers.map(l => l.id)
    expect(ids[0]).toBe('satellite-raster')
    expect(style.layers.filter(l => l.type === 'symbol').length).toBeGreaterThan(5)
    expect(ids).not.toContain('Background')
  })

  test('every id the strategy toggles exists in the spec', () => {
    const ids = new Set(layers.map(l => l.id))
    for (const group of ['poi', 'roadLabels', 'transit', 'placeLabels'] as const) {
      expect(layerGroups[group].length, group).toBeGreaterThan(0)
      for (const id of layerGroups[group]) expect(ids, id).toContain(id)
    }
    expect(ids).toContain(layerGroups.building3d)
  })
})

describe('assets the spec depends on', () => {
  const sprite = JSON.parse(
    readFileSync(resolvePath(WEB, 'public/sprites/parchment.json'), 'utf8'),
  )

  /**
   * MapLibre concatenates a font stack into one request path, so the glyph
   * directory has to be named for the whole stack. A stack we did not
   * generate 404s and its labels never draw.
   */
  test('every font stack has generated glyphs', () => {
    const stacks = new Set<string>()
    for (const l of layers) {
      const f = l.layout?.['text-font']
      if (Array.isArray(f) && f.every((x: unknown) => typeof x === 'string')) {
        stacks.add(f.join(','))
      }
    }
    expect(stacks.size).toBeGreaterThan(0)
    for (const stack of stacks) {
      const dir = resolvePath(WEB, 'public/fonts', stack, '0-255.pbf')
      expect(existsSync(dir), stack).toBe(true)
    }
  })

  /** Icon names the spec can emit, excluding data-driven class/subclass. */
  test('every literal icon the spec names exists in the sprite', () => {
    const literals = new Set<string>()
    for (const l of layers) {
      const icon = l.layout?.['icon-image']
      if (icon === undefined) continue
      if (typeof icon === 'string') literals.add(icon)
      else if (Array.isArray(icon) && icon[0] === 'concat') {
        // Shields: `road_` + ref_length, generated for widths 1..6.
        const prefix = icon[1]
        for (let n = 1; n <= 6; n++) literals.add(`${prefix}${icon[2]}${n}`)
      }
    }
    const missing = [...literals].filter(n => !(n in sprite))
    expect(missing).toEqual([])
  })

  /**
   * The POI icon expression walks subclass → class → dot. Every gated
   * subclass and every OpenMapTiles class has to resolve, or the icon falls
   * through to a generic dot while still rendering — invisible by eye.
   */
  test('every gated POI icon name resolves', () => {
    const poi = layers.find(l => l['source-layer'] === 'poi' && l.layout?.['icon-image'])
    expect(poi).toBeTruthy()
    const names = collectStrings(poi.layout['icon-image']).filter(
      s => !['coalesce', 'image', 'match', 'get', 'subclass', 'class', 'dot'].includes(s),
    )
    expect(names.length).toBeGreaterThan(40)
    expect(names.filter(n => !(n in sprite))).toEqual([])
  })
})
