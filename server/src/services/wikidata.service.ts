import axios from 'axios'
import { SOURCE } from '../lib/constants'

// Wikidata API URLs
const WIKIDATA_API_BASE = 'https://www.wikidata.org/w/api.php'
const WIKIMEDIA_COMMONS_API_BASE = 'https://commons.wikimedia.org/w/api.php'

export const fetchWikidataImage = async (
  wikidataId: string | undefined,
): Promise<string | null> => {
  if (!wikidataId) return null

  try {
    const response = await axios.get(
      `${WIKIDATA_API_BASE}?action=wbgetclaims&property=P18&entity=${wikidataId}&format=json&origin=*`,
    )

    if (response.status !== 200) {
      return null
    }

    const data = response.data
    const imageFileName = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value

    if (!imageFileName) return null

    const imageUrl = `${WIKIMEDIA_COMMONS_API_BASE}?action=query&titles=File:${encodeURIComponent(
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
    const response = await axios.get(
      `${WIKIDATA_API_BASE}?action=wbgetentities&ids=${wikidataId}&format=json&origin=*`,
    )

    if (response.status !== 200) return null

    const data = response.data
    const logoFileName =
      data.entities?.[wikidataId]?.claims?.P154?.[0]?.mainsnak?.datavalue?.value

    if (!logoFileName) return null

    const imageUrl = `${WIKIMEDIA_COMMONS_API_BASE}?action=query&titles=File:${encodeURIComponent(
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
