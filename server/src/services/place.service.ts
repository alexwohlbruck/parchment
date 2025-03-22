import axios from 'axios'
import type { Place } from '../types/place.types'

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

export const calculatePlaceCenter = (place: Place) => {
  if (place.type === 'node' && place.lat && place.lon) {
    return { lat: place.lat, lon: place.lon }
  }

  if (place.type === 'way' && place.geometry) {
    // Calculate the centroid of the way's nodes
    let sumLat = 0
    let sumLon = 0
    const nodes = place.geometry

    if (nodes.length === 0) return null

    for (const node of nodes) {
      sumLat += node.lat
      sumLon += node.lon
    }

    return {
      lat: sumLat / nodes.length,
      lon: sumLon / nodes.length,
    }
  }

  // For existing center values or relation types
  return place.center || null
}

export const buildOverpassQuery = (type: string, id: string) => {
  return `[out:json][timeout:25];
    ${type}(${id});
    out body meta center geom;`
}

export const fetchPlaceFromOverpass = async (
  type: 'node' | 'way' | 'relation',
  id: string,
): Promise<Place | null> => {
  try {
    const query = buildOverpassQuery(type, id)
    const response = await axios.get(
      `${OVERPASS_API_URL}?data=${encodeURIComponent(query)}`,
    )

    if (response.status !== 200) {
      throw new Error(`Failed to fetch place details (HTTP ${response.status})`)
    }

    const place = response.data.elements?.[0] as Place

    if (!place) {
      throw new Error(`Place not found: ${id}`)
    }

    // Calculate center coordinates if needed
    const center = calculatePlaceCenter(place)
    if (center) {
      place.center = center
    }

    return place
  } catch (error) {
    console.error('Error fetching place from Overpass:', error)
    return null
  }
}

