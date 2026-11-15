const QUESTION_START = /^(where|what|which|who|when|how|is there|are there|any|anywhere|find me|show me|recommend|suggest|best|good|somewhere|i need|i want|looking for)\b/i
const CONSTRAINTS = /\b(open (now|late|early|until|till|after|on)|with|without|that|near|nearby|close to|around|within|minutes?|mins?|walk|walking|drive|for (kids|dogs|groups|families|work|working|studying|a date)|good for|cheap|quiet|cozy|romantic|outdoor|wheelchair|vegan|vegetarian|gluten|late night|24 hours?|tonight|today|tomorrow|this weekend)\b/i
const LONG_QUERY_WORDS = 5

/**
 * Whether a palette query reads as a question for Ask rather than a lookup.
 * A query that names a result exactly ("Starbucks", "Central Park") is a lookup
 * however it is phrased.
 */
export function prefersAsk(query: string, options: { exactMatch?: boolean } = {}): boolean {
  const text = query.trim()
  if (!text) return false
  if (text.endsWith('?')) return true
  if (options.exactMatch) return false
  const words = text.split(/\s+/).length
  if (words < 2) return false
  return QUESTION_START.test(text) || CONSTRAINTS.test(text) || words >= LONG_QUERY_WORDS
}
