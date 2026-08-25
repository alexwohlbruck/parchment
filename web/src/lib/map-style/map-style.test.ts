/**
 * The style system's invariants.
 *
 * These are the things that, when they broke, produced a map that still
 * rendered and still looked "styled" — which is why they need asserting
 * rather than eyeballing. The previous dark basemap shipped for months as a
 * flat purple field because nothing checked that road classes were actually
 * distinguishable from one another.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateStyleMin, featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { buildMapStyle, buildSatelliteStyle } from './build'
import { buildLayers, layerGroups } from './layers'
import { flavors, LIGHT, DARK, type Flavor } from './flavors'

const opts = { tileServerUrl: 'https://example.test/tiles' } as any

/** Source-layers present in our OpenMapTiles basemap.pmtiles. */
const OMT_SOURCE_LAYERS = new Set([
  'aerodrome_label',
  'aeroway',
  'boundary',
  'building',
  'housenumber',
  'landcover',
  'landuse',
  'mountain_peak',
  'park',
  'place',
  'poi',
  'transportation',
  'transportation_name',
  'water',
  'water_name',
  'waterway',
])

function hexChroma(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return NaN
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255
}

/** Evaluate an `["interpolate", ..., ["zoom"], z0, v0, ...]` ramp at `zoom`. */
function rampAt(expr: any, zoom: number): number {
  const stops: Array<[number, number]> = []
  for (let i = 3; i < expr.length; i += 2) stops.push([expr[i], expr[i + 1]])
  let last = stops[0][1]
  for (const [z, v] of stops) {
    if (zoom < z) break
    last = v
  }
  return last
}

describe('flavors', () => {
  test('every flavor defines every token', () => {
    const keys = Object.keys(LIGHT).sort()
    for (const [id, flavor] of Object.entries(flavors)) {
      expect(Object.keys(flavor).sort(), `flavor "${id}"`).toEqual(keys)
      for (const [token, value] of Object.entries(flavor)) {
        expect(value, `${id}.${token}`).toBeDefined()
      }
    }
  })

  test('every POI family has a tint in every flavor', () => {
    const families = Object.keys(LIGHT.pois).sort()
    for (const flavor of Object.values(flavors)) {
      expect(Object.keys(flavor.pois).sort()).toEqual(families)
    }
  })

  /**
   * The rule the old runtime dark transform broke: hierarchy is carried by
   * hue, not by lightness alone. Motorway/trunk/primary must be chromatic;
   * secondary and below must be near-neutral so the arterials stand out.
   */
  test.each(Object.entries(flavors))(
    '%s: arterials are chromatic, minor roads are not',
    (_id, flavor: Flavor) => {
      for (const token of ['motorway', 'trunk', 'primary'] as const) {
        expect(hexChroma(flavor[token]), token).toBeGreaterThan(0.15)
      }
      for (const token of ['secondary', 'tertiary', 'minor', 'service'] as const) {
        expect(hexChroma(flavor[token]), token).toBeLessThan(0.08)
      }
    },
  )

  test('roads are lighter than the ground they sit on in the light flavor', () => {
    // Roads read as figure only when they are the brightest surface.
    expect(hexChroma(LIGHT.minor)).toBe(0)
    expect(LIGHT.minor).toBe('#FFFFFF')
    expect(LIGHT.background).not.toBe('#FFFFFF')
  })

  test('the dark ground is neutral, so gold and blue overlays do not fight it', () => {
    expect(hexChroma(DARK.background)).toBeLessThan(0.05)
  })
})

