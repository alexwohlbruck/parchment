/**
 * Map themes: one layer spec, several palettes.
 *
 * Parchment is the generated tokens as they stand. The others are overlays on
 * them, so a theme only names the colours it changes and inherits every token
 * it does not — a new layer or token added to the spec lands in every theme.
 */
import type { MapStyleId } from '@/types/map.types'
import type { ThemeShading } from '@/lib/map/building-shade'
import type { FlavorId } from './build'
import lightTokens from './tokens.light.json'
import darkTokens from './tokens.dark.json'

type Tokens = Record<string, string>
type Sky = Record<string, string | number>
type PerFlavor<T> = Partial<Record<FlavorId, T>>

interface MapTheme {
  tokens?: PerFlavor<Tokens>
  sky?: PerFlavor<Sky>
  /** Casts for buildings that record no colour of their own; none draws them all in the plain building colour. */
  buildingPastels?: PerFlavor<string[]>
  /** How far a building's own `building:colour` tints it; 0 draws every building plain. */
  buildingTint?: PerFlavor<number>
  /** The light on the 3D buildings: sun, sky and cast-shadow colours. */
  shading?: PerFlavor<ThemeShading>
  /** The street-zoom carriageway and its kerb. */
  roadSurface?: PerFlavor<RoadSurface>
  typography?: Typography
}

export interface RoadSurface {
  asphalt: string
  kerb: string
  /** The zoom from which roads deepen out of their map colour into the asphalt, reaching it as the lanes draw. */
  darkenFrom?: number
}

export interface Typography {
  /** Stands in for Geist at the same weight; `build-glyphs.mjs` generates its stacks. */
  family: 'Inter' | 'Roboto'
  roadLabels?: { transform: 'uppercase' | 'none'; letterSpacing: number }
}

const BASE_TOKENS: Record<FlavorId, Tokens> = { light: lightTokens, dark: darkTokens }

/**
 * The horizon colours track the ground they meet, so a steep view fades into the
 * land rather than ending on a band of another colour.
 */
const BASE_SKY: Record<FlavorId, Sky> = {
  light: {
    'sky-color': 'hsl(199, 88%, 78%)',
    'horizon-color': lightTokens.background_background_color_2,
    'fog-color': lightTokens.background_background_color,
    'fog-ground-blend': 0.8,
    'horizon-fog-blend': 0.6,
    'sky-horizon-blend': 0.85,
    'atmosphere-blend': 0,
  },
  dark: {
    'sky-color': 'hsl(218, 34%, 9%)',
    'horizon-color': darkTokens.background_background_color_2,
    'fog-color': darkTokens.background_background_color,
    'fog-ground-blend': 0.72,
    'horizon-fog-blend': 0.6,
    'sky-horizon-blend': 0.85,
    'atmosphere-blend': 0,
  },
}

/** Every land class at once, so a theme's ground cannot leave one tinted the old way. */
function land(c: {
  ground: string
  urban: string
  commercial: string
  industrial: string
  grass: string
  wood: string
  pitch: string
  pitchEdge: string
  cemetery: string
  school: string
  hospital: string
  sand: string
  airport: string
  water: string
  shallows: string
  pier: string
}): Tokens {
  return {
    background_background_color: c.ground,
    background_background_color_2: c.ground,
    residential_fill_color: c.urban,
    residential_fill_color_2: c.urban,
    commercial_fill_color: c.commercial,
    industrial_fill_color: c.industrial,
    industrial_fill_color_2: c.industrial.replace('hsl(', 'hsla(').replace(')', ', 0.2)'),
    industrial_fill_color_3: c.industrial,
    industrial_fill_color_4: c.industrial,
    industrial_fill_color_5: c.industrial.replace('hsl(', 'hsla(').replace(')', ', 0.5)'),
    grass_fill_color: c.grass,
    wood_fill_color: c.wood,
    stadium_fill_color: c.pitch,
    stadium_outline_color: c.pitchEdge,
    cemetery_fill_color: c.cemetery,
    school_fill_color: c.school,
    hospital_fill_color: c.hospital,
    sand_fill_color: c.sand,
    airport_zone_fill_color: c.airport,
    water_fill_color: c.water,
    aqueduct_line_color: c.water,
    river_line_color: c.water,
    river_tunnel_line_color: c.water,
    water_intermittent_fill_color: c.shallows,
    pier_fill_color: c.pier,
    bridge_outline_line_color: c.pier,
  }
}

