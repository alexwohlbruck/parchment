import type { Bookmark } from '@/types/library.types'
import type { ThemeColor } from '@/lib/utils'
import { frequentChipMeta } from '@/lib/frequents'

/** Place type names keyed by icon name, as `/search/categories/place-types` serves them. */
export type PlaceTypeLabels = Record<string, string>

export interface PlaceTypeFacet {
  key: string
  label: string
  icon: string
  iconPack: 'lucide' | 'maki'
  color: ThemeColor
  count: number
}

/** A place's type is the icon its row is drawn with. */
export function placeTypeKey(bookmark: Bookmark): string {
  return frequentChipMeta(bookmark).icon
}

/** The types a list can be narrowed to; empty unless at least two would split it. */
export function placeTypeFacets(
  bookmarks: Bookmark[],
  labels: PlaceTypeLabels,
): PlaceTypeFacet[] {
  const facets = new Map<string, PlaceTypeFacet>()
  for (const bookmark of bookmarks) {
    const key = placeTypeKey(bookmark)
    const label = labels[key]
    if (!label) continue
    const facet = facets.get(key)
    if (facet) {
      facet.count++
      continue
    }
    const look = frequentChipMeta(bookmark)
    facets.set(key, {
      key,
      label,
      icon: look.icon,
      iconPack: look.iconPack,
      color: look.color,
      count: 1,
    })
  }
  if (facets.size < 2) return []
  return [...facets.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  )
}

/** Places of any selected type; every place when none is selected. */
export function filterByPlaceTypes(
  bookmarks: Bookmark[],
  selected: readonly string[],
): Bookmark[] {
  if (!selected.length) return bookmarks
  return bookmarks.filter(bookmark => selected.includes(placeTypeKey(bookmark)))
}
