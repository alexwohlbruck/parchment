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
import {
  mergeAttributedValues,
  selectBestValue,
  getTimestamp,
} from './merge.service'
import { fetchPlaceFromOverpass } from './osm.service'
import { fetchWikidataImage, fetchWikidataBrandLogo } from './wikidata.service'
import { parseGoogleHours, parseOsmHours } from '../lib/hours.utils'
import { googleAdapter } from '../adapters/google-adapter'
import type { PlaceDataAdapter } from '../types/adapter.types'
import { API_CONFIG, SOURCE } from '../lib/constants'
import { osmAdapter } from '../adapters/osm-adapter'

function mergePlaceData(
  unifiedPlace: UnifiedPlace,
  adapter: PlaceDataAdapter,
  data: any,
) {
  if (!data) return

  try {
    const transformed = adapter.transform(data)

    // Use the timestamp from the source data if available (for OSM)
    // otherwise use the current timestamp
    const timestamp =
      adapter.sourceId === SOURCE.OSM && data.timestamp
        ? data.timestamp
        : getTimestamp()

    // Add source ID to externalIds if it exists
    if (adapter.sourceId === SOURCE.GOOGLE && 'place_id' in data) {
      unifiedPlace.externalIds[adapter.sourceId] = data.place_id
    } else if (adapter.sourceId === SOURCE.OSM && 'id' in data) {
      unifiedPlace.externalIds[adapter.sourceId] = data.id.toString()
    }

    // Name
    if (transformed.name) {
      unifiedPlace.name =
        selectBestValue([
          ...(unifiedPlace.name
            ? [{ value: unifiedPlace.name, sourceId: 'existing', timestamp }]
            : []),
          transformed.name,
        ]) ||
        unifiedPlace.name ||
        ''
    }

    // Address
    if (transformed.address) {
      // If we don't have an address yet, or if OSM provides an address, use it
      if (
        !unifiedPlace.address ||
        !unifiedPlace.address.formatted ||
        adapter.sourceId === SOURCE.OSM
      ) {
        unifiedPlace.address = transformed.address.value
      }
    }

    // Contact Info
    if (transformed.contactInfo) {
      const { phone, email, website, socials } = transformed.contactInfo

      // Handle phone number
      if (
        phone &&
        (!unifiedPlace.contactInfo.phone || adapter.sourceId === SOURCE.OSM)
      ) {
        unifiedPlace.contactInfo.phone = phone
      }

      // Handle email
      if (
        email &&
        (!unifiedPlace.contactInfo.email || adapter.sourceId === SOURCE.OSM)
      ) {
        unifiedPlace.contactInfo.email = email
      }

      // Handle website
      if (
        website &&
        (!unifiedPlace.contactInfo.website || adapter.sourceId === SOURCE.OSM)
      ) {
        unifiedPlace.contactInfo.website = website
      }

      // Handle social media links
      if (socials && Object.keys(socials).length > 0) {
        // Merge social media links
        Object.entries(socials).forEach(([platform, value]) => {
          if (
            !unifiedPlace.contactInfo.socials[platform] ||
            adapter.sourceId === SOURCE.OSM
          ) {
            unifiedPlace.contactInfo.socials[platform] = value
          }
        })
      }
    }

    // Opening Hours
    if (transformed.openingHours) {
      if (
        !unifiedPlace.openingHours ||
        !unifiedPlace.openingHours.regularHours?.length ||
        adapter.sourceId === SOURCE.OSM
      ) {
        unifiedPlace.openingHours = transformed.openingHours.value
      }
    }

    // Photos - just append, no priority handling
    if (transformed.photos && transformed.photos.length > 0) {
      unifiedPlace.photos.push(...transformed.photos)
    }

    // Ratings
    if (transformed.ratings) {
      // If we already have ratings, determine which to use based on source priority
      if (unifiedPlace.ratings) {
        if (transformed.ratings.rating) {
          unifiedPlace.ratings.rating =
            selectBestValue([
              unifiedPlace.ratings.rating,
              transformed.ratings.rating,
            ]) === transformed.ratings.rating.value
              ? transformed.ratings.rating
              : unifiedPlace.ratings.rating
        }

        if (transformed.ratings.reviewCount) {
          unifiedPlace.ratings.reviewCount =
            selectBestValue([
              unifiedPlace.ratings.reviewCount,
              transformed.ratings.reviewCount,
            ]) === transformed.ratings.reviewCount.value
              ? transformed.ratings.reviewCount
              : unifiedPlace.ratings.reviewCount
        }
      } else {
        // If no existing ratings, use the new ones
        unifiedPlace.ratings = transformed.ratings
      }
    }

    // Amenities
    if (
      transformed.amenities &&
      Object.keys(transformed.amenities).length > 0
    ) {
      Object.entries(transformed.amenities).forEach(([key, values]) => {
        const value = values[0]?.value
        if (value !== undefined) {
          if (!unifiedPlace.amenities[key] || adapter.sourceId === SOURCE.OSM) {
            unifiedPlace.amenities[key] = value
          }
        }
      })
    }

    // Add source reference with the correct timestamp
    unifiedPlace.sources.push({
      id: adapter.sourceId,
      name: adapter.sourceName,
      url: adapter.sourceUrl(data),
      updated:
        adapter.sourceId === SOURCE.OSM && data.timestamp
          ? data.timestamp
          : undefined,
      updatedBy:
        adapter.sourceId === SOURCE.OSM && 'user' in data
          ? data.user
          : undefined,
    })

    // Update lastUpdated timestamp only if this is from OSM or there is no lastUpdated yet
    if (adapter.sourceId === SOURCE.OSM || !unifiedPlace.lastUpdated) {
      unifiedPlace.lastUpdated = timestamp
    }
  } catch (error) {
    console.error(`Error merging data from ${adapter.sourceName}:`, error)
  }
}

function createBaseUnifiedPlace(
  place: Place,
  name: string,
  placeType: string,
): UnifiedPlace {
  return {
    id: `${place.type}/${place.id}`,
    externalIds: { [SOURCE.OSM]: place.id.toString() },
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

  if (API_CONFIG[SOURCE.GOOGLE]) {
    promises.push(searchGooglePlace(name, center.lat, center.lon, place))
  }

  if (API_CONFIG[SOURCE.WIKIDATA]) {
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

    if (API_CONFIG[SOURCE.GOOGLE]) {
      const googleData = externalData[currentIndex] as GooglePlaceDetails | null
      if (googleData) {
        mergePlaceData(unifiedPlace, googleAdapter, googleData)
      }
      currentIndex++
    }

    if (API_CONFIG[SOURCE.WIKIDATA]) {
      const [image, logo] = externalData[currentIndex] as [
        string | null,
        string | null,
      ]
      if (image) {
        unifiedPlace.photos.push({
          url: image,
          sourceId: SOURCE.WIKIDATA,
          isPrimary: true,
        })
      }
      if (logo) {
        unifiedPlace.photos.push({
          url: logo,
          sourceId: SOURCE.WIKIDATA,
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
