import type { PlaceDataAdapter } from '../types/adapter.types'
import type {
  PlacePhoto,
  AttributedValue,
  Address,
  OpeningHours,
  UnifiedPlace,
  PlaceGeometry,
} from '../types/unified-place.types'
import { getPlaceType } from '../lib/place.utils'
import { getTimestamp } from '../services/merge.service'
import { SOURCE } from '../lib/constants'
import { parseOsmHours } from '../lib/hours.utils'

/**
 * Interface for Pelias Feature response object
 */
export interface PeliasFeature {
  type: string
  geometry: {
    type: string
    coordinates: [number, number] // [longitude, latitude]
  }
  properties: {
    id: string
    gid: string
    layer: string
    source: string
    source_id: string
    name: string
    housenumber?: string
    street?: string
    postalcode?: string
    accuracy: string
    country?: string
    country_code?: string
    country_gid?: string
    country_a?: string
    region?: string
    region_gid?: string
    region_a?: string
    county?: string
    county_gid?: string
    county_a?: string
    locality?: string
    locality_gid?: string
    neighbourhood?: string
    neighbourhood_gid?: string
    label: string
    addendum?: {
      osm?: {
        wheelchair?: string
        wikidata?: string
        wikipedia?: string
        operator?: string
        brand?: string
        website?: string
        phone?: string
        opening_hours?: string
        [key: string]: string | undefined
      }
    }
  }
  bbox?: [number, number, number, number] // [minLon, minLat, maxLon, maxLat]
}

/**
 * Adapter for transforming Pelias API data to our unified format
 */
export const peliasAdapter: PlaceDataAdapter = {
  sourceId: SOURCE.PELIAS,
  sourceName: 'Pelias',
  sourceUrl: (feature: PeliasFeature) => {
    // Extract OSM ID from Pelias feature for the URL
    const osmId = feature.properties.source_id
    if (feature.properties.source === 'openstreetmap' && osmId) {
      return `https://www.openstreetmap.org/${osmId}`
    }
    return '' // Fallback empty URL
  },
  transform: (feature: PeliasFeature) => {
    try {
      const transformed: ReturnType<PlaceDataAdapter['transform']> = {
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        amenities: {},
      }

      const timestamp = getTimestamp()
      const props = feature.properties
      const osmData = props.addendum?.osm || {}

      // Name
      if (props.name) {
        transformed.name = {
          value: props.name,
          sourceId: SOURCE.PELIAS,
          timestamp,
        }
      }

      // Address
      const address = extractAddress(props)
      if (address) {
        transformed.address = {
          value: address,
          sourceId: SOURCE.PELIAS,
          timestamp,
        }
      }

      // Contact Info - ensure contactInfo exists
      if (osmData) {
        // Phone
        if (osmData.phone && transformed.contactInfo) {
          transformed.contactInfo.phone = {
            value: osmData.phone,
            sourceId: SOURCE.PELIAS,
            timestamp,
          }
        }

        // Website
        if (osmData.website && transformed.contactInfo) {
          transformed.contactInfo.website = {
            value: osmData.website,
            sourceId: SOURCE.PELIAS,
            timestamp,
          }
        }
      }

      // Opening Hours from OSM data
      if (osmData.opening_hours) {
        // Use the OSM hours parser
        const parsedHours = parseOsmHours({
          opening_hours: osmData.opening_hours,
        })
        if (parsedHours) {
          transformed.openingHours = {
            value: parsedHours,
            sourceId: SOURCE.PELIAS,
            timestamp,
          }
        }
      }

      // Photos - We don't get photos from Pelias directly

      // Amenities from OSM data
      const amenities: Record<string, AttributedValue<string>[]> = {}

      // Add place type as amenity
      if (props.layer) {
        amenities[`type:${props.layer}`] = [
          {
            value: props.layer,
            sourceId: SOURCE.PELIAS,
            timestamp,
          },
        ]
      }

      // Add OSM amenities if available
      if (osmData) {
        for (const [key, value] of Object.entries(osmData)) {
          // Skip undefined values and already processed fields
          if (value && !['website', 'phone', 'opening_hours'].includes(key)) {
            amenities[key] = [
              {
                value: value,
                sourceId: SOURCE.PELIAS,
                timestamp,
              },
            ]
          }
        }
      }

      if (Object.keys(amenities).length > 0) {
        transformed.amenities = amenities
      }

      return transformed
    } catch (error) {
      console.error('Error transforming Pelias data:', error)
      return {
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        amenities: {},
      }
    }
  },
}

/**
 * Extract address information from Pelias properties
 */
function extractAddress(props: PeliasFeature['properties']): Address | null {
  const address: Address = {}

  if (props.housenumber || props.street) {
    address.street1 = [props.housenumber, props.street]
      .filter(Boolean)
      .join(' ')
  }

  address.locality = props.locality || undefined
  address.region = props.region || undefined
  address.postalCode = props.postalcode || undefined
  address.country = props.country || undefined
  address.countryCode = props.country_code || undefined
  address.neighborhood = props.neighbourhood || undefined

  // Use the label as formatted address if available
  address.formatted = props.label || undefined

  // Return null if no address components found
  return Object.keys(address).length > 0 ? address : null
}

/**
 * Create a UnifiedPlace object from a Pelias feature
 */
export function createUnifiedPlaceFromPelias(
  feature: PeliasFeature,
): UnifiedPlace {
  const props = feature.properties
  const osmId = props.source_id

  const id = osmId || `pelias/${props.id}`

  let placeType = props.layer
  if (props.addendum?.osm) {
    const tags = props.addendum.osm as Record<string, string>
    placeType = getPlaceType(tags)
  }

  const geometry: PlaceGeometry = {
    type: 'point',
    center: {
      lat: feature.geometry.coordinates[1],
      lng: feature.geometry.coordinates[0],
    },
  }

  if (feature.bbox) {
    geometry.bounds = {
      minLat: feature.bbox[1],
      minLng: feature.bbox[0],
      maxLat: feature.bbox[3],
      maxLng: feature.bbox[2],
    }
  }

  const address = extractAddress(props)

  const unifiedPlace: UnifiedPlace = {
    id,
    externalIds: {
      [SOURCE.PELIAS]: props.gid,
    },
    name: props.name,
    placeType,
    geometry,
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
    sources: [
      {
        id: SOURCE.PELIAS,
        name: 'Pelias',
        url: osmId ? `https://www.openstreetmap.org/${osmId}` : '',
      },
    ],
    lastUpdated: getTimestamp(),
    createdAt: getTimestamp(),
  }

  if (osmId && props.source === 'openstreetmap') {
    unifiedPlace.externalIds[SOURCE.OSM] = `osm/${osmId}`
  }

  if (address) {
    unifiedPlace.address = address
  }

  return unifiedPlace
}
