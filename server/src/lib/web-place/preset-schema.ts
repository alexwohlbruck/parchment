import oh from 'opening_hours'
import { getPresetById, getPresetFields, listPresets, type FieldDefinition } from '../osm-presets'

const BUSINESS_KEYS = new Set(['amenity', 'shop', 'craft', 'office', 'tourism', 'leisure', 'healthcare', 'club'])

let businessPresets: string[] | null = null

/** Every iD preset a business could be mapped as, which is all a model may pick from. */
export function businessPresetIds(): string[] {
  businessPresets ??= listPresets()
    .filter(
      (preset) =>
        preset.searchable !== false &&
        preset.geometry.includes('point') &&
        BUSINESS_KEYS.has(preset.id.split('/')[0]) &&
        Object.values(preset.tags).every((value) => value !== '*'),
    )
    .map((preset) => preset.id)
  return businessPresets
}

export function isBusinessPreset(id: string): boolean {
  return businessPresetIds().includes(id)
}

/** The tags a node of this preset carries. */
export function presetTags(id: string): Record<string, string> {
  const preset = getPresetById(id)
  return preset ? { ...preset.tags, ...preset.addTags } : {}
}

export interface FieldSpec {
  key: string
  type: string
  label: string
  options?: string[]
  /** What each option reads as, for finding it in a quote. */
  optionLabels?: Record<string, string>
}

const READ_TYPES = new Set(['check', 'defaultCheck', 'combo', 'semiCombo', 'multiCombo', 'radio', 'number', 'text'])
/** Fields a site can't settle, that the base read already fills, or (brand, branch) that only chains carry. */
const SKIP_KEYS = /^(?:name|addr:|building|opening_hours$|phone$|mobile$|fax$|email$|website$|level$|ele$|height$|not:|ref:|gnis:|fhrs:|contact:|currency:|internet_access:ssid$|stars$|brand$|branch$)/

/** The preset's fields a business's own pages could answer, with the values the schema allows. */
export function presetFieldSpecs(id: string): FieldSpec[] {
  const preset = getPresetById(id)
  if (!preset) return []
  const seen = new Set<string>()
  return getPresetFields(preset)
    .filter((field) => READ_TYPES.has(field.type) && !SKIP_KEYS.test(field.key))
    .filter((field) => !seen.has(field.key) && seen.add(field.key))
    .map((field) => ({
      key: field.key,
      type: field.type,
      label: field.label,
      options: optionsOf(field),
      optionLabels: field.options &&
        Object.fromEntries(
          Object.entries(field.options).map(([option, label]) => [option, typeof label === 'string' ? label : label.title]),
        ),
    }))
}

function optionsOf(field: FieldDefinition): string[] | undefined {
  if (field.type === 'check' || field.type === 'defaultCheck') return ['yes', 'no']
  return field.options ? Object.keys(field.options) : undefined
}

export interface Claim {
  value: string
  quote: string
}

export interface CheckedTags {
  tags: Record<string, string>
  rejected: { key: string; reason: string }[]
}

/**
 * The claims the schema and the pages both bear out: a field the preset has, a value
 * it allows, and a quote that is really on the page.
 */
export function checkClaims(claims: Record<string, Claim | null>, specs: FieldSpec[], text: string): CheckedTags {
  const page = plain(text)
  const result: CheckedTags = { tags: {}, rejected: [] }
  for (const [key, claim] of Object.entries(claims)) {
    if (!claim) continue
    const reject = (reason: string) => result.rejected.push({ key, reason })
    const spec = specs.find((field) => field.key === key)
    if (!spec) {
      reject('not a field of this preset')
      continue
    }
    const value = String(claim.value ?? '').trim()
    const quote = plain(String(claim.quote ?? ''))
    if (!value || !quote) {
      reject('no value or quote')
      continue
    }
    if (!page.includes(quote)) {
      reject('quote is not on the page')
      continue
    }
    const tags = fieldTags(spec, value, quote)
    if (!tags) {
      reject(`"${value}" is not a value the schema allows`)
      continue
    }
    Object.assign(result.tags, tags)
  }
  return result
}

function fieldTags(spec: FieldSpec, value: string, quote: string): Record<string, string> | null {
  const values = value.split(';').map((part) => part.trim()).filter(Boolean)
  const known = (part: string) => !!spec.options?.includes(part)
  // A list field names things, so each one has to be named in the quote, whether or not the schema lists it.
  const named = (part: string) =>
    [part.replace(/_/g, ' '), spec.optionLabels?.[part]].some((words) => words && quote.includes(plain(words)))
  switch (spec.type) {
    case 'check':
    case 'defaultCheck':
    case 'radio':
    case 'combo':
      if (values.length !== 1) return null
      return known(values[0]) || (!spec.options && named(values[0])) ? { [spec.key]: values[0] } : null
    case 'multiCombo':
      if (!values.every((part) => /^[a-z0-9_]+$/.test(part) && named(part))) return null
      return Object.fromEntries(values.map((part) => [`${spec.key}${part}`, 'yes']))
    case 'semiCombo':
      if (!values.every((part) => /^[a-z0-9_:-]+$/.test(part) && named(part))) return null
      return { [spec.key]: values.join(';') }
    case 'number':
      return /^\d+(?:\.\d+)?$/.test(value) && quote.includes(value) ? { [spec.key]: value } : null
    default:
      return named(value) ? { [spec.key]: value } : null
  }
}

/** True for clean OSM syntax the parser reads without guessing, with no rule running two ranges into each other. */
export function isOsmHours(value: string): boolean {
  try {
    if (new oh(value, null, { mode: 0 } as never).getWarnings().length) return false
  } catch {
    return false
  }
  return value.split(';').every((rule) => !overlaps(rule))
}

function overlaps(rule: string): boolean {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const ranges = [...rule.matchAll(/(\d{2}:\d{2})-(\d{2}:\d{2})/g)]
    .map(([, open, close]) => [minutes(open), minutes(close)])
    .sort((a, b) => a[0] - b[0])
  return ranges.some(([open], index) => index > 0 && open < ranges[index - 1][1])
}

/** True when the words appear on the page, ignoring case, spacing and typographic quotes. */
export function onPage(words: string, text: string): boolean {
  const needle = plain(words)
  return !!needle && plain(text).includes(needle)
}

function plain(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}
