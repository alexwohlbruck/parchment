/**
 * Map themes: one layer spec, several palettes.
 *
 * Charlotte is the generated tokens as they stand. The others are overlays on
 * them, so a theme only names the colours it changes and inherits every token
 * it does not — a new layer or token added to the spec lands in every theme.
 */
import type { MapStyleId } from '@/types/map.types'
import type { ThemeShading } from '@/lib/map/building-shade'
import type { FlavorId } from './build'
import type { GlobePalette } from './globe-layers'
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
  /** The low-zoom globe's biomes, ocean depths, lines and names. */
  globe?: PerFlavor<Partial<GlobePalette>>
  /** Sea lining, wood tufts and paper grain over the palette, as an engraved chart has. */
  engraved?: boolean
}

export interface RoadSurface {
  asphalt: string
  kerb: string
  /** The zoom from which roads deepen out of their map colour into the asphalt, reaching it as the lanes draw. */
  darkenFrom?: number
}

export interface Typography {
  /** Stands in for Geist at the same weight; `build-glyphs.mjs` generates its stacks. */
  family: 'Inter' | 'Roboto' | 'EB Garamond'
  /** Every label's size, for a family that sets smaller than Geist at the same size. */
  textScale?: number
  roadLabels?: { transform: 'uppercase' | 'none'; letterSpacing: number }
  /** Neighbourhood and district names, in a face of their own. */
  districtLabels?: { font: string; letterSpacing: number; scale: number }
  /** Whole label layers, by id, in a face of their own. */
  layerFaces?: LayerFace[]
}

export interface LayerFace {
  layers: string[]
  font: string
  letterSpacing?: number
  transform?: 'uppercase' | 'none'
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
  walkway?: string
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
    path_walkway: c.walkway ?? c.path,
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
        walkway: 'hsl(213, 22%, 44%)',
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
  typography: {
    family: 'Inter',
    roadLabels: { transform: 'uppercase', letterSpacing: 0.06 },
    districtLabels: { font: 'Barlow Condensed SemiBold', letterSpacing: 0.1, scale: 1.4 },
  },
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
        ground: 'hsl(217, 39%, 18%)',
        urban: 'hsl(221, 39%, 22%)',
        commercial: 'hsl(236, 22%, 29%)',
        industrial: 'hsl(222, 30%, 23%)',
        grass: 'hsl(192, 63%, 21%)',
        wood: 'hsl(193, 57%, 18%)',
        pitch: 'hsl(192, 55%, 22%)',
        pitchEdge: 'hsl(192, 45%, 29%)',
        cemetery: 'hsl(193, 45%, 20%)',
        school: 'hsl(222, 34%, 25%)',
        hospital: 'hsl(240, 18%, 29%)',
        sand: 'hsl(40, 16%, 24%)',
        airport: 'hsl(222, 30%, 23%)',
        water: 'hsl(219, 100%, 9%)',
        shallows: 'hsl(218, 70%, 13%)',
        pier: 'hsl(217, 32%, 27%)',
      }),
      ...roads({
        highway: 'hsl(211, 28%, 46%)',
        highwayCasing: 'hsl(217, 39%, 15%)',
        major: 'hsl(210, 32%, 41%)',
        majorCasing: 'hsl(217, 39%, 15%)',
        minor: 'hsl(211, 31%, 36%)',
        minorCasing: 'hsl(217, 39%, 15%)',
        path: 'hsl(213, 30%, 30%)',
        walkway: 'hsl(212, 30%, 40%)',
        pathCasing: 'hsl(217, 39%, 15%)',
        rail: 'hsl(215, 20%, 42%)',
      }),
      ...buildings({ roof: 'hsl(227, 38%, 31%)', edge: 'hsl(225, 40%, 21%)', flat: 'hsl(227, 38%, 31%)' }),
      ...labels({
        strong: 'hsl(220, 20%, 92%)',
        muted: 'hsl(212, 22%, 68%)',
        road: 'hsl(209, 28%, 64%)',
        halo: 'rgba(28, 42, 64, 0.9)',
        water: 'hsl(214, 45%, 55%)',
        waterHalo: 'hsl(219, 100%, 9%)',
      }),
    },
  },
  sky: {
    light: { 'horizon-color': 'hsl(0, 0%, 95.5%)', 'fog-color': 'hsl(0, 0%, 95.5%)' },
    dark: { 'sky-color': 'hsl(219, 70%, 8%)', 'horizon-color': 'hsl(217, 39%, 18%)', 'fog-color': 'hsl(217, 39%, 18%)' },
  },
  roadSurface: {
    light: { asphalt: 'hsl(206, 25%, 78%)', kerb: 'hsl(206, 20%, 90%)' },
    dark: { asphalt: 'hsl(211, 31%, 36%)', kerb: 'hsl(217, 39%, 18%)' },
  },
  typography: { family: 'Roboto', roadLabels: { transform: 'none', letterSpacing: 0 } },
  buildingPastels: { light: [], dark: [] },
  buildingTint: { light: 0, dark: 0 },
  shading: {
    light: { sunTint: [1.0, 1.0, 1.0], skyTint: [0.98, 0.98, 1.0], shadowColor: [0.32, 0.34, 0.4] },
  },
}

