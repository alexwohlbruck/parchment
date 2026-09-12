import type { FieldDefinition } from '@/types/quick-edit.types'

/**
 * Arranging the tagging schema's fields into a form a person can face.
 *
 * A preset like Fast Food carries ~30 fields; shown flat they read as an
 * undifferentiated wall. Fields are sorted into sections, the yes/no ones are
 * collapsed into chips, and dependent fields stay hidden until the field they
 * depend on says they're relevant.
 */

export type SectionId =
  | 'basics'
  | 'features'
  | 'hours'
  | 'address'
  | 'contact'
  | 'more'

export const SECTION_ORDER: SectionId[] = [
  'basics',
  'features',
  'hours',
  'address',
  'contact',
  'more',
]

export interface FieldSection {
  id: SectionId
  fields: FieldDefinition[]
  /** How many of this section's fields the feature currently has a value for. */
  filled: number
}

const CHECK_TYPES = new Set(['check', 'defaultCheck', 'onewayCheck'])

const CONTACT_KEYS = new Set([
  'phone',
  'mobile',
  'fax',
  'email',
  'website',
  'url',
  'contact:phone',
  'contact:website',
  'contact:email',
])

/**
 * Fields whose relevance depends on another tag, where the id doesn't say so.
 * Drive-through hours only matter once there's a drive-through.
 */
const EXPLICIT_DEPENDENCIES: Record<string, string> = {
  'opening_hours/drive_through': 'drive_through',
  'toilets/disposal': 'toilets',
  'toilets/wheelchair': 'toilets',
  'toilets/menstrual_products': 'toilets',
  'changing_table/location': 'changing_table',
  'smoking/outside': 'smoking',
  'internet_access/ssid': 'internet_access',
  'internet_access/fee': 'internet_access',
  'self_service/laundry': 'self_service',
}

/** Values that mean "this doesn't apply", so dependent fields stay hidden. */
const ABSENT_VALUES = new Set(['no', 'none', 'false'])

export function isCheckField(field: FieldDefinition): boolean {
  return CHECK_TYPES.has(field.type)
}

export function sectionFor(field: FieldDefinition): SectionId {
  if (isCheckField(field)) return 'features'
  if (field.type === 'address') return 'address'
  if (field.key.startsWith('addr:') || field.key === 'building' || field.key === 'level') {
    return 'address'
  }
  if (field.key.includes('opening_hours') || field.key.endsWith('_hours')) return 'hours'
  if (CONTACT_KEYS.has(field.key) || field.key.startsWith('contact:')) return 'contact'
  return field.primary ? 'basics' : 'more'
}

/**
 * The field a field depends on, by id — either declared above or implied by the
 * schema's "parent/child" id convention (`internet_access/fee`).
 */
function dependencyIdOf(field: FieldDefinition): string | null {
  const explicit = EXPLICIT_DEPENDENCIES[field.id]
  if (explicit) return explicit
  const slash = field.id.lastIndexOf('/')
  return slash > 0 ? field.id.slice(0, slash) : null
}

/**
 * Whether a field is worth showing, given what the feature already says.
 * A dependent field appears once its dependency has a value that isn't a "no".
 */
export function isFieldVisible(
  field: FieldDefinition,
  fields: FieldDefinition[],
  tags: Record<string, string>,
): boolean {
  const dependencyId = dependencyIdOf(field)
  if (!dependencyId) return true

  // A field the user has already filled in stays put, whatever its dependency.
  if (tags[field.key]) return true

  const dependency = fields.find((f) => f.id === dependencyId)
  const value = tags[dependency?.key ?? dependencyId]
  return Boolean(value) && !ABSENT_VALUES.has(value)
}

/** Group a preset's fields into sections, dropping the ones not yet relevant. */
export function groupFields(
  fields: FieldDefinition[],
  tags: Record<string, string>,
): FieldSection[] {
  const seen = new Set<string>()
  const sections = new Map<SectionId, FieldDefinition[]>()

  for (const field of fields) {
    // moreFields can re-reference a field the preset already listed.
    if (seen.has(field.id)) continue
    seen.add(field.id)
    if (!isFieldVisible(field, fields, tags)) continue

    const section = sectionFor(field)
    const bucket = sections.get(section) ?? []
    bucket.push(field)
    sections.set(section, bucket)
  }

  return SECTION_ORDER.filter((id) => sections.get(id)?.length).map((id) => {
    const sectionFields = sections.get(id)!
    return {
      id,
      fields: sectionFields,
      filled: sectionFields.filter((f) => hasValue(f, tags)).length,
    }
  })
}

/** Whether a feature carries a value for a field, across its alternate keys. */
export function hasValue(
  field: FieldDefinition,
  tags: Record<string, string>,
): boolean {
  if (field.type === 'address') {
    return Object.keys(tags).some((key) => key.startsWith('addr:'))
  }
  if (tags[field.key]) return true
  // multiCombo fields spread across prefixed keys, e.g. payment:cash=yes
  return Object.keys(tags).some((key) => key.startsWith(`${field.key}:`))
}

/**
 * A one-line summary of what a collapsed section holds. A count tells you
 * there's something inside; the value tells you whether you need to open it.
 */
export function sectionPreview(
  section: FieldSection,
  tags: Record<string, string>,
): string {
  switch (section.id) {
    case 'features': {
      const on = section.fields.filter((f) => tags[f.key] === 'yes')
      return on.map((f) => f.label).join(', ')
    }
    case 'hours':
      return tags.opening_hours ?? ''
    case 'address':
      return [
        [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
        tags['addr:city'],
      ]
        .filter(Boolean)
        .join(', ')
    case 'contact':
      return tags.phone ?? tags.website ?? tags.email ?? ''
    default: {
      // Which details are filled in, not their values — "Brand, Takeaway"
      // reads; "Taco Bell, yes" is a riddle.
      const filled = section.fields.filter((f) => hasValue(f, tags))
      return filled.map((f) => f.label).join(', ')
    }
  }
}
