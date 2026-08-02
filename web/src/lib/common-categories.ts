/**
 * Curated "common categories" surfaced in the search palette when the input is
 * empty — the browse shortcuts a user reaches for most (restaurants, coffee,
 * gas, parking …), Apple-Maps style.
 *
 * WHY hand-curate instead of reading the category registry? The client registry
 * (`category.store`) is capped at 1000 presets and the server sorts multi-tag
 * presets first, so the single-tag everyday categories — Restaurant, Supermarket,
 * Parking, Park — actually fall *past* the cap and aren't reliably present.
 * Curating also lets us pick clean labels and icons and control the ordering.
 *
 * Ordering is the "most useful first" ranking, since the row scrolls and only
 * the first handful are visible without dragging. The band comments are an
 * editorial estimate of how often each is reached for, not measured data —
 * they exist to give new entries an obvious home rather than landing at the
 * end. Within a band, order is roughly by frequency too.
 *
 * The value is a `category:<id>` so the palette's existing category action
 * navigates without any registry lookup; enrichment (if the registry does have
 * the preset) is layered on top.
 *
 * Extension point: to personalize this (e.g. reorder by the user's own usage),
 * sort this list against a usage signal before rendering.
 */

import type { PlaceCategory } from '@/types/place.types'

export interface CommonCategory {
  /** OSM preset id, e.g. 'amenity/restaurant'. Drives navigation as `category:<id>`. */
  id: string
  /** i18n key for the display label. */
  labelKey: string
  /** Lucide icon glyph name. */
  icon: string
  /** Category class — drives the icon colour via getCategoryColor, matching the rest of the app. */
  category: PlaceCategory
}

const key = (name: string) => `palette.commands.search.commonCategories.${name}`

export const COMMON_CATEGORIES: CommonCategory[] = [
  // ── Daily ───────────────────────────────────────────
  { id: 'amenity/restaurant', labelKey: key('restaurants'), icon: 'Utensils', category: 'food_and_drink' },
  { id: 'amenity/cafe', labelKey: key('coffee'), icon: 'Coffee', category: 'food_and_drink' },
  { id: 'amenity/fuel', labelKey: key('gas'), icon: 'Fuel', category: 'commercial_services' },
  { id: 'shop/supermarket', labelKey: key('groceries'), icon: 'ShoppingCart', category: 'store' },
  { id: 'amenity/fast_food', labelKey: key('fastFood'), icon: 'Sandwich', category: 'food_and_drink' },
  { id: 'amenity/parking', labelKey: key('parking'), icon: 'SquareParking', category: 'commercial_services' },
  { id: 'amenity/pharmacy', labelKey: key('pharmacy'), icon: 'Pill', category: 'medical' },
  { id: 'tourism/hotel', labelKey: key('hotels'), icon: 'Hotel', category: 'commercial_services' },
  { id: 'amenity/atm', labelKey: key('atms'), icon: 'Banknote', category: 'commercial_services' },
  { id: 'amenity/bar', labelKey: key('bars'), icon: 'Beer', category: 'food_and_drink' },

  // ── Weekly ──────────────────────────────────────────
  { id: 'amenity/toilets', labelKey: key('restrooms'), icon: 'Toilet', category: 'commercial_services' },
  { id: 'amenity/bank', labelKey: key('banks'), icon: 'Landmark', category: 'commercial_services' },
  { id: 'leisure/park', labelKey: key('parks'), icon: 'Trees', category: 'park' },
  { id: 'shop/convenience', labelKey: key('convenience'), icon: 'Store', category: 'store' },
  { id: 'amenity/hospital', labelKey: key('hospitals'), icon: 'Cross', category: 'medical' },
  { id: 'shop/mall', labelKey: key('shoppingMalls'), icon: 'ShoppingBag', category: 'store' },
  { id: 'shop/bakery', labelKey: key('bakeries'), icon: 'Croissant', category: 'food_and_drink' },
  { id: 'amenity/charging_station', labelKey: key('evCharging'), icon: 'BatteryCharging', category: 'commercial_services' },
  { id: 'highway/bus_stop', labelKey: key('busStops'), icon: 'Bus', category: 'default' },
  { id: 'leisure/fitness_centre', labelKey: key('gyms'), icon: 'Dumbbell', category: 'sport_and_leisure' },

  // ── Occasional ──────────────────────────────────────
  { id: 'shop/clothes', labelKey: key('clothing'), icon: 'Shirt', category: 'store' },
  { id: 'amenity/post_office', labelKey: key('postOffices'), icon: 'Mail', category: 'commercial_services' },
  { id: 'amenity/doctors', labelKey: key('doctors'), icon: 'Stethoscope', category: 'medical' },
  { id: 'amenity/cinema', labelKey: key('cinemas'), icon: 'Clapperboard', category: 'arts_and_entertainment' },
  { id: 'shop/car_repair', labelKey: key('autoRepair'), icon: 'Wrench', category: 'commercial_services' },
  { id: 'shop/alcohol', labelKey: key('liquorStores'), icon: 'Wine', category: 'store' },
  { id: 'tourism/attraction', labelKey: key('attractions'), icon: 'FerrisWheel', category: 'arts_and_entertainment' },
  { id: 'shop/hardware', labelKey: key('hardware'), icon: 'Hammer', category: 'store' },
  { id: 'amenity/bicycle_parking', labelKey: key('bikeParking'), icon: 'Bike', category: 'commercial_services' },
  { id: 'amenity/library', labelKey: key('libraries'), icon: 'Library', category: 'education' },

  // ── Situational ─────────────────────────────────────
  { id: 'tourism/museum', labelKey: key('museums'), icon: 'Amphora', category: 'arts_and_entertainment' },
  { id: 'shop/hairdresser', labelKey: key('hairSalons'), icon: 'Scissors', category: 'commercial_services' },
  { id: 'leisure/playground', labelKey: key('playgrounds'), icon: 'ToyBrick', category: 'park' },
  { id: 'amenity/drinking_water', labelKey: key('drinkingWater'), icon: 'GlassWater', category: 'park' },
  { id: 'amenity/veterinary', labelKey: key('veterinarians'), icon: 'PawPrint', category: 'medical' },
  { id: 'amenity/theatre', labelKey: key('theatres'), icon: 'Drama', category: 'arts_and_entertainment' },
  { id: 'amenity/police', labelKey: key('police'), icon: 'Shield', category: 'default' },
  { id: 'amenity/bench', labelKey: key('benches'), icon: 'Armchair', category: 'park' },
  { id: 'amenity/recycling', labelKey: key('recycling'), icon: 'Recycle', category: 'default' },
  { id: 'amenity/waste_basket', labelKey: key('trashCans'), icon: 'Trash2', category: 'default' },
  { id: 'leisure/picnic_table', labelKey: key('picnicTables'), icon: 'Table', category: 'park' },
  { id: 'amenity/shelter', labelKey: key('shelters'), icon: 'TentTree', category: 'park' },
  { id: 'amenity/post_box', labelKey: key('postBoxes'), icon: 'Inbox', category: 'commercial_services' },
  { id: 'emergency/defibrillator', labelKey: key('defibrillators'), icon: 'HeartPulse', category: 'medical' },
]
