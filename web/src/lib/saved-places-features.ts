/**
 * Turns saved places into the GeoJSON the map layer draws.
 *
 * Bookmarks and decrypted E2EE points are different shapes from different
 * places — one comes from a table the server can read, the other from an
 * envelope only the client can open — but they render identically, so both
 * normalize to one feature shape here.
 *
 * A place on the map wears its PARENT COLLECTION's icon and colour, not its
 * own: the map is a view of collections, so a dot's job is to say which
 * collection it belongs to. A place filed in several collections wears the
 * one it was added to most recently (`collectionIds[0]`, which the list
 * endpoint orders for us). Frequents are the exception — they live outside
 * collections entirely, so they wear the look fixed by their type.
 *
 * Kept free of stores so the selection and the feature shape can be tested
 * without a map or a pinia instance.
 */

import type { Bookmark, DecryptedPoint } from '@/types/library.types'
import type { SavedPlacesVisibility } from './saved-places-layers'
import type { MapIconSpec } from './map-icon-images'
import {
  FREQUENT_META,
  isCanonicalFrequent,
  CUSTOM_FREQUENT_ICON,
  CUSTOM_FREQUENT_COLOR,
} from './frequents'

/** How a collection wants its places drawn. */
export interface CollectionStyle {
  icon?: string | null
  iconPack?: 'lucide' | 'maki'
  iconColor?: string | null
}

export interface SavedPlace {
  id: string
  name: string
  lat: number
  lng: number
  icon: string
  iconPack: 'lucide' | 'maki'
  iconColor: string
  externalIds: Record<string, string>
}

const DEFAULT_ICON = 'Bookmark'
const DEFAULT_ICON_COLOR = 'cobalt'

/**
 * The look a place inherits: its parent collection's, or — for a frequent —
 * the one fixed by its type. Returns the collection default when a place has
 * neither, which in practice means a collection whose metadata hasn't
 * decrypted on this device yet.
 */
function inheritedStyle(
  place: { frequentType?: string | null },
  collection: CollectionStyle | undefined,
): { icon: string; iconPack: 'lucide' | 'maki'; iconColor: string } {
  const frequentType = place.frequentType
  if (isCanonicalFrequent(frequentType as any)) {
    const meta = FREQUENT_META[frequentType as 'home' | 'work' | 'school']
    return { icon: meta.icon, iconPack: 'lucide', iconColor: meta.color }
  }
  if (frequentType === 'custom') {
    return {
      icon: CUSTOM_FREQUENT_ICON,
      iconPack: 'lucide',
      iconColor: CUSTOM_FREQUENT_COLOR,
    }
  }
  return {
    icon: collection?.icon || DEFAULT_ICON,
    iconPack: collection?.iconPack ?? 'lucide',
    iconColor: collection?.iconColor || DEFAULT_ICON_COLOR,
  }
}

/**
 * Stored `iconColor` is usually a `ThemeColor` name (`'cobalt'`), not a colour
 * — Vue components map the name to Tailwind classes, but map paint properties
 * need a literal. Callers pass `themeColorToHex`; the default identity keeps
 * this module DOM-free and testable.
 */
export type ColorResolver = (color: string) => string
const identity: ColorResolver = c => c

function isDrawable(place: { lat?: unknown; lng?: unknown }): boolean {
  return (
    typeof place.lat === 'number' &&
    typeof place.lng === 'number' &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng)
  )
}

function normalizeBookmark(
  bookmark: Bookmark,
  collection: CollectionStyle | undefined,
  resolveColor: ColorResolver,
): SavedPlace {
  const style = inheritedStyle(bookmark, collection)
  return {
    id: bookmark.id,
    name: bookmark.name,
    lat: bookmark.lat,
    lng: bookmark.lng,
    icon: style.icon,
    iconPack: style.iconPack,
    iconColor: resolveColor(style.iconColor),
    externalIds: bookmark.externalIds ?? {},
  }
}

function normalizePoint(
  point: DecryptedPoint,
  collection: CollectionStyle | undefined,
  resolveColor: ColorResolver,
): SavedPlace {
  // Points only ever live in one collection, so there is no ordering to
  // resolve — but they inherit the same way a bookmark does.
  const style = inheritedStyle(point, collection)
  return {
    id: point.id,
    name: point.name,
    lat: point.lat,
    lng: point.lng,
    icon: style.icon,
    iconPack: style.iconPack,
    iconColor: resolveColor(style.iconColor),
    externalIds: point.externalIds ?? {},
  }
}

/**
 * Every place currently switched on.
 *
 * A bookmark in no collection is governed by `uncategorized`; one in several
 * draws if ANY of them is on, so hiding a collection can't make a place
 * vanish from another collection the user left visible.
 */
export function selectSavedPlaces(params: {
  bookmarks: Bookmark[]
  pointsByCollection: Record<string, DecryptedPoint[]>
  visibility: SavedPlacesVisibility
  /** Collection id → the look its places should wear. */
  collectionStyles: Record<string, CollectionStyle>
  resolveColor?: ColorResolver
}): SavedPlace[] {
  const {
    bookmarks,
    pointsByCollection,
    visibility,
    collectionStyles,
    resolveColor = identity,
  } = params
  if (!visibility.enabled) return []

  const places: SavedPlace[] = []

  for (const bookmark of bookmarks) {
    if (!isDrawable(bookmark)) continue

    // Frequents are their own bucket — standalone by design, and governed by
    // the frequents toggle rather than by any collection.
    if (bookmark.frequentType) {
      if (visibility.frequents) {
        places.push(normalizeBookmark(bookmark, undefined, resolveColor))
      }
      continue
    }

    const memberships = bookmark.collectionIds ?? []
    const visible =
      memberships.length === 0
        ? visibility.uncategorized
        : memberships.some(id => visibility.collectionIds.has(id))
    if (!visible) continue

    // Style after the most recently added VISIBLE collection: styling after a
    // collection the user has switched off would show a dot in the colours of
    // something they asked not to see.
    const styleSource = memberships.find(id => visibility.collectionIds.has(id))
    places.push(
      normalizeBookmark(
        bookmark,
        styleSource ? collectionStyles[styleSource] : undefined,
        resolveColor,
      ),
    )
  }

  for (const collectionId of visibility.collectionIds) {
    for (const point of pointsByCollection[collectionId] ?? []) {
      if (!isDrawable(point)) continue
      places.push(
        normalizePoint(point, collectionStyles[collectionId], resolveColor),
      )
    }
  }

  return places
}

export function buildSavedPlacesGeoJSON(places: SavedPlace[]) {
  return {
    type: 'FeatureCollection' as const,
    features: places.map(place => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [place.lng, place.lat],
      },
      // No `name`: places on the map are unlabelled. Which collection a dot
      // belongs to is carried by its icon and colour, and a screen of saved
      // places reads far better without a name beside every one of them.
      properties: {
        id: place.id,
        icon: place.icon,
        iconPack: place.iconPack,
        iconColor: place.iconColor,
      },
    })),
  }
}

/** The distinct glyphs a set of places needs registered as map images. */
export function savedPlaceIconSpecs(places: SavedPlace[]): MapIconSpec[] {
  return places.map(place => ({ pack: place.iconPack, name: place.icon }))
}
