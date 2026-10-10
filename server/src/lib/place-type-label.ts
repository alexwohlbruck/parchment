/**
 * What kind of place a country, state, county, city, neighbourhood or postal
 * code is: "County", not "Area".
 *
 * The iD presets that name every other place type have nothing for these.
 * There is no `place/country`, `place/state` or `place/county` preset, so they
 * matched the catch-all `place=*` ("Place"); and `boundary=administrative` has
 * presets only for lines and relations, so a boundary polygon fell through to
 * the generic "Area". Pelias rows carry no OSM tags at all beyond the address
 * barrelman lends them, which made a postal code an "Address".
 *
 * Labels resolve to i18n keys under `placeType.*`, like transit-mode-label.ts.
 */

import { DEFAULT_LANGUAGE, type Language } from './i18n'
import { translate } from './i18n/translate'

type PlaceTypeKey =
  | 'country' | 'state' | 'province' | 'region' | 'county' | 'city' | 'town'
  | 'village' | 'municipality' | 'borough' | 'district' | 'township'
  | 'neighborhood' | 'hamlet' | 'postalCode'

/** `place=*` values that name a settlement or division. The rest (island,
 *  square, locality, farm) are left to their presets. */
const PLACE: Record<string, PlaceTypeKey> = {
  country: 'country',
  state: 'state',
  province: 'province',
  region: 'region',
  county: 'county',
  city: 'city',
  town: 'town',
  village: 'village',
  municipality: 'municipality',
  borough: 'borough',
  district: 'district',
  suburb: 'neighborhood',
  quarter: 'neighborhood',
  neighbourhood: 'neighborhood',
  hamlet: 'hamlet',
}

/** `border_type`, which US boundaries carry and which says what admin_level
 *  can't: an admin_level=8 is a city, a town or a village. */
const BORDER_TYPE: Record<string, PlaceTypeKey> = {
  nation: 'country',
  country: 'country',
  state: 'state',
  province: 'province',
  region: 'region',
  county: 'county',
  parish: 'county',
  city: 'city',
  town: 'town',
  village: 'village',
  municipality: 'municipality',
  borough: 'borough',
  district: 'district',
  township: 'township',
}

/** admin_level, when nothing more specific is tagged. Its meaning varies by
 *  country, so these are the broadest words that hold for most of them. */
function adminLevelKey(level: number): PlaceTypeKey | null {
  if (level === 2) return 'country'
  if (level === 3 || level === 5) return 'region'
  if (level === 4) return 'state'
  if (level === 6) return 'county'
  if (level === 7) return 'district'
  if (level === 8) return 'municipality'
  if (level >= 9 && level <= 11) return 'neighborhood'
  return null
}

/** Pelias (Who's on First) layers that are places rather than addresses. */
const PELIAS_LAYER: Record<string, PlaceTypeKey> = {
  postalcode: 'postalCode',
  country: 'country',
  dependency: 'country',
  macroregion: 'region',
  region: 'state',
  macrocounty: 'region',
  county: 'county',
  localadmin: 'municipality',
  locality: 'city',
  borough: 'borough',
  macrohood: 'neighborhood',
  neighbourhood: 'neighborhood',
}

function placeTypeKey(tags: Record<string, string>): PlaceTypeKey | null {
  if (tags.boundary === 'postal_code') return 'postalCode'
  const place = PLACE[tags.place]
  if (place) return place
  if (tags.boundary !== 'administrative') return null
  return BORDER_TYPE[tags.border_type] ?? adminLevelKey(Number(tags.admin_level))
}

/**
 * The label for a country, state, county, city, neighbourhood or postal code,
 * or null for anything else — which then takes its iD preset name.
 */
export function placeTypeLabel(
  tags: Record<string, string>,
  language: Language = DEFAULT_LANGUAGE,
): string | null {
  const key = placeTypeKey(tags)
  return key ? translate(language)(`placeType.${key}`) : null
}

/** The label for a Pelias layer, or null for addresses, streets and venues. */
export function peliasLayerLabel(
  layer: string | null | undefined,
  language: Language = DEFAULT_LANGUAGE,
): string | null {
  const key = layer ? PELIAS_LAYER[layer] : undefined
  return key ? translate(language)(`placeType.${key}`) : null
}
