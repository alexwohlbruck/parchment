import type { CategoryResult } from '../types/search.types'
import { getPlaceAttribute } from './place-attributes'
import { isPlaceGroup } from './place-groups'

/**
 * Presets that name an icon several unrelated presets share: a saved place
 * drawn with `lodging` is far more likely a hotel than a mattress store.
 */
const PREFERRED_PRESETS = new Set([
  'aeroway/aerodrome',
  'amenity/doctors',
  'amenity/place_of_worship/christian',
  'amenity/pub',
  'amenity/restaurant/asian',
  'amenity/restaurant/pizza',
  'amenity/townhall',
  'leisure/golf_course',
  'shop/clothes',
  'shop/watches',
  'shop/wine',
  'tourism/camp_site',
  'tourism/gallery',
  'tourism/hotel',
  'tourism/theme_park',
])

function tagValue(presetId: string): string {
  return presetId.split('/').at(-1)!
}

/** Fewer tags first; a building preset names the structure, not the place in it. */
function specificity(preset: CategoryResult): number {
  const buildingPenalty = preset.id.startsWith('building/') ? 0.5 : 0
  return Object.keys(preset.tags).length + buildingPenalty
}

function nameFor(icon: string, presets: CategoryResult[]): string | null {
  const preferred = presets.find(p => PREFERRED_PRESETS.has(p.id))
  if (preferred) return preferred.name

  const value = icon.replace(/-/g, '_')
  const [named] = presets
    .filter(p => tagValue(p.id) === value)
    .sort((a, b) => specificity(a) - specificity(b))
  if (named) return named.name

  const fewest = Math.min(...presets.map(p => Object.keys(p.tags).length))
  const generic = presets.filter(p => Object.keys(p.tags).length === fewest)
  return generic.length === 1 ? generic[0].name : null
}

/**
 * The place type each map icon stands for, keyed by icon name. Lucide names
 * are PascalCase and maki names kebab-case, so one key space holds both.
 * Icons no single type can name are left out.
 */
export function placeTypeLabels(
  categories: CategoryResult[],
): Record<string, string> {
  const byIcon = new Map<string, CategoryResult[]>()
  for (const category of categories) {
    if (!category.searchable || !category.iconName) continue
    if (getPlaceAttribute(category.id) || isPlaceGroup(category.id)) continue
    const presets = byIcon.get(category.iconName) ?? []
    presets.push(category)
    byIcon.set(category.iconName, presets)
  }

  const labels: Record<string, string> = {}
  for (const [icon, presets] of byIcon) {
    const name = nameFor(icon, presets)
    if (name) labels[icon] = name
  }
  return labels
}
