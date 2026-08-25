/**
 * Basemap colour tokens.
 *
 * A flavor is a flat map of named colours. It carries no geometry, no zoom
 * ramps and no layer IDs — `layers.ts` owns all of that and reads these by
 * name. One layer spec, N flavors: adding a theme is a new object here and
 * nothing else.
 *
 * The palette follows two rules taken from 2GIS's cartography, because they
 * are what makes a street map legible rather than merely coloured:
 *
 *   1. Roads are the lightest thing on the map. The ground is tinted (warm
 *      cream in light, neutral charcoal in dark) and the road network sits
 *      *above* it in near-white / raised grey. The network reads as figure,
 *      everything else as ground. Styles that put near-white roads on a
 *      near-white background lose the network entirely.
 *
 *   2. Hue encodes importance, and only the top three classes get hue at
 *      all. Motorway / trunk / primary carry a warm (light) or blue (dark)
 *      ramp; secondary and below are neutral with a grey casing. A pure
 *      lightness ramp cannot carry hierarchy — that was the defect in the
 *      previous runtime dark transform, which spaced five purples ~12
 *      lightness apart and flattened into one field of mush.
 */

export interface Flavor {
  /** Identifier used in cache keys and tests. */
  id: 'light' | 'dark'
  /** True when the ground is darker than the ink. Drives label contrast. */
  dark: boolean

  // Ground
  background: string
  earth: string

  // Landcover
  park: string
  wood: string
  grass: string
  scrub: string
  sand: string
  glacier: string
  wetland: string

  // Landuse
  residential: string
  commercial: string
  industrial: string
  hospital: string
  school: string
  cemetery: string
  pitch: string
  zoo: string
  military: string
  aerodrome: string

  // Water
  water: string
  waterway: string

  // Built form
  building: string
  building_outline: string
  building_3d: string
  runway: string
  taxiway: string
  pier: string

  // Roads — hue for the top three, neutral below
  motorway: string
  motorway_casing: string
  trunk: string
  trunk_casing: string
  primary: string
  primary_casing: string
  secondary: string
  secondary_casing: string
  tertiary: string
  tertiary_casing: string
  minor: string
  minor_casing: string
  service: string
  service_casing: string
  path: string
  track: string
  rail: string
  rail_hatch: string

  /** Tunnels: the road colour is replaced wholesale, not merely dimmed. */
  tunnel: string
  tunnel_casing: string
  /** Bridges reuse the road colour; only the casing darkens to lift them. */
  bridge_casing: string

  /** Route / hover highlight, baked into every road layer as a data match. */
  selected: string

  // Boundaries
  boundary: string
  boundary_country: string

  // Labels
  road_label: string
  road_label_halo: string
  road_label_minor: string
  shield_text: string
  shield_fill: string
  shield_outline: string
  poi_label: string
  poi_label_halo: string
  place_suburb: string
  place_village: string
  place_town: string
  place_city: string
  place_state: string
  place_country: string
  place_halo: string
  water_label: string
  water_label_halo: string
  housenumber: string
  housenumber_halo: string
  peak_label: string
  peak_label_halo: string

  /** Maki icon tints, keyed by the POI families in `layers.ts`. */
  pois: {
    default: string
    food: string
    shop: string
    transit: string
    outdoor: string
    lodging: string
    civic: string
    health: string
  }
}

/**
 * Light — warm cream ground, white roads, amber arterials.
 *
 * The ground is `#F5F2E0`, the cream 2GIS builds their light map on. Roads
 * are pure white on top of it, so the network is the brightest surface.
 */
