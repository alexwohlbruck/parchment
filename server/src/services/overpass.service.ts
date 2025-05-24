import axios from 'axios'
import type { Place } from '../types/place.types'
import { transformPlaceForAutocomplete } from './autocomplete.service'
import { AutocompletePrediction } from '../types/place.types'

// Default Overpass API URL
const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

/**
 * Build a query for fetching a place by ID from Overpass API
 * @param id The OSM ID in format type/id (e.g., node/123456)
 * @returns Overpass QL query string
 */
export const buildOverpassQuery = (id: string): string => {
  const [type, rawId] = id.includes('/') ? id.split('/') : [null, id]
  return `[out:json][timeout:60];
    ${type}(${rawId});
    out body geom meta;
    >;
    out body meta;`
}

/**
 * Build a query for searching places by name and location from Overpass API
 * @param query Search query string
 * @param lat Optional latitude for location bias
 * @param lon Optional longitude for location bias
 * @param radius Search radius in meters
 * @returns Overpass QL query string
 */
export const buildOverpassSearchQuery = (
  query: string,
  lat?: number,
  lon?: number,
  radius: number = 1000,
): string => {
  // Clean the query by removing special characters and quotes
  const cleanQuery = query.replace(/["']/g, '').trim()

  // If we have coordinates, search within the given radius
  const locationFilter =
    lat && lon ? `around:${radius},${lat},${lon}` : 'global'

  return `[out:json][timeout:90];
    (
      // Search by name
      node["name"~"${cleanQuery}", i](${locationFilter});
      way["name"~"${cleanQuery}", i](${locationFilter});
      relation["name"~"${cleanQuery}", i](${locationFilter});
      
      // Search by brand name
      node["brand:name"~"${cleanQuery}", i](${locationFilter});
      way["brand:name"~"${cleanQuery}", i](${locationFilter});
      relation["brand:name"~"${cleanQuery}", i](${locationFilter});
      
      // Search by operator name
      node["operator"~"${cleanQuery}", i](${locationFilter});
      way["operator"~"${cleanQuery}", i](${locationFilter});
      relation["operator"~"${cleanQuery}", i](${locationFilter});
    );
    out body geom meta;
    >;
    out body meta qt;`
}

/**
 * Calculate the center point of a place
 * @param place OSM place object
 * @returns Center coordinates or undefined if not determinable
 */
export const calculatePlaceCenter = (place: Place): Place['center'] => {
  // If the API provides a center, use it
  if (place.center) {
    return place.center
  }

  // For nodes, use their coordinates
  if (place.type === 'node' && place.lat && place.lon) {
    return { lat: place.lat, lon: place.lon }
  }

  // For ways and relations with geometry, calculate centroid
  if (place.geometry && place.geometry.length > 0) {
    let sumLat = 0
    let sumLon = 0
    const nodes = place.geometry

    for (const node of nodes) {
      sumLat += node.lat
      sumLon += node.lon
    }

    return {
      lat: sumLat / nodes.length,
      lon: sumLon / nodes.length,
    }
  }

  // For ways and relations with bounds but no geometry, use bounds center
  if (place.bounds) {
    return {
      lat: (place.bounds.minlat + place.bounds.maxlat) / 2,
      lon: (place.bounds.minlon + place.bounds.maxlon) / 2,
    }
  }

  return undefined
}

/**
 * Fetch a place from Overpass API by its OSM ID
 * @param id The OSM ID in format type/id (e.g., node/123456)
 * @param overpassUrl Optional custom Overpass API URL
 * @returns Place object or null if not found
 */
export const fetchPlaceFromOverpass = async (
  id: string,
  overpassUrl: string = OVERPASS_API_URL,
): Promise<Place | null> => {
  try {
    const query = buildOverpassQuery(id)

    console.log('Fetching OSM place by ID:', id)
    const response = await axios.post(overpassUrl, query, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.data.elements || response.data.elements.length === 0) {
      console.error('No place found with ID:', id)
      return null
    }

    // The first element should be our place
    const place = response.data.elements[0] as Place
    const center = calculatePlaceCenter(place)
    if (center) {
      place.center = center
    }

    return place
  } catch (error: any) {
    console.error('Error fetching place from Overpass:', error.message || error)
    if (axios.isAxiosError(error) && error.response) {
      console.error('Response status:', error.response.status)
      console.error(
        'Response data:',
        JSON.stringify(error.response?.data, null, 2),
      )
    }
    return null
  }
}

/**
 * Search for places matching a query using Overpass API
 * @param query Search query
 * @param lat Optional latitude for location bias
 * @param lon Optional longitude for location bias
 * @param radius Search radius in meters
 * @param overpassUrl Optional custom Overpass API URL
 * @returns Array of places matching the search
 */
export const searchOverpass = async (
  query: string,
  lat?: number,
  lon?: number,
  radius: number = 1000,
  overpassUrl: string = OVERPASS_API_URL,
): Promise<Place[]> => {
  try {
    console.log(`Searching Overpass for "${query}"`)

    const overpassQuery = buildOverpassSearchQuery(query, lat, lon, radius)

    const response = await axios.post(overpassUrl, overpassQuery, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.data.elements) {
      console.log('No results found')
      return []
    }

    // Filter out non-place results and ensure all places have a center
    const places = response.data.elements
      .filter((element: any) => {
        // Keep only elements with a name tag
        return (
          element.tags &&
          (element.tags.name ||
            element.tags['brand:name'] ||
            element.tags.operator)
        )
      })
      .map((element: any) => {
        // Add center if not already present
        if (!element.center) {
          const center = calculatePlaceCenter(element)
          if (center) {
            element.center = center
          }
        }
        return element as Place
      })

    console.log(`Found ${places.length} places matching "${query}"`)
    return places
  } catch (error: any) {
    console.error(
      'Error searching places with Overpass:',
      error.message || error,
    )
    if (axios.isAxiosError(error) && error.response) {
      console.error('Response status:', error.response.status)
      console.error(
        'Response data:',
        JSON.stringify(error.response?.data, null, 2),
      )
    }
    return []
  }
}

/**
 * Get autocomplete predictions from Overpass API
 * @param query Search query
 * @param lat Optional latitude for location bias
 * @param lon Optional longitude for location bias
 * @param radius Search radius in meters
 * @param overpassUrl Optional custom Overpass API URL
 * @returns Array of autocomplete predictions
 */
export const getOverpassAutocomplete = async (
  query: string,
  lat?: number,
  lon?: number,
  radius: number = 10000,
  overpassUrl: string = OVERPASS_API_URL,
): Promise<AutocompletePrediction[]> => {
  try {
    // Use the searchOverpass function to get place results
    const places = await searchOverpass(query, lat, lon, radius, overpassUrl)

    // Convert places to autocomplete prediction format
    return places.map((place) =>
      transformPlaceForAutocomplete(place, 'overpass'),
    )
  } catch (error) {
    console.error('Error getting Overpass autocomplete predictions:', error)
    return []
  }
}