function roads(c: {
  highway: string
  highwayCasing: string
  major: string
  majorCasing: string
  minor: string
  minorCasing: string
  path: string
  pathCasing: string
  rail: string
}): Tokens {
  return {
    road_highway: c.highway,
    road_highway_casing: c.highwayCasing,
    road_major: c.major,
    road_major_casing: c.majorCasing,
    road_minor: c.minor,
    road_minor_casing: c.minorCasing,
    path_surface: c.path,
    path_casing: c.pathCasing,
    path_bridge_casing: c.pathCasing,
    major_rail_line_color: c.rail,
    major_rail_line_color_2: c.rail,
    railway_tunnel_line_color: c.rail,
  }
}

function buildings(c: { roof: string; edge: string; flat: string }): Tokens {
  return {
    building_3d_fill_extrusion_color: c.roof,
    building_roof_edge: c.edge,
    building_fill_color: c.flat,
    building_fill_outline_color: c.edge,
    building_fill_outline_color_2: c.edge,
  }
}

function labels(c: { strong: string; muted: string; road: string; halo: string; water: string; waterHalo: string }): Tokens {
  return {
    label_ink_strong: c.strong,
    label_ink_muted: c.muted,
    label_ink_road: c.road,
    label_ink_road_minor: c.road,
    label_halo: c.halo,
    river_labels_text_color: c.water,
    lake_labels_text_color: c.water,
    ocean_labels_text_color: c.water,
    ocean_labels_text_color_2: c.water,
    ferry_text_color: c.water,
    river_labels_text_halo_color: c.waterHalo,
  }
}

/**
 * Cream land with tan commercial blocks, grey streets and steel highways by day;
 * slate land, ultramarine water and teal parks by night.
 */
const CUPERTINO: MapTheme = {
  tokens: {
    light: {
      ...land({
        ground: 'hsl(55, 24%, 94.5%)',
        urban: 'hsl(55, 24%, 94.5%)',
        commercial: 'hsl(43, 72%, 90%)',
        industrial: 'hsl(240, 7%, 89%)',
        grass: 'hsl(93, 63%, 63%)',
        wood: 'hsl(96, 50%, 76%)',
        pitch: 'hsl(96, 48%, 78%)',
        pitchEdge: 'hsl(96, 40%, 68%)',
        cemetery: 'hsl(96, 36%, 85%)',
        school: 'hsl(38, 42%, 86%)',
        hospital: 'hsl(352, 60%, 91%)',
        sand: 'hsl(46, 62%, 86%)',
        airport: 'hsl(240, 7%, 89%)',
        water: 'hsl(196, 83%, 75%)',
        shallows: 'hsl(196, 75%, 85%)',
        pier: 'hsl(55, 8%, 89%)',
      }),
      ...roads({
        highway: 'hsl(225, 11%, 72%)',
        highwayCasing: 'hsl(225, 10%, 63%)',
        major: 'hsl(225, 6%, 83%)',
        majorCasing: 'hsl(225, 6%, 75%)',
        minor: 'hsl(0, 0%, 99%)',
        minorCasing: 'hsl(220, 5%, 85%)',
        path: 'hsl(55, 10%, 90%)',
        pathCasing: 'hsl(190, 5%, 80%)',
        rail: 'hsl(225, 6%, 70%)',
      }),
      ...buildings({ roof: 'hsl(40, 6%, 89%)', edge: 'hsl(40, 4%, 81%)', flat: 'hsl(40, 5%, 76%)' }),
      ...labels({
        strong: 'hsl(0, 0%, 18%)',
        muted: 'hsl(0, 0%, 44%)',
        road: 'hsl(0, 0%, 30%)',
        halo: 'rgba(255, 255, 255, 0.92)',
        water: 'hsl(205, 70%, 38%)',
        waterHalo: 'hsl(196, 75%, 85%)',
      }),
    },
    dark: {
      ...land({
        ground: 'hsl(213, 27%, 26%)',
        urban: 'hsl(213, 27%, 26%)',
        commercial: 'hsl(238, 22%, 33%)',
        industrial: 'hsl(220, 20%, 29%)',
        grass: 'hsl(177, 100%, 17%)',
        wood: 'hsl(176, 90%, 18%)',
        pitch: 'hsl(177, 80%, 18%)',
        pitchEdge: 'hsl(177, 60%, 24%)',
        cemetery: 'hsl(176, 40%, 22%)',
        school: 'hsl(250, 16%, 31%)',
        hospital: 'hsl(345, 22%, 31%)',
        sand: 'hsl(40, 16%, 30%)',
        airport: 'hsl(220, 20%, 29%)',
        water: 'hsl(228, 60%, 31%)',
        shallows: 'hsl(226, 48%, 36%)',
        pier: 'hsl(213, 22%, 32%)',
      }),
      ...roads({
        highway: 'hsl(217, 28%, 63%)',
        highwayCasing: 'hsl(217, 24%, 46%)',
        major: 'hsl(214, 19%, 46%)',
        majorCasing: 'hsl(213, 28%, 21%)',
        minor: 'hsl(213, 20%, 39%)',
        minorCasing: 'hsl(213, 28%, 22%)',
        path: 'hsl(213, 18%, 34%)',
        pathCasing: 'hsl(213, 28%, 22%)',
        rail: 'hsl(214, 16%, 48%)',
      }),
      ...buildings({ roof: 'hsl(214, 26%, 40%)', edge: 'hsl(214, 28%, 30%)', flat: 'hsl(214, 24%, 44%)' }),
      ...labels({
        strong: 'hsl(0, 0%, 96%)',
        muted: 'hsl(213, 14%, 74%)',
        road: 'hsl(213, 16%, 82%)',
        halo: 'rgba(36, 48, 64, 0.9)',
        water: 'hsl(222, 60%, 74%)',
        waterHalo: 'hsl(228, 60%, 31%)',
      }),
    },
  },
  sky: {
    light: { 'horizon-color': 'hsl(55, 24%, 94.5%)', 'fog-color': 'hsl(55, 24%, 94.5%)' },
    dark: { 'sky-color': 'hsl(220, 36%, 12%)', 'horizon-color': 'hsl(213, 27%, 26%)', 'fog-color': 'hsl(213, 27%, 26%)' },
  },
  roadSurface: {
    light: { asphalt: 'hsl(200, 6%, 66%)', kerb: 'hsl(45, 8%, 86%)', darkenFrom: 13 },
    dark: { asphalt: 'hsl(210, 15%, 20%)', kerb: 'hsl(210, 14%, 30%)', darkenFrom: 13 },
  },
  typography: { family: 'Inter', roadLabels: { transform: 'uppercase', letterSpacing: 0.06 } },
  buildingPastels: {
    light: ['hsl(0, 8%, 89%)', 'hsl(30, 14%, 89%)', 'hsl(60, 8%, 88.5%)', 'hsl(220, 8%, 89%)'],
    dark: [],
  },
  buildingTint: { light: 0, dark: 0 },
  shading: {
    light: { sunTint: [1.02, 1.01, 0.98], skyTint: [0.96, 0.97, 1.02], shadowColor: [0.3, 0.31, 0.38] },
  },
}

