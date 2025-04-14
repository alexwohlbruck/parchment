import { RouteLocationRaw } from 'vue-router'
import { AppRoute } from '@/router'

/**
 * Parse a place ID string and returns the appropriate route object
 *
 * @param placeId The place ID string (e.g., "osm/node/123456", "google/abc123", "location/name/lat/lng")
 * @returns A route object that can be used with router.push()
 */
export function getPlaceRoute(placeId: string): RouteLocationRaw {
  console.log(`getPlaceRoute called with placeId: "${placeId}"`)

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
  // Generic provider format: "provider/id"
  else if (placeId.includes('/')) {
    const [provider, id] = placeId.split('/')
    console.log(`Parsed as provider route: provider=${provider}, placeId=${id}`)
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

/**
 * Create a location-based place ID
 *
 * @param name The name of the place
 * @param lat The latitude
 * @param lng The longitude
 * @returns A location-based place ID string
 */
export function createLocationPlaceId(
  name: string,
  lat: number,
  lng: number,
): string {
  return `location/${encodeURIComponent(name)}/${lat}/${lng}`
}

/**
 * Parse a place ID and extract the provider and ID
 *
 * @param placeId The place ID string
 * @returns An object with provider and id properties
 */
export function parsePlaceId(placeId: string): {
  provider: string
  id: string
} {
  if (placeId.includes('/')) {
    const [provider, ...idParts] = placeId.split('/')
    return {
      provider,
      id: idParts.join('/'), // Join remaining parts in case id contains slashes
    }
  }

  // If no provider specified, assume it's a Google place ID
  return {
    provider: 'google',
    id: placeId,
  }
}
