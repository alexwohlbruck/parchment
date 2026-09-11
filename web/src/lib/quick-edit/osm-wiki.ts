import type { FieldDefinition } from '@/types/quick-edit.types'

const WIKI = 'https://wiki.openstreetmap.org/wiki'

/**
 * The OSM wiki page documenting a tag, as iD's field help links to.
 *
 * A tag with a discrete value has its own page (`Tag:amenity=cafe`); otherwise
 * the key's page is the right destination. Wildcard references the schema uses
 * for tag families (`addr:*`) fall back to the family's key page.
 */
export function osmWikiUrl(key: string, value?: string): string | null {
  const cleanKey = key.replace(/[:*]+$/, '').trim()
  if (!cleanKey) return null

  const cleanValue = value?.trim()
  if (cleanValue && !cleanValue.includes(';') && !/[*]/.test(cleanValue)) {
    return `${WIKI}/Tag:${encodeURIComponent(cleanKey)}=${encodeURIComponent(cleanValue)}`
  }
  return `${WIKI}/Key:${encodeURIComponent(cleanKey)}`
}

/**
 * The wiki page for a form field, given what the feature currently says.
 * Fields documenting a tag family declare it themselves via `reference`.
 */
export function fieldWikiUrl(
  field: FieldDefinition,
  tags: Record<string, string>,
): string | null {
  const key = field.reference?.key ?? field.key
  const value = field.reference?.value ?? tags[field.key]

  // Free-text fields describe the key; there's no page per name or phone number.
  const valueless = ['text', 'textarea', 'localized', 'tel', 'url', 'email', 'number']
  return osmWikiUrl(key, valueless.includes(field.type) ? undefined : value)
}
