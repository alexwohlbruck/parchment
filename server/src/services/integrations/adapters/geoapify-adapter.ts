import type {
  Place,
  PlaceGeometry,
  Address,
  AttributedValue,
} from '../../../types/place.types'
import { getPlaceType } from '../../../lib/place.utils'
import { SOURCE } from '../../../lib/constants'
import { getPresetFromGeoapifyCategory } from '../mappings/geoapify-preset-mapping'

export interface GeoapifyFeature {
  type: string
  geometry: {
    type: string
    coordinates: [number, number]
  }
  properties: {
    place_id: string
    name?: string
    categories: string[]
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    state?: string
    country?: string
    country_code?: string
    formatted?: string
    lat: number
    lon: number
    datasource: {
      raw: {
        osm_id: string
        osm_type: 'n' | 'w' | 'r'
      }
    }
    [key: string]: any
  }
}

function getOsmId(feature: GeoapifyFeature) {
  const typeMap = {
    n: 'node',
    w: 'way',
    r: 'relation',
  }
  return [
    'osm',
    typeMap[feature.properties.datasource.raw.osm_type] || 'node',
    feature.properties.datasource.raw.osm_id,
  ].join('/')
}

export class GeoapifyAdapter {
  adaptPlaceDetails(feature: GeoapifyFeature): Place {
    try {
      const props = feature.properties
      const timestamp = new Date().toISOString()

      const lng = feature.geometry.coordinates[0]
      const lat = feature.geometry.coordinates[1]

      const geometry: PlaceGeometry = {
        type: 'point',
        center: { lat, lng },
      }

      const address = this.extractAddress(props)
      const placeType = getPlaceType(props.datasource.raw)

      const place: Place = {
        id: getOsmId(feature),
        externalIds: {
          osm: props.datasource.raw.osm_id,
        },
        name: {
          value: props.name || null,
          sourceId: SOURCE.OSM,
          timestamp,
        },
        description: null,
        placeType: {
          value: placeType || 'unknown',
          sourceId: SOURCE.OSM,
          timestamp,
        },
        geometry: {
          value: geometry,
          sourceId: SOURCE.OSM,
          timestamp,
        },
        photos: [],
        address: address
          ? {
              value: address,
              sourceId: SOURCE.OSM,
              timestamp,
            }
          : null,
        contactInfo: {
          phone: null,
          email: null,
          website: null,
          socials: {},
        },
        openingHours: null,
        amenities: this.extractAmenities(props),
        sources: [
          {
            id: SOURCE.OSM,
            name: 'OpenStreetMap',
            url: '',
          },
        ],
        lastUpdated: timestamp,
        createdAt: timestamp,
      }

      return place
    } catch (error) {
      console.error('Error adapting Geoapify data:', error)

      return {
        id: `geoapify/${feature.properties?.place_id || 'unknown'}`,
        externalIds: { geoapify: feature.properties?.place_id || 'unknown' },
        name: {
          value: feature.properties?.name || null,
          sourceId: SOURCE.OSM,
        },
        description: null,
        placeType: {
          value: 'unknown',
          sourceId: SOURCE.OSM,
        },
        geometry: {
          value: {
            type: 'point',
            center: {
              lat: feature.geometry?.coordinates?.[1] || 0,
              lng: feature.geometry?.coordinates?.[0] || 0,
            },
          },
          sourceId: SOURCE.OSM,
        },
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
            id: SOURCE.OSM,
            name: 'OpenStreetMap',
            url: '',
          },
        ],
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
    }
  }

  private extractAddress(props: GeoapifyFeature['properties']): Address | null {
    if (!props.street && !props.city && !props.postcode && !props.country) {
      return null
    }

    const address: Address = {}

    if (props.housenumber && props.street) {
      address.street1 = `${props.housenumber} ${props.street}`
    } else if (props.street) {
      address.street1 = props.street
    }

    address.locality = props.city || undefined
    address.region = props.state || undefined
    address.postalCode = props.postcode || undefined
    address.country = props.country || undefined
    address.countryCode = props.country_code?.toUpperCase() || undefined
    address.formatted = props.formatted || undefined

    return Object.keys(address).length > 0 ? address : null
  }

  private extractAmenities(
    props: GeoapifyFeature['properties'],
  ): Record<string, any> {
    const amenities: Record<string, any> = {}

    if (props.categories) {
      props.categories.forEach((category, index) => {
        amenities[`category_${index}`] = category
      })
    }

    return amenities
  }
}
