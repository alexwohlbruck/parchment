import axios from 'axios'
import type { Place } from '../types/place.types'
import type { Address, AttributedValue } from '../types/unified-place.types'

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'
const NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search'

export const buildOverpassQuery = (id: string) => {
  const [type, rawId] = id.includes('/') ? id.split('/') : [null, id]
  return `[out:json][timeout:60];
    ${type}(${rawId});
    out body geom meta;
    >;
    out body meta;`
}

// Build query for searching places by name and location
export const buildOverpassSearchQuery = (
  query: string,
  lat?: number,
  lon?: number,
  radius: number = 1000,
) => {
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
  id: string,
): Promise<Place | null> => {
  try {
    const query = buildOverpassQuery(id)

    const response = await axios.get(
      `${OVERPASS_API_URL}?data=${encodeURIComponent(query)}`,
    )

    console.log('Overpass response:', JSON.stringify(response.data, null, 2))

    if (response.status !== 200) {
      throw new Error(`Failed to fetch place details (HTTP ${response.status})`)
    }

    const place = response.data.elements?.[0] as Place
    if (!place) {
      throw new Error(`Place not found: ${id}`)
    }

    const center = calculatePlaceCenter(place)
    if (center) {
      place.center = center
    } else {
      console.error('Could not calculate center for place:', place)
    }

    return {
      ...place,
      id: `${place.type}/${place.id}`, // Convert id to composite type/id
    }
  } catch (error) {
    console.error('Error fetching place from Overpass:', error)
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data)
    }
    return null
  }
}

// Nominatim search query
export const searchNominatim = async (
  query: string,
  lat?: number,
  lon?: number,
  radius: number = 1000,
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

    const response = await axios.get(NOMINATIM_API_URL, {
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

        // Check place_class/place_type from Nominatim
        if (
          place.tags.place_class &&
          excludedTypes.includes(place.tags.place_class)
        ) {
          return false
        }

        // Skip administrative boundaries unless they are the main search term
        if (
          place.tags.place_class === 'boundary' &&
          place.tags.place_type === 'administrative' &&
          !place.tags.name.toLowerCase().includes(query.toLowerCase())
        ) {
          return false
        }

        return true
      })

    // Sort results by relevance - named places first, then by address match
    return transformedResults.sort((a: Place, b: Place) => {
      // Places with names first
      const aHasName = !!a.tags?.name
      const bHasName = !!b.tags?.name

      if (aHasName && !bHasName) return -1
      if (!aHasName && bHasName) return 1

      // Then sort by how well the name matches the query
      if (aHasName && bHasName) {
        const aNameMatch = a
          .tags!.name.toLowerCase()
          .includes(query.toLowerCase())
        const bNameMatch = b
          .tags!.name.toLowerCase()
          .includes(query.toLowerCase())

        if (aNameMatch && !bNameMatch) return -1
        if (!aNameMatch && bNameMatch) return 1
      }

      return 0
    })
  } catch (error) {
    console.error('Error searching places from Nominatim:', error)
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data)
    }
    return []
  }
}

// Transform a Nominatim result to our Place format
function transformNominatimToPlace(result: any): Place {
  // Determine the place type: node, way, or relation
  let placeType: 'node' | 'way' | 'relation' = 'node'
  if (result.osm_type === 'way') {
    placeType = 'way'
  } else if (result.osm_type === 'relation') {
    placeType = 'relation'
  }

  // Extract tags from extratags and namedetails
  const tags: Record<string, string> = {
    ...result.extratags,
  }

  // Add names from namedetails
  if (result.namedetails) {
    Object.entries(result.namedetails).forEach(([key, value]) => {
      if (key === 'name') {
        tags.name = value as string
      } else if (key.startsWith('name:')) {
        tags[key] = value as string
      }
    })
  }

  // If we still don't have a name, use the display name
  if (!tags.name && result.display_name) {
    tags.name = result.display_name.split(',')[0].trim()
  }

  // Populate address tags from address details
  if (result.address) {
    // Map common address fields to OSM tags
    const addressMapping: Record<string, string> = {
      house_number: 'addr:housenumber',
      road: 'addr:street',
      city: 'addr:city',
      town: 'addr:city',
      village: 'addr:city',
      hamlet: 'addr:city',
      county: 'addr:county',
      state: 'addr:state',
      postcode: 'addr:postcode',
      country: 'addr:country',
      country_code: 'addr:country_code',
    }

    for (const [key, value] of Object.entries(result.address)) {
      const osmTag = addressMapping[key]
      if (osmTag) {
        tags[osmTag] = value as string
      }
    }
  }

  // Extract the OSM ID - Nominatim includes a letter prefix sometimes (N, W, R)
  // which we need to strip to get the numeric ID that Overpass expects
  let osmId = result.osm_id
  if (typeof osmId === 'string') {
    osmId = osmId.replace(/^[NWR]/, '')
  }

  // Store the place class and type if available
  if (result.class) {
    tags.place_class = result.class
  }
  if (result.type) {
    tags.place_type = result.type
  }

  // Add category if available (helps with place type detection)
  if (result.category) {
    tags.category = result.category
  }

  return {
    id: parseInt(osmId.toString(), 10),
    type: placeType,
    tags,
    center: {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
    },
    bounds: result.boundingbox
      ? {
          minlat: parseFloat(result.boundingbox[0]),
          maxlat: parseFloat(result.boundingbox[1]),
          minlon: parseFloat(result.boundingbox[2]),
          maxlon: parseFloat(result.boundingbox[3]),
        }
      : undefined,
    // We don't get geometry from Nominatim, but we could fetch it later if needed
  }
}

// Keep searchOverpass as a backup search option
export const searchOverpass = async (
  query: string,
  lat?: number,
  lon?: number,
  radius: number = 1000,
): Promise<Place[]> => {
  try {
    const searchQuery = buildOverpassSearchQuery(query, lat, lon, radius)
    console.log('Overpass search query:', searchQuery)

    const response = await axios.get(
      `${OVERPASS_API_URL}?data=${encodeURIComponent(searchQuery)}`,
      { timeout: 10000 }, // 10 second timeout
    )

    if (response.status !== 200) {
      throw new Error(`Failed to search places (HTTP ${response.status})`)
    }

    const places = response.data.elements as Place[]

    // Calculate center for each place
    return places.map((place) => {
      const center = calculatePlaceCenter(place)
      if (center) {
        place.center = center
      }
      return place
    })
  } catch (error) {
    console.error('Error searching places from Overpass:', error)
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data)
    }
    return []
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