describe('layer spec', () => {
  const layers = buildLayers({ flavor: LIGHT })

  test('every layer targets a source-layer our tiles actually carry', () => {
    for (const l of layers as any[]) {
      if (!l['source-layer']) continue
      expect(OMT_SOURCE_LAYERS, `${l.id} → ${l['source-layer']}`).toContain(
        l['source-layer'],
      )
    }
  })

  test('layer ids are unique', () => {
    const ids = layers.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('a casing is always drawn before, and wider than, its fill', () => {
    const ids = layers.map(l => l.id)
    for (const l of layers as any[]) {
      if (!l.id.endsWith('-casing')) continue
      const fillId = l.id.replace(/-casing$/, '')
      const fill = layers.find(x => x.id === fillId) as any
      expect(fill, `${l.id} has no fill`).toBeTruthy()
      expect(ids.indexOf(l.id)).toBeLessThan(ids.indexOf(fillId))

      // At the ribbon zoom the casing must bracket the fill on both sides.
      const casingW = rampAt(l.paint['line-width'], 16)
      const fillW = rampAt(fill.paint['line-width'], 16)
      expect(casingW, `${l.id} @z16`).toBeGreaterThan(fillW)
    }
  })

  test('road importance is monotonic in width', () => {
    const order = ['service', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']
    const widths = order.map(key => {
      const l = layers.find(x => x.id === `road-surface-${key}`) as any
      return rampAt(l.paint['line-width'], 16)
    })
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i], `${order[i]} vs ${order[i - 1]}`).toBeGreaterThan(widths[i - 1])
    }
  })

  test('the ribbon break makes roads jump, not creep, at z14', () => {
    const l = layers.find(x => x.id === 'road-surface-minor') as any
    const before = rampAt(l.paint['line-width'], 14)
    const after = rampAt(l.paint['line-width'], 14.01)
    expect(after).toBeGreaterThan(before * 2)
  })

  test('no road class pops in — every one fades from transparent', () => {
    for (const l of layers as any[]) {
      if (!l.id.startsWith('road-') || l.type !== 'line') continue
      const color = JSON.stringify(l.paint['line-color'])
      expect(color, l.id).toContain('rgba(0, 0, 0, 0)')
    }
  })

  test('selection is baked into every road fill', () => {
    const fills = (layers as any[]).filter(
      l => l.id.startsWith('road-') && l.type === 'line' && !l.id.endsWith('-casing'),
    )
    expect(fills.length).toBeGreaterThan(0)
    for (const l of fills) {
      expect(JSON.stringify(l.paint['line-color']), l.id).toContain('selected')
    }
  })

  test('minimal drops POIs, house numbers and buildings', () => {
    const minimal = buildLayers({ flavor: LIGHT, detail: 'minimal' }).map(l => l.id)
    for (const id of ['poi', 'housenumber', 'building', 'building-3d']) {
      expect(minimal).not.toContain(id)
    }
    // …but keeps the network and the place names.
    expect(minimal).toContain('road-surface-motorway')
    expect(minimal).toContain('place-city')
  })

  test('every id the strategy toggles exists in the full spec', () => {
    const ids = new Set(layers.map(l => l.id))
    const toggled = [
      ...layerGroups.poi,
      ...layerGroups.roadLabels,
      ...layerGroups.transit,
      ...layerGroups.placeLabels,
      layerGroups.building3d,
    ]
    for (const id of toggled) expect(ids, id).toContain(id)
  })

  /**
   * MapLibre joins a font stack into one request path, and the glyph server
   * serves single-font stacks only — so `['Noto Sans Bold', 'Noto Sans
   * Regular']` requests a stack that 404s and the label never draws. Only
   * fonts the server actually has may be named, one per stack.
   */
  test('font stacks name exactly one available font', () => {
    const AVAILABLE = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']
    for (const l of layers as any[]) {
      const stack = l.layout?.['text-font']
      if (!stack) continue
      expect(stack, l.id).toHaveLength(1)
      expect(AVAILABLE, l.id).toContain(stack[0])
    }
  })

  test('label language preference is honoured when set', () => {
    const [en] = buildLayers({ flavor: LIGHT, lang: 'en' }).filter(
      l => l.id === 'place-city',
    ) as any[]
    expect(JSON.stringify(en.layout['text-field'])).toContain('name:en')

    const [local] = buildLayers({ flavor: LIGHT }).filter(
      l => l.id === 'place-city',
    ) as any[]
    expect(JSON.stringify(local.layout['text-field'])).not.toContain('name:')
  })
})

describe('assembled styles', () => {
  test('street styles carry one vector source and a background', () => {
    for (const theme of ['light', 'dark'] as const) {
      const style = buildMapStyle({ ...opts, theme })
      expect(Object.keys(style.sources)).toEqual(['openmaptiles'])
      expect(style.layers[0].type).toBe('background')
      expect(style.sprite).toContain('/sprites/parchment')
      expect(style.glyphs).toContain('{fontstack}')
    }
  })

  test('the tile URL carries the auth token when we have one', () => {
    const withKey = buildMapStyle({ ...opts, theme: 'light', tileKey: 'abc' })
    const url = (withKey.sources.openmaptiles as any).tiles[0]
    expect(url).toContain('token=abc')

    const without = buildMapStyle({ ...opts, theme: 'light' })
    expect((without.sources.openmaptiles as any).tiles[0]).not.toContain('token=')
  })

  test('attribution credits both OSM and the CC-BY design lineage', () => {
    const style = buildMapStyle({ ...opts, theme: 'light' })
    const attr = (style.sources.openmaptiles as any).attribution
    expect(attr).toContain('OpenStreetMap')
    expect(attr).toContain('CC BY 3.0')
  })

  test('hybrid keeps labels and arterials over the imagery, nothing else', () => {
    const style = buildSatelliteStyle({ ...opts, theme: 'light', hybrid: true })
    const ids = style.layers.map(l => l.id)
    expect(ids[0]).toBe('satellite-raster')
    expect(ids).toContain('place-city')
    expect(ids).toContain('road-surface-motorway')
    expect(ids).not.toContain('road-surface-minor')
    expect(ids).not.toContain('background')
  })

  test('plain satellite is imagery only', () => {
    const style = buildSatelliteStyle({ ...opts, theme: 'light', hybrid: false })
    expect(style.layers).toHaveLength(1)
    expect(Object.keys(style.sources)).toEqual(['satellite-raster'])
  })
})

