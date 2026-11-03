// What people look for mid-trip, per way of travelling, as search presets.

export type AheadCategoryKey = 'fuel' | 'charging' | 'coffee' | 'food' | 'restrooms' | 'parking' | 'water' | 'bikeRepair'

export const AHEAD_CATEGORIES: Record<AheadCategoryKey, string[]> = {
  fuel: ['amenity/fuel'],
  charging: ['amenity/charging_station'],
  coffee: ['amenity/cafe'],
  food: ['amenity/fast_food', 'amenity/restaurant'],
  restrooms: ['amenity/toilets'],
  parking: ['amenity/parking'],
  water: ['amenity/drinking_water'],
  bikeRepair: ['shop/bicycle', 'amenity/bicycle_repair_station'],
}

const BY_MODE: Record<string, AheadCategoryKey[]> = {
  driving: ['fuel', 'charging', 'coffee', 'food', 'restrooms', 'parking'],
  cycling: ['coffee', 'water', 'bikeRepair', 'food', 'restrooms'],
  walking: ['coffee', 'food', 'restrooms', 'water'],
}

export function aheadCategoriesFor(mode: string): AheadCategoryKey[] {
  return BY_MODE[mode === 'biking' ? 'cycling' : mode] ?? BY_MODE.driving
}
