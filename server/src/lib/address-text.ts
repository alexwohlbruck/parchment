/**
 * Normalize text for comparison (names, addresses, etc.)
 * Works globally for any language
 */
export function normalizeText(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Remove common business suffixes (English)
      .replace(
        /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company)\b/g,
        '',
      )
      // Remove punctuation but keep unicode letters and numbers
      .replace(/[^\w\s\u00C0-\u017F\u0100-\u024F\u1E00-\u1EFF]/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Normalize street names by handling common abbreviations
 */
export function normalizeStreetName(street: string): string {
  return (
    normalizeText(street)
      // Normalize directional abbreviations
      .replace(/\b(n|north)\b/g, 'north')
      .replace(/\b(s|south)\b/g, 'south')
      .replace(/\b(e|east)\b/g, 'east')
      .replace(/\b(w|west)\b/g, 'west')
      .replace(/\b(ne|northeast)\b/g, 'northeast')
      .replace(/\b(nw|northwest)\b/g, 'northwest')
      .replace(/\b(se|southeast)\b/g, 'southeast')
      .replace(/\b(sw|southwest)\b/g, 'southwest')
      // Normalize street type abbreviations
      .replace(/\b(st|street)\b/g, 'street')
      .replace(/\b(ave|avenue)\b/g, 'avenue')
      .replace(/\b(rd|road)\b/g, 'road')
      .replace(/\b(dr|drive)\b/g, 'drive')
      .replace(/\b(ln|lane)\b/g, 'lane')
      .replace(/\b(ct|court)\b/g, 'court')
      .replace(/\b(pl|place)\b/g, 'place')
      .replace(/\b(blvd|boulevard)\b/g, 'boulevard')
      // Remove unit/apartment info for comparison
      .replace(/\b(unit|apt|apartment|suite|ste)\s+\w+/g, '')
      .trim()
  )
}
