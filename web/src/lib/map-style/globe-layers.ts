/**
 * The zoomed-out globe: biomes, ocean depth, relief, reference lines and
 * physical-geography names, from tiles bundled in `public/globe/` and built by
 * `web/scripts/globe-tiles/build.sh`. The basemap carries almost nothing below
 * z6, so these draw the world until its own landcover and water take over.
 */
import type { FlavorId } from './build'
import { TERRAIN_ATTRIBUTION } from './terrain'

export const GLOBE_SOURCE = 'globe'
export const GLOBE_RELIEF_SOURCE = 'globe-relief'
export const GLOBE_PROTOCOL = 'globe'
/** The tile layer of continent, ocean and landform names. */
export const GLOBE_NAMES = 'label'

const VERSION = 'v2'
const VECTOR_MAXZOOM = 5
const RELIEF_MAXZOOM = 4
/** Relief over-zoomed much past its data turns to mush, so it bows out early. */
const RELIEF_FADED = 6.5

/** Basemap layers these replace at globe zoom. */
export const BASEMAP_CONTINENT_LABELS = 'Continent labels'
export const GLOBE_CONTINENT_LABELS = 'Globe continent labels'
const BASEMAP_OCEAN_LABELS = 'Ocean labels'
const BASEMAP_GLACIER = 'Glacier'
const BASEMAP_WATER = 'Water'

/** Zoom where the globe hands the land and its names back to the basemap. */
const HANDOFF = 6

/** Gzipped on disk, since static hosts serve `.pbf` uncompressed; see `globe-tiles.ts`. */
export function globeTilePath(z: number, x: number, y: number): string {
  return `/globe/${VERSION}/vector/${z}/${x}/${y}.pbf.gz`
}

export function globeSources(origin: string) {
  return {
    [GLOBE_SOURCE]: {
      type: 'vector' as const,
      tiles: [`${GLOBE_PROTOCOL}://{z}/{x}/{y}`],
      maxzoom: VECTOR_MAXZOOM,
      attribution: 'Natural Earth, RESOLVE Ecoregions 2017 (CC BY 4.0)',
    },
    [GLOBE_RELIEF_SOURCE]: {
      type: 'raster' as const,
      tiles: [`${origin}/globe/${VERSION}/relief/{z}/{x}/{y}.webp`],
      tileSize: 256,
      maxzoom: RELIEF_MAXZOOM,
      attribution: TERRAIN_ATTRIBUTION,
    },
  }
}

type Palette = {
  biome: Record<string, string>
  /** The water above 200 m, which leads into `depth`; the theme's own water takes over as the depths fade. */
  shelf: string
  /** Deepening ocean, from 200 m down. */
  depth: [number, string][]
  relief: number
  /** The basemap's ice, where its own colour reads as water from orbit. */
  ice?: string
  line: string
  continent: string
  ocean: string
  oceanHalo: string
  region: string
  halo: string
}

export type GlobePalette = Palette

