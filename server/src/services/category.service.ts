import { CategoryResult } from '../types/search.types'
import type { Language } from '../lib/i18n/i18n.types'
import { getLanguageCode } from '../lib/i18n'
import { getPlaceCategory, resolveIcon } from '../lib/place-categories'

/**
 * Custom aliases for common colloquial / alternative names not in the iD schema.
 * Handles plurals, regional spellings, abbreviations, and consumer slang.
 */
const CUSTOM_ALIASES: Record<string, string[]> = {
  // Cycling
  'amenity/bicycle_parking':  ['bike rack', 'bike racks', 'bike stand', 'bike lock', 'cycle rack', 'bicycle stand', 'bicycle rack', 'cycle parking'],
  'amenity/bicycle_repair_station': ['bike repair', 'bike fix', 'bicycle fix', 'bike tool station', 'bike pump'],
  'amenity/bicycle_rental':   ['bike hire', 'bike share', 'bikeshare', 'cycle hire'],
  'shop/bicycle':             ['bike shop', 'bike store', 'cycle shop', 'cycling store'],

  // Water / hydration
  'amenity/drinking_water':   ['water fountain', 'drinking fountain', 'water tap', 'water spigot', 'hydration station', 'fountain', 'water'],
  'amenity/fountain':         ['water feature', 'decorative fountain', 'splash fountain', 'water fountain'],
  'amenity/water_point':      ['water station', 'water tap', 'water refill'],

  // Food & drink
  'amenity/cafe':             ['coffee shop', 'coffeehouse', 'coffee house', 'espresso bar', 'coffee bar', 'tea shop'],
  'amenity/fast_food':        ['fast food', 'quick service', 'takeaway', 'takeout', 'drive through'],
  'amenity/bar':              ['pub', 'tavern', 'saloon', 'drinkery', 'cocktail bar', 'sports bar'],
  'amenity/restaurant':       ['eatery', 'diner', 'dining', 'place to eat'],
  'amenity/food_court':       ['food hall', 'food court'],
  'shop/supermarket':         ['grocery store', 'grocery', 'food store', 'market', 'grocer', 'food market'],
  'shop/convenience':         ['corner store', 'corner shop', 'bodega', 'mini mart', 'convenience store'],
  'shop/bakery':              ['bread shop', 'pastry shop', 'patisserie'],
  'shop/alcohol':             ['liquor store', 'off licence', 'bottle shop', 'beer store', 'wine shop'],
  'amenity/ice_cream':        ['gelato', 'ice cream shop', 'soft serve', 'frozen yogurt', 'froyo'],

  // Health & services
  'amenity/pharmacy':         ['drugstore', 'chemist', 'drug store', 'apothecary', 'medicine'],
  'amenity/hospital':         ['emergency room', 'ER', 'A&E', 'medical center', 'medical centre'],
  'amenity/clinic':           ['urgent care', 'walk-in clinic', 'medical office', 'doctor office'],
  'amenity/dentist':          ['dental office', 'dental clinic', 'tooth doctor'],
  'amenity/veterinary':       ['vet', 'animal hospital', 'pet clinic', 'animal clinic'],

  // Money & banking
  'amenity/atm':              ['cash machine', 'cashpoint', 'ATM machine', 'money machine', 'cash dispenser'],
  'amenity/bank':             ['bank branch', 'financial institution', 'credit union'],
  'amenity/bureau_de_change': ['currency exchange', 'money exchange', 'forex'],

  // Transport
  'amenity/parking':          ['car park', 'parking lot', 'parking garage', 'parking deck', 'garage'],
  'amenity/fuel':             ['gas station', 'petrol station', 'filling station', 'service station', 'gas'],
  'amenity/bus_stop':         ['bus shelter', 'transit stop', 'coach stop'],
  'amenity/taxi':             ['cab stand', 'cab rank', 'taxi stand', 'rideshare', 'uber'],
  'amenity/car_rental':       ['car hire', 'auto rental', 'rent a car'],
  'amenity/car_wash':         ['auto wash', 'auto detailing', 'car detailing'],
  'amenity/charging_station': ['EV charger', 'electric vehicle charger', 'tesla supercharger', 'ev charging'],

  // Facilities / amenities
  'amenity/toilets':          ['bathroom', 'restroom', 'WC', 'lavatory', 'loo', 'public toilet', 'washroom'],
  'amenity/bench':            ['seat', 'seating', 'park bench', 'rest area'],
  'amenity/waste_basket':     ['trash can', 'rubbish bin', 'garbage can', 'litter bin', 'waste bin'],
  'amenity/recycling':        ['recycle bin', 'recycling bin', 'recycle', 'blue bin'],
  'amenity/post_box':         ['mailbox', 'mail box', 'letter box', 'post office box'],
  'amenity/post_office':      ['mail office', 'postal office', 'USPS', 'Royal Mail'],

  // Shopping
  'shop/mall':                ['shopping mall', 'shopping center', 'shopping centre', 'plaza', 'outlet mall'],
  'shop/clothes':             ['clothing store', 'apparel store', 'fashion store', 'boutique'],
  'shop/shoes':               ['shoe store', 'footwear', 'sneaker store', 'boot store'],
  'shop/electronics':         ['tech store', 'gadget store', 'computer store', 'electronics shop'],
  'shop/hardware':            ['hardware store', 'home improvement', 'tool store', 'DIY store'],
  'shop/hairdresser':         ['hair salon', 'barber', 'barbershop', 'salon', 'hair stylist'],
  'shop/beauty':              ['beauty salon', 'nail salon', 'spa salon'],
  'shop/pet':                 ['pet store', 'pet shop', 'animal store'],

  // Recreation
  'leisure/park':             ['public park', 'green space', 'city park', 'garden', 'gardens'],
  'leisure/playground':       ['kids playground', 'play area', 'jungle gym', 'playpark'],
  'leisure/swimming_pool':    ['pool', 'public pool', 'lap pool', 'outdoor pool', 'indoor pool'],
  'leisure/fitness_centre':   ['gym', 'fitness club', 'health club', 'workout', 'CrossFit', 'exercise'],
  'leisure/sports_centre':    ['sports center', 'sports complex', 'recreation center', 'rec center'],
  'leisure/dog_park':         ['off leash area', 'dog run', 'off-leash park'],
  'leisure/picnic_table':     ['picnic area', 'picnic spot', 'picnic bench'],
  'leisure/golf_course':      ['golf club', 'golf links', 'driving range'],
  'leisure/stadium':          ['arena', 'sports stadium', 'ballpark', 'amphitheater'],
  'amenity/theatre':          ['theater', 'playhouse', 'performing arts'],
  'amenity/cinema':           ['movie theater', 'movies', 'film theater', 'multiplex', 'movie house'],

  // Education
  'amenity/school':           ['elementary school', 'middle school', 'high school', 'K-12', 'academy'],
  'amenity/university':       ['college', 'uni', 'campus', 'higher education'],
  'amenity/library':          ['public library', 'book library', 'lending library'],

  // Lodging
  'tourism/hotel':            ['inn', 'motel', 'lodge', 'accommodation', 'stay', 'lodging'],
  'tourism/hostel':           ['backpacker hostel', 'cheap accommodation', 'dormitory'],
  'tourism/camp_site':        ['campground', 'camping', 'RV park', 'tent site'],

  // Tourism / attractions
  'tourism/museum':           ['art museum', 'history museum', 'science museum', 'exhibit', 'exhibits'],
  'tourism/attraction':       ['tourist attraction', 'landmark', 'point of interest', 'sight', 'sightseeing'],
  'tourism/viewpoint':        ['scenic overlook', 'observation point', 'panoramic view', 'lookout'],
  'historic/monument':        ['memorial', 'statue', 'obelisk', 'historic monument'],

  // Nature
  'natural/beach':            ['sandy beach', 'swimming beach', 'seaside', 'waterfront'],
  'natural/waterfall':        ['falls', 'cascade', 'water falls'],
  'natural/peak':             ['mountain top', 'summit', 'hilltop'],

  // Places
  'place/neighbourhood':      ['neighborhood', 'hood', 'district', 'area'],
  'office/government':        ['government office', 'government building', 'city hall', 'municipal'],
}

