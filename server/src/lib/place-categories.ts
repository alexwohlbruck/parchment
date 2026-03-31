import type { PlaceCategory, PlaceIcon } from '../types/place.types'
import type { MatchResult } from './osm-presets'

// ─── Category palette ────────────────────────────────────────────────────────

export interface PlaceCategoryDefinition {
  id: PlaceCategory
  label: string
  /** HSL / hex colors for light and dark map/UI themes */
  colors: { light: string; dark: string }
}

/**
 * Single source of truth for every PlaceCategory: its display label and
 * theme-aware colors.  Consumed by the server for icon resolution and
 * served to the client via GET /search/categories/palette so the client
 * never has to hard-code these values.
 */
export const categoryPalette: PlaceCategoryDefinition[] = [
  { id: 'food_and_drink',         label: 'Food & Drink',          colors: { light: '#FF9933',            dark: '#FBCB6A' } },
  { id: 'education',              label: 'Education',             colors: { light: 'hsl(30, 50%, 38%)',  dark: 'hsl(30, 50%, 70%)' } },
  { id: 'medical',                label: 'Medical',               colors: { light: 'hsl(0, 90%, 60%)',   dark: 'hsl(0, 70%, 70%)' } },
  { id: 'sport_and_leisure',      label: 'Sport & Leisure',       colors: { light: 'hsl(190, 75%, 38%)', dark: 'hsl(190, 60%, 70%)' } },
  { id: 'store',                  label: 'Store',                 colors: { light: 'hsl(210, 75%, 53%)', dark: 'hsl(210, 70%, 75%)' } },
  { id: 'arts_and_entertainment', label: 'Arts & Entertainment',  colors: { light: 'hsl(320, 85%, 60%)', dark: 'hsl(320, 70%, 75%)' } },
  { id: 'commercial_services',    label: 'Commercial Services',   colors: { light: 'hsl(250, 75%, 60%)', dark: 'hsl(260, 70%, 75%)' } },
  { id: 'park',                   label: 'Park & Nature',         colors: { light: 'hsl(110, 70%, 28%)', dark: 'hsl(110, 55%, 65%)' } },
  { id: 'default',                label: 'Other',                 colors: { light: 'hsl(210, 20%, 43%)', dark: 'hsl(210, 20%, 70%)' } },
]

const categoryPaletteMap = new Map(categoryPalette.map(c => [c.id, c]))

/** Convenience: get the color for a category by theme */
export function getCategoryColor(category: PlaceCategory, theme: 'light' | 'dark'): string {
  return categoryPaletteMap.get(category)?.colors[theme]
    ?? categoryPaletteMap.get('default')!.colors[theme]
}

// ─── Category rules ───────────────────────────────────────────────────────────

/**
 * Maps OSM preset ID prefixes to place categories.
 * Order matters — more specific prefixes should come first.
 */
