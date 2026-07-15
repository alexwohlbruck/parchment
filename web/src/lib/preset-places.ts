import type { ThemeColor } from '@/lib/utils'

/**
 * "Special" bookmarks the app treats as fixed, always-available places:
 * Home, Work, and School. These are ordinary bookmarks distinguished by a
 * `presetType` tag — see `bookmarks.presetType`. The three are singletons
 * (one each); setting a new Home reassigns the old one.
 */
export const PRESET_TYPES = ['home', 'work', 'school'] as const

export type PresetType = (typeof PRESET_TYPES)[number]

interface PresetMeta {
  /** Lucide icon name (canonical — overrides the bookmark's own icon in the
   *  special-place slots so a Home always looks like a Home). */
  icon: string
  /** i18n key for the human label. */
  labelKey: string
  /** Theme color for the slot's icon chip. */
  color: ThemeColor
}

export const PRESET_META: Record<PresetType, PresetMeta> = {
  home: { icon: 'Home', labelKey: 'library.types.home', color: 'cobalt' },
  work: { icon: 'Briefcase', labelKey: 'library.types.work', color: 'iris' },
  school: {
    icon: 'GraduationCap',
    labelKey: 'library.types.school',
    color: 'forest',
  },
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