/**
 * Normalize a word for fuzzy comparison: lowercase, strip common suffixes.
 * Handles plural/gerund/past-tense variations so "bike racks" matches "bike rack".
 */
function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/ies$/, 'y')   // parties → party
    .replace(/ves$/, 'f')   // knives → knife
    .replace(/ing$/, '')     // parking → park
    .replace(/ed$/, '')      // parked → park
    .replace(/s$/, '')       // racks → rack
}

/**
 * Score a query against a target string using word-level fuzzy matching.
 * Handles plurals, word order variations, and partial prefix matches.
 * Returns a score > 0 when the query words all appear in the target, 0 otherwise.
 */
function wordOverlapScore(query: string, target: string): number {
  const qWords = query.trim().split(/\s+/).map(normalizeWord).filter(Boolean)
  const tWords = target.toLowerCase().split(/\s+/).map(normalizeWord).filter(Boolean)
  if (qWords.length === 0 || tWords.length === 0) return 0

  // All query words must match (normalized) some target word via prefix
  const allMatch = qWords.every((qw) =>
    tWords.some((tw) => tw.startsWith(qw) || qw.startsWith(tw)),
  )

  if (!allMatch) return 0

  // More words matched = higher confidence; exact-length match = max confidence
  const lengthRatio = Math.min(qWords.length, tWords.length) / Math.max(qWords.length, tWords.length)
  return 60 * lengthRatio // base 60 for multi-word overlap, up to 60
}

