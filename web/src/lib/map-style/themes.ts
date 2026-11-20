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

/** Near-white and neutral, with land allowed a clear colour and buildings a soft grey block. */
const CUPERTINO: MapTheme = {
  tokens: {
    light: {
      ...land({
        ground: 'hsl(40, 8%, 95.5%)',
        urban: 'hsl(40, 8%, 95%)',
        industrial: 'hsl(230, 14%, 92%)',
        grass: 'hsl(96, 56%, 64%)',
        wood: 'hsl(100, 38%, 77%)',
        pitch: 'hsl(100, 42%, 76%)',
        pitchEdge: 'hsl(100, 36%, 68%)',
        cemetery: 'hsl(100, 26%, 86%)',
        school: 'hsl(46, 72%, 90%)',
        hospital: 'hsl(354, 70%, 93%)',
        sand: 'hsl(46, 62%, 87%)',
        airport: 'hsl(230, 12%, 92%)',
        water: 'hsl(204, 74%, 75%)',
        shallows: 'hsl(203, 72%, 85%)',
        pier: 'hsl(40, 6%, 91%)',
      }),
      ...roads({
        highway: 'hsl(40, 96%, 76%)',
        highwayCasing: 'hsl(34, 72%, 63%)',
        major: 'hsl(0, 0%, 100%)',
        majorCasing: 'hsl(225, 10%, 79%)',
        minor: 'hsl(0, 0%, 100%)',
        minorCasing: 'hsl(225, 9%, 85%)',
        path: 'hsl(40, 6%, 92.5%)',
        pathCasing: 'hsl(225, 7%, 84%)',
        rail: 'hsl(225, 6%, 72%)',
      }),
      ...buildings({ roof: 'hsl(36, 6%, 90%)', edge: 'hsl(30, 4%, 80%)', flat: 'hsl(30, 6%, 70%)' }),
      ...labels({
        strong: 'hsl(0, 0%, 18%)',
        muted: 'hsl(0, 0%, 44%)',
        road: 'hsl(0, 0%, 36%)',
        halo: 'rgba(255, 255, 255, 0.92)',
        water: 'hsl(205, 70%, 38%)',
        waterHalo: 'hsl(203, 72%, 85%)',
      }),
    },
    dark: {
      ...land({
        ground: 'hsl(240, 3%, 17%)',
        urban: 'hsl(240, 3%, 17.5%)',
        industrial: 'hsl(245, 6%, 20%)',
        grass: 'hsl(128, 32%, 27%)',
        wood: 'hsl(128, 20%, 21%)',
        pitch: 'hsl(128, 22%, 24%)',
        pitchEdge: 'hsl(128, 20%, 28%)',
        cemetery: 'hsl(128, 12%, 21%)',
        school: 'hsl(44, 14%, 21%)',
        hospital: 'hsl(352, 16%, 22%)',
        sand: 'hsl(40, 12%, 24%)',
        airport: 'hsl(245, 5%, 20%)',
        water: 'hsl(210, 34%, 22%)',
        shallows: 'hsl(210, 26%, 26%)',
        pier: 'hsl(240, 3%, 22%)',
      }),
      ...roads({
        highway: 'hsl(36, 34%, 42%)',
        highwayCasing: 'hsl(36, 26%, 30%)',
        major: 'hsl(240, 3%, 38%)',
        majorCasing: 'hsl(240, 3%, 24%)',
        minor: 'hsl(240, 3%, 31%)',
        minorCasing: 'hsl(240, 3%, 22%)',
        path: 'hsl(240, 3%, 25%)',
        pathCasing: 'hsl(240, 3%, 19%)',
        rail: 'hsl(240, 3%, 36%)',
      }),
      ...buildings({ roof: 'hsl(240, 3%, 27%)', edge: 'hsl(240, 3%, 20%)', flat: 'hsl(240, 3%, 40%)' }),
      ...labels({
        strong: 'hsl(0, 0%, 93%)',
        muted: 'hsl(0, 0%, 66%)',
        road: 'hsl(0, 0%, 76%)',
        halo: 'rgba(28, 28, 30, 0.9)',
        water: 'hsl(205, 50%, 66%)',
        waterHalo: 'hsl(210, 34%, 22%)',
      }),
    },
  },
  sky: {
    light: { 'horizon-color': 'hsl(40, 8%, 95.5%)', 'fog-color': 'hsl(40, 8%, 95.5%)' },
    dark: { 'sky-color': 'hsl(240, 6%, 9%)', 'horizon-color': 'hsl(240, 3%, 17%)', 'fog-color': 'hsl(240, 3%, 17%)' },
  },
  buildingPastels: { light: [] },
  buildingTint: { light: 0, dark: 0 },
  shading: {
    light: { sunTint: [1.02, 1.01, 0.98], skyTint: [0.97, 0.98, 1.0], shadowColor: [0.3, 0.3, 0.33] },
  },
}

