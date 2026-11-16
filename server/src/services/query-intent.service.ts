import type { Language } from '../lib/i18n/i18n.types'
import type { QueryIntent } from '../types/search.types'
import { parseQueryIntent, type IntentVocabulary } from '../lib/search/query-intent'
import { fieldFiltersTag } from '../lib/search/tag-filters'
import { PLACE_ATTRIBUTES } from '../lib/place-attributes'
import { getPresetById, getPresetFields } from '../lib/osm-presets'
import { categoryService } from './category.service'

const ATTRIBUTE_IDS = new Set(PLACE_ATTRIBUTES.map((a) => a.id))

const vocabularies = new Map<Language, IntentVocabulary>()

const namesExactly = (term: string, text: string) =>
  text === term
  || text === `${term}s`
  || text === `${term}es`
  || (term.endsWith('y') && text === `${term.slice(0, -1)}ies`)

function buildVocabulary(language: Language): IntentVocabulary {
  const attributes = PLACE_ATTRIBUTES.flatMap((attribute) => {
    const name = categoryService.getCategoryById(attribute.id, language)?.name ?? attribute.id
    const phrases = new Set([name, ...attribute.aliases].map((p) => p.toLowerCase()))
    return [...phrases].map((phrase) => ({ phrase, id: attribute.id, name, tags: attribute.tagSets[0] }))
  }).sort((a, b) => b.phrase.length - a.phrase.length)

  return {
    attributes,
    findCategory(text) {
      const candidates = categoryService
        .searchCategories(text, language, 10)
        .filter((c) => !ATTRIBUTE_IDS.has(c.id))
      const match =
        candidates.find((c) => namesExactly(c.name.toLowerCase(), text))
        ?? candidates.find((c) => c.aliases?.some((a) => namesExactly(a.toLowerCase(), text)))
      return match ? { id: match.id, name: match.name } : null
    },
    canFilter(categoryId, key, value) {
      const preset = getPresetById(categoryId)
      return !!preset && getPresetFields(preset, language).some((f) => fieldFiltersTag(f, key, value))
    },
  }
}

/** What `query` is after, given the titles autocomplete found for it. */
export function classifyQuery(
  query: string,
  options: { language: Language; resultTitles?: string[] },
): QueryIntent {
  let vocabulary = vocabularies.get(options.language)
  if (!vocabulary) {
    vocabulary = buildVocabulary(options.language)
    vocabularies.set(options.language, vocabulary)
  }
  const typed = query.trim().toLowerCase()
  const namedResult = (options.resultTitles ?? []).some((t) => t.trim().toLowerCase() === typed)
  return parseQueryIntent(query, vocabulary, { namedResult })
}
