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
    // `poi_halo` is a real colour, not a category — it is the label halo.
    const categories = Object.keys(light).filter(
      k => k.startsWith('poi_') && !['poi_halo', 'poi_ink'].includes(k),
    )
    expect(categories).toContain('poi_food_and_drink')
    expect(categories).toContain('poi_default')
    for (const c of categories) expect(light[c]).toMatch(/^@@category:/)
  })

  /**
   * Mapbox Standard letters a POI name in the same colour as its glyph, over a
   * halo that inverts with the theme. The app's search-result markers already
   * do this; the basemap has to agree or the two disagree on screen.
   */
  test('the POI label halo inverts between flavors', () => {
    expect(light.poi_halo).toBe('#FFFFFF')
    expect(dark.poi_halo).toBe('#0D0D0D')
  })

  /**
   * The glyph is knocked out of the badge, so its ink has to contrast with
   * the category colours the badge is filled with. Light-flavor categories
   * are saturated and mid-dark, dark-flavor ones are pale — so the ink
   * inverts too.
   */
  test('badge ink is white in both flavors', () => {
    // The disc carries the category colour, so the glyph knocked out of it is
    // always white — the same rule `map-icon-images.ts` states for the
    // saved-place and search-result glyphs. Inverting it per theme put
    // near-black glyphs on dark badges.
    expect(light.poi_ink).toBe('#FFFFFF')
    expect(dark.poi_ink).toBe('#FFFFFF')
  })
})

describe('Mapbox POI treatment', () => {
  const poi = layers.filter(l => l['source-layer'] === 'poi' && l.type === 'symbol')

  test('there are POI layers to style', () => {
    expect(poi.length).toBeGreaterThan(5)
  })

  test.each(poi.map(l => [l.id, l]))('%s: glyph is ink, label is category colour', (_id, l: any) => {
    // The badge carries the category colour; the glyph is ink knocked out of
    // it, so the two deliberately differ.
    expect(l.paint['icon-color']).toBe('@poi_ink')
    expect(JSON.stringify(l.paint['text-color'])).toContain('@poi_')
  })

  test.each(poi.map(l => [l.id, l]))('%s: name sits under the glyph', (_id, l: any) => {
    expect(l.layout['text-anchor']).toBe('top')
    expect(l.layout['text-offset']).toEqual([0, 1.1])
    expect(l.layout['text-size']).toBe(13)
    // The glyph outlives its label in a collision, so a dense block keeps its
    // icons instead of going blank.
    expect(l.layout['text-optional']).toBe(true)
  })

  /**
   * `1.14r / 24` at r=9.5 — the same figure `glyphSize()` in `core-layers.ts`
   * gives the search-result markers.
   *
   * Guarded because an earlier revision re-derived this from Maki's 15-unit
   * grid instead, got 0.72, and drew glyphs wider than the discs under them:
   * the icon covered its own badge and spilled past the ring, so in dark mode
   * every POI read as a white blob.
   */
  test.each(poi.map(l => [l.id, l]))('%s: glyph fits inside its badge', (_id, l: any) => {
    expect(l.layout['icon-size']).toBeCloseTo(0.451, 3)
  })

  /**
   * Circle layers do not take part in collision, so a glyph that loses one
   * leaves its disc behind as an empty coloured blob. Both flags together are
   * what keeps a badge and its glyph a single object — same as the saved-place
   * glyphs in `core-layers.ts`.
   */
  test.each(poi.map(l => [l.id, l]))('%s: glyph cannot be culled off its badge', (_id, l: any) => {
    expect(l.layout['icon-allow-overlap']).toBe(true)
    expect(l.layout['icon-ignore-placement']).toBe(true)
  })

  test.each(poi.map(l => [l.id, l]))('%s: halo is on the text, not the glyph', (_id, l: any) => {
    expect(l.paint['text-halo-width']).toBe(1)
    expect(l.paint['text-halo-color']).toBe('@poi_halo')
    expect(l.paint['icon-halo-width']).toBe(0)
    expect(l.paint['icon-halo-color']).toBeUndefined()
  })

  /** The scatter of bare dots around the named places on a Mapbox map. */
  test('every POI sits on a category-coloured badge', () => {
    const dot = layers.find(l => l.id === 'POI badge')
    expect(dot).toBeTruthy()
    expect(dot.type).toBe('circle')
    expect(dot['source-layer']).toBe('poi')
    expect(JSON.stringify(dot.paint['circle-color'])).toContain('@poi_food_and_drink')
    // A glyphed POI gets the full ~22px disc; everything else collapses to a dot.
    expect(JSON.stringify(dot.paint['circle-radius'])).toContain('9.5')
    expect(JSON.stringify(dot.paint['circle-radius'])).toContain('2.5')
  })

  test('badges draw beneath the glyphs they sit under', () => {
    const ids = layers.map(l => l.id)
    const firstGlyph = Math.min(...poi.map(l => ids.indexOf(l.id)))
    expect(ids.indexOf('POI badge')).toBeLessThan(firstGlyph)
  })

  /**
   * Only a handful of POIs earn a glyph at any zoom; the rest fall through to
   * a dot. Both sides gate on the same `rank` step, and the dot layer negates
   * the conjunction of that gate with the classes the glyph layers claim — so
   * a POI is drawn exactly once, either way.
   */
  test('glyphs and badges step on the same rank thresholds', () => {
    const badge = layers.find(l => l.id === 'POI badge')
    // The two express the gate differently — the filter compares rank, the
    // badge switches radius on it — but they must agree on where the steps
    // fall, or a POI gets a glyph with no disc under it (or vice versa).
    const thresholds = (f: any) => {
      const json = JSON.stringify(f)
      const at = json.indexOf('["step",["zoom"]')
      if (at < 0) return ''
      return (json.slice(at).match(/,(1[4-9]|2[0-2]),/g) ?? []).join()
    }
    const want = thresholds(badge.paint['circle-radius'])
    expect(want, 'badge has no zoom step').toBeTruthy()
    for (const l of poi) {
      expect(thresholds(l.filter), l.id + ' disagrees').toBe(want)
    }
  })

})