export const LIGHT: Flavor = {
  id: 'light',
  dark: false,

  background: '#F5F2E0',
  earth: '#F5F2E0',

  park: '#D3E3B8',
  wood: '#C6DCA8',
  grass: '#DCE8C4',
  scrub: '#DDE4C2',
  sand: '#F2EAD0',
  glacier: '#EAF2F5',
  wetland: '#D2E2D4',

  residential: '#EFEBD8',
  commercial: '#F2ECD9',
  industrial: '#EAE6D4',
  hospital: '#F3E3DF',
  school: '#F0E8DC',
  cemetery: '#DDE5C9',
  pitch: '#CFE2B4',
  zoo: '#DEE7C6',
  military: '#E7E3D0',
  aerodrome: '#EBE9DC',

  water: '#ADD3E3',
  waterway: '#9EC8DA',

  building: '#E7E1CC',
  building_outline: '#D9D2B9',
  building_3d: '#E4DDC6',
  runway: '#DFDCCB',
  taxiway: '#E8E5D4',
  pier: '#EDE9D8',

  motorway: '#F5A22E',
  motorway_casing: '#BF6F0D',
  trunk: '#FFB92E',
  trunk_casing: '#ED9B35',
  primary: '#FBCC6F',
  primary_casing: '#E19D48',
  secondary: '#FFFFFF',
  secondary_casing: '#B6B6B6',
  tertiary: '#FFFFFF',
  tertiary_casing: '#BDBDBD',
  minor: '#FFFFFF',
  minor_casing: '#BFBFBF',
  service: '#FBFBF8',
  service_casing: '#C9C9C4',
  path: '#B3A895',
  track: '#C0B49C',
  rail: '#C2BCA8',
  rail_hatch: '#AAA490',

  tunnel: '#F0EDDD',
  tunnel_casing: '#D6D2C0',
  bridge_casing: '#9E9E96',

  selected: '#FA5C4A',

  boundary: '#B9B3A0',
  boundary_country: '#9C9684',

  road_label: '#55554A',
  road_label_halo: '#F5F2E0',
  road_label_minor: '#6E6E61',
  shield_text: '#3A3A32',
  shield_fill: '#FFFFFF',
  shield_outline: '#A8A294',
  poi_label: '#4A4A40',
  poi_label_halo: '#F5F2E0',
  place_suburb: '#6B6B5D',
  place_village: '#3E3E36',
  place_town: '#33332C',
  place_city: '#1F1F1B',
  place_state: '#7A7468',
  place_country: '#41413A',
  place_halo: '#F5F2E0',
  water_label: '#3D6B7D',
  water_label_halo: '#E4F0F5',
  housenumber: '#8A8A7C',
  housenumber_halo: '#F5F2E0',
  peak_label: '#6B5B45',
  peak_label_halo: '#F5F2E0',

  pois: {
    default: '#7A7468',
    food: '#D2803A',
    shop: '#7C6BB0',
    transit: '#3E7BB5',
    outdoor: '#4E8C46',
    lodging: '#B0658F',
    civic: '#6E7A88',
    health: '#C0564F',
  },
}

/**
 * Dark — neutral charcoal ground, raised-grey roads, blue arterials.
 *
 * Deliberately neutral rather than tinted: Parchment's own overlays are
 * already gold and blue (transit lines, routes), and a hue-tinted ground
 * competes with them. Arterials go blue so they separate from the neutral
 * minor network by hue, not just by lightness.
 */
export const DARK: Flavor = {
  id: 'dark',
  dark: true,

  background: '#1B1D21',
  earth: '#1B1D21',

  park: '#1C2620',
  wood: '#1A241E',
  grass: '#1F2822',
  scrub: '#212821',
  sand: '#242420',
  glacier: '#242A2E',
  wetland: '#1D2624',

  residential: '#1E2024',
  commercial: '#202226',
  industrial: '#1E2023',
  hospital: '#242023',
  school: '#222126',
  cemetery: '#1E2420',
  pitch: '#22301F',
  zoo: '#202521',
  military: '#232326',
  aerodrome: '#1F2125',

  water: '#17222E',
  waterway: '#1B2B3A',

  building: '#212327',
  building_outline: '#2A2D32',
  building_3d: '#24272C',
  runway: '#2C3036',
  taxiway: '#26292F',
  pier: '#2A2D33',

  motorway: '#4E8AC0',
  motorway_casing: '#24384C',
  trunk: '#427AAC',
  trunk_casing: '#223546',
  primary: '#3A6B98',
  primary_casing: '#203141',
  secondary: '#4A4F57',
  secondary_casing: '#2A2D33',
  tertiary: '#43484F',
  tertiary_casing: '#282B31',
  minor: '#3B4046',
  minor_casing: '#26292E',
  service: '#33373C',
  service_casing: '#24272B',
  path: '#454A50',
  track: '#3E4349',
  rail: '#3A3F45',
  rail_hatch: '#4A4F55',

  tunnel: '#26292E',
  tunnel_casing: '#1B1D21',
  bridge_casing: '#121417',

  selected: '#FF6B58',

  boundary: '#4C535E',
  boundary_country: '#5E6675',

  road_label: '#A8B0BA',
  road_label_halo: '#15171B',
  road_label_minor: '#8B929B',
  shield_text: '#D6DAE0',
  shield_fill: '#2A2D33',
  shield_outline: '#4C535E',
  poi_label: '#B6BCC4',
  poi_label_halo: '#15171B',
  place_suburb: '#9AA1AA',
  place_village: '#C2C8D0',
  place_town: '#D2D7DD',
  place_city: '#F2F4F7',
  place_state: '#79808A',
  place_country: '#C8CDD4',
  place_halo: '#14161A',
  water_label: '#6E93AE',
  water_label_halo: '#101820',
  housenumber: '#5D646C',
  housenumber_halo: '#15171B',
  peak_label: '#9A9384',
  peak_label_halo: '#15171B',

  pois: {
    default: '#8B929B',
    food: '#E0A05E',
    shop: '#A796D8',
    transit: '#5FA0D8',
    outdoor: '#6FB565',
    lodging: '#D18AB2',
    civic: '#93A0AE',
    health: '#E07D76',
  },
}

export const flavors: Record<Flavor['id'], Flavor> = {
  light: LIGHT,
  dark: DARK,
}

export function getFlavor(id: string | undefined): Flavor {
  return id === 'dark' ? DARK : LIGHT
}