interface CachedCategoryData {
  categories: CategoryResult[]
  lastUpdated: string
}

// Cache by API language code (en, es) to avoid recomputing
const categoryCache = new Map<string, CachedCategoryData>()

export class CategoryService {
  /**
   * Load all searchable categories/presets from OSM tagging schema
   * Returns categories with translations for the given language
   */
  loadCategories(language: Language = 'en-US'): CategoryResult[] {
    const apiLang = getLanguageCode(language)
    // Check cache first
    const cached = categoryCache.get(apiLang)
    if (cached) {
      return cached.categories
    }

    const start = Date.now()

    try {
      // Load presets directly since loadPresets is not exported
      const rawPresets = require('@openstreetmap/id-tagging-schema/dist/presets.min.json')

      // Load translations (OSM schema uses two-letter codes)
      let translations: any = {}
      let presetTranslations: any = {}
      try {
        const rawTranslations = require(`@openstreetmap/id-tagging-schema/dist/translations/${apiLang}.json`)
        translations = rawTranslations[apiLang] || {}
        presetTranslations = translations?.presets?.presets || {}
      } catch (error) {
        if (apiLang !== 'en') {
          try {
            const enTranslations = require('@openstreetmap/id-tagging-schema/dist/translations/en.json')
            translations = enTranslations.en || {}
            presetTranslations = translations?.presets?.presets || {}
          } catch (enError) {
            console.warn('Could not load translations for', apiLang)
          }
        }
      }

      const categories: CategoryResult[] = []

      for (const [presetId, rawPreset] of Object.entries(rawPresets)) {
        const preset = rawPreset as any

        // Only include searchable presets that have meaningful tags
        const tags = preset.tags || {}
        const searchable = preset.searchable !== false

        if (!searchable || Object.keys(tags).length === 0) {
          continue
        }

        // Skip very generic presets that would match too many things
        const isGeneric = [
          'point',
          'line',
          'area',
          'vertex',
          'relation',
        ].includes(presetId)
        if (isGeneric) {
          continue
        }

        // Get localized name
        let localizedName =
          presetTranslations[presetId]?.name || preset.name || presetId

        // Fallback name handling for nested presets
        if (!localizedName && presetId.includes('/')) {
          const parts = presetId.split('/')
          if (parts.length === 3) {
            const parentName =
              presetTranslations[`${parts[0]}/${parts[1]}`]?.name
            const categoryName = presetTranslations[parts[0]]?.name
            localizedName = parentName || categoryName || presetId
          } else if (parts.length === 2) {
            localizedName = presetTranslations[parts[0]]?.name || presetId
          }
        }

        // Build aliases from various sources
        const aliases: string[] = []

        // Add terms from translations if available
        const translationData = presetTranslations[presetId]
        if (translationData?.terms) {
          aliases.push(...translationData.terms)
        }

        // Add the English name if different from localized name
        if (language !== 'en' && preset.name !== localizedName) {
          aliases.push(preset.name)
        }

        // Add tag values as potential search terms
        Object.values(tags).forEach((tagValue: unknown) => {
          if (
            typeof tagValue === 'string' &&
            tagValue !== '*' &&
            !aliases.includes(tagValue)
          ) {
            aliases.push(tagValue.replace(/_/g, ' '))
          }
        })

        // Merge custom aliases (colloquial / regional / abbreviation overrides)
        const customAliases = CUSTOM_ALIASES[presetId]
        if (customAliases) {
          for (const a of customAliases) {
            if (!aliases.includes(a)) aliases.push(a)
          }
        }

        const rawIcon = preset.icon || 'maki-circle'
        const resolved = resolveIcon(rawIcon)

        const category: CategoryResult = {
          id: presetId,
          type: 'category',
          name: localizedName,
          description: this.getPresetDescription(
            preset,
            presetTranslations[presetId],
          ),
          icon: rawIcon,
          iconName: resolved.icon,
          iconPack: resolved.iconPack,
          iconCategory: getPlaceCategory(presetId),
          tags: tags,
          addTags: preset.addTags,
          geometry: preset.geometry || ['point'],
          fields: preset.fields,
          searchable: searchable,
          aliases: aliases.filter(Boolean), // Remove empty strings
        }

        categories.push(category)
      }

      // Sort categories by relevance (more specific tags first, then alphabetically)
      categories.sort((a, b) => {
        const aTagCount = Object.keys(a.tags).length
        const bTagCount = Object.keys(b.tags).length

        if (aTagCount !== bTagCount) {
          return bTagCount - aTagCount // More tags = more specific
        }

        return a.name.localeCompare(b.name)
      })

      // Cache the results
      const cacheData: CachedCategoryData = {
        categories,
        lastUpdated: new Date().toISOString(),
      }
      categoryCache.set(apiLang, cacheData)

      return categories
    } catch (error) {
      return []
    }
  }