/**
 * Neutral grey land, pale yellow commercial blocks, mint parks, white streets
 * and blue-grey highways by day; navy land and blue-grey streets by night.
 */
const MOUNTAIN_VIEW: MapTheme = {
  tokens: {
    light: {
      ...land({
        ground: 'hsl(0, 0%, 95.5%)',
        urban: 'hsl(0, 0%, 95.5%)',
        commercial: 'hsl(43, 67%, 92%)',
        industrial: 'hsl(225, 14%, 92%)',
        grass: 'hsl(145, 72%, 74%)',
        wood: 'hsl(142, 52%, 82%)',
        pitch: 'hsl(145, 50%, 82%)',
        pitchEdge: 'hsl(145, 40%, 72%)',
        cemetery: 'hsl(142, 36%, 88%)',
        school: 'hsl(34, 64%, 92%)',
        hospital: 'hsl(5, 72%, 95%)',
        sand: 'hsl(44, 62%, 88%)',
        airport: 'hsl(225, 14%, 92%)',
        water: 'hsl(193, 71%, 75%)',
        shallows: 'hsl(193, 65%, 86%)',
        pier: 'hsl(0, 0%, 93%)',
      }),
      ...roads({
        highway: 'hsl(218, 34%, 75%)',
        highwayCasing: 'hsl(210, 31%, 64%)',
        major: 'hsl(210, 24%, 86%)',
        majorCasing: 'hsl(210, 20%, 78%)',
        minor: 'hsl(0, 0%, 100%)',
        minorCasing: 'hsl(215, 14%, 85%)',
        path: 'hsl(0, 0%, 97%)',
        pathCasing: 'hsl(215, 12%, 86%)',
        rail: 'hsl(215, 10%, 72%)',
      }),
      ...buildings({ roof: 'hsl(240, 10%, 92%)', edge: 'hsl(225, 23%, 86%)', flat: 'hsl(230, 12%, 82%)' }),
      ...labels({
        strong: 'hsl(210, 6%, 22%)',
        muted: 'hsl(213, 5%, 40%)',
        road: 'hsl(213, 5%, 38%)',
        halo: 'rgba(255, 255, 255, 0.95)',
        water: 'hsl(198, 60%, 34%)',
        waterHalo: 'hsl(193, 65%, 86%)',
      }),
    },
    dark: {
      ...land({
        ground: 'hsl(208, 52%, 23%)',
        urban: 'hsl(208, 52%, 23%)',
        commercial: 'hsl(214, 42%, 27%)',
        industrial: 'hsl(214, 40%, 26%)',
        grass: 'hsl(160, 45%, 26%)',
        wood: 'hsl(165, 45%, 21%)',
        pitch: 'hsl(160, 38%, 25%)',
        pitchEdge: 'hsl(160, 34%, 31%)',
        cemetery: 'hsl(165, 30%, 24%)',
        school: 'hsl(222, 34%, 28%)',
        hospital: 'hsl(345, 26%, 28%)',
        sand: 'hsl(40, 18%, 27%)',
        airport: 'hsl(214, 40%, 26%)',
        water: 'hsl(214, 58%, 13%)',
        shallows: 'hsl(212, 50%, 18%)',
        pier: 'hsl(212, 36%, 30%)',
      }),
      ...roads({
        highway: 'hsl(212, 28%, 50%)',
        highwayCasing: 'hsl(212, 36%, 32%)',
        major: 'hsl(212, 33%, 36%)',
        majorCasing: 'hsl(210, 50%, 20%)',
        minor: 'hsl(213, 44%, 31%)',
        minorCasing: 'hsl(210, 50%, 20%)',
        path: 'hsl(213, 40%, 28%)',
        pathCasing: 'hsl(210, 50%, 20%)',
        rail: 'hsl(212, 24%, 44%)',
      }),
      ...buildings({ roof: 'hsl(212, 46%, 29%)', edge: 'hsl(210, 52%, 21%)', flat: 'hsl(212, 40%, 34%)' }),
      ...labels({
        strong: 'hsl(220, 30%, 88%)',
        muted: 'hsl(215, 22%, 68%)',
        road: 'hsl(215, 24%, 76%)',
        halo: 'rgba(28, 60, 88, 0.9)',
        water: 'hsl(210, 40%, 62%)',
        waterHalo: 'hsl(214, 58%, 13%)',
      }),
    },
  },
  sky: {
    light: { 'horizon-color': 'hsl(0, 0%, 95.5%)', 'fog-color': 'hsl(0, 0%, 95.5%)' },
    dark: { 'sky-color': 'hsl(214, 50%, 9%)', 'horizon-color': 'hsl(208, 52%, 23%)', 'fog-color': 'hsl(208, 52%, 23%)' },
  },
  roadSurface: {
    light: { asphalt: 'hsl(206, 25%, 78%)', kerb: 'hsl(206, 20%, 90%)' },
    dark: { asphalt: 'hsl(212, 33%, 33%)', kerb: 'hsl(210, 50%, 20%)' },
  },
  typography: { family: 'Roboto', roadLabels: { transform: 'none', letterSpacing: 0 } },
  buildingPastels: { light: [], dark: [] },
  buildingTint: { light: 0, dark: 0 },
  shading: {
    light: { sunTint: [1.0, 1.0, 1.0], skyTint: [0.98, 0.98, 1.0], shadowColor: [0.32, 0.34, 0.4] },
  },
}