const categoryRules: Array<{ match: (presetId: string) => boolean; category: PlaceCategory }> = [
  // Park-like (must come before sport_and_leisure to catch leisure/park etc.)
  {
    match: (id) =>
      id.startsWith('leisure/park') ||
      id.startsWith('leisure/garden') ||
      id.startsWith('leisure/nature_reserve') ||
      id.startsWith('leisure/picnic_table') ||
      id.startsWith('leisure/firepit') ||
      id.startsWith('amenity/bench') ||
      id.startsWith('amenity/shelter') ||
      id.startsWith('amenity/drinking_water') ||
      id.startsWith('natural/'),
    category: 'park',
  },

  // Food & Drink
  {
    match: (id) =>
      id.startsWith('amenity/restaurant') ||
      id.startsWith('amenity/cafe') ||
      id.startsWith('amenity/bar') ||
      id.startsWith('amenity/pub') ||
      id.startsWith('amenity/fast_food') ||
      id.startsWith('amenity/food_court') ||
      id.startsWith('amenity/ice_cream') ||
      id.startsWith('amenity/biergarten'),
    category: 'food_and_drink',
  },

  // Education
  {
    match: (id) =>
      id.startsWith('amenity/school') ||
      id.startsWith('amenity/university') ||
      id.startsWith('amenity/college') ||
      id.startsWith('amenity/library') ||
      id.startsWith('amenity/kindergarten') ||
      id.startsWith('amenity/language_school') ||
      id.startsWith('amenity/music_school') ||
      id.startsWith('amenity/driving_school'),
    category: 'education',
  },

  // Medical
  {
    match: (id) =>
      id.startsWith('amenity/hospital') ||
      id.startsWith('amenity/pharmacy') ||
      id.startsWith('amenity/clinic') ||
      id.startsWith('amenity/doctors') ||
      id.startsWith('amenity/dentist') ||
      id.startsWith('amenity/veterinary') ||
      id.startsWith('healthcare/'),
    category: 'medical',
  },

  // Bicycle infrastructure (before general sport_and_leisure)
  {
    match: (id) =>
      id.startsWith('amenity/bicycle_parking') ||
      id.startsWith('amenity/bicycle_repair_station') ||
      id.startsWith('amenity/bicycle_rental') ||
      id.startsWith('amenity/vending_machine/bicycle') ||
      id.startsWith('shop/bicycle'),
    category: 'sport_and_leisure',
  },

  // Sport & Leisure
  {
    match: (id) =>
      id.startsWith('leisure/') ||
      id.startsWith('sport/') ||
      id.startsWith('amenity/swimming_pool') ||
      id.startsWith('amenity/gym'),
    category: 'sport_and_leisure',
  },

  // Stores (food & drink stores + general shops)
  {
    match: (id) =>
      id.startsWith('shop/'),
    category: 'store',
  },

  // Transport (bus stops, train stations, etc.) → commercial_services category
  {
    match: (id) =>
      id === 'railway' ||
      id.startsWith('railway/') ||
      id.startsWith('public_transport/') ||
      id === 'highway' ||
      id.startsWith('highway/bus_stop') ||
      id.startsWith('aeroway/'),
    category: 'commercial_services',
  },

  // Commercial Services, Motorist, Lodging (must come before tourism catch-all)
  {
    match: (id) =>
      id.startsWith('office/') ||
      id.startsWith('amenity/bank') ||
      id.startsWith('amenity/atm') ||
      id.startsWith('amenity/bureau_de_change') ||
      id.startsWith('amenity/car_rental') ||
      id.startsWith('amenity/car_wash') ||
      id.startsWith('amenity/fuel') ||
      id.startsWith('amenity/charging_station') ||
      id.startsWith('amenity/parking') ||
      id.startsWith('amenity/toilets') ||
      id.startsWith('tourism/hotel') ||
      id.startsWith('tourism/motel') ||
      id.startsWith('tourism/hostel') ||
      id.startsWith('tourism/guest_house') ||
      id.startsWith('tourism/camp_site') ||
      id.startsWith('tourism/caravan_site') ||
      id.startsWith('tourism/information'),
    category: 'commercial_services',
  },

  // Arts, Entertainment, Historic, Tourism (catch-all for remaining tourism)
  {
    match: (id) =>
      id.startsWith('tourism/') ||
      id.startsWith('historic/') ||
      id.startsWith('amenity/theatre') ||
      id.startsWith('amenity/cinema') ||
      id.startsWith('amenity/arts_centre') ||
      id.startsWith('amenity/nightclub') ||
      id.startsWith('amenity/casino') ||
      id.startsWith('amenity/community_centre'),
    category: 'arts_and_entertainment',
  },
]

export function getPlaceCategory(presetId: string): PlaceCategory {
  for (const rule of categoryRules) {
    if (rule.match(presetId)) {
      return rule.category
    }
  }
  return 'default'
}

/**
 * Maps common maki icon names to lucide equivalents.
 * Only includes icons where a good lucide match exists.
 */
