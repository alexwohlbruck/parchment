import type { DisplayChip, ChipSentiment, ChipCategory } from '../types/place.types'

// ── Chip definition ──────────────────────────────────────────────────────────

interface ChipDef {
  label: string
  icon: string
  sentiment: ChipSentiment
  section?: 'diet'
  category?: ChipCategory
}

/**
 * Map of `"{key}_{value}"` → chip definition.
 * Keys use the raw OSM tag key; values are the raw OSM tag value.
 */
const CHIP_LABELS: Record<string, ChipDef> = {
  // ── Accessibility ────────────────────────────────────────────────────────
  wheelchair_yes:        { label: 'Accessible',              icon: 'accessibility', sentiment: 'positive', category: 'accessibility' },
  wheelchair_limited:    { label: 'Limited Accessibility',    icon: 'accessibility', sentiment: 'neutral',  category: 'accessibility' },
  wheelchair_designated: { label: 'Designated Accessible',    icon: 'accessibility', sentiment: 'positive', category: 'accessibility' },
  wheelchair_no:         { label: 'Not Accessible',           icon: 'accessibility', sentiment: 'negative', category: 'accessibility' },
  tactile_paving_yes:    { label: 'Tactile Paving',           icon: 'accessibility', sentiment: 'positive', category: 'accessibility' },
  tactile_paving_no:     { label: 'No Tactile Paving',        icon: 'accessibility', sentiment: 'negative', category: 'accessibility' },

  // ── Admission / Cost ─────────────────────────────────────────────────────
  fee_yes:               { label: 'Paid',                      icon: 'dollar-sign',   sentiment: 'neutral',  category: 'cost' },
  fee_no:                { label: 'Free',                      icon: 'dollar-sign',   sentiment: 'positive', category: 'cost' },

  // ── Restrooms ────────────────────────────────────────────────────────────
  toilets_yes:           { label: 'Restrooms',                icon: 'toilet',        sentiment: 'positive', category: 'restrooms' },
  toilets_no:            { label: 'No Restrooms',              icon: 'toilet',        sentiment: 'negative', category: 'restrooms' },
  toilets_customers:     { label: 'Restrooms (Customers)',     icon: 'toilet',        sentiment: 'neutral',  category: 'restrooms' },
  shower_yes:            { label: 'Shower',                    icon: 'shower-head',   sentiment: 'positive', category: 'restrooms' },
  shower_no:             { label: 'No Shower',                 icon: 'shower-head',   sentiment: 'negative', category: 'restrooms' },
  changing_table_yes:    { label: 'Baby Changing',             icon: 'baby',          sentiment: 'positive', category: 'restrooms' },
  changing_table_no:     { label: 'No Baby Changing',          icon: 'baby',          sentiment: 'negative', category: 'restrooms' },

  // ── Internet ─────────────────────────────────────────────────────────────
  internet_access_wlan:     { label: 'Wi-Fi',                 icon: 'wifi',          sentiment: 'positive', category: 'internet' },
  internet_access_yes:      { label: 'Internet',              icon: 'wifi',          sentiment: 'positive', category: 'internet' },
  internet_access_no:       { label: 'No Wi-Fi',              icon: 'wifi',          sentiment: 'negative', category: 'internet' },
  internet_access_terminal: { label: 'Internet Terminal',      icon: 'wifi',          sentiment: 'neutral',  category: 'internet' },
  internet_access_wired:    { label: 'Wired Internet',         icon: 'wifi',          sentiment: 'neutral',  category: 'internet' },

  // ── Seating & Environment ────────────────────────────────────────────────
  outdoor_seating_yes:      { label: 'Outdoor Seating',        icon: 'umbrella',      sentiment: 'positive', category: 'seating' },
  outdoor_seating_no:       { label: 'No Outdoor Seating',     icon: 'umbrella',      sentiment: 'negative', category: 'seating' },
  outdoor_seating_terrace:  { label: 'Terrace',                icon: 'umbrella',      sentiment: 'positive', category: 'seating' },
  outdoor_seating_garden:   { label: 'Garden Seating',         icon: 'umbrella',      sentiment: 'positive', category: 'seating' },
  outdoor_seating_patio:    { label: 'Patio',                  icon: 'umbrella',      sentiment: 'positive', category: 'seating' },
  outdoor_seating_balcony:  { label: 'Balcony',                icon: 'umbrella',      sentiment: 'positive', category: 'seating' },
  outdoor_seating_rooftop:  { label: 'Rooftop',                icon: 'umbrella',      sentiment: 'positive', category: 'seating' },
  outdoor_seating_sidewalk: { label: 'Sidewalk Seating',       icon: 'umbrella',      sentiment: 'positive', category: 'seating' },
  indoor_seating_yes:       { label: 'Indoor Seating',         icon: 'armchair',      sentiment: 'positive', category: 'seating' },
  indoor_seating_no:        { label: 'No Indoor Seating',      icon: 'armchair',      sentiment: 'negative', category: 'seating' },
  indoor_yes:               { label: 'Indoor',                 icon: 'home',          sentiment: 'positive', category: 'seating' },
  indoor_no:                { label: 'Outdoor Only',           icon: 'home',          sentiment: 'neutral',  category: 'seating' },
  covered_yes:              { label: 'Covered',                icon: 'umbrella',      sentiment: 'positive', category: 'seating' },
  covered_no:               { label: 'Uncovered',              icon: 'umbrella',      sentiment: 'negative', category: 'seating' },
  heated_yes:               { label: 'Heated',                 icon: 'flame',         sentiment: 'positive', category: 'seating' },
  heated_no:                { label: 'Not Heated',             icon: 'flame',         sentiment: 'negative', category: 'seating' },
  lit_yes:                  { label: 'Lit',                    icon: 'sun',           sentiment: 'positive', category: 'seating' },
  lit_no:                   { label: 'Unlit',                  icon: 'sun',           sentiment: 'negative', category: 'seating' },
  air_conditioning_yes:     { label: 'AC',                     icon: 'snowflake',     sentiment: 'positive', category: 'seating' },
  air_conditioning_no:      { label: 'No AC',                  icon: 'snowflake',     sentiment: 'negative', category: 'seating' },

  // ── Smoking ──────────────────────────────────────────────────────────────
  smoking_yes:        { label: 'Smoking Allowed',  icon: 'cigarette', sentiment: 'neutral',  category: 'smoking' },
  smoking_no:         { label: 'No Smoking',        icon: 'cigarette', sentiment: 'positive', category: 'smoking' },
  smoking_outside:    { label: 'Smoking Outside',   icon: 'cigarette', sentiment: 'neutral',  category: 'smoking' },
  smoking_separated:  { label: 'Smoking Area',      icon: 'cigarette', sentiment: 'neutral',  category: 'smoking' },
  smoking_isolated:   { label: 'Smoking Area',      icon: 'cigarette', sentiment: 'neutral',  category: 'smoking' },
  smoking_dedicated:  { label: 'Smoking Area',      icon: 'cigarette', sentiment: 'neutral',  category: 'smoking' },

  // ── Food & Drink Service ─────────────────────────────────────────────────
  takeaway_yes:                { label: 'Takeout',                    icon: 'shopping-bag',    sentiment: 'positive', category: 'food_service' },
  takeaway_no:                 { label: 'No Takeout',                 icon: 'shopping-bag',    sentiment: 'negative', category: 'food_service' },
  takeaway_only:               { label: 'Takeout Only',               icon: 'shopping-bag',    sentiment: 'neutral',  category: 'food_service' },
  delivery_yes:                { label: 'Delivery',                   icon: 'shopping-bag',    sentiment: 'positive', category: 'food_service' },
  delivery_no:                 { label: 'No Delivery',                icon: 'shopping-bag',    sentiment: 'negative', category: 'food_service' },
  delivery_only:               { label: 'Delivery Only',              icon: 'shopping-bag',    sentiment: 'neutral',  category: 'food_service' },
  drive_through_yes:           { label: 'Drive-Thru',                 icon: 'shopping-bag',    sentiment: 'positive', category: 'food_service' },
  drive_through_no:            { label: 'No Drive-Thru',              icon: 'shopping-bag',    sentiment: 'negative', category: 'food_service' },
  reservation_yes:             { label: 'Reservations',               icon: 'calendar-check',  sentiment: 'positive', category: 'food_service' },
  reservation_no:              { label: 'Walk-ins Only',              icon: 'calendar-check',  sentiment: 'neutral',  category: 'food_service' },
  reservation_required:        { label: 'Reservations Required',      icon: 'calendar-check',  sentiment: 'neutral',  category: 'food_service' },
  reservation_recommended:     { label: 'Reservations Recommended',   icon: 'calendar-check',  sentiment: 'neutral',  category: 'food_service' },
  self_service_yes:            { label: 'Self Service',               icon: 'hand',            sentiment: 'neutral',  category: 'food_service' },
  self_service_only:           { label: 'Self Service Only',          icon: 'hand',            sentiment: 'neutral',  category: 'food_service' },
  self_service_no:             { label: 'Table Service',              icon: 'hand',            sentiment: 'neutral',  category: 'food_service' },
  breakfast_yes:               { label: 'Breakfast',                  icon: 'coffee',          sentiment: 'positive', category: 'offerings' },
  bar_yes:                     { label: 'Bar',                        icon: 'wine',            sentiment: 'positive', category: 'offerings' },
  cocktails_yes:               { label: 'Cocktails',                  icon: 'wine',            sentiment: 'positive', category: 'offerings' },
  microbrewery_yes:            { label: 'Microbrewery',               icon: 'beer',            sentiment: 'positive', category: 'offerings' },
  live_music_yes:              { label: 'Live Music',                 icon: 'music',           sentiment: 'positive', category: 'offerings' },
  organic_yes:                 { label: 'Organic',                    icon: 'leaf',            sentiment: 'positive', category: 'offerings' },
  organic_only:                { label: 'Organic Only',               icon: 'leaf',            sentiment: 'positive', category: 'offerings' },
  second_hand_yes:             { label: 'Second Hand',                icon: 'recycle',         sentiment: 'neutral',  category: 'offerings' },
  second_hand_only:            { label: 'Second Hand Only',           icon: 'recycle',         sentiment: 'neutral',  category: 'offerings' },
  bulk_purchase_yes:           { label: 'Bulk Purchase',              icon: 'shopping-bag',    sentiment: 'neutral',  category: 'offerings' },

  // ── Water ────────────────────────────────────────────────────────────────
  drinking_water_yes:  { label: 'Drinking Water',     icon: 'droplet', sentiment: 'positive', category: 'water' },
  drinking_water_no:   { label: 'No Drinking Water',  icon: 'droplet', sentiment: 'negative', category: 'water' },

  // ── Pets & Family ────────────────────────────────────────────────────────
  dog_yes:             { label: 'Dog Friendly',    icon: 'dog',       sentiment: 'positive', category: 'family' },
  dog_leashed:         { label: 'Dogs on Leash',   icon: 'dog',       sentiment: 'neutral',  category: 'family' },
  dog_no:              { label: 'No Dogs',          icon: 'dog',       sentiment: 'negative', category: 'family' },
  pets_allowed_yes:    { label: 'Pets Allowed',     icon: 'paw-print', sentiment: 'positive', category: 'family' },
  pets_allowed_no:     { label: 'No Pets',          icon: 'paw-print', sentiment: 'negative', category: 'family' },
  kids_area_yes:       { label: 'Kids Area',        icon: 'baby',      sentiment: 'positive', category: 'family' },
  kids_area_designated:{ label: 'Kids Area',        icon: 'baby',      sentiment: 'positive', category: 'family' },
  kids_area_no:        { label: 'No Kids Area',     icon: 'baby',      sentiment: 'negative', category: 'family' },
  highchair_yes:       { label: 'Highchairs',       icon: 'baby',      sentiment: 'positive', category: 'family' },
  highchair_no:        { label: 'No Highchairs',    icon: 'baby',      sentiment: 'negative', category: 'family' },

  // ── LGBTQ+ ──────────────────────────────────────────────────────────────
  lgbtq_welcome: { label: 'LGBTQ+ Friendly', icon: 'heart', sentiment: 'positive', category: 'lgbtq' },
  lgbtq_primary: { label: 'LGBTQ+ Venue',    icon: 'heart', sentiment: 'positive', category: 'lgbtq' },
  lgbtq_only:    { label: 'LGBTQ+ Only',      icon: 'heart', sentiment: 'positive', category: 'lgbtq' },
  lgbtq_no:      { label: 'Not LGBTQ+ Friendly', icon: 'heart', sentiment: 'negative', category: 'lgbtq' },

  // ── Payment ──────────────────────────────────────────────────────────────
  'payment:cash_yes':          { label: 'Cash',            icon: 'credit-card', sentiment: 'neutral',  category: 'payment' },
  'payment:cash_no':           { label: 'No Cash',         icon: 'credit-card', sentiment: 'neutral',  category: 'payment' },
  'payment:credit_cards_yes':  { label: 'Credit Cards',    icon: 'credit-card', sentiment: 'neutral',  category: 'payment' },
  'payment:credit_cards_no':   { label: 'No Credit Cards', icon: 'credit-card', sentiment: 'negative', category: 'payment' },
  'payment:debit_cards_yes':   { label: 'Debit Cards',     icon: 'credit-card', sentiment: 'neutral',  category: 'payment' },
  'payment:contactless_yes':   { label: 'Contactless',     icon: 'smartphone',  sentiment: 'positive', category: 'payment' },
  'payment:apple_pay_yes':     { label: 'Apple Pay',       icon: 'smartphone',  sentiment: 'positive', category: 'payment' },
  'payment:google_pay_yes':    { label: 'Google Pay',      icon: 'smartphone',  sentiment: 'positive', category: 'payment' },

  // ── Automation ───────────────────────────────────────────────────────────
  automated_yes: { label: 'Automated', icon: 'bot',  sentiment: 'neutral', category: 'automation' },
  automated_no:  { label: 'Staffed',   icon: 'bot',  sentiment: 'neutral', category: 'automation' },

  // ── Diet (routed to cuisine section) ─────────────────────────────────────
  'diet:vegan_yes':       { label: 'Vegan',          icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:vegan_only':      { label: 'Vegan Only',     icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:vegetarian_yes':  { label: 'Vegetarian',     icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:vegetarian_only': { label: 'Vegetarian Only', icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:halal_yes':       { label: 'Halal',          icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:halal_only':      { label: 'Halal Only',     icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:kosher_yes':      { label: 'Kosher',         icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:kosher_only':     { label: 'Kosher Only',    icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:gluten_free_yes': { label: 'Gluten Free',    icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:lactose_free_yes':{ label: 'Lactose Free',   icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:pescetarian_yes': { label: 'Pescetarian',    icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
  'diet:dairy_free_yes':  { label: 'Dairy Free',     icon: 'leaf', sentiment: 'positive', section: 'diet', category: 'diet' },
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
  'reservation', 'self_service',
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
        chip: { key: 'internet_access', value: rootValue, label: 'Free Wi-Fi', icon: 'wifi', sentiment: 'positive', category: 'internet' },
        consumedKeys,
      }
    }
    if (feeValue === 'yes') {
      return {
        chip: { key: 'internet_access', value: rootValue, label: 'Paid Wi-Fi', icon: 'wifi', sentiment: 'neutral', category: 'internet' },
        consumedKeys,
      }
    }
    if (feeValue === 'customers') {
      return {
        chip: { key: 'internet_access', value: rootValue, label: 'Wi-Fi (Customers)', icon: 'wifi', sentiment: 'neutral', category: 'internet' },
        consumedKeys,
      }
    }
  }

  // No fee subtag — use the default chip label
  const lookupKey = `internet_access_${rootValue}`
  const def = CHIP_LABELS[lookupKey]
  if (!def) return null

  return {
    chip: { key: 'internet_access', value: rootValue, ...def },
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
export function resolveDisplayChips(tags: Record<string, string>): ChipResolution {
  const chips: DisplayChip[] = []
  const consumed = new Set<string>()

  // 1. Handle internet_access specially (may merge :fee subtag)
  const internetResult = resolveInternetChip(tags)
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
      const def = CHIP_LABELS[lookupKey]
      if (def) {
        chips.push({ key, value, ...def })
        consumed.add(key)
      }
    }
  }

  // 3. Handle colon-key chips (payment:*, diet:*)
  for (const [key, value] of Object.entries(tags)) {
    if (consumed.has(key)) continue

    if (CHIP_COLON_KEYS.has(key)) {
      const lookupKey = `${key}_${value}`
      const def = CHIP_LABELS[lookupKey]
      if (def) {
        chips.push({ key, value, ...def })
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
