/** Metres around the place's centre that a review's location may fall within. */
const SUBJECT_UNCERTAINTY_M = 50

export interface ReviewSubject {
  name: string
  lat: number
  lng: number
}

/**
 * The `geo:` URI Mangrove files place reviews under. Mangrove matches it by
 * proximity plus a case- and punctuation-insensitive name comparison.
 */
export function mangroveSubject({ name, lat, lng }: ReviewSubject): string {
  return `geo:${lat},${lng}?q=${encodeURIComponent(name)}&u=${SUBJECT_UNCERTAINTY_M}`
}

export function mangroveSubjectUrl(sub: string): string {
  return `https://mangrove.reviews/search?sub=${encodeURIComponent(sub)}`
}

const MARESI_PREFIX = 'urn:maresi:'

/**
 * Signature of the review an edit belongs to. Edits are separate signed
 * reviews whose subject points at the original, and only the original can be
 * edited or deleted cleanly.
 */
export function originalSignature(review: {
  signature: string
  payload: { sub: string; action?: string | null }
}): string {
  const { sub, action } = review.payload
  return action === 'edit' && sub.startsWith(MARESI_PREFIX)
    ? sub.slice(MARESI_PREFIX.length)
    : review.signature
}