/**
 * MapLibre rejects an invalid layer outright rather than degrading, so a
 * malformed expression means that layer silently never draws. Two real bugs
 * were caught here and nowhere else: `match` cannot branch on a boolean, and
 * `["zoom"]` is only legal as the direct input of a top-level
 * `step`/`interpolate` — so a zoom fade may not be nested inside a `case`.
 */
describe('spec compliance', () => {
  const cases: Array<[string, () => any]> = [
    ['light', () => buildMapStyle({ ...opts, theme: 'light' })],
    ['dark', () => buildMapStyle({ ...opts, theme: 'dark' })],
    ['minimal', () => buildMapStyle({ ...opts, theme: 'dark', mapStyle: 'parchment-minimal' })],
    ['hybrid', () => buildSatelliteStyle({ ...opts, theme: 'dark', hybrid: true })],
    ['satellite', () => buildSatelliteStyle({ ...opts, theme: 'dark', hybrid: false })],
  ]

  test.each(cases)('%s validates against the MapLibre style spec', (_name, make) => {
    const errors = validateStyleMin(make()).map(e => `${e.message}`)
    expect(errors).toEqual([])
  })

  test('every filter compiles and evaluates', () => {
    for (const l of buildLayers({ flavor: DARK }) as any[]) {
      if (!l.filter) continue
      const f = featureFilter(l.filter)
      const run = () =>
        f.filter({ zoom: 15 } as any, { type: 1, properties: {} } as any, {} as any)
      expect(run, l.id).not.toThrow()
    }
  })

  /** POI density is gated on OpenMapTiles' own `rank`, stepped by zoom. */
  test('poi density opens up as you zoom in', () => {
    const poi = (buildLayers({ flavor: DARK }) as any[]).find(l => l.id === 'poi')
    const f = featureFilter(poi.filter)
    const minor = { type: 1, properties: { rank: 10, class: 'cafe' } } as any
    expect(f.filter({ zoom: 14 } as any, minor, {} as any)).toBe(false)
    expect(f.filter({ zoom: 15 } as any, minor, {} as any)).toBe(true)

    const major = { type: 1, properties: { rank: 3, class: 'cafe' } } as any
    expect(f.filter({ zoom: 14 } as any, major, {} as any)).toBe(true)
  })
})

describe('sprite', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, '../../../public/sprites/parchment.json'), 'utf8'),
  )

  test('icons are SDFs, so icon-color can tint them per family and theme', () => {
    for (const [name, icon] of Object.entries<any>(manifest)) {
      expect(icon.sdf, name).toBe(true)
    }
  })

  test('carries the fallback marker and the icons the spec names directly', () => {
    for (const name of ['marker', 'mountain', 'airport']) {
      expect(manifest, name).toHaveProperty(name)
    }
  })

  /**
   * `icon-image: ["get", "class"]` only works because OpenMapTiles' poi
   * taxonomy came from Maki — but the two spell names differently (Maki
   * `fast-food`, OpenMapTiles `fast_food`), and a handful are genuinely
   * renamed. The sprite build publishes aliases to close that gap; without
   * them 9 of these 37 fell through to a generic dot, which still *renders*
   * and so would never have been noticed by eye.
   *
   * Source: openmaptiles/layers/poi/poi.yaml, `class` field values.
   */
  const OMT_POI_CLASSES = [
    'aerialway', 'alcohol_shop', 'art_gallery', 'atm', 'attraction', 'bar',
    'beer', 'bus', 'cafe', 'campsite', 'car', 'castle', 'cemetery',
    'clothing_store', 'college', 'entrance', 'fast_food', 'fuel', 'golf',
    'grocery', 'harbor', 'hospital', 'ice_cream', 'laundry', 'library',
    'lodging', 'music', 'office', 'park', 'post', 'railway', 'school',
    'shop', 'stadium', 'swimming', 'town_hall', 'zoo',
  ]

  test('every OpenMapTiles poi class resolves to a real icon', () => {
    const missing = OMT_POI_CLASSES.filter(c => !(c in manifest))
    expect(missing).toEqual([])
  })
})
