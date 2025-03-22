import axios from 'axios'
import type { Place } from '../types/place.types'
import { getPlaceType } from '../lib/place.utils'

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
