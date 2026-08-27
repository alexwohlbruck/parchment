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
import { validateStyleMin, featureFilter, expression, latest } from '@maplibre/maplibre-gl-style-spec'
import { buildMapStyle, buildSatelliteStyle, buildLayers, layerGroups } from './build'
import spec from './spec.json'
import { TRANSIT_POI_CLASSES } from './transit-poi.mjs'
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
    // `poi_halo`/`poi_ink` are real colours, not categories — they are the
    // label halo and the glyph knockout. `poi_v4_*` are real colours too, but
    // deliberately so: they are MapTiler's own family palette, copied for the
    // glyph-only treatment rather than tracking ours.
    const categories = Object.keys(light).filter(
      k =>
        k.startsWith('poi_') &&
        !k.startsWith('poi_v4_') &&
        // Real colours, not categories: the label halo, the glyph knockout,
        // and transit blue — a stop is wayfinding rather than a category.
        !['poi_halo', 'poi_ink', 'poi_transit', 'poi_icon_halo'].includes(k),
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
   * The glyph is knocked out of the badge to the surface behind it, so the ink
   * follows the flavor. Light-flavor categories are saturated and mid-dark,
   * dark-flavor ones are pale — a white glyph washes out on the latter.
   */
  test('badge ink follows the flavor, matching the halo', () => {
    expect(light.poi_ink).toBe('#FFFFFF')
    expect(dark.poi_ink).toBe('#0D0D0D')
    // Knockout and halo are the same surface; drifting apart means the glyph
    // stops matching the map it is cut out of.
    expect(light.poi_ink).toBe(light.poi_halo)
    expect(dark.poi_ink).toBe(dark.poi_halo)
  })
})

/**
 * The badge treatment: a category-coloured disc with the glyph knocked out of
 * it, the marker search results and saved places already use.
 *
 * It is ONE symbol layer. It began as a circle layer with a glyph layer over
 * it, and the two could never be kept together — circle layers take no part in
 * collision, so either a culled glyph left an empty disc behind or
 * `icon-allow-overlap` kept every glyph and the badges piled up. The disc is
 * baked into the sprite image now (`build-sprite.mjs`), so a badge is an
 * ordinary icon that MapLibre places like any other.
 */
