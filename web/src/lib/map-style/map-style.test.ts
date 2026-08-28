/**
 * The basemap's invariants.
 *
 * The spec and both token maps are generated from MapTiler's styles by
 * `scripts/convert-basemap-style.mjs`, so these assert the things a
 * regeneration could quietly break — an unresolved token, a font stack we
 * have no glyphs for, an icon the sprite lacks. Each of those still renders
 * *something*, which is exactly why they need asserting rather than eyeballing.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { validateStyleMin, featureFilter, expression, latest } from '@maplibre/maplibre-gl-style-spec'
import {
  buildMapStyle,
  buildSatelliteStyle,
  buildLayers,
  layerGroups,
  MAX_PITCH,
  SOURCE,
  BUILDING_3D_ROOF_LAYER,
  BUILDING_ROOF_EDGE_LAYER,
} from './build'
import { BUILDING_3D_SOURCE, BUILDING_3D_TILES } from './detail-layers'
import { setBarrelmanBuildingsReady } from './barrelman-buildings'
import spec from './spec.json'
import { TRANSIT_POI_CLASSES } from './transit-poi.mjs'
import { terrainSource } from './terrain'
import { TREE_OPACITY } from './detail-layers'
import { getCustomColorTint } from '@/lib/color-tint'
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

  /**
   * A tunnel is under the ground, and the only thing on the map that says so is
   * that the ground shows through it. Every tunnelled way has to be in on it —
   * a road tunnel drawn at full strength beside a translucent rail one reads as
   * a road, not as a tunnel.
   */
  test('every tunnelled way lets the ground through', () => {
    const tunnels = layers.filter(l => /tunnel/i.test(l.id) && l.type === 'line')
    expect(tunnels.length).toBeGreaterThan(4)
    for (const layer of tunnels) {
      const opacity = layer.paint?.['line-opacity']
      expect(typeof opacity, layer.id).toBe('number')
      expect(opacity, layer.id).toBeLessThanOrEqual(0.6)
    }
  })
})

/**
 * The elevation source is shared by both engines, so the things that make it
 * readable by both are the things worth pinning.
 */