const makiToLucideMap: Record<string, string> = {
  // Food & Drink
  'maki-restaurant': 'UtensilsCrossed',
  'maki-cafe': 'Coffee',
  'maki-bar': 'Wine',
  'maki-beer': 'Beer',
  'maki-fast-food': 'Sandwich',
  'maki-ice-cream': 'IceCreamCone',
  'maki-bakery': 'CakeSlice',

  // Education
  'maki-school': 'GraduationCap',
  'maki-college': 'GraduationCap',
  'maki-library': 'BookOpen',

  // Medical
  'maki-hospital': 'Hospital',
  'maki-pharmacy': 'Pill',
  'maki-doctor': 'Stethoscope',
  'maki-dentist': 'Smile',
  'maki-veterinary': 'PawPrint',

  // Sport & Leisure
  'maki-swimming': 'Waves',
  'maki-soccer': 'CircleDot',
  'maki-tennis': 'CircleDot',
  'maki-golf': 'Flag',
  'maki-fitness-centre': 'Dumbbell',
  'maki-playground': 'Baby',
  'maki-stadium': 'Trophy',
  'maki-pitch': 'Trophy',

  // Stores
  'maki-grocery': 'ShoppingCart',
  'maki-shop': 'ShoppingBag',
  'maki-clothing-store': 'Shirt',
  'maki-convenience': 'Store',
  'maki-marketplace': 'Store',

  // Arts & Entertainment
  'maki-museum': 'Landmark',
  'maki-theatre': 'Drama',
  'maki-cinema': 'Clapperboard',
  'maki-art-gallery': 'Palette',
  'maki-music': 'Music',
  'maki-attraction': 'Star',
  'maki-viewpoint': 'Eye',
  'maki-castle': 'Castle',
  'maki-monument': 'Landmark',

  // Commercial Services
  'maki-bank': 'Landmark',
  'maki-post': 'Mail',
  'maki-fuel': 'Fuel',
  'maki-parking': 'ParkingSquare',
  'maki-car': 'Car',
  'maki-car-rental': 'Car',
  'maki-lodging': 'Hotel',
  'maki-campsite': 'Tent',

  // Parks & Nature
  'maki-park': 'Trees',
  'maki-garden': 'Flower2',
  'maki-wetland': 'Droplets',
  'maki-mountain': 'Mountain',

  // Transport
  'maki-bus': 'Bus',
  'maki-rail': 'TrainFront',
  'maki-rail-light': 'TramFront',
  'maki-rail-metro': 'TrainFront',
  'maki-airport': 'Plane',
  'maki-ferry': 'Ship',
  'maki-bicycle': 'Bike',
  'maki-bicycle-share': 'Bike',
  'maki-taxi': 'Car',

  // Other
  'maki-place-of-worship': 'Church',
  'maki-religious-christian': 'Church',
  'maki-religious-muslim': 'Moon',
  'maki-religious-jewish': 'Star',
  'maki-cemetery': 'Cross',
  'maki-fire-station': 'Flame',
  'maki-police': 'Shield',
  'maki-town-hall': 'Building2',
  'maki-embassy': 'Building',
  'maki-information': 'Info',
  'maki-toilet': 'Bath',
  'maki-drinking-water': 'GlassWater',
  'maki-telephone': 'Phone',
  'maki-recycling': 'Recycle',
  'maki-waste-basket': 'Trash2',
}

/**
 * Maps temaki and other non-maki icon pack names to lucide or maki equivalents.
 */
const nonMakiFallbackMap: Record<string, { icon: string; iconPack: 'lucide' | 'maki' }> = {
  // temaki icons → maki equivalents (prefer maki when available)
  'temaki-tram': { icon: 'rail-light', iconPack: 'maki' },
  'temaki-bus': { icon: 'bus', iconPack: 'maki' },
  'temaki-train': { icon: 'rail', iconPack: 'maki' },
  'temaki-subway': { icon: 'rail-metro', iconPack: 'maki' },
  'temaki-ferry': { icon: 'ferry', iconPack: 'maki' },
  'temaki-board_train': { icon: 'rail', iconPack: 'maki' },
  'temaki-board_bus': { icon: 'bus', iconPack: 'maki' },
  'temaki-board_tram': { icon: 'rail-light', iconPack: 'maki' },
  'temaki-airport': { icon: 'airport', iconPack: 'maki' },
  'temaki-tree_and_bench': { icon: 'park', iconPack: 'maki' },
  'temaki-bench': { icon: 'picnic-site', iconPack: 'maki' },
  'temaki-tree': { icon: 'park', iconPack: 'maki' },
  'temaki-playground': { icon: 'playground', iconPack: 'maki' },
  'temaki-car_wash': { icon: 'car-repair', iconPack: 'maki' },
  'temaki-car_parked': { icon: 'parking', iconPack: 'maki' },
  'temaki-car_structure': { icon: 'parking-garage', iconPack: 'maki' },
  'temaki-gas': { icon: 'fuel', iconPack: 'maki' },
  'temaki-construction': { icon: 'construction', iconPack: 'maki' },
  'temaki-museum': { icon: 'museum', iconPack: 'maki' },
  'temaki-school': { icon: 'school', iconPack: 'maki' },
  'temaki-pedestrian': { icon: 'marker', iconPack: 'maki' },
  'temaki-storage_tank': { icon: 'industry', iconPack: 'maki' },
  'temaki-power': { icon: 'industry', iconPack: 'maki' },
  'temaki-shinto': { icon: 'religious-shinto', iconPack: 'maki' },
  'temaki-rail_profile': { icon: 'rail', iconPack: 'maki' },
  'temaki-light_rail': { icon: 'rail-light', iconPack: 'maki' },
  'temaki-stop_position': { icon: 'rail-light', iconPack: 'maki' },
  'temaki-bicycle_rental': { icon: 'bicycle-share', iconPack: 'maki' },
  'temaki-bicycle_parked': { icon: 'bicycle', iconPack: 'maki' },
  'temaki-bicycle_repair': { icon: 'bicycle', iconPack: 'maki' },
  'temaki-vending_machine': { icon: 'convenience', iconPack: 'maki' },
  'temaki-art_gallery': { icon: 'art-gallery', iconPack: 'maki' },
  'temaki-ice_cream': { icon: 'ice-cream', iconPack: 'maki' },
  'temaki-laundry': { icon: 'laundry', iconPack: 'maki' },
  'temaki-briefcase': { icon: 'commercial', iconPack: 'maki' },

  // fas (Font Awesome) icons → maki equivalents
  'fas-concierge-bell': { icon: 'lodging', iconPack: 'maki' },
  'fas-swimming-pool': { icon: 'swimming', iconPack: 'maki' },
  'fas-clinic-medical': { icon: 'hospital', iconPack: 'maki' },
  'fas-briefcase-medical': { icon: 'hospital', iconPack: 'maki' },
  'fas-drumstick-bite': { icon: 'fast-food', iconPack: 'maki' },
  'fas-charging-station': { icon: 'charging-station', iconPack: 'maki' },
  'fas-synagogue': { icon: 'religious-jewish', iconPack: 'maki' },
  'fas-mosque': { icon: 'religious-muslim', iconPack: 'maki' },
  'fas-church': { icon: 'religious-christian', iconPack: 'maki' },
  'fas-cross': { icon: 'cemetery', iconPack: 'maki' },
  'fas-dumpster': { icon: 'waste-basket', iconPack: 'maki' },
  'fas-paw': { icon: 'veterinary', iconPack: 'maki' },

  // iD icons → lucide fallbacks (no maki equivalent)
  'iD-line': { icon: 'Minus', iconPack: 'lucide' },
  'iD-area': { icon: 'Square', iconPack: 'lucide' },
  'iD-relation': { icon: 'GitBranch', iconPack: 'lucide' },
}

