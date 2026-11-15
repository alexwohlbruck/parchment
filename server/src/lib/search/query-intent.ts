import type { QueryIntent } from '../../types/search.types'

/** A phrase naming something a place has, and the tags that say it does. */
export interface AttributePhrase {
  phrase: string
  id: string
  name: string
  tags: Record<string, string>
}

export interface IntentVocabulary {
  /** Longest phrase first, so "open 24 hours" wins over "open". */
  attributes: AttributePhrase[]
  /** The kind of place `text` names outright ("cafes", "thai restaurant"). */
  findCategory: (text: string) => { id: string; name: string } | null
  /** Whether category results can be filtered on `key=value`. */
  canFilter: (categoryId: string, key: string, value: string) => boolean
}

type PhraseEffect = 'drop' | 'ask' | 'openNow'

const NEARBY = ['near me', 'nearby', 'near here', 'around here', 'around me', 'close by', 'close to me', 'in the area']

const ASK = [
  "^(?:where|what|which|who|when|how|why|is there|are there|any|anywhere|find me|show me|recommend|suggest|somewhere|i need|i want|i'm looking for|looking for|can i|should i)",
  'best|good|great|nice|top|cheap|cheapest|affordable|quiet|cozy|cosy|romantic|fancy|trendy|popular|authentic|hidden gems?|kid friendly|family friendly',
  'for (?:kids|children|dogs|groups|families|work|working|studying|a date|date night)',
  'open (?:late|early|until|till|after|before|on|at)|late night|tonight|today|tomorrow|this (?:morning|afternoon|evening|weekend)',
  '(?:after|before|at|by) \\d\\S*|on (?:mon|tues|wednes|thurs|fri|satur|sun)days?|on the weekend',
  'within|\\d+ ?(?:min|mins|minutes?|hours?|hrs?|km|mi|miles?|blocks?)|walk|walking|walkable|drive|driving|biking',
  'by (?:car|bike|train|subway|transit|bus)|on (?:the|my) way|along|near|close to|next to|between',
  'vs|versus|better than|compared to|or',
]

const OPEN_NOW = ['open now', 'open right now', 'currently open', 'open at the moment', 'still open', 'that are open', 'that is open', '^open', 'open$']

const FILLER = ['with', 'that have', 'that has', 'which have', 'having', 'has', 'have', 'offering', 'serving', 'and', 'plus', '&', 'w/', 'a', 'an', 'the', 'some', 'places?', 'spots?']

const phraseRule = (effect: PhraseEffect, phrases: string[]) => ({
  effect,
  pattern: new RegExp(`(?:^|\\s)(?:${phrases.join('|')})(?=\\s|$)`, 'g'),
})

const NEARBY_RULE = phraseRule('drop', NEARBY)
const LATER_RULES = [phraseRule('ask', ASK), phraseRule('openNow', OPEN_NOW), phraseRule('drop', FILLER)]

const LONG_QUERY_WORDS = 5

const normalize = (text: string) =>
  text.toLowerCase().replace(/[?!.,;:()"]/g, ' ').replace(/\s+/g, ' ').trim()

const phrasePatterns = new Map<string, RegExp>()
function phrasePattern(phrase: string): RegExp {
  let pattern = phrasePatterns.get(phrase)
  if (!pattern) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern = new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`)
    phrasePatterns.set(phrase, pattern)
  }
  return pattern
}

/**
 * Reads a typed query into what classic search can answer by itself. A query
 * naming a result exactly is a lookup however it is phrased, unless it ends in
 * a question mark.
 */
export function parseQueryIntent(
  query: string,
  vocabulary: IntentVocabulary,
  options: { namedResult?: boolean } = {},
): QueryIntent {
  const raw = query.trim()
  let text = normalize(raw)
  if (!text) return { intent: 'lookup', residual: '' }
  if (raw.endsWith('?')) return { intent: 'ask', residual: text }
  const words = text.split(' ').length
  if (options.namedResult || words < 2) return { intent: 'lookup', residual: text }

  text = text.replace(NEARBY_RULE.pattern, ' ')

  const attributes: AttributePhrase[] = []
  for (const attribute of vocabulary.attributes) {
    const pattern = phrasePattern(attribute.phrase)
    if (!pattern.test(text)) continue
    text = text.replace(pattern, ' ')
    if (!attributes.some((a) => a.id === attribute.id)) attributes.push(attribute)
  }

  let ask = false
  let openNow = false
  for (const rule of LATER_RULES) {
    text = text.replace(rule.pattern, () => {
      if (rule.effect === 'ask') ask = true
      if (rule.effect === 'openNow') openNow = true
      return ' '
    })
  }
  const residual = text.replace(/\s+/g, ' ').trim()
  if (ask) return { intent: 'ask', residual }

  const category = residual
    ? vocabulary.findCategory(residual)
    : attributes[0] && { id: attributes[0].id, name: attributes[0].name }
  if (!category) {
    const ambiguous = attributes.length > 0 || openNow || words >= LONG_QUERY_WORDS
    return { intent: ambiguous ? 'ask' : 'lookup', residual }
  }

  const filters = attributes.filter((a) => a.id !== category.id)
  if (!filters.length && !openNow) return { intent: 'lookup', category, residual: '' }

  const tags = Object.assign({}, ...filters.map((a) => a.tags)) as Record<string, string>
  const filterable = Object.entries(tags).every(([key, value]) =>
    vocabulary.canFilter(category.id, key, value),
  )
  if (!filterable) return { intent: 'ask', residual }

  return {
    intent: 'browse',
    category,
    ...(filters.length
      ? { attributes: filters.map(({ id, name }) => ({ id, name })), tags }
      : {}),
    ...(openNow ? { openNow } : {}),
    residual: '',
  }
}
