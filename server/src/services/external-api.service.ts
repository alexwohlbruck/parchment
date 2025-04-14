import axios from 'axios'
import type { GooglePlaceDetails } from '../types/place.types'
import type { Place } from '../types/place.types'
import * as turf from '@turf/turf'

// Define the structure of Google Places API response
interface GooglePlaceApiResponse {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  types?: string[]
  photos?: Array<{
    name: string
    heightPx?: number
    widthPx?: number
  }>
  rating?: number
  userRatingCount?: number
  googleMapsUri?: string
  priceLevel?: string
  businessStatus?: string
  editorialSummary?: {
    languageCode?: string
    text?: string
    overview?: string
  }
  location?: {
    latitude: number
    longitude: number
  }
  dineIn?: boolean
  takeout?: boolean
  delivery?: boolean
  curbsidePickup?: boolean
  servesBreakfast?: boolean
  servesLunch?: boolean
  servesDinner?: boolean
  servesBeer?: boolean
  servesVegetarianFood?: boolean
  servesCocktails?: boolean
  servesCoffee?: boolean
  outdoorSeating?: boolean
  liveMusic?: boolean
  goodForChildren?: boolean
  goodForGroups?: boolean
  restroom?: boolean
  regularOpeningHours?: {
    openNow?: boolean
    periods?: Array<{
      open: { day: number; time: string }
      close: { day: number; time: string }
    }>
    weekdayDescriptions?: string[]
  }
  utcOffsetMinutes?: number
}

// Google API constants
export const GOOGLE_MAPS_PHOTO_URL =
  'https://maps.googleapis.com/maps/api/place/photo'
export const GOOGLE_PLACES_API_URL = 'https://places.googleapis.com/v1/places'
const DEFAULT_SEARCH_RADIUS = 500 // meters

// Interface for autocomplete prediction results
export interface AutocompletePrediction {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  types: string[]
}

function calculateSearchRadius(place: Place): number {
  // For points (nodes), use default radius
  if (place.type === 'node' || !place.bounds) {
    return DEFAULT_SEARCH_RADIUS
  }

  // For areas (ways/relations), calculate the diagonal distance of the bounding box
  // Calculate the area's diagonal distance using the southwest and northeast corners
  const sw = turf.point([place.bounds.minlon, place.bounds.minlat])
  const ne = turf.point([place.bounds.maxlon, place.bounds.maxlat])
  const diagonalDistance = turf.distance(sw, ne, { units: 'meters' })

  // Use half the diagonal distance plus the default radius as search radius
  // This ensures we cover the entire area plus a buffer
  return diagonalDistance / 2 + DEFAULT_SEARCH_RADIUS
}

// Search for a single place that matches an OSM place
export async function searchGooglePlace(
  name: string,
  lat: number,
  lon: number,
  osmPlace: Place,
): Promise<GooglePlaceDetails | null> {
  try {
    const searchRadius = calculateSearchRadius(osmPlace)
    console.log(`Searching for "${name}" with radius ${searchRadius}m`)

    // Search for the place with calculated radius
    const searchResponse = await axios.post(
      `${GOOGLE_PLACES_API_URL}:searchText`,
      {
        textQuery: name,
        locationBias: {
          circle: {
            center: {
              latitude: lat,
              longitude: lon,
            },
            radius: searchRadius,
          },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.types,places.photos,places.rating,places.userRatingCount,places.googleMapsUri,places.priceLevel,places.businessStatus,places.editorialSummary,places.location,places.dineIn,places.takeout,places.delivery,places.curbsidePickup,places.servesBreakfast,places.servesLunch,places.servesDinner,places.servesBeer,places.servesVegetarianFood,places.servesCocktails,places.servesCoffee,places.outdoorSeating,places.liveMusic,places.goodForChildren,places.goodForGroups,places.restroom,places.regularOpeningHours,places.utcOffsetMinutes',
        },
      },
    )

    if (!searchResponse.data.places?.length) {
      return null
    }

    // Get the first result's coordinates
    const place = searchResponse.data.places[0] as GooglePlaceApiResponse
    const resultLat = place.location?.latitude
    const resultLng = place.location?.longitude

    // If location is missing, don't use this result
    if (!resultLat || !resultLng) {
      return null
    }

    // Calculate distance using Turf.js
    const from = turf.point([lon, lat])
    const to = turf.point([resultLng, resultLat])
    const distance = turf.distance(from, to, { units: 'meters' })

    // Only return the result if it's within the calculated search radius
    if (distance <= searchRadius) {
      return transformGooglePlace(place)
    }

    return null
  } catch (error) {
    console.error('Error fetching Google Places data:', error)
    return null
  }
}

// Search for multiple places based on query and location
export async function searchGooglePlaces(
  query: string,
  lat: number,
  lng: number,
  radius: number = 1000,
): Promise<GooglePlaceDetails[]> {
  try {
    console.log(`Searching Google Places for "${query}" with radius ${radius}m`)

    // Search for places matching the query
    const searchResponse = await axios.post(
      `${GOOGLE_PLACES_API_URL}:searchText`,
      {
        textQuery: query,
        locationBias: {
          circle: {
            center: {
              latitude: lat,
              longitude: lng,
            },
            radius: radius,
          },
        },
        maxResultCount: 20,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.types,places.photos,places.rating,places.userRatingCount,places.googleMapsUri,places.priceLevel,places.businessStatus,places.editorialSummary,places.location,places.dineIn,places.takeout,places.delivery,places.curbsidePickup,places.servesBreakfast,places.servesLunch,places.servesDinner,places.servesBeer,places.servesVegetarianFood,places.servesCocktails,places.servesCoffee,places.outdoorSeating,places.liveMusic,places.goodForChildren,places.goodForGroups,places.restroom,places.regularOpeningHours,places.utcOffsetMinutes',
        },
      },
    )

    if (!searchResponse.data.places?.length) {
      return []
    }

    // Transform all results
    return searchResponse.data.places.map((place: GooglePlaceApiResponse) =>
      transformGooglePlace(place),
    )
  } catch (error) {
    console.error('Error searching Google Places:', error)
    return []
  }
}