/**
 * An engraved sea chart: buff paper, a sea washed in faded verdigris with its
 * coast lined in ink, red-ochre post roads, sepia lettering, italic waters and
 * towns in small capitals. By night the same chart under a lamp.
 */
const CHART: MapTheme = {
  tokens: {
    light: {
      ...land({
        ground: 'hsl(41, 50%, 86%)',
        urban: 'hsl(38, 44%, 82%)',
        commercial: 'hsl(28, 46%, 79%)',
        industrial: 'hsl(34, 20%, 75%)',
        grass: 'hsl(64, 28%, 73%)',
        wood: 'hsl(70, 22%, 66%)',
        pitch: 'hsl(66, 28%, 70%)',
        pitchEdge: 'hsl(72, 22%, 54%)',
        cemetery: 'hsl(68, 22%, 74%)',
        school: 'hsl(34, 40%, 79%)',
        hospital: 'hsl(8, 38%, 80%)',
        sand: 'hsl(44, 56%, 79%)',
        airport: 'hsl(36, 22%, 77%)',
        water: 'hsl(188, 26%, 74%)',
        shallows: 'hsl(186, 28%, 80%)',
        pier: 'hsl(36, 30%, 76%)',
      }),
      ...roads({
        highway: 'hsl(12, 44%, 64%)',
        highwayCasing: 'hsl(10, 36%, 42%)',
        major: 'hsl(40, 70%, 90%)',
        majorCasing: 'hsl(28, 38%, 40%)',
        minor: 'hsl(42, 60%, 92%)',
        minorCasing: 'hsl(30, 24%, 62%)',
        path: 'hsl(40, 45%, 88%)',
        pathCasing: 'hsl(30, 25%, 58%)',
        rail: 'hsl(25, 30%, 26%)',
      }),
      ...buildings({ roof: 'hsl(33, 30%, 76%)', edge: 'hsl(28, 32%, 50%)', flat: 'hsl(31, 28%, 70%)' }),
      ...labels({
        strong: 'hsl(24, 48%, 17%)',
        muted: 'hsl(28, 28%, 34%)',
        road: 'hsl(24, 36%, 24%)',
        halo: 'hsla(41, 50%, 87%, 0.85)',
        water: 'hsl(203, 48%, 25%)',
        waterHalo: 'hsl(188, 26%, 78%)',
      }),
      glacier_fill_color: 'hsl(190, 22%, 90%)',
      aeroway_line_color: 'hsl(34, 22%, 66%)',
      heliport_fill_color: 'hsl(34, 22%, 70%)',
      ferry_line_line_color: 'hsl(203, 40%, 36%)',
      ferry_line_line_color_2: 'hsl(203, 40%, 36%)',
      country_border_line_color: 'hsl(350, 42%, 40%)',
      other_border_line_color: 'hsl(350, 28%, 50%)',
      disputed_border_line_color: 'hsl(350, 28%, 50%)',
      ocean_labels_text_halo_color: 'hsl(188, 26%, 78%)',
      ocean_labels_text_halo_color_2: 'hsl(188, 26%, 78%)',
      lake_labels_text_halo_color: 'hsl(188, 26%, 78%)',
      town_labels_icon_color: 'hsl(24, 48%, 17%)',
      town_labels_icon_halo_color: 'hsl(41, 50%, 86%)',
      poi_halo: 'hsla(41, 50%, 87%, 0.85)',
      highway_shield_text_halo_color: 'hsl(41, 50%, 86%)',
    },
    dark: {
      ...land({
        ground: 'hsl(33, 24%, 15%)',
        urban: 'hsl(32, 22%, 18%)',
        commercial: 'hsl(24, 26%, 21%)',
        industrial: 'hsl(30, 12%, 19%)',
        grass: 'hsl(75, 22%, 20%)',
        wood: 'hsl(80, 22%, 17%)',
        pitch: 'hsl(75, 22%, 22%)',
        pitchEdge: 'hsl(75, 18%, 30%)',
        cemetery: 'hsl(72, 16%, 19%)',
        school: 'hsl(32, 22%, 20%)',
        hospital: 'hsl(8, 24%, 21%)',
        sand: 'hsl(40, 26%, 22%)',
        airport: 'hsl(30, 12%, 20%)',
        water: 'hsl(200, 32%, 12%)',
        shallows: 'hsl(198, 28%, 15%)',
        pier: 'hsl(32, 18%, 24%)',
      }),
      ...roads({
        highway: 'hsl(16, 38%, 40%)',
        highwayCasing: 'hsl(16, 34%, 20%)',
        major: 'hsl(38, 32%, 38%)',
        majorCasing: 'hsl(30, 26%, 12%)',
        minor: 'hsl(36, 22%, 29%)',
        minorCasing: 'hsl(30, 26%, 12%)',
        path: 'hsl(36, 20%, 26%)',
        walkway: 'hsl(36, 24%, 36%)',
        pathCasing: 'hsl(30, 26%, 12%)',
        rail: 'hsl(36, 22%, 46%)',
      }),
      ...buildings({ roof: 'hsl(32, 20%, 26%)', edge: 'hsl(30, 22%, 18%)', flat: 'hsl(32, 18%, 28%)' }),
      ...labels({
        strong: 'hsl(42, 55%, 82%)',
        muted: 'hsl(38, 30%, 62%)',
        road: 'hsl(40, 35%, 72%)',
        halo: 'hsla(33, 24%, 13%, 0.88)',
        water: 'hsl(190, 35%, 62%)',
        waterHalo: 'hsl(200, 32%, 12%)',
      }),
      glacier_fill_color: 'hsl(200, 14%, 24%)',
      aeroway_line_color: 'hsl(34, 16%, 30%)',
      heliport_fill_color: 'hsl(34, 16%, 24%)',
      ferry_line_line_color: 'hsl(190, 30%, 45%)',
      ferry_line_line_color_2: 'hsl(190, 30%, 45%)',
      country_border_line_color: 'hsl(355, 40%, 52%)',
      other_border_line_color: 'hsl(355, 26%, 42%)',
      disputed_border_line_color: 'hsl(355, 26%, 42%)',
      ocean_labels_text_halo_color: 'hsl(200, 32%, 12%)',
      ocean_labels_text_halo_color_2: 'hsl(200, 32%, 12%)',
      lake_labels_text_halo_color: 'hsl(200, 32%, 12%)',
      town_labels_icon_color: 'hsl(42, 55%, 82%)',
      town_labels_icon_halo_color: 'hsl(33, 24%, 15%)',
      poi_halo: 'hsla(33, 24%, 13%, 0.88)',
      highway_shield_text_halo_color: 'hsl(33, 24%, 15%)',
    },
  },
  sky: {
    light: { 'sky-color': 'hsl(38, 36%, 80%)', 'horizon-color': 'hsl(41, 50%, 86%)', 'fog-color': 'hsl(41, 50%, 86%)' },
    dark: { 'sky-color': 'hsl(30, 26%, 7%)', 'horizon-color': 'hsl(33, 24%, 15%)', 'fog-color': 'hsl(33, 24%, 15%)' },
  },
  roadSurface: {
    light: { asphalt: 'hsl(36, 26%, 74%)', kerb: 'hsl(30, 26%, 56%)' },
    dark: { asphalt: 'hsl(34, 16%, 24%)', kerb: 'hsl(30, 20%, 14%)' },
  },
  typography: {
    family: 'EB Garamond',
    textScale: 1.12,
    roadLabels: { transform: 'none', letterSpacing: 0.02 },
    districtLabels: { font: 'IM Fell English SC Regular', letterSpacing: 0.14, scale: 1.08 },
    layerFaces: [
      { layers: ['River labels', 'Lake labels', 'Ferry', 'Globe sea labels', 'Globe line labels', 'Globe region labels', 'Globe range labels'], font: 'IM Fell English Italic', letterSpacing: 0.06 },
      { layers: ['Ocean labels', 'Globe ocean labels'], font: 'IM Fell English Italic', letterSpacing: 0.3 },
      { layers: ['Town labels', 'City labels', 'Capital city labels'], font: 'IM Fell English SC Regular', letterSpacing: 0.04 },
      { layers: ['State labels', 'Country labels', 'Continent labels', 'Globe continent labels'], font: 'IM Fell English SC Regular', letterSpacing: 0.24, transform: 'uppercase' },
    ],
  },
  buildingPastels: {
    light: ['hsl(30, 28%, 75%)', 'hsl(38, 30%, 77%)', 'hsl(24, 26%, 74%)'],
    dark: [],
  },
  buildingTint: { light: 0, dark: 0 },
  shading: {
    light: { sunTint: [1.05, 1.0, 0.9], skyTint: [0.98, 0.95, 0.9], shadowColor: [0.36, 0.27, 0.18] },
  },
  globe: {
    light: {
      biome: {
        desert: 'hsl(40, 52%, 84%)',
        scrub: 'hsl(52, 38%, 80%)',
        grassland: 'hsl(56, 32%, 79%)',
        savanna: 'hsl(50, 40%, 79%)',
        tundra: 'hsl(45, 22%, 84%)',
        dry_forest: 'hsl(70, 26%, 72%)',
        forest: 'hsl(70, 22%, 70%)',
        boreal: 'hsl(76, 16%, 72%)',
        rainforest: 'hsl(76, 24%, 66%)',
      },
      depth: [
        [200, 'hsl(188, 26%, 70%)'],
        [1000, 'hsl(190, 27%, 67%)'],
        [2000, 'hsl(192, 28%, 64%)'],
        [3000, 'hsl(194, 28%, 61%)'],
        [4000, 'hsl(196, 29%, 58%)'],
        [5000, 'hsl(198, 29%, 55.5%)'],
        [6000, 'hsl(200, 30%, 53%)'],
        [8000, 'hsl(202, 30%, 50%)'],
      ],
      relief: 0.7,
      line: 'hsla(203, 40%, 24%, 0.45)',
      continent: 'hsl(24, 48%, 22%)',
      ocean: 'hsl(203, 48%, 22%)',
      oceanHalo: 'hsla(188, 26%, 78%, 0.5)',
      region: 'hsl(28, 30%, 32%)',
      halo: 'hsla(41, 50%, 87%, 0.7)',
    },
    dark: {
      biome: {
        desert: 'hsl(36, 22%, 20%)',
        scrub: 'hsl(48, 16%, 19%)',
        grassland: 'hsl(62, 16%, 19%)',
        savanna: 'hsl(48, 18%, 19%)',
        tundra: 'hsl(40, 10%, 22%)',
        dry_forest: 'hsl(70, 16%, 18%)',
        forest: 'hsl(78, 18%, 17%)',
        boreal: 'hsl(85, 14%, 18%)',
        rainforest: 'hsl(82, 20%, 16%)',
      },
      depth: [
        [200, 'hsl(200, 32%, 11.5%)'],
        [1000, 'hsl(201, 33%, 11%)'],
        [2000, 'hsl(202, 34%, 10.2%)'],
        [3000, 'hsl(203, 34%, 9.6%)'],
        [4000, 'hsl(203, 35%, 9%)'],
        [5000, 'hsl(204, 35%, 8.4%)'],
        [6000, 'hsl(205, 36%, 7.8%)'],
        [8000, 'hsl(205, 36%, 7%)'],
      ],
      ice: 'hsl(200, 14%, 30%)',
      line: 'hsla(190, 22%, 55%, 0.35)',
      continent: 'hsl(42, 45%, 75%)',
      ocean: 'hsl(190, 30%, 58%)',
      region: 'hsl(38, 26%, 60%)',
      halo: 'hsla(33, 24%, 13%, 0.6)',
    },
  },
  engraved: true,
}

const THEMES: Record<MapStyleId, MapTheme> = {
  charlotte: {},
  chart: CHART,
  cupertino: CUPERTINO,
  'mountain-view': MOUNTAIN_VIEW,
}

const theme = (style: MapStyleId | undefined): MapTheme => THEMES[style ?? 'charlotte'] ?? {}

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

export function themeEngraved(style: MapStyleId | undefined): boolean {
  return !!theme(style).engraved
}

export function themeGlobe(style: MapStyleId | undefined, flavor: FlavorId): Partial<GlobePalette> | undefined {
  return theme(style).globe?.[flavor]
}