const PALETTE: Record<FlavorId, Palette> = {
  light: {
    biome: {
      desert: 'hsl(40, 48%, 86%)',
      scrub: 'hsl(62, 30%, 84%)',
      grassland: 'hsl(80, 40%, 83%)',
      savanna: 'hsl(62, 44%, 82%)',
      tundra: 'hsl(150, 12%, 87%)',
      dry_forest: 'hsl(92, 38%, 78%)',
      forest: 'hsl(108, 36%, 76%)',
      boreal: 'hsl(140, 26%, 77%)',
      rainforest: 'hsl(120, 40%, 72%)',
    },
    shelf: 'hsl(206, 74%, 63%)',
    depth: [
      [200, 'hsl(207, 78%, 58%)'],
      [1000, 'hsl(208, 74%, 55%)'],
      [2000, 'hsl(209, 70%, 52.5%)'],
      [3000, 'hsl(210, 67%, 50.5%)'],
      [4000, 'hsl(211, 64%, 48.5%)'],
      [5000, 'hsl(212, 62%, 46.5%)'],
      [6000, 'hsl(213, 60%, 44%)'],
      [8000, 'hsl(215, 58%, 40%)'],
    ],
    relief: 1,
    line: 'hsla(0, 0%, 100%, 0.55)',
    continent: 'hsl(222, 10%, 44%)',
    ocean: 'hsl(210, 70%, 92%)',
    oceanHalo: 'hsla(207, 70%, 45%, 0.35)',
    region: 'hsl(32, 14%, 40%)',
    halo: 'rgba(255, 255, 255, 0.6)',
  },
  dark: {
    biome: {
      desert: 'hsl(34, 16%, 26%)',
      scrub: 'hsl(70, 10%, 25%)',
      grassland: 'hsl(95, 12%, 25%)',
      savanna: 'hsl(66, 12%, 25%)',
      tundra: 'hsl(205, 14%, 27%)',
      dry_forest: 'hsl(120, 14%, 23%)',
      forest: 'hsl(140, 18%, 22%)',
      boreal: 'hsl(170, 16%, 22%)',
      rainforest: 'hsl(145, 24%, 20%)',
    },
    shelf: 'hsl(216, 36%, 16.5%)',
    depth: [
      [200, 'hsl(217, 38%, 13%)'],
      [1000, 'hsl(218, 40%, 12%)'],
      [2000, 'hsl(218, 42%, 11%)'],
      [3000, 'hsl(219, 43%, 10.3%)'],
      [4000, 'hsl(219, 44%, 9.6%)'],
      [5000, 'hsl(220, 45%, 9%)'],
      [6000, 'hsl(220, 46%, 8.2%)'],
      [8000, 'hsl(221, 48%, 7%)'],
    ],
    relief: 0.75,
    ice: 'hsl(212, 18%, 36%)',
    line: 'hsla(210, 30%, 75%, 0.2)',
    continent: 'hsl(220, 12%, 76%)',
    ocean: 'hsl(210, 35%, 52%)',
    oceanHalo: 'rgba(0, 0, 0, 0)',
    region: 'hsl(35, 12%, 66%)',
    halo: 'rgba(13, 16, 22, 0.6)',
  },
}

/** Full strength through the globe, gone by `until`. */
function fade(from: number, until: number, strength = 1): any {
  return ['interpolate', ['linear'], ['zoom'], from, strength, until, 0]
}

function biomeLayer(p: Palette) {
  return {
    id: 'Globe biome',
    type: 'fill',
    source: GLOBE_SOURCE,
    'source-layer': 'biome',
    maxzoom: HANDOFF + 2,
    paint: {
      'fill-color': ['match', ['get', 'class'], ...Object.entries(p.biome).flat(), 'transparent'],
      'fill-opacity': fade(HANDOFF - 1, HANDOFF + 2),
      'fill-antialias': false,
    },
  }
}

function depthLayer(p: Palette) {
  return {
    id: 'Globe ocean depth',
    type: 'fill',
    source: GLOBE_SOURCE,
    'source-layer': 'bathymetry',
    maxzoom: HANDOFF + 4,
    layout: { 'fill-sort-key': ['get', 'depth'] },
    paint: {
      'fill-color': ['step', ['get', 'depth'], p.depth[0][1], ...p.depth.slice(1).flat()],
      'fill-opacity': fade(HANDOFF + 1, HANDOFF + 4),
      'fill-antialias': false,
    },
  }
}

function reliefLayer(p: Palette) {
  return {
    id: 'Globe relief',
    type: 'raster',
    source: GLOBE_RELIEF_SOURCE,
    maxzoom: RELIEF_FADED,
    paint: {
      'raster-opacity': fade(RELIEF_MAXZOOM, RELIEF_FADED, p.relief),
      'raster-fade-duration': 0,
    },
  }
}

function lineLayer(p: Palette) {
  return {
    id: 'Globe lines',
    type: 'line',
    source: GLOBE_SOURCE,
    'source-layer': 'graticule',
    maxzoom: HANDOFF,
    paint: {
      'line-color': p.line,
      'line-width': 0.8,
      'line-dasharray': [3, 3],
      'line-opacity': fade(HANDOFF - 1, HANDOFF),
    },
  }
}

type LabelStyle = { font: string; size: any; color: string; halo: string; layout?: Record<string, unknown>; until?: number }

