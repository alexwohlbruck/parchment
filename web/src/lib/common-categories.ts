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
 * Ordering here is the "most useful first" ranking. The value is a `category:<id>`
 * so the palette's existing category action navigates without any registry
 * lookup; enrichment (if the registry does have the preset) is layered on top.
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

export const COMMON_CATEGORIES: CommonCategory[] = [
  { id: 'amenity/restaurant', labelKey: 'palette.commands.search.commonCategories.restaurants', icon: 'Utensils', category: 'food_and_drink' },
  { id: 'amenity/cafe', labelKey: 'palette.commands.search.commonCategories.coffee', icon: 'Coffee', category: 'food_and_drink' },
  { id: 'amenity/fast_food', labelKey: 'palette.commands.search.commonCategories.fastFood', icon: 'Sandwich', category: 'food_and_drink' },
  { id: 'shop/supermarket', labelKey: 'palette.commands.search.commonCategories.groceries', icon: 'ShoppingCart', category: 'store' },
  { id: 'amenity/fuel', labelKey: 'palette.commands.search.commonCategories.gas', icon: 'Fuel', category: 'commercial_services' },
  { id: 'amenity/parking', labelKey: 'palette.commands.search.commonCategories.parking', icon: 'SquareParking', category: 'commercial_services' },
  { id: 'amenity/pharmacy', labelKey: 'palette.commands.search.commonCategories.pharmacy', icon: 'Pill', category: 'medical' },
  { id: 'tourism/hotel', labelKey: 'palette.commands.search.commonCategories.hotels', icon: 'Hotel', category: 'commercial_services' },
  { id: 'amenity/bar', labelKey: 'palette.commands.search.commonCategories.bars', icon: 'Beer', category: 'food_and_drink' },
  { id: 'leisure/park', labelKey: 'palette.commands.search.commonCategories.parks', icon: 'Trees', category: 'park' },
  { id: 'amenity/hospital', labelKey: 'palette.commands.search.commonCategories.hospitals', icon: 'Cross', category: 'medical' },
  { id: 'amenity/atm', labelKey: 'palette.commands.search.commonCategories.atms', icon: 'Landmark', category: 'commercial_services' },
]