  /**
   * Search categories by name and aliases.
   * Scoring layers (highest → lowest):
   *   1000 exact name match
   *    800 exact alias match
   *    500 name starts with query
   *    400 alias starts with query
   *    250 name has query at word boundary
   *    200 alias has query at word boundary
   *    150 exact tag-value match
   *    100 name contains query anywhere
   *     80 alias contains query anywhere
   *     60 word-overlap fuzzy (handles plurals, word order, partial prefixes)
   *     50 tag value contains query
   */
  searchCategories(
    query: string,
    language: Language = 'en',
    maxResults: number = 20,
  ): CategoryResult[] {
    if (!query || query.trim().length === 0) {
      return []
    }

    const categories = this.loadCategories(language)
    const searchTerm = query.toLowerCase().trim()
    // Normalized variant strips plural/gerund suffixes so "restaurants" matches "Restaurant"
    const normalizedTerm = normalizeWord(searchTerm)
    // The set of terms to check: raw + normalized (deduplicated)
    const terms = normalizedTerm !== searchTerm ? [searchTerm, normalizedTerm] : [searchTerm]

    const matches: Array<{ category: CategoryResult; score: number }> = []

    for (const category of categories) {
      let score = 0
      const categoryNameLower = category.name.toLowerCase()

      // ── Name checks (raw + normalized) ────────────────────────────────────
      for (const term of terms) {
        if (categoryNameLower === term) {
          score = Math.max(score, term === searchTerm ? 1000 : 950) // slight penalty for normalized match
        } else if (categoryNameLower.startsWith(term)) {
          score = Math.max(score, term === searchTerm ? 500 : 475)
        } else if (
          categoryNameLower.includes(` ${term}`) ||
          categoryNameLower.includes(`${term} `)
        ) {
          score = Math.max(score, term === searchTerm ? 250 : 225)
        } else if (categoryNameLower.includes(term)) {
          score = Math.max(score, term === searchTerm ? 100 : 90)
        }
      }

      // ── Alias checks (raw + normalized) ───────────────────────────────────
      for (const alias of category.aliases || []) {
        const aliasLower = alias.toLowerCase()
        for (const term of terms) {
          if (aliasLower === term) {
            score = Math.max(score, term === searchTerm ? 800 : 760)
          } else if (aliasLower.startsWith(term)) {
            score = Math.max(score, term === searchTerm ? 400 : 380)
          } else if (
            aliasLower.includes(` ${term}`) ||
            aliasLower.includes(`${term} `)
          ) {
            score = Math.max(score, term === searchTerm ? 200 : 180)
          } else if (aliasLower.includes(term)) {
            score = Math.max(score, term === searchTerm ? 80 : 72)
          }
        }
      }

      // ── Tag value checks ──────────────────────────────────────────────────
      for (const tagValue of Object.values(category.tags)) {
        const tagLower = (tagValue as string).toLowerCase().replace(/_/g, ' ')
        if (tagLower === searchTerm) {
          score = Math.max(score, 150)
        } else if (tagLower.includes(searchTerm)) {
          score = Math.max(score, 50)
        }
      }

      // ── Word-overlap fuzzy (handles plurals, partial prefixes, word order) ─
      // Runs for any query length (not just multi-word) so "restaurants" → "restaurant" works.
      if (score === 0) {
        const nameOverlap = wordOverlapScore(searchTerm, categoryNameLower)
        score += nameOverlap

        if (score === 0) {
          for (const alias of category.aliases || []) {
            const aliasOverlap = wordOverlapScore(searchTerm, alias.toLowerCase())
            if (aliasOverlap > 0) {
              score += aliasOverlap
              break
            }
          }
        }
      }

      // Boost score for shorter names (more specific/relevant)
      if (score > 0) {
        const lengthBonus = Math.max(0, 50 - category.name.length)
        score += lengthBonus
        matches.push({ category, score })
      }
    }

    // Sort by score (descending) and return top results
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((match) => match.category)
  }

  /**
   * Get category by ID
   */
  getCategoryById(
    categoryId: string,
    language: Language = 'en',
  ): CategoryResult | null {
    const categories = this.loadCategories(language)
    return categories.find((cat) => cat.id === categoryId) || null
  }

  /**
   * Clear category cache (useful for testing or language changes)
   */
  clearCategoryCache(language?: Language): void {
    if (language) {
      categoryCache.delete(language)
    } else {
      categoryCache.clear()
    }
  }

  /**
   * Helper to get preset description from translations
   */
  private getPresetDescription(
    preset: any,
    translationData?: any,
  ): string | undefined {
    // Try to get description from translations
    if (translationData?.description) {
      return translationData.description
    }

    // Fallback: create description from tag info
    const mainTag = Object.entries(preset.tags)[0]
    if (mainTag) {
      const [key, value] = mainTag
      if (value !== '*') {
        return `${key}=${value}`
      }
    }

    return undefined
  }
}

export const categoryService = new CategoryService()