describe('badge POI treatment', () => {
  const poi = layers.filter(l => l['source-layer'] === 'poi' && l.type === 'symbol')

  test('there are POI layers to style', () => {
    expect(poi.length).toBeGreaterThan(5)
  })

  test('no circle layer survives — the badge is its own image', () => {
    expect(layers.some(l => l.type === 'circle' && l['source-layer'] === 'poi')).toBe(false)
  })

  test.each(poi.map(l => [l.id, l]))('%s: draws the badge form of its icon', (_id, l: any) => {
    const image = JSON.stringify(l.layout['icon-image'])
    // A disc for places, a square plate for transit stops.
    expect(image).toContain('badge-')
    expect(image).toContain('tile-')
    // Places are drawn at the size the art was baked at — scaling a badge
    // scales its disc. Transit plates are the one deliberate exception.
    const size = l.layout['icon-size']
    expect(Array.isArray(size) ? size[0] : size).toBe(Array.isArray(size) ? 'case' : 1)
    if (Array.isArray(size)) expect(size[size.length - 1]).toBe(1)
  })

  test.each(poi.map(l => [l.id, l]))('%s: the disc carries the category colour', (_id, l: any) => {
    // The glyph is a hole in the disc, so tinting the image tints the badge.
    expect(JSON.stringify(l.paint['icon-color'])).toContain('@poi_')
    expect(JSON.stringify(l.paint['text-color'])).toContain('@poi_')
  })

  test.each(poi.map(l => [l.id, l]))('%s: the badge casts a shadow, not a ring', (_id, l: any) => {
    // One halo per symbol, spent on the shadow. It has to be width 0: a halo
    // renders around every edge of the SDF, and the glyph is a hole through
    // the disc, so any width puts a dark rim around the glyph.
    expect(l.paint['icon-halo-color']).toBe('@poi_icon_halo')
    expect(l.paint['icon-halo-width']).toBe(0)
    expect(l.paint['icon-halo-blur']).toBeGreaterThan(0)
  })

  /**
   * The whole reason for baking the disc into the image. Forcing icons to
   * draw is what piled badges on top of each other; now that a badge is one
   * object, collision can do its job.
   */
  test.each(poi.map(l => [l.id, l]))('%s: collision is left to the engine', (_id, l: any) => {
    expect(l.layout['icon-allow-overlap']).toBe(false)
    expect(l.layout['icon-ignore-placement']).toBe(false)
  })

  test.each(poi.map(l => [l.id, l]))('%s: name sits under the badge', (_id, l: any) => {
    expect(l.layout['text-anchor']).toBe('top')
    expect(l.layout['text-offset']).toEqual([0, 1.1])
    expect(l.layout['text-size']).toBe(13)
    // The badge outlives its label in a collision, so a dense block keeps its
    // icons instead of going blank.
    expect(l.layout['text-optional']).toBe(true)
  })

  /**
   * Every icon a POI layer can ask for needs a badge form in the sheet, or the
   * `coalesce` falls through and the POI draws nothing at all.
   */
  test('every badge image the style asks for exists in the sprite', () => {
    const sprite = JSON.parse(
      readFileSync(resolvePath(WEB, 'public/sprites/parchment.json'), 'utf8'),
    )
    const badges = Object.keys(sprite).filter(k => k.startsWith('badge-'))
    expect(badges.length).toBeGreaterThan(200)
    for (const name of Object.keys(sprite)) {
      // Both plate forms are themselves badges — there is no badge of a badge.
      if (name.startsWith('badge-') || name.startsWith('tile-')) continue
      // A badge is a knocked-out SDF glyph, so only SDF art has one. The route
      // shields are full-colour rasters and are never worn as badges.
      if (!sprite[name].sdf) continue
      if (name === 'dot' || name === 'oneway') continue
      expect(sprite[`badge-${name}`], `badge-${name}`).toBeTruthy()
    }
  })

  /**
   * A path crossing a plaza is one pavement. Every casing has to be drawn
   * before every surface, so a plaza's fill covers the casings of the paths
   * inside it and the two read as one surface rather than as a channel scored
   * across the square.
   */
  test('pedestrian casings all draw beneath pedestrian surfaces', () => {
    const layers = buildMapStyle({ ...opts, theme: 'light' }).layers
    const at = (id: string) => layers.findIndex(l => l.id === id)
    const casings = [at('Pedestrian area outline'), at('Path outline')]
    const surfaces = [at('Pedestrian'), at('Path')]
    for (const c of casings) expect(c).toBeGreaterThan(-1)
    for (const s of surfaces) expect(s).toBeGreaterThan(-1)
    expect(Math.max(...casings)).toBeLessThan(Math.min(...surfaces))
  })

  /**
   * At grade a pavement is the lowest thing on the street. Drawn above the
   * roads it cut across every junction; drawn above the buildings it ran
   * straight through them in a tilted view.
   */
  test('pedestrian surfaces at grade draw beneath roads and buildings', () => {
    const layers = buildMapStyle({ ...opts, theme: 'light' }).layers
    const at = (id: string) => layers.findIndex(l => l.id === id)
    const ped = ['Pedestrian area outline', 'Path outline', 'Pedestrian', 'Path'].map(at)
    for (const i of ped) expect(i).toBeGreaterThan(-1)
    const firstRoad = at('Minor road outline')
    const firstBuilding = layers.findIndex(l => (l as any)['source-layer'] === 'building')
    expect(firstRoad).toBeGreaterThan(-1)
    expect(firstBuilding).toBeGreaterThan(-1)
    expect(Math.max(...ped)).toBeLessThan(firstRoad)
    expect(Math.max(...ped)).toBeLessThan(firstBuilding)
  })

  /** A footbridge crosses over the road, not under it — but still under buildings. */
  test('elevated paths draw above the roads and below the buildings', () => {
    const layers = buildMapStyle({ ...opts, theme: 'light' }).layers
    const at = (id: string) => layers.findIndex(l => l.id === id)
    const bridge = at('Path bridge')
    expect(bridge).toBeGreaterThan(-1)
    expect(bridge).toBeGreaterThan(at('Highway'))
    expect(bridge).toBeLessThan(
      layers.findIndex(l => (l as any)['source-layer'] === 'building'),
    )
  })

  /** A plaza edge and the path running into it are one line. */
  test('the plaza casing matches the path casing', () => {
    const layers = buildMapStyle({ ...opts, theme: 'light' }).layers
    const plaza = layers.find(l => l.id === 'Pedestrian area outline')!
    const path = layers.find(l => l.id === 'Path outline')!
    expect(plaza.paint!['line-color']).toEqual(path.paint!['line-color'])
    expect(plaza.paint!['line-width']).toEqual(path.paint!['line-width'])
    expect((plaza as any).minzoom).toBe((path as any).minzoom)
  })

  /** The surface is continuous pavement; dashing it reads as a trail. */
  test('the path surface is solid and matches the plaza fill', () => {
    const layers = buildMapStyle({ ...opts, theme: 'light' }).layers
    const path = layers.find(l => l.id === 'Path')!
    const plaza = layers.find(l => l.id === 'Pedestrian')!
    expect(path.paint!['line-dasharray']).toBeUndefined()
    expect(path.paint!['line-color']).toBe(plaza.paint!['fill-color'])
  })

  /**
   * A campus or hospital boundary must not paint over what is physically on
   * the ground inside it. NYU's university polygon covers Washington Square
   * Park, and drawn on top it turned the whole park into a pale blue slab.
   */
  test('institutional land use draws beneath natural land cover', () => {
    const layers = buildMapStyle({ ...opts, theme: 'light' }).layers
    const index = (id: string) => layers.findIndex(l => l.id === id)
    const lastInstitutional = Math.max(
      ...['Cemetery', 'Hospital', 'Stadium', 'School'].map(index),
    )
    const firstCover = Math.min(
      ...layers
        .map((l, i) => ((l as any)['source-layer'] === 'landcover' ? i : Infinity)),
    )
    expect(firstCover).toBeLessThan(Infinity)
    expect(lastInstitutional).toBeLessThan(firstCover)
  })

  /**
   * The two sheets have to describe the same icon at the same size.
   *
   * `width / pixelRatio` is what MapLibre draws, so a mismatch means the map
   * renders at one size on an ordinary display and another on a retina one.
   * That is exactly what happened: `sharp`'s `density` already scales a vector,
   * the builder multiplied by the ratio a second time, and every icon that read
   * its size back from the render — every bare glyph, and every route shield —
   * came out 1.7x too large at @2x. Badges were unaffected, which is why it
   * went unnoticed until the shields landed.
   */
  test('both sprite sheets draw every icon at the same CSS size', () => {
    const at1x = JSON.parse(
      readFileSync(resolvePath(WEB, 'public/sprites/parchment.json'), 'utf8'),
    )
    const at2x = JSON.parse(
      readFileSync(resolvePath(WEB, 'public/sprites/parchment@2x.json'), 'utf8'),
    )
    const cssSize = (e: any) => [e.width / e.pixelRatio, e.height / e.pixelRatio]
    const mismatched = Object.keys(at1x).filter(name => {
      if (!at2x[name]) return false
      const [w1, h1] = cssSize(at1x[name])
      const [w2, h2] = cssSize(at2x[name])
      return w1 !== w2 || h1 !== h2
    })
    expect(mismatched).toEqual([])
  })

  /**
   * Route shields resolve `{network}-{ref_length}` against the sprite and fall
   * back to `default-{ref_length}`. Two things have to hold for that to work.
   */
  describe('route shields', () => {
    const sprite = JSON.parse(
      readFileSync(resolvePath(WEB, 'public/sprites/parchment.json'), 'utf8'),
    )
    const shieldLayer = () =>
      buildMapStyle({ ...opts, theme: 'light' }).layers.find(
        l => l.id === 'Highway shield',
      )!

    /** The fallback is only a fallback if it covers every length that passes the filter. */
    test('a default plaque exists for every ref length the layer allows', () => {
      for (let n = 1; n <= 6; n++) {
        expect(sprite[`default-${n}`], `default-${n}`).toBeTruthy()
      }
    })

    /**
     * White numerals are keyed on ref length, not on the network alone,
     * because a long interstate ref falls through to the white plaque — and
     * white-on-white is invisible. The cutoff has to match the art that ships.
     */
    test('white lettering stops where the interstate art stops', () => {
      const layer = shieldLayer()
      const [, condition] = layer.paint!['text-color'] as any[]
      const cutoff = condition[2][2]
      expect(sprite[`us-interstate-${cutoff}`], `us-interstate-${cutoff}`).toBeTruthy()
      expect(sprite[`us-interstate-${cutoff + 1}`]).toBeUndefined()
    })

    /** Shields are colour art; tinting them would flatten the interstate to one hue. */
    test('shield art is not SDF', () => {
      for (const name of ['us-interstate-2', 'us-highway-2', 'default-3', 'motorway-exit-2']) {
        expect(sprite[name]?.sdf, name).toBe(false)
      }
    })
  })
})

