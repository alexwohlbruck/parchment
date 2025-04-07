import axios from 'axios'
import type { Place } from '../types/place.types'
import type { Address, AttributedValue } from '../types/unified-place.types'

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

export const buildOverpassQuery = (type: string, id: string) => {
  return `[out:json][timeout:60];
    ${type}(${id});
    out body geom meta;
    >;
    out body meta;`
}

export const calculatePlaceCenter = (place: Place) => {
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

  return null
}

export const fetchPlaceFromOverpass = async (
  type: 'node' | 'way' | 'relation',
  id: string,
): Promise<Place | null> => {
  try {
    const query = buildOverpassQuery(type, id)
    console.log('Overpass query:', query)

    const response = await axios.get(
      `${OVERPASS_API_URL}?data=${encodeURIComponent(query)}`,
    )

    if (response.status !== 200) {
      throw new Error(`Failed to fetch place details (HTTP ${response.status})`)
    }

    console.log('Overpass response:', JSON.stringify(response.data, null, 2))

    const place = response.data.elements?.[0] as Place
    if (!place) {
      throw new Error(`Place not found: ${type}/${id}`)
    }

    const center = calculatePlaceCenter(place)
    if (center) {
      place.center = center
    } else {
      console.error('Could not calculate center for place:', place)
    }

    return place
  } catch (error) {
    console.error('Error fetching place from Overpass:', error)
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data)
    }
    return null
  }
}

export const extractOsmAddress = (
  tags: Record<string, string | undefined>,
): Address | null => {
  const osmAddress: Address = {}

  if (tags['addr:housenumber'] || tags['addr:street']) {
    osmAddress.street1 = [tags['addr:housenumber'], tags['addr:street']]
      .filter(Boolean)
      .join(' ')
  }

  osmAddress.street2 = tags['addr:unit'] || undefined
  osmAddress.locality = tags['addr:city'] || undefined
  osmAddress.region = tags['addr:state'] || undefined
  osmAddress.postalCode = tags['addr:postcode'] || undefined
  osmAddress.country = tags['addr:country'] || undefined

  const formattedParts = [
    osmAddress.street1,
    osmAddress.street2,
    osmAddress.locality
      ? `${osmAddress.locality}${osmAddress.region ? ',' : ''}`
      : '',
    osmAddress.region,
    osmAddress.postalCode,
    osmAddress.country,
  ].filter(Boolean)

  osmAddress.formatted = formattedParts.join(' ')

  return Object.keys(osmAddress).length > 0 ? osmAddress : null
}

export const extractOsmContactInfo = (
  tags: Record<string, string | undefined>,
) => {
  const contactInfo = {
    phone: [] as AttributedValue<string>[],
    email: [] as AttributedValue<string>[],
    website: [] as AttributedValue<string>[],
  }

  if (tags.phone) {
    contactInfo.phone.push({
      value: tags.phone,
      sourceId: 'osm',
    })
  }

  const email = tags.email || tags['contact:email']
  if (email) {
    contactInfo.email.push({
      value: email,
      sourceId: 'osm',
    })
  }

  if (tags.website) {
    contactInfo.website.push({
      value: tags.website,
      sourceId: 'osm',
    })
  }

  return contactInfo
}

export const extractOsmOpeningHours = (
  tags: Record<string, string | undefined>,
) => {
  const openingHours = tags.opening_hours
  if (!openingHours) return null

  return {
    value: {
      regularHours: [],
      rawText: openingHours,
    },
    sourceId: 'osm',
  }
}

export const extractOsmAmenities = (
  tags: Record<string, string | undefined>,
) => {
  const amenities: Record<string, AttributedValue<string>[]> = {}
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

  for (const [key, value] of Object.entries(tags)) {
    if (
      value &&
      !key.startsWith('addr:') &&
      !['name', 'website', 'phone', 'opening_hours'].includes(key) &&
      (knownAmenityTags.includes(key) || key.includes(':'))
    ) {
      amenities[key] = [
        {
          value: value,
          sourceId: 'osm',
        },
      ]
    }
  }

  return amenities
}
