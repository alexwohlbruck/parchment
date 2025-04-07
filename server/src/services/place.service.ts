import type { Place, GooglePlaceDetails } from '../types/place.types'
import type {
  UnifiedPlace,
  AttributedValue,
  PlaceGeometry,
  Address,
  OpeningHours,
  PlacePhoto,
  SourceReference,
} from '../types/unified-place.types'
import { getPlaceType } from '../lib/place.utils'
import {
  searchGooglePlace,
  GOOGLE_PLACES_API_URL,
  GOOGLE_MAPS_PHOTO_URL,
} from './external-api.service'
import { mergeAttributedValues, selectBestValue } from './merge.service'
import {
  fetchPlaceFromOverpass,
  extractOsmAddress,
  extractOsmContactInfo,
  extractOsmOpeningHours,
  extractOsmAmenities,
} from './osm.service'
import { fetchWikidataImage, fetchWikidataBrandLogo } from './wikidata.service'
import { parseGoogleHours, parseOsmHours } from '../lib/hours.utils'
import { googleAdapter } from '../adapters/google-adapter'
import type { PlaceDataAdapter } from '../types/adapter.types'

const API_CONFIG = {
  useGooglePlaces: true,
  useWikidata: true,
} as const

const osmAdapter: PlaceDataAdapter = {
  sourceId: 'osm',
  sourceName: 'OpenStreetMap',
  sourceUrl: (place: Place) =>
    `https://www.openstreetmap.org/${place.type}/${place.id}`,
  transform: (place: Place) => {
    if (!place.tags) return {}

    const address = extractOsmAddress(place.tags)
    const contactInfo = extractOsmContactInfo(place.tags)
    const openingHours = parseOsmHours(place.tags)
    const amenities = extractOsmAmenities(place.tags)

    return {
      ...(address && {
        address: {
          value: address,
          sourceId: 'osm',
        },
      }),
      contactInfo: {
        phone: contactInfo.phone.map((phone) => ({
          value: phone,
          sourceId: 'osm',
          timestamp: new Date().toISOString(),
        })),
        email: contactInfo.email.map((email) => ({
          value: email,
          sourceId: 'osm',
          timestamp: new Date().toISOString(),
        })),
        website: contactInfo.website.map((website) => ({
          value: website,
          sourceId: 'osm',
          timestamp: new Date().toISOString(),
        })),
      },
      ...(openingHours && {
        openingHours: {
          value: openingHours,
          sourceId: 'osm',
        },
      }),
      amenities: Object.entries(amenities).reduce(
        (acc, [key, value]) => ({
          ...acc,
          [key]: [
            {
              value,
              sourceId: 'osm',
            },
          ],
        }),
        {},
      ),
    }
  },
}

function mergePlaceData(
  unifiedPlace: UnifiedPlace,
  adapter: PlaceDataAdapter,
  data: any,
) {
  if (!data) return

  const transformed = adapter.transform(data)

  // Add Google Maps place ID to externalIds if it exists
  if (adapter.sourceId === 'google' && data.place_id) {
    unifiedPlace.externalIds.google = data.place_id
  }

  // For name, use OSM as primary, Google as backup
  if (transformed.name) {
    if (!unifiedPlace.name || adapter.sourceId === 'osm') {
      unifiedPlace.name = transformed.name.value
    }
  }

  // For address, use OSM as primary, Google as backup
  if (transformed.address) {
    // If we don't have an address yet, or if the current address is empty (no fields set), use this one
    if (
      !unifiedPlace.address ||
      !unifiedPlace.address.formatted ||
      unifiedPlace.address.formatted.trim() === '' ||
      adapter.sourceId === 'osm'
    ) {
      unifiedPlace.address = transformed.address.value
    }
  }

  // For contact info, use OSM as primary, Google as backup for each field
  if (transformed.contactInfo) {
    const { phone, email, website } = transformed.contactInfo

    if (phone) {
      if (!unifiedPlace.contactInfo.phone || adapter.sourceId === 'osm') {
        unifiedPlace.contactInfo.phone = phone
      }
    }

    if (email) {
      if (!unifiedPlace.contactInfo.email || adapter.sourceId === 'osm') {
        unifiedPlace.contactInfo.email = email
      }
    }

    if (website) {
      if (!unifiedPlace.contactInfo.website || adapter.sourceId === 'osm') {
        unifiedPlace.contactInfo.website = website
      }
    }
  }

  if (transformed.openingHours) {
    if (
      !unifiedPlace.openingHours ||
      !unifiedPlace.openingHours.regularHours?.length ||
      adapter.sourceId === 'osm'
    ) {
      unifiedPlace.openingHours = transformed.openingHours.value
    }
  }

  if (transformed.photos) {
    unifiedPlace.photos.push(...transformed.photos)
  }

  if (transformed.ratings) {
    unifiedPlace.ratings = {
      ...unifiedPlace.ratings,
      ...transformed.ratings,
    }
  }

  if (transformed.amenities) {
    Object.entries(transformed.amenities).forEach(([key, values]) => {
      const value = values[0]?.value
      if (value !== undefined) {
        if (!unifiedPlace.amenities[key] || adapter.sourceId === 'osm') {
          unifiedPlace.amenities[key] = value
        }
      }
    })
  }

  unifiedPlace.sources.push({
    id: adapter.sourceId,
    name: adapter.sourceName,
    url: adapter.sourceUrl(data),
    updated: new Date().toISOString(),
  })
}

