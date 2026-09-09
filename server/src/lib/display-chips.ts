import type { DisplayChip, ChipSentiment, ChipCategory } from '../types/place.types'
import type { TranslateFn, TranslationKey } from './i18n/i18n.types'

// ── Chip definition ──────────────────────────────────────────────────────────

interface ChipDef {
  icon: string
  sentiment: ChipSentiment
  section?: 'diet'
  category?: ChipCategory
}

/**
 * Map of `"{key}_{value}"` → chip presentation.
 * Keys use the raw OSM tag key; values are the raw OSM tag value.
 *
 * The user-facing label for each entry lives in the locale files under
 * `chips.<key>` — see `chipLabelKey`, which makes a missing entry a
 * compile error rather than a raw key leaking into the UI.
 */
const CHIP_DEFS = {
  // ── Accessibility ────────────────────────────────────────────────────────
  wheelchair_yes: { icon: 'accessibility', sentiment: 'positive', category: 'accessibility' },
  wheelchair_limited: { icon: 'accessibility', sentiment: 'neutral', category: 'accessibility' },
  wheelchair_designated: { icon: 'accessibility', sentiment: 'positive', category: 'accessibility' },
  wheelchair_no: { icon: 'accessibility', sentiment: 'negative', category: 'accessibility' },
  tactile_paving_yes: { icon: 'accessibility', sentiment: 'positive', category: 'accessibility' },
  tactile_paving_no: { icon: 'accessibility', sentiment: 'negative', category: 'accessibility' },

  // ── Admission / Cost ─────────────────────────────────────────────────────
  fee_yes: { icon: 'dollar-sign', sentiment: 'neutral', category: 'cost' },
  fee_no: { icon: 'dollar-sign', sentiment: 'positive', category: 'cost' },

  // ── Restrooms ────────────────────────────────────────────────────────────
  toilets_yes: { icon: 'toilet', sentiment: 'positive', category: 'restrooms' },
  toilets_no: { icon: 'toilet', sentiment: 'negative', category: 'restrooms' },
  toilets_customers: { icon: 'toilet', sentiment: 'neutral', category: 'restrooms' },
  shower_yes: { icon: 'shower-head', sentiment: 'positive', category: 'restrooms' },
  shower_no: { icon: 'shower-head', sentiment: 'negative', category: 'restrooms' },
  changing_table_yes: { icon: 'baby', sentiment: 'positive', category: 'restrooms' },
  changing_table_no: { icon: 'baby', sentiment: 'negative', category: 'restrooms' },

  // ── Internet ─────────────────────────────────────────────────────────────
  internet_access_wlan: { icon: 'wifi', sentiment: 'positive', category: 'internet' },
  internet_access_yes: { icon: 'wifi', sentiment: 'positive', category: 'internet' },
  internet_access_no: { icon: 'wifi', sentiment: 'negative', category: 'internet' },
  internet_access_terminal: { icon: 'wifi', sentiment: 'neutral', category: 'internet' },
  internet_access_wired: { icon: 'wifi', sentiment: 'neutral', category: 'internet' },

  // ── Seating & Environment ────────────────────────────────────────────────
  outdoor_seating_yes: { icon: 'umbrella', sentiment: 'positive', category: 'seating' },
  outdoor_seating_no: { icon: 'umbrella', sentiment: 'negative', category: 'seating' },
  outdoor_seating_terrace: { icon: 'umbrella', sentiment: 'positive', category: 'seating' },
  outdoor_seating_garden: { icon: 'umbrella', sentiment: 'positive', category: 'seating' },
  outdoor_seating_patio: { icon: 'umbrella', sentiment: 'positive', category: 'seating' },
  outdoor_seating_balcony: { icon: 'umbrella', sentiment: 'positive', category: 'seating' },
  outdoor_seating_rooftop: { icon: 'umbrella', sentiment: 'positive', category: 'seating' },
  outdoor_seating_sidewalk: { icon: 'umbrella', sentiment: 'positive', category: 'seating' },
  indoor_seating_yes: { icon: 'armchair', sentiment: 'positive', category: 'seating' },
  indoor_seating_no: { icon: 'armchair', sentiment: 'negative', category: 'seating' },
  indoor_yes: { icon: 'home', sentiment: 'positive', category: 'seating' },
  indoor_no: { icon: 'home', sentiment: 'neutral', category: 'seating' },
  covered_yes: { icon: 'umbrella', sentiment: 'positive', category: 'seating' },
  covered_no: { icon: 'umbrella', sentiment: 'negative', category: 'seating' },
  heated_yes: { icon: 'flame', sentiment: 'positive', category: 'seating' },
  heated_no: { icon: 'flame', sentiment: 'negative', category: 'seating' },
  lit_yes: { icon: 'sun', sentiment: 'positive', category: 'seating' },
  lit_no: { icon: 'sun', sentiment: 'negative', category: 'seating' },
  air_conditioning_yes: { icon: 'snowflake', sentiment: 'positive', category: 'seating' },
  air_conditioning_no: { icon: 'snowflake', sentiment: 'negative', category: 'seating' },

  // ── Smoking ──────────────────────────────────────────────────────────────
  smoking_yes: { icon: 'cigarette', sentiment: 'neutral', category: 'smoking' },
  smoking_no: { icon: 'cigarette', sentiment: 'positive', category: 'smoking' },
  smoking_outside: { icon: 'cigarette', sentiment: 'neutral', category: 'smoking' },
  smoking_separated: { icon: 'cigarette', sentiment: 'neutral', category: 'smoking' },
  smoking_isolated: { icon: 'cigarette', sentiment: 'neutral', category: 'smoking' },
  smoking_dedicated: { icon: 'cigarette', sentiment: 'neutral', category: 'smoking' },

  // ── Food & Drink Service ─────────────────────────────────────────────────
  takeaway_yes: { icon: 'shopping-bag', sentiment: 'positive', category: 'food_service' },
  takeaway_no: { icon: 'shopping-bag', sentiment: 'negative', category: 'food_service' },
  takeaway_only: { icon: 'shopping-bag', sentiment: 'neutral', category: 'food_service' },
  delivery_yes: { icon: 'shopping-bag', sentiment: 'positive', category: 'food_service' },
  delivery_no: { icon: 'shopping-bag', sentiment: 'negative', category: 'food_service' },
  delivery_only: { icon: 'shopping-bag', sentiment: 'neutral', category: 'food_service' },
  drive_through_yes: { icon: 'shopping-bag', sentiment: 'positive', category: 'food_service' },
  drive_through_no: { icon: 'shopping-bag', sentiment: 'negative', category: 'food_service' },
  reservation_yes: { icon: 'calendar-check', sentiment: 'positive', category: 'food_service' },
  reservation_no: { icon: 'calendar-check', sentiment: 'neutral', category: 'food_service' },
  reservation_required: { icon: 'calendar-check', sentiment: 'neutral', category: 'food_service' },
  reservation_recommended: { icon: 'calendar-check', sentiment: 'neutral', category: 'food_service' },
  self_service_yes: { icon: 'hand', sentiment: 'neutral', category: 'food_service' },
  self_service_only: { icon: 'hand', sentiment: 'neutral', category: 'food_service' },
  self_service_no: { icon: 'hand', sentiment: 'neutral', category: 'food_service' },
  breakfast_yes: { icon: 'coffee', sentiment: 'positive', category: 'offerings' },
  bar_yes: { icon: 'wine', sentiment: 'positive', category: 'offerings' },
  cocktails_yes: { icon: 'wine', sentiment: 'positive', category: 'offerings' },
  microbrewery_yes: { icon: 'beer', sentiment: 'positive', category: 'offerings' },
  live_music_yes: { icon: 'music', sentiment: 'positive', category: 'offerings' },
  organic_yes: { icon: 'leaf', sentiment: 'positive', category: 'offerings' },
  organic_only: { icon: 'leaf', sentiment: 'positive', category: 'offerings' },
  second_hand_yes: { icon: 'recycle', sentiment: 'neutral', category: 'offerings' },
  second_hand_only: { icon: 'recycle', sentiment: 'neutral', category: 'offerings' },
  bulk_purchase_yes: { icon: 'shopping-bag', sentiment: 'neutral', category: 'offerings' },

  // ── Water & Utilities ─────────────────────────────────────────────────────
  drinking_water_yes: { icon: 'droplet', sentiment: 'positive', category: 'water' },
  drinking_water_no: { icon: 'droplet', sentiment: 'negative', category: 'water' },
  bottle_yes: { icon: 'droplet', sentiment: 'positive', category: 'water' },
  bottle_no: { icon: 'droplet', sentiment: 'negative', category: 'water' },
  hot_water_yes: { icon: 'droplet', sentiment: 'positive', category: 'water' },
  hot_water_no: { icon: 'droplet', sentiment: 'negative', category: 'water' },

  // ── Seasonal & Timing ───────────────────────────────────────────────────
  seasonal_yes: { icon: 'calendar', sentiment: 'neutral', category: 'timing' },
  seasonal_no: { icon: 'calendar', sentiment: 'positive', category: 'timing' },

  // ── Pets & Family ────────────────────────────────────────────────────────
  dog_yes: { icon: 'dog', sentiment: 'positive', category: 'family' },
  dog_leashed: { icon: 'dog', sentiment: 'neutral', category: 'family' },
  dog_no: { icon: 'dog', sentiment: 'negative', category: 'family' },
  pets_allowed_yes: { icon: 'paw-print', sentiment: 'positive', category: 'family' },
  pets_allowed_no: { icon: 'paw-print', sentiment: 'negative', category: 'family' },
  kids_area_yes: { icon: 'baby', sentiment: 'positive', category: 'family' },
  kids_area_designated: { icon: 'baby', sentiment: 'positive', category: 'family' },
  kids_area_no: { icon: 'baby', sentiment: 'negative', category: 'family' },
  highchair_yes: { icon: 'baby', sentiment: 'positive', category: 'family' },
  highchair_no: { icon: 'baby', sentiment: 'negative', category: 'family' },

  // ── LGBTQ+ ──────────────────────────────────────────────────────────────
  lgbtq_welcome: { icon: 'heart', sentiment: 'positive', category: 'lgbtq' },
  lgbtq_primary: { icon: 'heart', sentiment: 'positive', category: 'lgbtq' },
  lgbtq_only: { icon: 'heart', sentiment: 'positive', category: 'lgbtq' },
  lgbtq_no: { icon: 'heart', sentiment: 'negative', category: 'lgbtq' },

  // ── Payment ──────────────────────────────────────────────────────────────
  'payment:cash_yes': { icon: 'credit-card', sentiment: 'neutral', category: 'payment' },
  'payment:cash_no': { icon: 'credit-card', sentiment: 'neutral', category: 'payment' },
  'payment:credit_cards_yes': { icon: 'credit-card', sentiment: 'neutral', category: 'payment' },
  'payment:credit_cards_no': { icon: 'credit-card', sentiment: 'negative', category: 'payment' },
  'payment:debit_cards_yes': { icon: 'credit-card', sentiment: 'neutral', category: 'payment' },
  'payment:contactless_yes': { icon: 'smartphone', sentiment: 'positive', category: 'payment' },
  'payment:apple_pay_yes': { icon: 'smartphone', sentiment: 'positive', category: 'payment' },
  'payment:google_pay_yes': { icon: 'smartphone', sentiment: 'positive', category: 'payment' },

  // ── Parking ──────────────────────────────────────────────────────────────
  parking_yes: { icon: 'car', sentiment: 'positive', category: 'facilities' },
  parking_no: { icon: 'car', sentiment: 'negative', category: 'facilities' },

  // ── Accommodation & Facilities ────────────────────────────────────────────
  heating_yes: { icon: 'flame', sentiment: 'positive', category: 'facilities' },
  heating_no: { icon: 'flame', sentiment: 'negative', category: 'facilities' },
  kitchen_yes: { icon: 'cooking-pot', sentiment: 'positive', category: 'facilities' },
  kitchen_no: { icon: 'cooking-pot', sentiment: 'negative', category: 'facilities' },
  fireplace_yes: { icon: 'flame', sentiment: 'positive', category: 'facilities' },
  fireplace_no: { icon: 'flame', sentiment: 'negative', category: 'facilities' },
  cabins_yes: { icon: 'home', sentiment: 'positive', category: 'facilities' },
  caravans_yes: { icon: 'home', sentiment: 'positive', category: 'facilities' },
  tents_yes: { icon: 'tent', sentiment: 'positive', category: 'facilities' },
  openfire_yes: { icon: 'flame', sentiment: 'positive', category: 'facilities' },
  openfire_no: { icon: 'flame', sentiment: 'negative', category: 'facilities' },
  bbq_yes: { icon: 'flame', sentiment: 'positive', category: 'facilities' },
  bbq_no: { icon: 'flame', sentiment: 'negative', category: 'facilities' },
  power_supply_yes: { icon: 'plug', sentiment: 'positive', category: 'facilities' },
  power_supply_no: { icon: 'plug', sentiment: 'negative', category: 'facilities' },

  // ── Recreation & Outdoor ────────────────────────────────────────────────
  bench_yes: { icon: 'armchair', sentiment: 'positive', category: 'recreation' },
  bench_no: { icon: 'armchair', sentiment: 'negative', category: 'recreation' },
  shelter_yes: { icon: 'home', sentiment: 'positive', category: 'recreation' },
  shelter_no: { icon: 'home', sentiment: 'negative', category: 'recreation' },
  picnic_table_yes: { icon: 'armchair', sentiment: 'positive', category: 'recreation' },
  picnic_table_no: { icon: 'armchair', sentiment: 'negative', category: 'recreation' },

  // ── Accessibility Details ───────────────────────────────────────────────
  handrail_yes: { icon: 'accessibility', sentiment: 'positive', category: 'accessibility' },
  handrail_no: { icon: 'accessibility', sentiment: 'negative', category: 'accessibility' },
  step_count_yes: { icon: 'accessibility', sentiment: 'neutral', category: 'accessibility' },

  // ── Services ────────────────────────────────────────────────────────────
  dispensing_yes: { icon: 'pill', sentiment: 'positive', category: 'services' },
  dispensing_no: { icon: 'pill', sentiment: 'neutral', category: 'services' },
  parcel_pickup_yes: { icon: 'package', sentiment: 'positive', category: 'services' },
  parcel_mail_in_yes: { icon: 'package', sentiment: 'positive', category: 'services' },
  compressed_air_yes: { icon: 'wind', sentiment: 'positive', category: 'services' },

  // ── Cycling ─────────────────────────────────────────────────────────────
  cargo_bike_yes: { icon: 'bike', sentiment: 'positive', category: 'cycling' },
  cargo_bike_no: { icon: 'bike', sentiment: 'negative', category: 'cycling' },

  // ── Automation ───────────────────────────────────────────────────────────
  automated_yes: { icon: 'bot', sentiment: 'neutral', category: 'automation' },
  automated_no: { icon: 'bot', sentiment: 'neutral', category: 'automation' },

  // ── Diet (routed to cuisine section) ─────────────────────────────────────
  'diet:vegan_yes': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:vegan_only': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:vegetarian_yes': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:vegetarian_only': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:halal_yes': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:halal_only': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:kosher_yes': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:kosher_only': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:gluten_free_yes': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:lactose_free_yes': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:pescetarian_yes': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:dairy_free_yes': { icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
} satisfies Record<string, ChipDef>