describe('assembled styles', () => {
  const cases: Array<[string, () => any]> = [
    ['light', () => buildMapStyle({ ...opts, theme: 'light' })],
    ['dark', () => buildMapStyle({ ...opts, theme: 'dark' })],
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
  /** Font lists anywhere in a `text-font`, including inside expressions. */
  const fontLists = (() => {
    const EXPR = new Set(['match', 'case', 'step', 'literal', 'get', 'coalesce', 'concat', 'interpolate'])
    const found = new Set<string>()
    const walk = (n: any) => {
      if (!Array.isArray(n)) return
      if (n.length && n.every((x: unknown) => typeof x === 'string') && !EXPR.has(n[0])) {
        found.add(n.join(','))
        return
      }
      n.forEach(walk)
    }
    for (const l of layers) if (l.layout?.['text-font']) walk(l.layout['text-font'])
    return found
  })()

  test('every font stack has generated glyphs', () => {
    expect(fontLists.size).toBeGreaterThan(0)
    for (const stack of fontLists) {
      expect(existsSync(resolvePath(WEB, 'public/fonts', stack, '0-255.pbf')), stack).toBe(true)
    }
  })

  /**
   * MapLibre requests glyphs at `encodeURIComponent(fontstack)`, which turns a
   * multi-font stack's separator into `%2C`. Static file servers do not decode
   * that back into a directory name, so the request falls through to the SPA's
   * index.html and MapLibre parses HTML as protobuf — "Unimplemented type: 4",
   * and every label on the map silently disappears. Curling the same path with
   * a literal comma works, which is what made this look like a corrupt font.
   */
  test('no font stack names more than one font', () => {
    for (const stack of fontLists) {
      expect(stack, `"${stack}" would be requested as %2C-encoded`).not.toContain(',')
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
  /**
   * There is no fallback image: a POI with no glyph shows its bare badge. A
   * `dot` fallback stamped a filled circle over the disc and turned it black.
   */
  test('an unmapped POI falls through to no image, not a filled circle', () => {
    const poi = layers.find(l => l['source-layer'] === 'poi' && l.layout?.['icon-image'])
    const json = JSON.stringify(poi.layout['icon-image'])
    expect(json).not.toContain('"dot"')
    expect(json).toContain('""')
  })

  test('every gated POI icon name resolves', () => {
    const poi = layers.find(l => l['source-layer'] === 'poi' && l.layout?.['icon-image'])
    expect(poi).toBeTruthy()
    const names = collectStrings(poi.layout['icon-image']).filter(
      s =>
        s !== '' &&
        !['coalesce', 'image', 'match', 'get', 'subclass', 'class'].includes(s),
    )
    expect(names.length).toBeGreaterThan(40)
    expect(names.filter(n => !(n in sprite))).toEqual([])
  })
})