/** Cool near-white land, white roads with grey casings, and highways in yellow. */
const MOUNTAIN_VIEW: MapTheme = {
  tokens: {
    light: {
      ...land({
        ground: 'hsl(210, 17%, 97.5%)',
        urban: 'hsl(210, 14%, 95.5%)',
        industrial: 'hsl(222, 16%, 93%)',
        grass: 'hsl(138, 46%, 72%)',
        wood: 'hsl(130, 38%, 82%)',
        pitch: 'hsl(138, 40%, 82%)',
        pitchEdge: 'hsl(138, 32%, 74%)',
        cemetery: 'hsl(138, 28%, 88%)',
        school: 'hsl(34, 64%, 92%)',
        hospital: 'hsl(5, 72%, 95%)',
        sand: 'hsl(44, 62%, 88%)',
        airport: 'hsl(222, 16%, 93%)',
        water: 'hsl(196, 68%, 76%)',
        shallows: 'hsl(196, 60%, 87%)',
        pier: 'hsl(210, 14%, 94%)',
      }),
      ...roads({
        highway: 'hsl(45, 95%, 78%)',
        highwayCasing: 'hsl(41, 82%, 64%)',
        major: 'hsl(0, 0%, 100%)',
        majorCasing: 'hsl(220, 9%, 81%)',
        minor: 'hsl(0, 0%, 100%)',
        minorCasing: 'hsl(220, 9%, 87%)',
        path: 'hsl(210, 14%, 95%)',
        pathCasing: 'hsl(220, 9%, 86%)',
        rail: 'hsl(220, 6%, 74%)',
      }),
      ...buildings({ roof: 'hsl(220, 5%, 91%)', edge: 'hsl(220, 5%, 83%)', flat: 'hsl(220, 5%, 74%)' }),
      ...labels({
        strong: 'hsl(210, 6%, 25%)',
        muted: 'hsl(213, 5%, 40%)',
        road: 'hsl(213, 5%, 40%)',
        halo: 'rgba(255, 255, 255, 0.95)',
        water: 'hsl(200, 60%, 34%)',
        waterHalo: 'hsl(196, 60%, 87%)',
      }),
    },
    dark: {
      ...land({
        ground: 'hsl(220, 8%, 13%)',
        urban: 'hsl(220, 8%, 14%)',
        industrial: 'hsl(222, 9%, 16%)',
        grass: 'hsl(150, 30%, 22%)',
        wood: 'hsl(150, 20%, 17%)',
        pitch: 'hsl(150, 22%, 19%)',
        pitchEdge: 'hsl(150, 20%, 23%)',
        cemetery: 'hsl(150, 12%, 17%)',
        school: 'hsl(34, 12%, 17%)',
        hospital: 'hsl(5, 14%, 18%)',
        sand: 'hsl(40, 12%, 20%)',
        airport: 'hsl(222, 8%, 16%)',
        water: 'hsl(214, 38%, 15%)',
        shallows: 'hsl(214, 30%, 19%)',
        pier: 'hsl(220, 6%, 18%)',
      }),
      ...roads({
        highway: 'hsl(38, 18%, 38%)',
        highwayCasing: 'hsl(38, 14%, 26%)',
        major: 'hsl(220, 6%, 30%)',
        majorCasing: 'hsl(220, 6%, 19%)',
        minor: 'hsl(220, 6%, 25%)',
        minorCasing: 'hsl(220, 6%, 17%)',
        path: 'hsl(220, 6%, 20%)',
        pathCasing: 'hsl(220, 6%, 15%)',
        rail: 'hsl(220, 6%, 32%)',
      }),
      ...buildings({ roof: 'hsl(220, 6%, 21%)', edge: 'hsl(220, 6%, 16%)', flat: 'hsl(220, 6%, 32%)' }),
      ...labels({
        strong: 'hsl(210, 10%, 88%)',
        muted: 'hsl(210, 6%, 62%)',
        road: 'hsl(210, 6%, 70%)',
        halo: 'rgba(30, 32, 36, 0.9)',
        water: 'hsl(205, 40%, 60%)',
        waterHalo: 'hsl(214, 38%, 15%)',
      }),
    },
  },
  sky: {
    light: { 'horizon-color': 'hsl(210, 17%, 97.5%)', 'fog-color': 'hsl(210, 17%, 97.5%)' },
    dark: { 'sky-color': 'hsl(220, 12%, 7%)', 'horizon-color': 'hsl(220, 8%, 13%)', 'fog-color': 'hsl(220, 8%, 13%)' },
  },
  buildingPastels: { light: [] },
  buildingTint: { light: 0, dark: 0 },
  shading: {
    light: { sunTint: [1.0, 1.0, 1.0], skyTint: [0.98, 0.98, 1.0], shadowColor: [0.32, 0.33, 0.36] },
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