type ChipKey = keyof typeof CHIP_DEFS

/**
 * Locale key for a chip. The return type is what enforces coverage: if a chip
 * key has no `chips.<key>` entry in en-US, this stops compiling.
 */
function chipLabelKey(key: ChipKey): TranslationKey {
  return `chips.${key}`
}

/**
 * Look up the translated display label for a tag key+value combination.
 * Returns null if no curated chip exists for it.
 */
export function getChipLabel(
  key: string,
  value: string,
  t: TranslateFn,
): string | null {
  const lookupKey = `${key}_${value}`
  if (!(lookupKey in CHIP_DEFS)) return null
  return t(chipLabelKey(lookupKey as ChipKey))
}

// ── Root keys eligible for chip display ───────────────────────────────────────

/** Set of tag root keys that can become chips. */
const CHIP_ROOT_KEYS = new Set([
  'wheelchair', 'tactile_paving',
  'fee',
  'toilets', 'shower', 'changing_table',
  'internet_access',
  'outdoor_seating', 'indoor_seating', 'indoor', 'covered', 'heated', 'lit', 'air_conditioning',
  'smoking',
  'takeaway', 'delivery', 'drive_through',
  'reservation', 'self_service', 'parking',
  'breakfast', 'bar', 'cocktails', 'microbrewery', 'live_music',
  'organic', 'second_hand', 'bulk_purchase',
  'drinking_water',
  'dog', 'pets_allowed', 'kids_area', 'highchair',
  'lgbtq',
  'automated',
])

