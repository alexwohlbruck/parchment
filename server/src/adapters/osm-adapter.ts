import {
  UnifiedPlace,
  AttributedValue,
  PlaceGeometry,
  Address,
  Coordinates,
  OpeningHours,
  OpeningTime,
  SourceReference,
} from '../types/unified-place.types'
import { Place } from '../types/place.types'
import {
  parseOpeningHoursForUnifiedFormat,
  getPlaceType,
} from '../lib/place.utils'
import { encode } from 'pluscodes'

export function adaptOsmPlace(osmPlace: Place): UnifiedPlace {
  if (!osmPlace || !osmPlace.id) {
    throw new Error('Invalid OSM place data')
  }

  const sourceId = 'osm'
  const sourceName = 'OpenStreetMap'
  const sourceUrl = `https://www.openstreetmap.org/${osmPlace.type}/${osmPlace.id}`

  const source: SourceReference = {
    id: sourceId,
    name: sourceName,
    url: sourceUrl,
    updated: osmPlace.version ? new Date().toISOString() : undefined,
    updatedBy: osmPlace.user,
  }

  const center: Coordinates = {
    lat: osmPlace.center?.lat ?? osmPlace.lat ?? 0,
    lng: osmPlace.center?.lon ?? osmPlace.lon ?? 0,
  }

  let plusCode: string | undefined
  if (center.lat !== 0 && center.lng !== 0) {
    try {
      const code = encode(
        {
          latitude: center.lat,
          longitude: center.lng,
        },
        10,
      )

      // Check if code is not null before assigning
      if (code !== null) {
        plusCode = code
      }
    } catch (e) {
      console.error('Failed to generate plus code:', e)
    }
  }

  const geometry: PlaceGeometry = {
    type: osmPlace.type === 'node' ? 'point' : 'polygon',
    center,
    plusCode,
  }

  if (osmPlace.bounds) {
    geometry.bounds = {
      minLat: osmPlace.bounds.minlat,
      minLng: osmPlace.bounds.minlon,
      maxLat: osmPlace.bounds.maxlat,
      maxLng: osmPlace.bounds.maxlon,
    }
  }

  if (osmPlace.geometry) {
    geometry.nodes = osmPlace.geometry.map((node) => ({
      lat: node.lat,
      lng: node.lon,
    }))
  }

  const attributedGeometry: AttributedValue<PlaceGeometry> = {
    value: geometry,
    sourceId,
    timestamp: new Date().toISOString(),
  }

  const address: Address = {}
  if (osmPlace.tags) {
    if (osmPlace.tags['addr:housenumber'] || osmPlace.tags['addr:street']) {
      address.street1 = [
        osmPlace.tags['addr:housenumber'],
        osmPlace.tags['addr:street'],
      ]
        .filter(Boolean)
        .join(' ')
    }

    address.street2 = osmPlace.tags['addr:unit'] || undefined
    address.locality = osmPlace.tags['addr:city'] || undefined
    address.region = osmPlace.tags['addr:state'] || undefined
    address.postalCode = osmPlace.tags['addr:postcode'] || undefined
    address.country = osmPlace.tags['addr:country'] || undefined

    const formattedParts = [
      address.street1,
      address.street2,
      address.locality ? `${address.locality}${address.region ? ',' : ''}` : '',
      address.region,
      address.postalCode,
      address.country,
    ].filter(Boolean)

    address.formatted = formattedParts.join(' ')
  }

  const attributedAddress: AttributedValue<Address> = {
    value: address,
    sourceId,
    timestamp: new Date().toISOString(),
  }

  const photos = []
  if (osmPlace.image) {
    photos.push({
      url: osmPlace.image,
      sourceId,
      isPrimary: true,
      isCover: true,
    })
  }

  if (osmPlace.brandLogo) {
    photos.push({
      url: osmPlace.brandLogo,
      sourceId,
      isLogo: true,
    })
  }

  let openingHours: OpeningHours | undefined
  if (osmPlace.tags?.opening_hours) {
    const parsedHours = parseOpeningHoursForUnifiedFormat(
      osmPlace.tags.opening_hours,
    )
    if (parsedHours) {
      openingHours = {
        regularHours: parsedHours,
        rawText: osmPlace.tags.opening_hours,
        isOpen24_7: false,
        isPermanentlyClosed: false,
        isTemporarilyClosed: false,
      }
    }
  }

  const amenities: Record<string, string | boolean | number> = {}
  if (osmPlace.tags) {
    const knownAmenityTags = [
      'wheelchair',
      'internet_access',
      'smoking',
      'toilets',
      'outdoor_seating',
      'payment:credit_cards',
      'payment:cash',
      'delivery',
      'takeaway',
      'drive_through',
      'air_conditioning',
      'wifi',
    ]

    for (const [key, value] of Object.entries(osmPlace.tags)) {
      if (
        value &&
        !key.startsWith('addr:') &&
        !['name', 'website', 'phone', 'opening_hours'].includes(key) &&
        (knownAmenityTags.includes(key) || key.includes(':'))
      ) {
        amenities[key] = value
      }
    }
  }

  const unifiedPlace: UnifiedPlace = {
    id: `osm:${osmPlace.type}:${osmPlace.id}`,
    externalIds: {
      [sourceId]: `${osmPlace.type}/${osmPlace.id}`,
    },
    name: osmPlace.tags?.name || `Unnamed Place (${osmPlace.id})`,
    placeType: osmPlace.tags ? getPlaceType(osmPlace.tags) : 'Place',
    geometry: geometry,
    photos,
    address: address,
    contactInfo: {
      phone: osmPlace.tags?.phone
        ? {
            value: osmPlace.tags.phone,
            sourceId,
            timestamp: Date.now().toString(),
          }
        : null,
      email: osmPlace.tags?.email
        ? {
            value: osmPlace.tags.email,
            sourceId,
            timestamp: Date.now().toString(),
          }
        : null,
      website: osmPlace.tags?.website
        ? {
            value: osmPlace.tags.website,
            sourceId,
            timestamp: Date.now().toString(),
          }
        : null,
      socials: {},
    },
    openingHours: openingHours || null,
    amenities,
    sources: [source],
    lastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }

  const socialMap = {
    'contact:facebook': 'facebook',
    'contact:instagram': 'instagram',
    'contact:twitter': 'twitter',
    'contact:linkedin': 'linkedin',
    'contact:youtube': 'youtube',
  }

  if (osmPlace.tags) {
    for (const [key, mappedKey] of Object.entries(socialMap)) {
      if (osmPlace.tags[key]) {
        unifiedPlace.contactInfo.socials[mappedKey] = {
          value: osmPlace.tags[key],
          sourceId,
          timestamp: new Date().toISOString(),
        }
      }
    }
  }

  return unifiedPlace
}
