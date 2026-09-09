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
  // `public_transport=platform` rather than `highway=bus_stop`: it's the modern
  // tagging every mode shares, so one chip covers bus, tram and rail stops
  // (bus stops carry both tags, so none are lost).
  { id: 'public_transport/platform', labelKey: key('transitStops'), icon: 'Bus', category: 'commercial_services' },
  { id: 'railway/station', labelKey: key('trainStations'), icon: 'TrainFront', category: 'commercial_services' },
  { id: 'leisure/fitness_centre', labelKey: key('gyms'), icon: 'Dumbbell', category: 'sport_and_leisure' },
  { id: 'amenity/place_of_worship', labelKey: key('placesOfWorship'), icon: 'Church', category: 'default' },
  { id: 'amenity/school', labelKey: key('schools'), icon: 'GraduationCap', category: 'education' },
  { id: 'amenity/ice_cream', labelKey: key('iceCream'), icon: 'IceCreamCone', category: 'food_and_drink' },

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
  { id: 'amenity/dentist', labelKey: key('dentists'), icon: 'Smile', category: 'medical' },
  { id: 'amenity/clinic', labelKey: key('urgentCare'), icon: 'BriefcaseMedical', category: 'medical' },
  { id: 'shop/beauty', labelKey: key('beautySalons'), icon: 'Sparkles', category: 'commercial_services' },
  { id: 'shop/laundry', labelKey: key('laundry'), icon: 'WashingMachine', category: 'commercial_services' },
  { id: 'amenity/car_wash', labelKey: key('carWash'), icon: 'SprayCan', category: 'commercial_services' },
  { id: 'amenity/car_rental', labelKey: key('carRental'), icon: 'Car', category: 'commercial_services' },
  { id: 'aeroway/aerodrome', labelKey: key('airports'), icon: 'Plane', category: 'commercial_services' },
  { id: 'leisure/dog_park', labelKey: key('dogParks'), icon: 'Dog', category: 'sport_and_leisure' },
  { id: 'amenity/childcare', labelKey: key('childcare'), icon: 'Baby', category: 'education' },
  { id: 'shop/pet', labelKey: key('petStores'), icon: 'Bone', category: 'store' },
  { id: 'amenity/marketplace', labelKey: key('farmersMarkets'), icon: 'Carrot', category: 'store' },
  // Not a place type — `internet_access=wlan` is an attribute of cafes,
  // libraries, hotels … The server turns this preset into a tag filter so the
  // chip browses everywhere with WiFi (see derivePresetFilter).
  { id: 'internet_access/wlan', labelKey: key('wifi'), icon: 'Wifi', category: 'commercial_services' },

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
  { id: 'tourism/picnic_site', labelKey: key('picnicAreas'), icon: 'ShoppingBasket', category: 'park' },
  { id: 'amenity/fountain', labelKey: key('fountains'), icon: 'Droplets', category: 'park' },
  { id: 'amenity/shower', labelKey: key('showers'), icon: 'ShowerHead', category: 'commercial_services' },
  { id: 'amenity/public_bookcase', labelKey: key('publicBookcases'), icon: 'BookOpen', category: 'education' },
  { id: 'leisure/fitness_station', labelKey: key('outdoorGyms'), icon: 'Weight', category: 'sport_and_leisure' },
  { id: 'amenity/bicycle_repair_station', labelKey: key('bikeRepair'), icon: 'Bolt', category: 'sport_and_leisure' },
  { id: 'amenity/shelter', labelKey: key('shelters'), icon: 'TentTree', category: 'park' },
  { id: 'amenity/post_box', labelKey: key('postBoxes'), icon: 'Inbox', category: 'commercial_services' },
  { id: 'emergency/defibrillator', labelKey: key('defibrillators'), icon: 'HeartPulse', category: 'medical' },
  { id: 'tourism/artwork', labelKey: key('publicArt'), icon: 'Palette', category: 'arts_and_entertainment' },
  { id: 'tourism/viewpoint', labelKey: key('viewpoints'), icon: 'Binoculars', category: 'arts_and_entertainment' },
  { id: 'leisure/nature_reserve', labelKey: key('natureReserves'), icon: 'TreePine', category: 'park' },
  { id: 'natural/beach', labelKey: key('beaches'), icon: 'Umbrella', category: 'park' },
]
