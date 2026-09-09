import axios from 'axios'
import { SOURCE } from '../lib/constants'
import packageJson from '../../package.json'
import { logError } from '../lib/logger'

// Wikidata API URLs
const WIKIDATA_API_BASE = 'https://www.wikidata.org/w/api.php'
const WIKIMEDIA_COMMONS_API_BASE = 'https://commons.wikimedia.org/w/api.php'

// Wikimedia enforces a descriptive User-Agent — requests without one are
// rejected (403). Keep in sync with wikidata-integration.getWikidataHeaders.
const WIKI_HEADERS: Record<string, string> = {
  'User-Agent': `Parchment/${packageJson.version} (https://github.com/alexwohlbruck/parchment)`,
}

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
    logError('Error fetching Wikidata image', error)
    return null
  }
}

/**
 * Fetch a brand's logo URL (P154) and short description in a single entity
 * request. Preferred over calling fetchWikidataBrandLogo separately when both
 * are needed (e.g. the brand results header) — it avoids a second entity fetch.
 */
export const fetchWikidataBrandMeta = async (
  wikidataId: string | undefined,
  language = 'en',
): Promise<{ logoUrl: string | null; description: string | null }> => {
  if (!wikidataId) return { logoUrl: null, description: null }

  try {
    const langs = language === 'en' ? 'en' : `${language}|en`
    const response = await axios.get(
      `${WIKIDATA_API_BASE}?action=wbgetentities&ids=${wikidataId}&props=claims|descriptions&languages=${langs}&format=json`,
      { headers: WIKI_HEADERS },
    )
    if (response.status !== 200) return { logoUrl: null, description: null }

    const entity = response.data.entities?.[wikidataId]
    const description =
      entity?.descriptions?.[language]?.value ||
      entity?.descriptions?.en?.value ||
      null

    let logoUrl: string | null = null
    const logoFileName = entity?.claims?.P154?.[0]?.mainsnak?.datavalue?.value
    if (logoFileName) {
      const imageResponse = await axios.get(
        `${WIKIMEDIA_COMMONS_API_BASE}?action=query&titles=File:${encodeURIComponent(
          logoFileName,
        )}&prop=imageinfo&iiprop=url&format=json`,
        { headers: WIKI_HEADERS },
      )
      if (imageResponse.status === 200) {
        const pages = imageResponse.data.query?.pages || {}
        const page = Object.values(pages)[0] as any
        logoUrl = page?.imageinfo?.[0]?.url || null
      }
    }

    return { logoUrl, description }
  } catch (error) {
    logError('Error fetching Wikidata brand meta', error)
    return { logoUrl: null, description: null }
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
    logError('Error fetching Wikidata brand logo', error)
    return null
  }
}
