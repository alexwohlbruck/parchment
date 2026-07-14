import { Place } from '@/types/place.types'
import { RouteLocationRaw } from 'vue-router'
import { AppRoute } from '@/router'

/**
 * Parse a place ID string and returns the appropriate route object
 *
 * @param placeId The place ID string (e.g., "osm/node/123456", "google/abc123", "location/name/lat/lng")
 * @returns A route object that can be used with router.push()
 */
export function getPlaceRoute(placeId: string): RouteLocationRaw {
  // Pelias / OpenAddresses geocoder results, e.g.
  // "pelias/openaddresses:address:us/ny/city_of_new_york:7e5bd55eb1baa131".
  // These aren't backed by a retrievable record — the full address is already
  // in the search result (carried into the store via setPartialPlace at click
  // time) — and the embedded '/' and ':' break the naive split() below, which
  // truncated the id to "openaddresses:address:us" and produced a dead URL.
  // Route to the provider view with the whole id after the "pelias/" prefix
  // (vue-router percent-encodes the slashes); Place.vue renders the cached
  // place for the "pelias" provider instead of a nonexistent backend lookup.
  if (placeId.startsWith('pelias/')) {
    return {
      name: AppRoute.PLACE_PROVIDER,
      params: {
        provider: 'pelias',
        placeId: placeId.slice('pelias/'.length),
      },
    }
  }

  // OSM format: "osm/node/123456789"
  if (placeId.startsWith('osm/')) {
    const parts = placeId.substring(4).split('/')
    if (parts.length >= 2) {
      console.log(`Parsed as OSM route: type=${parts[0]}, id=${parts[1]}`)
      return {
        name: AppRoute.PLACE,
        params: {
          type: parts[0],
          id: parts[1],
        },
      }
    }
  }
  // Coordinates format: "coords/35.2271/-80.8431"
  else if (placeId.startsWith('coords/')) {
    const parts = placeId.substring(7).split('/')
    if (parts.length >= 2) {
      console.log(
        `Parsed as coords route: lat=${parts[0]}, lng=${parts[1]}`,
      )
      return {
        name: AppRoute.PLACE_COORDS,
        params: {
          lat: parts[0],
          lng: parts[1],
        },
      }
    }
  }
  // Location format: "location/name/lat/lng"
  else if (placeId.startsWith('location/')) {
    const parts = placeId.substring(9).split('/')
    if (parts.length >= 3) {
      console.log(
        `Parsed as location route: name=${parts[0]}, lat=${parts[1]}, lng=${parts[2]}`,
      )
      return {
        name: AppRoute.PLACE_LOCATION,
        params: {
          name: parts[0],
          lat: parts[1],
          lng: parts[2],
        },
      }
    }
  }
  // Generic provider format: "provider/id". Split on the FIRST slash only —
  // the id portion may itself contain slashes, and destructuring split('/')
  // would silently drop everything after the second segment.
  else if (placeId.includes('/')) {
    const slash = placeId.indexOf('/')
    const provider = placeId.slice(0, slash)
    const id = placeId.slice(slash + 1)
    return {
      name: AppRoute.PLACE_PROVIDER,
      params: {
        provider,
        placeId: id,
      },
    }
  }

  // Fallback for unknown formats - assume it's a Google Place ID
  console.log(`No prefix detected, assuming Google Place ID: "${placeId}"`)
  return {
    name: AppRoute.PLACE_PROVIDER,
    params: {
      provider: 'google',
      placeId,
    },
  }
}

export function formatAddress(place: Place): string {
  if (!place.address) return ''

  const address = place.address.value
  const { street1, street2, locality, postalCode, neighborhood, region } =
    address

  const parts: string[] = []

  // Add street address if available
  const streetParts = [street1, street2].filter(Boolean)
  const hasStreetAddress = streetParts.length > 0
  if (hasStreetAddress) {
    parts.push(streetParts.join(' '))
  }

  // Add neighborhood and locality
  if (neighborhood && locality) {
    parts.push(`${neighborhood}, ${locality}`)
  } else if (neighborhood) {
    parts.push(neighborhood)
    if (locality) parts.push(locality)
  } else if (locality) {
    parts.push(locality)
  }

  // Add postal code if we don't have a street address
  if (postalCode && !hasStreetAddress) {
    parts.push(postalCode)
  }
  // Or add region if we don't have street address or postal code
  else if (region && !hasStreetAddress && !postalCode) {
    parts.push(region)
  }

  return parts.join(', ')
}

export function parseCuisines(cuisine: string | undefined): string[] | null {
  if (!cuisine) return null

  return cuisine
    .split(';')
    .map(c => c.trim())
    .map(c => c.replace(/_/g, ' '))
    .map(c => c.charAt(0).toUpperCase() + c.slice(1))
}

export function getWifiStatus(tags: Record<string, string | undefined>) {
  const access = tags.internet_access
  const ssid = tags['internet_access:ssid']
  const fee = tags['internet_access:fee']
  const password = tags['internet_access:password']

  if (!access || access === 'no') return null

  let label = 'WiFi available'

  if (access === 'free' || fee === 'no') {
    label = 'Free WiFi available'
  } else if (access === 'customers') {
    label = 'WiFi for customers'
  } else if (fee === 'yes') {
    label = 'Paid WiFi available'
  }

  return {
    label,
    ssid,
    password,
  }
}

export function hasOutdoorSeating(
  tags: Record<string, string | undefined>,
): boolean {
  return tags.outdoor_seating === 'yes'
}

export function getWheelchairAccess(
  tags: Record<string, string | undefined>,
): string {
  const wheelchair = tags?.wheelchair || 'unknown'

  switch (wheelchair) {
    case 'yes':
      return 'Wheelchair accessible'
    case 'no':
      return 'Not wheelchair accessible'
    case 'limited':
      return 'Limited wheelchair accessibility'
    case 'designated':
      return 'Designated wheelchair access'
    default:
      return 'Unknown wheelchair accessibility'
  }
}

export function getSmokingStatus(
  tags: Record<string, string | undefined>,
): string {
  const smoking = tags?.smoking || 'unknown'

  switch (smoking) {
    case 'yes':
      return 'Smoking allowed'
    case 'no':
      return 'No smoking'
    case 'separated':
      return 'Separate smoking area'
    case 'isolated':
      return 'Isolated smoking area'
    case 'outside':
      return 'Smoking allowed outside'
    case 'dedicated':
      return 'Dedicated smoking area'
    default:
      return 'Unknown smoking policy'
  }
}

export function getRestroomAccess(
  tags: Record<string, string | undefined>,
): string {
  const toilets = tags?.toilets || 'unknown'

  switch (toilets) {
    case 'yes':
      return 'Restrooms available'
    case 'no':
      return 'No restrooms'
    case 'customers':
      return 'Restrooms for customers only'
    default:
      return 'Unknown restroom availability'
  }
}