/**
 * The second POI treatment: a tinted glyph on a halo, no disc, transcribed
 * from MapTiler Streets v4. Their v4 tiles split POIs across `poi_food`,
 * `poi_shopping`, … source-layers our OpenMapTiles basemap does not carry, so
 * what ports is the treatment, applied to the family layers we already derive
 * from v2.
 */
describe('glyph-only POI style', () => {
  const badge = buildLayers({ flavor: 'dark' }) as any[]
  const glyph = buildLayers({ flavor: 'dark', poiStyle: 'glyph' }) as any[]
  const glyphLight = buildLayers({ flavor: 'light', poiStyle: 'glyph' }) as any[]
  const poiIds = spec.layers
    .filter((l: any) => l['source-layer'] === 'poi' && l.type === 'symbol')
    .map((l: any) => l.id)

  test('every POI layer survives the swap', () => {
    for (const id of poiIds) expect(glyph.some(l => l.id === id), id).toBe(true)
  })

  test('draw order is untouched', () => {
    expect(glyph.map(l => l.id)).toEqual(badge.map(l => l.id))
  })

  test.each(poiIds)('%s is a haloed glyph, not a knockout', id => {
    const l = glyph.find(x => x.id === id)
    expect(l.paint['icon-halo-width']).toBe(3.5)
    // The badge treatment inks the glyph to the surface; this one tints it.
    expect(l.paint['icon-color']).not.toBe(darkTokens.poi_ink)
    expect(l.paint['icon-color']).toBe(l.paint['text-color'])
  })

  /**
   * The whole point of a second treatment is that it is MapTiler's palette,
   * not ours — so it must not resolve to the category colours the badge uses.
   */
  test('it uses the v4 family palette, not the app categories', () => {
    const food = glyph.find(l => l.id === 'Food')
    expect(food.paint['icon-color']).toBe(darkTokens.poi_v4_food)
    expect(food.paint['icon-color']).not.toBe(darkTokens.poi_food_and_drink)
  })

  test('light and dark differ, in both ink and halo', () => {
    for (const id of poiIds) {
      const d = glyph.find(x => x.id === id)
      const l = glyphLight.find(x => x.id === id)
      expect(d.paint['icon-color'], id).not.toBe(l.paint['icon-color'])
    }
    expect(lightTokens.poi_v4_halo).toBe('hsl(0, 0%, 100%)')
    expect(darkTokens.poi_v4_halo).toBe('hsl(0, 0%, 0%)')
  })

  /**
   * With no disc underneath, a culled glyph leaves nothing behind — so this
   * treatment can let the collision system place icons normally, where the
   * badge treatment has to force them.
   */
  test('collision is left to the engine', () => {
    for (const id of poiIds) {
      const l = glyph.find(x => x.id === id)
      expect(l.layout['icon-allow-overlap'], id).toBe(false)
      expect(l.layout['icon-ignore-placement'], id).toBe(false)
    }
  })

  test('the dot fallback exists, and is a dot rather than Maki\'s disc', () => {
    const sprite = JSON.parse(readFileSync(resolvePath(__dirname, '../../../public/sprites/parchment.json'), 'utf8'))
    expect(sprite.dot).toBeTruthy()
    // Aliasing `dot` to `circle` would give them identical boxes.
    expect(sprite.dot.x === sprite.circle?.x && sprite.dot.y === sprite.circle?.y).toBe(false)
  })
})