function label(id: string, filter: any, { font, size, color, halo, layout, until = HANDOFF }: LabelStyle) {
  return {
    id,
    type: 'symbol',
    source: GLOBE_SOURCE,
    'source-layer': GLOBE_NAMES,
    maxzoom: until,
    ...(filter ? { filter } : {}),
    layout: {
      'text-field': ['get', 'name'],
      'text-font': [font],
      'text-size': size,
      'text-max-width': 7,
      'text-padding': 6,
      ...layout,
    },
    paint: {
      'text-color': color,
      'text-halo-color': halo,
      'text-halo-width': 1,
      'text-halo-blur': 0.5,
      'text-opacity': fade(until - 0.5, until),
    },
  }
}

const byClass = (...classes: string[]) => ['in', ['get', 'class'], ['literal', classes]]

function labelLayers(p: Palette) {
  const size = (low: number, high: number) => ['interpolate', ['linear'], ['zoom'], 1, low, 5, high]
  const region = { font: 'Geist Regular', size: size(10, 13), color: p.region, halo: p.halo }
  const water = { font: 'Geist Regular', size: size(10, 13), color: p.ocean, halo: p.oceanHalo }
  return [
    label('Globe region labels', byClass('desert', 'plateau', 'basin', 'peninsula'), {
      ...region,
      layout: { 'text-letter-spacing': 0.08, 'symbol-sort-key': ['get', 'rank'] },
    }),
    label('Globe range labels', byClass('range'), {
      ...region,
      layout: { 'symbol-placement': 'line-center', 'text-letter-spacing': 0.2, 'text-max-angle': 30 },
    }),
    label('Globe sea labels', byClass('sea'), {
      ...water,
      layout: { 'text-letter-spacing': 0.06, 'symbol-sort-key': ['get', 'rank'] },
    }),
    label('Globe ocean labels', byClass('ocean'), {
      ...water,
      font: 'Geist Medium',
      size: size(12, 17),
      layout: { 'text-letter-spacing': 0.12, 'text-max-width': 6 },
    }),
    label(GLOBE_CONTINENT_LABELS, byClass('continent'), {
      font: 'Geist SemiBold',
      size: size(11, 15),
      color: p.continent,
      halo: p.halo,
      until: 3,
      layout: { 'text-letter-spacing': 0.16, 'text-transform': 'uppercase' },
    }),
    {
      ...label('Globe line labels', null, {
        font: 'Geist Regular',
        size: 10,
        color: p.line,
        halo: 'rgba(0, 0, 0, 0)',
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 600, 'text-letter-spacing': 0.05 },
      }),
      'source-layer': 'graticule',
      minzoom: 2,
    },
  ]
}

/**
 * Splice the globe layers into the basemap: biomes over the background and
 * under every landcover, depth and relief over the water, names with the
 * basemap's own country labels.
 */
export function withGlobeLayers(layers: any[], flavor: FlavorId, theme?: Partial<Palette>): any[] {
  const p = { ...PALETTE[flavor], ...theme }
  const out = layers
    .filter(l => l.id !== BASEMAP_CONTINENT_LABELS)
    .map(l => {
      if (l.id === BASEMAP_OCEAN_LABELS) return { ...l, minzoom: Math.max(l.minzoom ?? 0, HANDOFF) }
      if (l.id === BASEMAP_WATER) return { ...l, paint: { ...l.paint, 'fill-color': ['interpolate', ['linear'], ['zoom'], HANDOFF + 1, p.shelf, HANDOFF + 4, l.paint['fill-color']] } }
      if (l.id === BASEMAP_GLACIER && p.ice) return { ...l, paint: { ...l.paint, 'fill-color': ['step', ['zoom'], p.ice, HANDOFF, l.paint['fill-color']] } }
      return l
    })
  const afterBackground = out.findIndex(l => l.type === 'background') + 1
  out.splice(afterBackground, 0, biomeLayer(p))
  const afterWater = out.findIndex(l => l.id === BASEMAP_WATER) + 1
  out.splice(afterWater, 0, depthLayer(p), reliefLayer(p), lineLayer(p))
  // Above the country names, so a continent wins the space while the whole globe is in view.
  const labelsAt = out.findIndex(l => l.id === 'Country labels') + 1
  out.splice(labelsAt || out.length, 0, ...labelLayers(p))
  return out
}
