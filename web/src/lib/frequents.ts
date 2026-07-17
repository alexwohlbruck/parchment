import type { ThemeColor } from '@/lib/utils'

/**
 * "Frequents" — bookmarks the app treats as fixed, always-available places,
 * distinguished by a `frequentType` tag (see `bookmarks.frequentType`).
 *
 *  - Home / Work / School are *canonical* types: each has a fixed icon, colour
 *    and label, so a Home always looks like a Home.
 *  - `custom` is a user-named frequent (e.g. "Gym"): it keeps the bookmark's
 *    own name as its label and the place's own icon/colour, both editable.
 *
 * The DB column stays `preset_type` — only the code concept was renamed.
 */
export const FREQUENT_TYPES = ['home', 'work', 'school'] as const

/** Canonical (fixed icon/label) frequent types. */
export type CanonicalFrequentType = (typeof FREQUENT_TYPES)[number]

/** Every frequent type, including the user-named `custom`. */
export type FrequentType = CanonicalFrequentType | 'custom'

interface FrequentMeta {
  /** Lucide icon name — canonical types override the bookmark's own icon so a
   *  Home always looks like a Home. */
  icon: string
  /** i18n key for the human label. */
  labelKey: string
  /** Theme colour for the icon chip. */
  color: ThemeColor
}

export const FREQUENT_META: Record<CanonicalFrequentType, FrequentMeta> = {
  home: { icon: 'Home', labelKey: 'library.types.home', color: 'cobalt' },
  work: { icon: 'Briefcase', labelKey: 'library.types.work', color: 'iris' },
  school: {
    icon: 'GraduationCap',
    labelKey: 'library.types.school',
    color: 'forest',
  },
}

/** Menu icon + label for the `custom` frequent option (no fixed chip icon). */
export const CUSTOM_FREQUENT_ICON = 'Star'
export const CUSTOM_FREQUENT_LABEL_KEY = 'library.types.custom'

/** True for a canonical type whose icon/colour is fixed by FREQUENT_META. */
export function isCanonicalFrequent(
  type: FrequentType | null | undefined,
): type is CanonicalFrequentType {
  return type === 'home' || type === 'work' || type === 'school'
}

/**
 * How to render a frequent bookmark's chip: canonical types use the fixed
 * FREQUENT_META icon/colour and a translated label; `custom` (and any untagged
 * bookmark) uses its own name, icon and colour. `labelKey` is set for canonical
 * types (translate it); `title` is set otherwise.
 */
export function frequentChipMeta(bookmark: {
  frequentType?: FrequentType | null
  name: string
  icon: string
  iconPack?: 'lucide' | 'maki'
  iconColor: string
}): {
  icon: string
  iconPack: 'lucide' | 'maki'
  color: ThemeColor
  labelKey?: string
  title?: string
} {
  if (isCanonicalFrequent(bookmark.frequentType)) {
    const meta = FREQUENT_META[bookmark.frequentType]
    return {
      icon: meta.icon,
      iconPack: 'lucide',
      color: meta.color,
      labelKey: meta.labelKey,
    }
  }
  return {
    icon: bookmark.icon,
    iconPack: bookmark.iconPack ?? 'lucide',
    color: bookmark.iconColor as ThemeColor,
    title: bookmark.name,
  }
}

/**
 * Derive `externalIds` from a search-result / place id string. This is the
 * inverse of the place-route encoding (`getPlaceRoute`) and of how bookmarks
 * store their ids — e.g. "osm/node/123" → { osm: "node/123" }. Splitting on
 * the FIRST slash preserves ids whose value contains slashes (pelias).
 * Returns an empty object for ids with no provider prefix.
 */
export function deriveExternalIds(id: string): Record<string, string> {
  const slash = id.indexOf('/')
  if (slash === -1) return {}
  const provider = id.slice(0, slash)
  const value = id.slice(slash + 1)
  if (!provider || !value) return {}
  return { [provider]: value }
}
