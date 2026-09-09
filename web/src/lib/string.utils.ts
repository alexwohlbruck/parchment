export function capitalize(value: string): string {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Capitalise words after spaces/start only — not after apostrophes or mid-word.
 * Converts underscores and hyphens to spaces.
 *
 * @example
 * formatWord('bicycle_parking') // → 'Bicycle Parking'
 * formatWord('drive-through')   // → 'Drive Through'
 */
export function formatWord(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/(^|[ ])\w/g, m => m.toUpperCase())
}
