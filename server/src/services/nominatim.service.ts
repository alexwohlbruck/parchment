import axios from 'axios'
import type { Place } from '../types/place.types'
import { transformPlaceForAutocomplete } from './autocomplete.service'
import { AutocompletePrediction } from '../types/place.types'

// Default Nominatim API URL
const NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search'

/**
 * Search for places using Nominatim
 * @param query Search query
 * @param lat Optional latitude for location bias
 * @param lon Optional longitude for location bias
 * @param radius Search radius in meters
 * @returns Array of places matching the search
 */
export const searchNominatim = async (
  query: string,
  lat?: number,
  lon?: number,
  radius: number = 1000,
  nominatimUrl: string = NOMINATIM_API_URL,
): Promise<Place[]> => {
  try {
    console.log(`Searching Nominatim for "${query}"`)

    // Build parameters for the Nominatim search
    const params: Record<string, string> = {
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      extratags: '1',
      namedetails: '1',
      limit: '50',
      dedupe: '1', // Remove duplicates
      'accept-language': 'en', // Prefer English results
    }

    // Add location bias if coordinates are provided
    if (lat && lon) {
      // Nominatim uses the viewbox and bounded parameters for limiting search area
      // Calculate the bounding box based on the radius
      // Approximate conversion: 1 degree of latitude = 111km, 1 degree of longitude = 111km * cos(latitude)
      const latDelta = radius / 111000
      const lonDelta = radius / (111000 * Math.cos((lat * Math.PI) / 180))

      // Set the viewbox in the format: min longitude, min latitude, max longitude, max latitude
      params.viewbox = `${lon - lonDelta},${lat - latDelta},${lon + lonDelta},${
        lat + latDelta
      }`
      params.bounded = '1'
    }

    const response = await axios.get(nominatimUrl, {
      params,
      headers: {
        'User-Agent': 'Parchment/1.0 (https://parchment.app)', // Required by Nominatim ToS
      },
      timeout: 10000, // 10 second timeout
    })

    if (response.status !== 200) {
      throw new Error(
        `Failed to search places with Nominatim (HTTP ${response.status})`,
      )
    }

    // Filter and convert Nominatim results to our Place format
    const transformedResults = response.data
      .map((result: any) => transformNominatimToPlace(result))
      .filter((place: Place) => {
        // Focus on places with names that are likely businesses/POIs
        if (!place.tags?.name) {
          return false
        }

        // Skip certain types of results that aren't useful as places
        const excludedTypes = [
          'boundary',
          'landuse',
          'natural',
          'highway',
          'water',
          'railway',
        ]

        const placeAmenity = place.tags?.amenity
        const placeShop = place.tags?.shop
        const placeTourism = place.tags?.tourism
        const placeLeisure = place.tags?.leisure
        const placeBuilding = place.tags?.building
        const placeOffice = place.tags?.office
        const placeType = place.tags?.['place']

        // Include if it has one of these common place tags
        if (
          placeAmenity ||
          placeShop ||
          placeTourism ||
          placeLeisure ||
          placeOffice
        ) {
          return true
        }

        // Include some specific building types that are likely POIs
        if (
          placeBuilding &&
          ['hotel', 'commercial', 'retail', 'office', 'public'].includes(
            placeBuilding,
          )
        ) {
          return true
        }

        // Include specific place types that are likely POIs
        if (
          placeType &&
          [
            'square',
            'neighbourhood',
            'suburb',
            'quarter',
            'village',
            'town',
          ].includes(placeType)
        ) {
          return true
        }

        // Check if the place has a type that we want to exclude
        for (const excludedType of excludedTypes) {
          if (place.tags?.[excludedType]) {
            return false
          }
        }

        return true
      })

    return transformedResults
  } catch (error: any) {
    console.error(
      'Error searching places with Nominatim:',
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
 * Get place details by OSM ID using Nominatim
 * @param osmId The OSM ID in format type/id (e.g., node/123456)
 * @returns Place details or null if not found
 */
export const getNominatimPlaceDetails = async (
  osmId: string,
  nominatimUrl: string = 'https://nominatim.openstreetmap.org/lookup',
): Promise<any | null> => {
  try {
    console.log(`Getting place details from Nominatim for ID: ${osmId}`)

    // Handle potential prefix like 'node/'
    let osmType: string | null = null
    let osmIdValue: string = osmId

    if (osmId.includes('/')) {
      const parts = osmId.split('/')
      osmType = parts[0]
      osmIdValue = parts[1]
    }

    // Validate OSM type
    if (osmType && !['node', 'way', 'relation'].includes(osmType)) {
      console.error(`Invalid OSM type: ${osmType}`)
      return null
    }

    // Build the query for Nominatim
    const params: Record<string, any> = {
      osm_ids: `${osmType?.charAt(0).toUpperCase() || 'N'}${osmIdValue}`,
      format: 'json',
      addressdetails: 1,
      extratags: 1,
      namedetails: 1,
      'accept-language': 'en',
    }

    console.log(`Calling Nominatim lookup API with params:`, params)

    const response = await axios.get(nominatimUrl, {
      params,
      headers: {
        'User-Agent': 'Parchment/1.0',
      },
    })

    // Nominatim lookup returns an array
    if (
      !response.data ||
      !Array.isArray(response.data) ||
      response.data.length === 0
    ) {
      console.error('No results found from Nominatim lookup')
      return null
    }

    // Transform the Nominatim result to our Place format
    return transformNominatimToPlace(response.data[0])
  } catch (error) {
    console.error('Error getting place details from Nominatim:', error)
    return null
  }
}

/**
 * Transform a Nominatim result to our Place format
 * @param result Nominatim API result
 * @returns Formatted Place object
 */
function transformNominatimToPlace(result: any): Place {
  // Ensure we have a valid result
  if (!result) {
    throw new Error('Nominatim result is null or undefined')
  }

  // Extract and format the place type from OSM
  let osmType = result.osm_type?.toLowerCase() || 'node'
  let osmId = result.osm_id || '0'

  // Create a basic Place object with mandatory fields
  const place: Place = {
    id: `${osmType}/${osmId}`,
    type: osmType as 'node' | 'way' | 'relation',
    tags: {
      name: result.name || result.display_name || '',
    },
    center: {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
    },
  }

  // Add OSM type and class/category information to tags
  if (result.class) {
    place.tags[result.class] = result.type || 'yes'
  }

  if (result.category) {
    place.tags.category = result.category
  }

  if (result.type) {
    place.tags.type = result.type
  }

  // Add name details if available
  if (result.namedetails) {
    for (const [key, value] of Object.entries(result.namedetails)) {
      if (key === 'name') {
        place.tags.name = value as string
      } else if (key.startsWith('name:')) {
        place.tags[key] = value as string
      }
    }
  }

  // Add address information to tags with addr: prefix
  if (result.address) {
    for (const [key, value] of Object.entries(result.address)) {
      place.tags[`addr:${key}`] = value as string
    }
  }

  // Add extra tags directly to tags object
  if (result.extratags) {
    for (const [key, value] of Object.entries(result.extratags)) {
      place.tags[key] = value as string
    }
  }

  // Calculate bounds if available
  if (result.boundingbox && result.boundingbox.length === 4) {
    place.bounds = {
      minlat: parseFloat(result.boundingbox[0]),
      maxlat: parseFloat(result.boundingbox[1]),
      minlon: parseFloat(result.boundingbox[2]),
      maxlon: parseFloat(result.boundingbox[3]),
    }
  }

  // Add importance if available
  if (result.importance) {
    place.tags.importance = result.importance.toString()
  }

  return place
}