function transformGooglePlace(
  place: GooglePlaceApiResponse,
): GooglePlaceDetails {
  // Log raw photo data
  if (place.photos?.length) {
    console.log(
      'Raw photo data from Google Places API:',
      JSON.stringify(place.photos, null, 2),
    )
  }

  // Log editorial summary data if available for debugging
  if (place.editorialSummary) {
    console.log(
      'Editorial summary from Google Places API:',
      JSON.stringify(place.editorialSummary, null, 2),
    )
  }

  return {
    place_id: place.id,
    name: place.displayName?.text || '',
    formatted_address: place.formattedAddress || '',
    formatted_phone_number: place.internationalPhoneNumber || '',
    website: place.websiteUri || '',
    types: place.types || [],
    photos:
      place.photos?.map((photo) => ({
        photo_reference: photo.name,
        height: photo.heightPx || 0,
        width: photo.widthPx || 0,
        html_attributions: [],
      })) || [],
    rating: place.rating || 0,
    user_ratings_total: place.userRatingCount || 0,
    google_maps_uri: place.googleMapsUri || '',
    price_level: place.priceLevel || '',
    business_status: place.businessStatus || '',
    editorial_summary: place.editorialSummary
      ? {
          language: place.editorialSummary.languageCode || undefined,
          overview:
            place.editorialSummary.text ||
            place.editorialSummary.overview ||
            '',
        }
      : undefined,
    // Add location/geometry information
    geometry: place.location
      ? {
          location: {
            lat: place.location.latitude,
            lng: place.location.longitude,
          },
        }
      : undefined,
    dine_in: place.dineIn || false,
    takeout: place.takeout || false,
    delivery: place.delivery || false,
    curbside_pickup: place.curbsidePickup || false,
    serves_breakfast: place.servesBreakfast || false,
    serves_lunch: place.servesLunch || false,
    serves_dinner: place.servesDinner || false,
    serves_beer: place.servesBeer || false,
    serves_vegetarian: place.servesVegetarianFood || false,
    serves_cocktails: place.servesCocktails || false,
    serves_coffee: place.servesCoffee || false,
    outdoor_seating: place.outdoorSeating || false,
    live_music: place.liveMusic || false,
    good_for_children: place.goodForChildren || false,
    good_for_groups: place.goodForGroups || false,
    restroom: place.restroom || false,
    opening_hours: place.regularOpeningHours
      ? {
          open_now: place.regularOpeningHours.openNow || false,
          periods: place.regularOpeningHours.periods || [],
          weekday_text: place.regularOpeningHours.weekdayDescriptions || [],
        }
      : undefined,
    utc_offset: place.utcOffsetMinutes || 0,
  }
}

// Autocomplete suggestions from Google Places
export async function getGooglePlacesAutocomplete(
  query: string,
  lat?: number,
  lng?: number,
  radius: number = 10000, // Wider radius for autocomplete
): Promise<AutocompletePrediction[]> {
  try {
    if (!query || query.length < 2) {
      return []
    }

    console.log(`Getting autocomplete suggestions for "${query}"`)
    console.log(
      `API key configured: ${process.env.GOOGLE_MAPS_API_KEY ? 'Yes' : 'No'}`,
    )

    // Build the autocomplete request
    const request: any = {
      textQuery: query,
      languageCode: 'en', // English results
      maxResultCount: 5, // Limit to top 5 for better performance
    }

    // Add location bias if coordinates are provided
    if (lat && lng) {
      request.locationBias = {
        circle: {
          center: {
            latitude: lat,
            longitude: lng,
          },
          radius: radius,
        },
      }
      console.log(
        `Using location bias: lat=${lat}, lng=${lng}, radius=${radius}m`,
      )
    }

    // Log the full request for debugging
    console.log('Request payload:', JSON.stringify(request, null, 2))

    const response = await axios.post(
      `${GOOGLE_PLACES_API_URL}:searchText`,
      request,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.types,places.location',
        },
      },
    )

    // Log the raw response for debugging
    console.log('Response status:', response.status)
    console.log('Response data structure:', Object.keys(response.data))
    console.log('Places returned:', response.data.places?.length || 0)

    if (!response.data.places || response.data.places.length === 0) {
      console.log('No places found in the response')
      return []
    }

    // Debug first result
    if (response.data.places.length > 0) {
      console.log(
        'First result:',
        JSON.stringify(response.data.places[0], null, 2),
      )
    }

    // Transform the response into our simplified format
    const predictions = response.data.places.map((place: any) => ({
      placeId: place.id,
      description: `${place.displayName?.text || ''}, ${
        place.formattedAddress || ''
      }`,
      mainText: place.displayName?.text || '',
      secondaryText: place.formattedAddress || '',
      types: place.types || [],
      // We can't get distanceMeters from the API, remove it
    }))

    console.log(`Returning ${predictions.length} autocomplete suggestions`)
    return predictions
  } catch (error) {
    console.error(
      'Error getting Google Places autocomplete suggestions:',
      error,
    )
    if (axios.isAxiosError(error) && error.response) {
      console.error('Response status:', error.response.status)
      console.error('Response data:', error.response.data)
    }
    return []
  }
}