/**
 * Resolves an OSM preset icon to the best available icon for rendering.
 * Prefers maki icons. Falls back to lucide only for non-maki icon packs.
 */
export function resolveIcon(presetIcon: string): { icon: string; iconPack: 'lucide' | 'maki' } {
  // Already a lucide-compatible name (no prefix)
  if (!presetIcon.startsWith('maki-') && !presetIcon.startsWith('iD-') && !presetIcon.startsWith('temaki-') && !presetIcon.startsWith('fas-') && !presetIcon.startsWith('roentgen-')) {
    return { icon: presetIcon, iconPack: 'lucide' }
  }

  // maki-prefixed icons: use maki directly
  if (presetIcon.startsWith('maki-')) {
    const makiName = presetIcon.slice(5)
    return { icon: makiName, iconPack: 'maki' }
  }

  // Non-maki icon packs (temaki, iD, fas, roentgen): try fallback map
  const fallback = nonMakiFallbackMap[presetIcon]
  if (fallback) return fallback

  // Try stripping prefix — maybe maki has it under the same name
  const stripped = presetIcon.replace(/^(temaki|iD|fas|roentgen)-/, '')
  // Fall back to lucide map for unmapped non-maki icons
  const lucideMatch = makiToLucideMap[`maki-${stripped}`]
  if (lucideMatch) {
    return { icon: lucideMatch, iconPack: 'lucide' }
  }

  // Last resort: use as maki name but log the miss
  console.warn(`⚠️  Unmapped icon "${presetIcon}" → falling back to "${stripped}" (maki). Add to nonMakiFallbackMap.`)
  return { icon: stripped, iconPack: 'maki' }
}

// Track icons that resolve to generic fallbacks
const loggedMissingIcons = new Set<string>()

/**
 * Builds a PlaceIcon from an OSM preset match result.
 */
export function buildPlaceIcon(presetMatch: MatchResult | null): PlaceIcon | undefined {
  if (!presetMatch?.preset) return undefined

  const category = getPlaceCategory(presetMatch.preset.id)
  const presetIcon = presetMatch.preset.icon
  if (!presetIcon || presetIcon === 'maki-circle' || presetIcon === 'maki-marker') {
    // No meaningful icon — log once per preset so we can assign icons
    const key = presetMatch.preset.id
    if (!loggedMissingIcons.has(key)) {
      loggedMissingIcons.add(key)
      console.warn(`📍 No icon for preset "${key}" (raw: ${presetIcon || 'none'}). Will show MapPin.`)
    }
  }

  const { icon, iconPack } = resolveIcon(presetIcon || 'maki-marker')

  return { category, icon, iconPack, presetId: presetMatch.preset.id }
}