function createBaseUnifiedPlace(
  place: Place,
  name: string,
  placeType: string,
): UnifiedPlace {
  return {
    id: `${place.type}/${place.id}`,
    externalIds: { osm: place.id.toString() },
    name: name,
    placeType: placeType,
    geometry: createGeometry(place),
    photos: [],
    address: null,
    contactInfo: {
      phone: null,
      email: null,
      website: null,
      socials: {},
    },
    openingHours: null,
    amenities: {},
    sources: [],
    lastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }
}

function createGeometry(place: Place): PlaceGeometry {
  return {
    type: place.type === 'node' ? 'point' : 'polygon',
    center: {
      lat: place.center!.lat,
      lng: place.center!.lon,
    },
    ...(place.bounds && {
      bounds: {
        minLat: place.bounds.minlat,
        minLng: place.bounds.minlon,
        maxLat: place.bounds.maxlat,
        maxLng: place.bounds.maxlon,
      },
    }),
    ...(place.geometry && {
      nodes: place.geometry.map((node) => ({
        lat: node.lat,
        lng: node.lon,
      })),
    }),
  }
}

async function fetchExternalData(
  name: string,
  center: { lat: number; lon: number },
  place: Place,
) {
  const promises: Promise<any>[] = []

  if (API_CONFIG.useGooglePlaces) {
    promises.push(searchGooglePlace(name, center.lat, center.lon, place))
  }

  if (API_CONFIG.useWikidata) {
    const wikidataId = place.tags?.wikidata || place.tags?.['brand:wikidata']
    promises.push(
      Promise.all([
        fetchWikidataImage(wikidataId),
        fetchWikidataBrandLogo(wikidataId),
      ]),
    )
  }

  return Promise.all(promises)
}

export const getPlaceDetails = async (
  type: 'node' | 'way' | 'relation',
  id: string,
): Promise<UnifiedPlace | null> => {
  try {
    console.log(`Fetching place details for ${type}/${id}`)
    const place = await fetchPlaceFromOverpass(type, id)

    if (!place) {
      console.error('Could not fetch place from Overpass')
      return null
    }

    console.log('Raw place data:', JSON.stringify(place, null, 2))

    if (!place.center) {
      console.error('Place data missing center coordinates:', place)
      return null
    }

    const name = place.tags?.name || place.tags?.['brand:name'] || ''
    const placeType = getPlaceType(place.tags || {})
    const unifiedPlace = createBaseUnifiedPlace(place, name, placeType)

    mergePlaceData(unifiedPlace, osmAdapter, place)

    const externalData = await fetchExternalData(name, place.center, place)
    let currentIndex = 0

    if (API_CONFIG.useGooglePlaces) {
      const googleData = externalData[currentIndex] as GooglePlaceDetails | null
      if (googleData) {
        mergePlaceData(unifiedPlace, googleAdapter, googleData)
      }
      currentIndex++
    }

    if (API_CONFIG.useWikidata) {
      const [image, logo] = externalData[currentIndex] as [
        string | null,
        string | null,
      ]
      if (image) {
        unifiedPlace.photos.push({
          url: image,
          sourceId: 'wikidata',
          isPrimary: true,
        })
      }
      if (logo) {
        unifiedPlace.photos.push({
          url: logo,
          sourceId: 'wikidata',
          isLogo: true,
        })
      }
    }

    return unifiedPlace
  } catch (error) {
    console.error('Error getting place details:', error)
    return null
  }
}