const THEMES: Record<MapStyleId, MapTheme> = {
  parchment: {},
  cupertino: CUPERTINO,
  'mountain-view': MOUNTAIN_VIEW,
}

const theme = (style: MapStyleId | undefined): MapTheme => THEMES[style ?? 'parchment'] ?? {}

const tokenCache = new Map<string, Tokens>()

/** The theme's colour tokens for a flavor, over the generated ones. */
export function themeTokens(style: MapStyleId | undefined, flavor: FlavorId): Tokens {
  const key = `${style}|${flavor}`
  let tokens = tokenCache.get(key)
  if (!tokens) {
    tokens = { ...BASE_TOKENS[flavor], ...theme(style).tokens?.[flavor] }
    tokenCache.set(key, tokens)
  }
  return tokens
}

export function themeSky(style: MapStyleId | undefined, flavor: FlavorId): Sky {
  return { ...BASE_SKY[flavor], ...theme(style).sky?.[flavor] }
}

/** The theme's unpainted-building casts, or `undefined` for the flavor's own. */
export function themeBuildingPastels(style: MapStyleId | undefined, flavor: FlavorId): string[] | undefined {
  return theme(style).buildingPastels?.[flavor]
}

export function themeBuildingTint(style: MapStyleId | undefined, flavor: FlavorId): number | undefined {
  return theme(style).buildingTint?.[flavor]
}

export function themeShading(style: MapStyleId | undefined, flavor: FlavorId): ThemeShading | undefined {
  return theme(style).shading?.[flavor]
}

export function themeRoadSurface(style: MapStyleId | undefined, flavor: FlavorId): RoadSurface | undefined {
  return theme(style).roadSurface?.[flavor]
}

export function themeTypography(style: MapStyleId | undefined): Typography | undefined {
  return theme(style).typography
}