describe('terrain source', () => {
  const src = terrainSource()

  test('is terrarium-encoded, which is what both engines can read', () => {
    // Mapbox's own DEM needs a Mapbox token and so cannot serve MapLibre;
    // terrarium is the encoding they have in common.
    expect(src.encoding).toBe('terrarium')
    expect(src.type).toBe('raster-dem')
  })

  test('declares the tile size and zoom the dataset actually has', () => {
    // Terrarium tiles are 256px where a DEM source otherwise assumes 512, and
    // the dataset stops at 15. Both wrong by default, and both wrong quietly:
    // the terrain just comes out garbled rather than erroring.
    expect(src.tileSize).toBe(256)
    expect(src.maxzoom).toBe(15)
  })

  test('needs no API key', () => {
    for (const url of src.tiles) {
      expect(url).not.toMatch(/token|key|access/i)
      expect(url).toMatch(/^https:\/\//)
    }
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

  /**
   * Every layer's dark colour has to be the one MapTiler paints it, not one it
   * inherited from an unrelated layer that happened to agree in daylight.
   *
   * This is the invariant the tokenizer exists to hold and the one it quietly
   * broke: it deduplicated on the light colour alone, so the first layer to
   * claim a colour also decided what everything else painted that colour would
   * look like at night. White is where that bites — MapTiler paints sixteen
   * unrelated things white in daylight, and all sixteen took glacier blue,
   * including minor roads, runways, cable cars, and the halo behind every
   * label on the map. Nothing about the light map changed, so nothing showed
   * it except the night map looking oddly blue.
   *
   * Checked against the vendored source rather than against a snapshot,
   * because a snapshot of the wrong values is just as green.
   */
  test('a dark colour belongs to its own layer, not to whichever shared its light one', () => {
    const vendor = (file: string) =>
      JSON.parse(readFileSync(resolvePath(WEB, 'scripts/vendor', file), 'utf8'))
    const darkStyle = vendor('maptiler-streets-v2-dark.json')
    const byId = new Map<string, any>(darkStyle.layers.map((l: any) => [l.id, l]))

    /** Every colour literal in a value, in document order — the pairing order. */
    const colorsIn = (value: any, out: string[] = []): string[] => {
      if (typeof value === 'string' && /^(#|rgba?\(|hsla?\()/.test(value.trim())) out.push(value.trim())
      else if (Array.isArray(value)) value.forEach(v => colorsIn(v, out))
      else if (value && typeof value === 'object') Object.values(value).forEach(v => colorsIn(v, out))
      return out
    }
    const tokensIn = (value: any, out: string[] = []): string[] => {
      if (typeof value === 'string' && value.startsWith('@')) out.push(value.slice(1))
      else if (Array.isArray(value)) value.forEach(v => tokensIn(v, out))
      else if (value && typeof value === 'object') Object.values(value).forEach(v => tokensIn(v, out))
      return out
    }

    /**
     * Tokens we author rather than lift — the tail of `convert-basemap-style`
     * overwrites these after tokenizing, so MapTiler's value is not the answer
     * for them and never was.
     */
    const authored =
      /^(poi_|road_|shield_ink|path_surface|path_casing|building_3d_|building_roof_edge$)/

    const wrong: string[] = []
    let checked = 0
    for (const layer of layers) {
      const source = byId.get(layer.id)
      if (!source) continue
      for (const section of ['paint', 'layout'] as const) {
        for (const [prop, value] of Object.entries(layer[section] ?? {})) {
          const expected = colorsIn(source[section]?.[prop])
          const used = tokensIn(value)
          // Only where both sides carry the same number of colours: our layer
          // rewrites (shields, POIs, pedestrian surfaces) deliberately diverge.
          if (!used.length || used.length !== expected.length) continue
          used.forEach((token, i) => {
            if (authored.test(token)) return
            checked++
            if (dark[token] !== expected[i]) {
              wrong.push(`${layer.id}.${prop}[${i}] is ${dark[token]}, MapTiler paints ${expected[i]}`)
            }
          })
        }
      }
    }

    // A floor, so a change that silently stops pairing anything at all — a
    // renamed layer, a restructured section — fails here instead of passing
    // vacuously with an empty `wrong`. Well under the ~77 lifted colours left
    // once the authored ones are set aside, since authoring more of the map is
    // a normal thing to do and should not need this number revisited.
    expect(checked).toBeGreaterThan(50)
    expect(wrong).toEqual([])
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
    // `poi_v4_*` are real colours, deliberately: they are MapTiler's own
    // family palette, copied for the glyph-only treatment rather than
    // tracking ours. The rest name a category and resolve through the live
    // palette — raw for the label, tinted for the badge's plate, ink and ring.
    const categories = Object.keys(light).filter(
      k =>
        k.startsWith('poi_') &&
        !k.startsWith('poi_v4_') &&
        // Real colours, not categories: the label halo, the badge's lift, and
        // transit blue — a stop is wayfinding rather than a category.
        !['poi_halo', 'poi_lift'].includes(k) &&
        !k.startsWith('poi_transit_'),
    )
    expect(categories).toContain('poi_plate_food_and_drink')
    expect(categories).toContain('poi_ink_default')
    for (const c of categories) expect(light[c], c).toMatch(/^@@category-(plate|ink|ring):/)
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
   * The badge's lift inverts too. A cast shadow is a daylight idea: behind a
   * pale badge on dark ground a dark blur does nothing, so night gets a faint
   * light bloom doing the same job.
   */
  test('the badge lift inverts between flavors', () => {
    expect(light.poi_lift).toMatch(/^rgba\(0,\s*0,\s*0/)
    expect(dark.poi_lift).toMatch(/^rgba\(255,\s*255,\s*255/)
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

  test.each(poi.map(l => [l.id, l]))('%s: the badge name carries its colours', (_id, l: any) => {
    // A badge is four colours and a symbol layer offers two, so the image is
    // named rather than tinted and `poi-badge.ts` composites it. The name has
    // to carry a plate, an ink and a lift, or there is nothing to draw with.
    const image = JSON.stringify(l.layout['icon-image'])
    expect(image).toContain('@poi_plate_')
    expect(image).toContain('@poi_ink_')
    expect(image).toContain('@poi_lift')
    // The label takes the glyph's colour, not the plate's — the plate is a pale
    // tint and would be unreadable as lettering.
    expect(JSON.stringify(l.paint['text-color'])).toContain('@poi_ink_')
  })

  test.each(poi.map(l => [l.id, l]))('%s: nothing tints the badge at draw time', (_id, l: any) => {
    // Both of these are inherited from MapTiler and both are dead against a
    // full-colour image. Left in they are misleading, and they keep MapTiler's
    // own family tokens alive in the token file.
    expect(l.paint['icon-color']).toBeUndefined()
    expect(l.paint['icon-halo-color']).toBeUndefined()
    expect(l.paint['icon-halo-width']).toBeUndefined()
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

  /**
   * A one-way arrow is paint on the roadway, so a building standing over that
   * road hides it. MapLibre draws every layer at or after the first 3D one with
   * depth testing off (`opaquePassCutoff`), so the only way a building can
   * occlude a symbol is for the symbol to be ordered underneath it.
   */
  test('one-way arrows draw beneath the buildings that stand over them', () => {
    const layers = buildMapStyle({ ...opts, theme: 'light' }).layers
    const at = (id: string) => layers.findIndex(l => l.id === id)
    const oneway = at('Oneway')
    expect(oneway).toBeGreaterThan(-1)
    // Above every road, so the arrow still sits on the tarmac...
    expect(oneway).toBeGreaterThan(at('Highway'))
    expect(oneway).toBeGreaterThan(at('Minor road'))
    // ...and under the footbridges and buildings that cross over it.
    expect(oneway).toBeLessThan(at('Path bridge'))
    expect(oneway).toBeLessThan(
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

  test.each(poiIds)('%s is a haloed glyph, not a plate', id => {
    const l = glyph.find(x => x.id === id)
    expect(l.paint['icon-halo-width']).toBe(3.5)
    // The badge treatment composites its own image and tints nothing at draw
    // time; this one is a plain sprite glyph the layer tints, in the same
    // colour as its label.
    expect(l.paint['icon-color']).toBe(l.paint['text-color'])
    expect(JSON.stringify(l.layout['icon-image'])).not.toContain('poi|')
  })

  /**
   * The whole point of a second treatment is that it is MapTiler's palette,
   * not ours — so it must not resolve to the category colours the badge uses.
   */
  test('it uses the v4 family palette, not the app categories', () => {
    const food = glyph.find(l => l.id === 'Food')
    expect(food.paint['icon-color']).toBe(darkTokens.poi_v4_food)
    expect(food.paint['icon-color']).not.toBe(darkTokens.poi_ink_food_and_drink)
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
   * 3D buildings come from Barrelman, not from the basemap.
   *
   * OpenStreetMap maps a detailed building twice — an outline over the whole
   * footprint and `building:part` polygons inside it holding the real heights —
   * and OpenMapTiles marks the outline `hide_3d` so a 3D map can drop it. A
   * stock build carries no such field, so the filter MapTiler wrote (and which
   * is still here) had nothing to bite on and every part-mapped building drew
   * twice, z-fighting, one at the outline's default height and one at the
   * part's own.
   */
  describe('3D building source', () => {
    // The switch is made only once the source is known to answer; these build
    // the migrated style directly. `falls back` below covers the other side.
    beforeEach(() => setBarrelmanBuildingsReady(true))
    afterEach(() => setBarrelmanBuildingsReady(null))

    const extrusions = (flavor: 'light' | 'dark' = 'dark') =>
      (buildLayers({ flavor }) as any[]).filter(l => l.type === 'fill-extrusion')

    /**
     * Barrelman has to have the source created before it serves it, and a style
     * pointed at one that 404s draws no buildings at all — worse than the fault
     * it fixes, since a doubled building is at least a building. So the basemap
     * is what the style starts on, and the probe in `barrelman-buildings.ts`
     * moves it over.
     */
    test('falls back to the basemap until the source is known to answer', () => {
      setBarrelmanBuildingsReady(null)
      for (const l of extrusions()) {
        expect(l.source, l.id).toBe(SOURCE)
        expect(l['source-layer'], l.id).toBe('building')
      }
      // And the roof-colour layer is not added either — there is no second
      // colour to read without the source that carries it.
      expect(extrusions().map(l => l.id)).not.toContain(BUILDING_3D_ROOF_LAYER)
    })

    test('the extrusion reads Barrelman, and the flat fill still reads the basemap', () => {
      for (const l of extrusions()) {
        expect(l.source, l.id).toBe(BUILDING_3D_SOURCE)
        expect(l['source-layer'], l.id).toBe(BUILDING_3D_TILES)
      }
      // The flat footprint is left alone: an outline and a part painted the same
      // flat colour on top of each other are indistinguishable from one shape.
      const flat = (buildLayers({ flavor: 'dark' }) as any[]).find(l => l.id === 'Building')
      expect(flat.source).toBe(SOURCE)
      expect(flat['source-layer']).toBe('building')
    })

    test('the source it reads is declared', () => {
      const style = buildMapStyle({ ...opts, theme: 'dark' })
      expect(style.sources[BUILDING_3D_SOURCE]).toBeTruthy()
      expect((style.sources[BUILDING_3D_SOURCE] as any).tiles[0]).toContain(BUILDING_3D_TILES)
    })

    test('the outline filter is still there, to bite on the flag Barrelman adds', () => {
      for (const l of extrusions()) expect(l.filter, l.id).toEqual(['!has', 'hide_3d'])
    })

    /**
     * The one that matters, and the one that fails silently.
     *
     * The roof colour arrives on a second layer over the same buildings, and the
     * whole trick rests on MapLibre putting the two in ONE bucket — it groups by
     * `type`, `source`, `source-layer`, `minzoom`, `maxzoom`, `filter` and
     * `layout`, and paint is deliberately not in that list. Differ on any of
     * them and they land in separate buckets with separately ordered vertices,
     * at which point the roof colours are read against the wrong buildings.
     */
    test('the roof layer matches the buildings on every key a bucket is grouped by', () => {
      const [buildings, roof] = extrusions()
      expect(roof.id).toBe(BUILDING_3D_ROOF_LAYER)
      for (const key of ['type', 'source', 'source-layer', 'minzoom', 'maxzoom', 'filter', 'layout']) {
        expect(roof[key], key).toEqual(buildings[key])
      }
    })

    test('the roof layer is never drawn', () => {
      // MapLibre's own fill-extrusion draw returns immediately on zero opacity,
      // so the layer costs a paint buffer per tile and no fragments at all.
      const [, roof] = extrusions()
      expect(roof.paint['fill-extrusion-opacity']).toBe(0)
    })

    test('the roof takes roof_colour, falling back to the walls rather than to bare', () => {
      const [buildings, roof] = extrusions()
      const wall = JSON.stringify(buildings.paint['fill-extrusion-color'])
      const top = JSON.stringify(roof.paint['fill-extrusion-color'])
      expect(wall).not.toContain('roof_colour')
      expect(top).toContain('roof_colour')
      // A building recording only `building:colour` wears it on the roof too,
      // rather than banding at the roofline against an untinted top.
      expect(top).toContain('"coalesce",["get","roof_colour"],["get","colour"]')
    })

    test('the roofline stand-in follows the extrusion, source and filter both', () => {
      // It traces what is extruded. Left on the basemap it would outline the
      // hidden outlines — an edge around nothing — and miss the parts.
      const edge = (buildLayers({ flavor: 'dark' }) as any[])
        .find(l => l.id === BUILDING_ROOF_EDGE_LAYER)
      expect(edge.source).toBe(BUILDING_3D_SOURCE)
      expect(edge['source-layer']).toBe(BUILDING_3D_TILES)
      expect(edge.filter).toEqual(['!has', 'hide_3d'])
    })

    test('trees still stand above the buildings, both layers of them', () => {
      const ids = (buildLayers({ flavor: 'dark' }) as any[]).map(l => l.id)
      expect(ids.indexOf('Trees')).toBeGreaterThan(ids.indexOf(BUILDING_3D_ROOF_LAYER))
    })
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
    /** How colourful, in channel units — 0 for any grey, 255 for a pure hue. */
    const chroma = (c: number[]) => Math.max(...c) - Math.min(...c)
    /** Hue in degrees, and how far two of them are apart around the circle. */
    const hue = ([r, g, b]: number[]) => {
      const mx = Math.max(r, g, b)
      const d = mx - Math.min(r, g, b)
      if (!d) return 0
      const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      return ((h * 60) % 360 + 360) % 360
    }
    const hueGap = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360
      return d > 180 ? 360 - d : d
    }

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

    /**
     * The property the whole expression is built around, and the one it used to
     * get wrong. The tint was scaled by the tile colour's departure from its own
     * luminance in absolute channel units, which a dark colour has little of
     * however saturated it is — so a maroon facade tinted a fraction as much as
     * a scarlet one, and a bottle-green one barely at all. Normalising by the
     * tile's chroma means only hue and colourfulness survive the trip.
     *
     * Every shade here clears `CHROMA_REF`, which is where the tint reaches full
     * strength. Below it the tint deliberately fades out — a colour with little
     * chroma left to measure is a grey with a cast, and the map would rather
     * under-tint one of those than punch a hole for every facade tagged `black`.
     */
    test.each(['light', 'dark'] as const)('%s: the same hue tints alike at any lightness', flavor => {
      for (const shades of [
        ['#800000', '#b00000', '#ff0000'],
        ['#005500', '#00aa00', '#00ff00'],
        ['#000080', '#0000c0', '#0000ff'],
      ]) {
        const [first, ...rest] = shades.map(colour => evaluate(flavor, { colour }))
        for (const other of rest) expect(other, shades.join(' ')).toEqual(first)
      }
    })

    /**
     * The other half of that failure: subtracting a *luminance*-weighted mean
     * leaves a direction that is not isotropic, because blue carries 0.07 of the
     * luminance and red and green carry the rest. Any blue content swung the
     * blue channel hard while red and green movements damped out, so the palette
     * collapsed onto the blue-yellow axis — on the night flavor, whose anchor is
     * itself a saturated blue-grey, a dark red facade came out blue.
     */
    test.each(['light', 'dark'] as const)('%s: a facade keeps its own hue', flavor => {
      const wheel = [
        '#ff0000', '#ff8c00', '#ffff00', '#556b2f', '#00ff00', '#008080',
        '#0000ff', '#4b0082', '#800080', '#8b4513', '#ffc0cb',
        // Dark and muted paint, which is what a real facade usually is, and
        // what the luminance-weighted version turned blue.
        '#4b0000', '#004d00', '#000080', '#cdaa7d',
      ]
      for (const colour of wheel) {
        const tile = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16))
        expect(hueGap(hue(evaluate(flavor, { colour })), hue(tile)), colour).toBeLessThan(4)
      }
    })

    /**
     * A hint of the colour, never the colour. The hue is carried faithfully, so
     * the only thing keeping a red-painted building from being red is how far
     * the tint is allowed to travel — and on the night flavor it may travel in
     * both directions, where daylight can only darken. Bounded against the
     * flavor's own colour cast rather than an absolute, since "subtle" means
     * subtle next to the map it sits on.
     */
    test.each(['light', 'dark'] as const)('%s: a tint stays a hint of the paint', flavor => {
      const plain = chroma(evaluate(flavor, {}))
      for (const colour of ['#ff0000', '#00ff00', '#0000ff', '#ffff00']) {
        const tinted = chroma(evaluate(flavor, { colour }))
        expect(tinted, colour).toBeLessThan(70)
        // And it never reads as more colourful than the tile it came from.
        expect(tinted, colour).toBeLessThan(chroma([1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16))))
      }
      expect(plain).toBeLessThan(70)
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
    // Through the tint, which is what the badge is drawn from: the same hue at
    // the icon-tile's lightness rather than the raw colour, so a badge on the
    // map and the icon in a place's header cannot come out different.
    const json = JSON.stringify(style.layers)
    expect(json).toContain(getCustomColorTint('#123456', 'solid', false)!.foreground)
    expect(json).toContain(getCustomColorTint('#123456', 'solid', false)!.background)
  })


  /**
   * The camera can now tilt to 85, where the horizon comes into view. Left
   * unspecified MapLibre's sky is fully transparent, so a steep view would end
   * in whatever is behind the canvas rather than in anything map-like.
   */
  test('both flavors define a sky for the raised pitch to look into', () => {
    expect(MAX_PITCH).toBe(85)
    for (const theme of ['light', 'dark'] as const) {
      const sky = (buildMapStyle({ ...opts, theme }) as any).sky
      expect(sky, theme).toBeTruthy()
      expect(sky['sky-color'], theme).toBeTruthy()
      // The haze on the far ground, which is what stops the last tiles ending
      // on a hard line.
      expect(sky['fog-color'], theme).toBeTruthy()
    }
    // The imagery basemap is daylight photography whatever the app theme is.
    expect((buildSatelliteStyle({ ...opts, theme: 'dark' }) as any).sky).toEqual(
      (buildMapStyle({ ...opts, theme: 'light' }) as any).sky,
    )
  })

  /**
   * Parking and trees are ours rather than MapTiler's, and come from their own
   * Barrelman sources — OpenMapTiles carries neither. See `detail-layers.ts`.
   */
  describe('map detail', () => {
    const style = buildMapStyle({ ...opts, theme: 'light' })
    const at = (id: string) => style.layers.findIndex(l => l.id === id)

    test('the detail sources are declared and separate from the basemap', () => {
      expect(Object.keys(style.sources)).toContain('parking')
      expect(Object.keys(style.sources)).toContain('trees')
      for (const id of ['Parking', 'Parking outline', 'Trees']) expect(at(id)).toBeGreaterThan(-1)
    })

    test('parking is the lowest paving on the street', () => {
      // Under the pedestrian block, and so under the roads too: a path
      // crossing a lot is drawn over it, not scored through it.
      expect(at('Parking')).toBeLessThan(at('Pedestrian area outline'))
      expect(at('Parking outline')).toBeLessThan(at('Pedestrian area outline'))
      expect(at('Parking')).toBeLessThan(at('Parking outline'))
    })

    test('multi-storey and underground parking are not painted as ground', () => {
      // The first is a building the basemap already draws; the second is not
      // visible from above. Either one drawn flat puts a slab over a tower.
      const layer = style.layers.find(l => l.id === 'Parking')! as any
      const filter = featureFilter(layer.filter as any, 'Parking.filter')
      const evaluate = (parking: string) =>
        filter.filter({ zoom: 16 } as any, { properties: { parking }, type: 3 } as any, {} as any)
      expect(evaluate('surface')).toBe(true)
      expect(evaluate('multi-storey')).toBe(false)
      expect(evaluate('underground')).toBe(false)
    })

    test('trees stand above the buildings, where the models have to sit', () => {
      const lastBuilding = style.layers.map(l => (l as any)['source-layer']).lastIndexOf('building')
      expect(at('Trees')).toBeGreaterThan(lastBuilding)
    })

    /**
     * The 3D form reads its instances out of the same tiles the flat form
     * draws, so hiding the circles with `visibility` would stop the source
     * loading and leave the models with nothing to place.
     */
    test('the flat tree form can be muted without unloading its source', () => {
      const trees = style.layers.find(l => l.id === 'Trees')!
      expect(trees.layout?.visibility).toBeUndefined()
      expect(trees.paint!['circle-opacity']).toEqual(TREE_OPACITY)
    })
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
        // The name's own scaffolding: its prefix, its separators, and the
        // colour tokens `poi-badge.ts` reads back out of it.
        s !== 'poi|' &&
        s !== '|' &&
        !s.startsWith('@poi_') &&
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