describe('assembled styles', () => {
  const cases: Array<[string, () => any]> = [
    ['light', () => buildMapStyle({ ...opts, theme: 'light' })],
    ['dark', () => buildMapStyle({ ...opts, theme: 'dark' })],
    ['hybrid', () => buildSatelliteStyle({ ...opts, theme: 'dark', hybrid: true })],
    ['satellite', () => buildSatelliteStyle({ ...opts, theme: 'dark', hybrid: false })],
    ['light glyph POIs', () => buildMapStyle({ ...opts, theme: 'light', poiStyle: 'glyph' })],
    ['dark glyph POIs', () => buildMapStyle({ ...opts, theme: 'dark', poiStyle: 'glyph' })],
  ]

  test.each(cases)('%s validates against the MapLibre style spec', (_name, make) => {
    expect(validateStyleMin(make()).map(e => e.message)).toEqual([])
  })

  test.each(cases)('%s leaves no unresolved token behind', (_name, make) => {
    const stray = collectStrings(make().layers).filter(s => /^@/.test(s))
    expect(stray).toEqual([])
  })

  /**
   * Buildings take their colour from the tile's own `building:colour` where OSM
   * has one, blended toward the flavor's anchor. Most buildings in a well-mapped
   * city carry one, so this drives the look of the whole 3D layer — and the
   * values are untrusted OSM strings, so the fallback path matters as much as
   * the happy one.
   */
  describe('building colour', () => {
    const evaluate = (flavor: 'light' | 'dark', properties: Record<string, unknown>) => {
      const layer = (buildLayers({ flavor }) as any[]).find(l => l.id === layerGroups.building3d)
      const parsed = expression.createPropertyExpression(
        layer.paint['fill-extrusion-color'],
        `${layer.id}.paint.fill-extrusion-color`,
        (latest as any)['paint_fill-extrusion']['fill-extrusion-color'],
      )
      expect(parsed.result).toBe('success')
      const c = (parsed as any).value.evaluate({ zoom: 16 }, { properties })
      return [c.r, c.g, c.b].map(v => Math.round(v * 255))
    }

    const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

    test.each(['light', 'dark'] as const)('%s: a painted building takes its hue', flavor => {
      const plain = evaluate(flavor, {})
      const red = evaluate(flavor, { colour: '#ff0000' })
      expect(red).not.toEqual(plain)
      expect(red[0] - red[2]).toBeGreaterThan(plain[0] - plain[2])
    })

    /**
     * The whole point of subtracting the tile colour's luminance: a grey of any
     * lightness contributes no hue, so it cannot punch a hole in the map. 155
     * buildings in a 7x7 z14 grid over Manhattan are tagged literally `black`
     * and 52 `white`, so this is the common case, not a contrived one.
     */
    test.each(['light', 'dark'] as const)('%s: greys render as plain buildings', flavor => {
      const plain = evaluate(flavor, {})
      for (const colour of ['black', 'white', '#808080', 'lightgray']) {
        expect(evaluate(flavor, { colour }), colour).toEqual(plain)
      }
    })

    test('an unparseable colour renders plain rather than black', () => {
      // `to-color` yields black instead of throwing, which the luminance
      // subtraction then treats as any other neutral.
      for (const colour of ['brick', 'light_grey', '#70c2dcb']) {
        expect(evaluate('light', { colour }), colour).toEqual(evaluate('light', {}))
      }
    })

    test.each(['light', 'dark'] as const)('%s: lightness is the flavor’s, not the tile’s', flavor => {
      // A near-black and a near-white facade must not differ in weight.
      const dim = luma(evaluate(flavor, { colour: '#1e1006' }))
      const bright = luma(evaluate(flavor, { colour: '#fffffb' }))
      expect(Math.abs(dim - bright)).toBeLessThan(6)
    })

    test('dark keeps less of the tile colour than light does', () => {
      const spread = (f: 'light' | 'dark') => {
        const [r, g, b] = evaluate(f, { colour: '#cdaa7d' })
        const [pr, pg, pb] = evaluate(f, {})
        return Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb)
      }
      expect(spread('dark')).toBeLessThan(spread('light'))
    })
  })

  test('every filter compiles and evaluates', () => {
    for (const l of buildLayers({ flavor: 'dark' }) as any[]) {
      if (!l.filter) continue
      const f = featureFilter(l.filter, `${l.id}.filter`)
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
      else if (Array.isArray(icon) && icon[0] === 'concat' && typeof icon[2] === 'string') {
        // Shields: `road_` + ref_length, generated for widths 1..6. The POI
        // `concat` is data-driven and covered by its own test below.
        const prefix = icon[1]
        for (let n = 1; n <= 6; n++) literals.add(`${prefix}${icon[2]}${n}`)
      }
    }
    const missing = [...literals].filter(n => !(n in sprite))
    expect(missing).toEqual([])
  })

  /**
   * The POI icon expression walks subclass → class. Every gated subclass and
   * every OpenMapTiles class has to resolve in BOTH forms — bare for the
   * glyph-only treatment, `badge-` prefixed for the badge one — or the
   * `coalesce` falls through and the POI draws nothing at all.
   */
  test('every gated POI icon name resolves, bare and as a badge', () => {
    const poi = layers.find(l => l['source-layer'] === 'poi' && l.layout?.['icon-image'])
    expect(poi).toBeTruthy()
    const names = collectStrings(poi.layout['icon-image']).filter(
      s =>
        s !== '' &&
        s !== 'badge-' &&
        s !== 'tile-' &&
        !['coalesce', 'image', 'match', 'concat', 'get', 'subclass', 'class', 'case'].includes(s),
    )
    expect(names.length).toBeGreaterThan(40)
    expect(names.filter(n => !(n in sprite))).toEqual([])
    expect(names.filter(n => !(`badge-${n}` in sprite))).toEqual([])
    // Transit classes are the ones drawn on a square plate, so they need the
    // second art form too — a miss there draws nothing at all.
    expect(
      TRANSIT_POI_CLASSES.filter(c => names.includes(c) && !(`tile-${c}` in sprite)),
    ).toEqual([])
  })
})