export const fetchWikidataImage = async (
  wikidataId: string | undefined,
): Promise<string | null> => {
  if (!wikidataId) return null

  try {
    // Query Wikidata API for the image
    const response = await axios.get(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&property=P18&entity=${wikidataId}&format=json&origin=*`,
    )

    if (response.status !== 200) {
      return null
    }

    const data = response.data
    const imageFileName = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value

    if (!imageFileName) return null

    // Get the actual image URL from Wikimedia Commons
    const imageUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(
      imageFileName,
    )}&prop=imageinfo&iiprop=url&format=json&origin=*`

    const imageResponse = await axios.get(imageUrl)

    if (imageResponse.status !== 200) {
      return null
    }

    const imageData = imageResponse.data
    const pages = imageData.query?.pages || {}
    const page = Object.values(pages)[0] as any
    const url = page?.imageinfo?.[0]?.url

    return url || null
  } catch (error) {
    console.error('Error fetching Wikidata image:', error)
    return null
  }
}

export const fetchWikidataBrandLogo = async (
  wikidataId: string | undefined,
): Promise<string | null> => {
  if (!wikidataId) return null

  try {
    // First get the entity data to find the logo
    const response = await axios.get(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json&origin=*`,
    )

    if (response.status !== 200) return null

    const data = response.data
    const logoFileName =
      data.entities?.[wikidataId]?.claims?.P154?.[0]?.mainsnak?.datavalue?.value

    if (!logoFileName) return null

    // Get the actual image URL from Wikimedia Commons
    const imageUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(
      logoFileName,
    )}&prop=imageinfo&iiprop=url&format=json&origin=*`

    const imageResponse = await axios.get(imageUrl)

    if (imageResponse.status !== 200) return null

    const imageData = imageResponse.data
    const pages = imageData.query?.pages || {}
    const page = Object.values(pages)[0] as any
    const url = page?.imageinfo?.[0]?.url

    return url || null
  } catch (error) {
    console.error('Error fetching Wikidata brand logo:', error)
    return null
  }
}

export const getPlaceType = (tags: Record<string, string>): string => {
  const amenity = tags.amenity
  const shop = tags.shop
  const tourism = tags.tourism
  const leisure = tags.leisure
  const office = tags.office
  const historic = tags.historic
  const healthcare = tags.healthcare
  const building = tags.building
  const landuse = tags.landuse
  const cuisine = tags.cuisine

  // Common amenities
  if (amenity === 'restaurant') return 'Restaurant'
  if (amenity === 'cafe') return 'Café'
  if (amenity === 'bar') return 'Bar'
  if (amenity === 'pub') return 'Pub'
  if (amenity === 'fast_food') return 'Fast Food Restaurant'
  if (amenity === 'hospital') return 'Hospital'
  if (amenity === 'pharmacy') return 'Pharmacy'
  if (amenity === 'school') return 'School'
  if (amenity === 'bank') return 'Bank'
  if (amenity === 'atm') return 'ATM'
  if (amenity === 'parking') return 'Parking'
  if (amenity === 'fuel') return 'Gas Station'
  if (amenity === 'post_office') return 'Post Office'
  if (amenity === 'library') return 'Library'
  if (amenity === 'cinema') return 'Cinema'
  if (amenity === 'theatre') return 'Theatre'
  if (amenity === 'marketplace') return 'Marketplace'
  if (amenity === 'place_of_worship') {
    const religion = tags.religion
    if (religion === 'christian') return 'Church'
    if (religion === 'muslim') return 'Mosque'
    if (religion === 'jewish') return 'Synagogue'
    if (religion === 'buddhist') return 'Buddhist Temple'
    if (religion === 'hindu') return 'Hindu Temple'
    return 'Place of Worship'
  }

  // Shops
  if (shop === 'supermarket') return 'Supermarket'
  if (shop === 'convenience') return 'Convenience Store'
  if (shop === 'clothes') return 'Clothing Store'
  if (shop === 'mall') return 'Shopping Mall'
  if (shop === 'hardware') return 'Hardware Store'
  if (shop === 'electronics') return 'Electronics Store'
  if (shop === 'bakery') return 'Bakery'
  if (shop === 'butcher') return 'Butcher Shop'
  if (shop === 'confectionery') return 'Confectionery'
  if (shop === 'deli') return 'Delicatessen'
  if (shop) return shop.charAt(0).toUpperCase() + shop.slice(1) + ' Shop'

  // Tourism
  if (tourism === 'hotel') return 'Hotel'
  if (tourism === 'hostel') return 'Hostel'
  if (tourism === 'guest_house') return 'Guest House'
  if (tourism === 'motel') return 'Motel'
  if (tourism === 'museum') return 'Museum'
  if (tourism === 'gallery') return 'Art Gallery'
  if (tourism === 'attraction') return 'Tourist Attraction'
  if (tourism === 'viewpoint') return 'Viewpoint'
  if (tourism) return tourism.charAt(0).toUpperCase() + tourism.slice(1)

  // Leisure
  if (leisure === 'park') return 'Park'
  if (leisure === 'garden') return 'Garden'
  if (leisure === 'playground') return 'Playground'
  if (leisure === 'sports_centre') return 'Sports Center'
  if (leisure === 'stadium') return 'Stadium'
  if (leisure === 'swimming_pool') return 'Swimming Pool'
  if (leisure) return leisure.charAt(0).toUpperCase() + leisure.slice(1)

  // Office
  if (office)
    return office.charAt(0).toUpperCase() + office.slice(1) + ' Office'

  // Historic
  if (historic === 'monument') return 'Monument'
  if (historic === 'memorial') return 'Memorial'
  if (historic === 'castle') return 'Castle'
  if (historic === 'ruins') return 'Ruins'
  if (historic)
    return historic.charAt(0).toUpperCase() + historic.slice(1) + ' Site'

  // Healthcare
  if (healthcare === 'doctor') return "Doctor's Office"
  if (healthcare === 'dentist') return 'Dentist'
  if (healthcare === 'clinic') return 'Medical Clinic'
  if (healthcare)
    return healthcare.charAt(0).toUpperCase() + healthcare.slice(1)

  // Buildings
  if (building === 'apartments') return 'Apartment Building'
  if (building === 'house') return 'House'
  if (building === 'commercial') return 'Commercial Building'
  if (building === 'industrial') return 'Industrial Building'
  if (building)
    return building.charAt(0).toUpperCase() + building.slice(1) + ' Building'

  // Landuse
  if (landuse === 'residential') return 'Residential Area'
  if (landuse === 'commercial') return 'Commercial Area'
  if (landuse === 'industrial') return 'Industrial Area'
  if (landuse === 'retail') return 'Retail Area'
  if (landuse === 'farmland') return 'Farmland'
  if (landuse === 'forest') return 'Forest'
  if (landuse)
    return landuse.charAt(0).toUpperCase() + landuse.slice(1) + ' Area'

  // Special cases for specific combinations
  if (
    cuisine &&
    (amenity === 'restaurant' || amenity === 'cafe' || amenity === 'fast_food')
  ) {
    const cuisineType = cuisine.split(';')[0].trim().replace(/_/g, ' ')
    return (
      cuisineType.charAt(0).toUpperCase() +
      cuisineType.slice(1) +
      ' ' +
      (amenity === 'restaurant'
        ? 'Restaurant'
        : amenity === 'cafe'
        ? 'Café'
        : 'Fast Food')
    )
  }

  // Default fallback
  return tags.name ? 'Place' : 'Unnamed Place'
}

export const getPlaceDetails = async (
  type: 'node' | 'way' | 'relation',
  id: string,
) => {
  try {
    const place = await fetchPlaceFromOverpass(type, id)

    if (!place) {
      return null
    }

    // Get the place type
    const placeType = getPlaceType(place.tags || {})

    // Get Wikidata images if available
    const wikidataId = place.tags?.wikidata || place.tags?.['brand:wikidata']

    const [image, brandLogo] = await Promise.all([
      fetchWikidataImage(wikidataId),
      fetchWikidataBrandLogo(wikidataId),
    ])

    return {
      ...place,
      placeType,
      image,
      brandLogo,
    }
  } catch (error) {
    console.error('Error getting place details:', error)
    return null
  }
}