/** Tags that are always chips even though they contain a colon (not subtags). */
const CHIP_COLON_KEYS = new Set([
  'payment:cash', 'payment:credit_cards', 'payment:debit_cards',
  'payment:contactless', 'payment:apple_pay', 'payment:google_pay',
  'diet:vegan', 'diet:vegetarian', 'diet:halal', 'diet:kosher',
  'diet:gluten_free', 'diet:lactose_free', 'diet:pescetarian', 'diet:dairy_free',
])

// ── Special internet_access handling ─────────────────────────────────────────

/**
 * For `internet_access`, always create a chip from the root tag.
 * If `:fee` subtag exists, merge it into the label (Free Wi-Fi / Paid Wi-Fi).
 * The `:fee` subtag is consumed; other subtags (`:ssid`, `:password`) remain
 * as list items so their details are still visible.
 */
function resolveInternetChip(
  tags: Record<string, string>,
  t: TranslateFn,
): { chip: DisplayChip; consumedKeys: string[] } | null {
  const rootValue = tags['internet_access']
  if (!rootValue) return null

  const feeValue = tags['internet_access:fee']

  // Always consume the root key + :fee (if present)
  const consumedKeys = ['internet_access']
  if (feeValue !== undefined) consumedKeys.push('internet_access:fee')

  // Adjust label based on fee info
  if (rootValue === 'wlan' || rootValue === 'yes') {
    if (feeValue === 'no') {
      return {
        chip: {
          key: 'internet_access',
          value: rootValue,
          label: t('chips.internet_access_free'),
          icon: 'wifi',
          sentiment: 'positive',
          category: 'internet',
        },
        consumedKeys,
      }
    }
    if (feeValue === 'yes') {
      return {
        chip: {
          key: 'internet_access',
          value: rootValue,
          label: t('chips.internet_access_paid'),
          icon: 'wifi',
          sentiment: 'neutral',
          category: 'internet',
        },
        consumedKeys,
      }
    }
    if (feeValue === 'customers') {
      return {
        chip: {
          key: 'internet_access',
          value: rootValue,
          label: t('chips.internet_access_customers'),
          icon: 'wifi',
          sentiment: 'neutral',
          category: 'internet',
        },
        consumedKeys,
      }
    }
  }

  // No fee subtag — use the default chip label
  const lookupKey = `internet_access_${rootValue}`
  const def = CHIP_DEFS[lookupKey as ChipKey]
  if (!def) return null

  return {
    chip: {
      key: 'internet_access',
      value: rootValue,
      label: t(chipLabelKey(lookupKey as ChipKey)),
      ...def,
    },
    consumedKeys,
  }
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export interface ChipResolution {
  chips: DisplayChip[]
  remainingTags: Record<string, string>
}

/**
 * Resolve display chips from raw OSM tags.
 *
 * Returns the list of chips and the remaining tags (with chip keys removed)
 * so the remaining tags can be rendered as list items in the OSM tags widget.
 */
export function resolveDisplayChips(
  tags: Record<string, string>,
  t: TranslateFn,
): ChipResolution {
  const chips: DisplayChip[] = []
  const consumed = new Set<string>()

  // 1. Handle internet_access specially (may merge :fee subtag)
  const internetResult = resolveInternetChip(tags, t)
  if (internetResult) {
    chips.push(internetResult.chip)
    for (const k of internetResult.consumedKeys) consumed.add(k)
  }

  // 2. Handle root-key chips
  // When a chip-eligible tag has subtags, we still create the chip but only
  // consume the root key. Subtags remain as list items for additional detail
  // (e.g. "Restrooms" chip + "Wheelchair: Yes" detail below).
  for (const [key, value] of Object.entries(tags)) {
    if (consumed.has(key)) continue

    if (CHIP_ROOT_KEYS.has(key)) {
      const lookupKey = `${key}_${value}`
      const def = CHIP_DEFS[lookupKey as ChipKey]
      if (def) {
        chips.push({ key, value, label: t(chipLabelKey(lookupKey as ChipKey)), ...def })
        consumed.add(key)
      }
    }
  }

  // 3. Handle colon-key chips (payment:*, diet:*)
  for (const [key, value] of Object.entries(tags)) {
    if (consumed.has(key)) continue

    if (CHIP_COLON_KEYS.has(key)) {
      const lookupKey = `${key}_${value}`
      const def = CHIP_DEFS[lookupKey as ChipKey]
      if (def) {
        chips.push({ key, value, label: t(chipLabelKey(lookupKey as ChipKey)), ...def })
        consumed.add(key)
      }
    }
  }

  // 4. Build remaining tags
  const remainingTags: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags)) {
    if (!consumed.has(key)) {
      remainingTags[key] = value
    }
  }

  return { chips, remainingTags }
}
