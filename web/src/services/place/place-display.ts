import type { RouteLocationRaw } from 'vue-router'
import { capitalize } from '@/lib/string'
import type { Place, PlaceCategory } from '@/types/place.types'
import type { Bookmark } from '@/types/library.types'
import type { RecentPlaceEntry, RecentSearchEntry } from '@/lib/recents'
import type { AutocompleteResult } from '@/types/search.types'
import type { ThemeColor } from '@/lib/utils'
import { AppRoute } from '@/router'
import { getPlaceRoute, getPlaceRouteFromExternalIds, getTransitStopRoute, formatAddress } from '@/lib/place/place.utils'
import { getCategoryColor } from '@/services/place/place-colors'
import { frequentChipMeta } from '@/lib/frequents'
import {
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultCategory,
  getSearchResultName,
} from '@/lib/search/search-result'

/**
 * The normalized shape every place-like surface renders from.
 *
 * Places reach the UI as several different records — a full `Place`, a saved
 * `Bookmark`, an autocomplete hit — and each used to grow its own icon/title/
 * subtitle logic at the call site. Adapting to `PlaceDisplay` first means
 * `PlaceCard` stays dumb and the derivation rules live in one testable place.
 *
 * Fields are already display-resolved: a `null` means "don't render this line",
 * not "unknown". Suppression rules (an address that just repeats the title, a
 * type that is already the title) are applied by the adapters below.
 */
export interface PlaceDisplay {
  /** Present when the surface can navigate to a place detail view. */
  id: string | null
  title: string
  icon: string
  iconPack: 'lucide' | 'maki'
  /** Themed chip colour — bookmarks and frequents, whose look is fixed by type. */
  color?: ThemeColor
  /** Resolved category colour for POIs. Takes precedence over `color` in ItemIcon. */
  customColor?: string
  /** Brand logo, rendered in place of an icon glyph. */
  imageUrl: string | null
  placeType: string | null
  address: string | null
  summary: string | null
  phone: string | null
  /** 0–5, already scaled from the stored 0–1 rating. */
  rating: number | null
  reviewCount: number | null
  openState: 'open' | 'closed' | null
  hoursText: string | null
  route: RouteLocationRaw | null
}

/** Minimal translation function — matches the `t` from `useI18n`. */
type TFn = (key: string) => string

/**
 * Build a display record from whatever fields a caller has, defaulting the
 * rest to "nothing to render". For sources that are neither a `Place` nor a
 * `Bookmark` — command-palette options, for instance — where spelling out
 * every null at the call site would bury the two fields that matter.
 */
export function makePlaceDisplay(
  fields: Partial<PlaceDisplay> & { title: string },
): PlaceDisplay {
  return {
    id: null,
    icon: 'MapPin',
    iconPack: 'lucide',
    imageUrl: null,
    placeType: null,
    address: null,
    summary: null,
    phone: null,
    rating: null,
    reviewCount: null,
    openState: null,
    hoursText: null,
    route: null,
    ...fields,
  }
}

export interface PlaceDisplayOptions {
  isDark: boolean
  t: TFn
}

/**
 * Place types that carry no information worth showing as a subtitle: either a
 * geometry-type fallback from a geocoder, or the generic catch-all.
 */
const UNINFORMATIVE_PLACE_TYPES = new Set([
  'place',
  'poi',
  'Point',
  'LineString',
  'Polygon',
  'MultiPolygon',
  'Line',
  'Area',
])


/** Open/closed state, but only where the hours data actually states it. */
function resolveHours(
  place: Place,
  t: TFn,
): { openState: 'open' | 'closed' | null; hoursText: string | null } {
  const hours = place.openingHours?.value
  if (!hours) return { openState: null, hoursText: null }

  if (hours.isPermanentlyClosed)
    return { openState: 'closed', hoursText: t('place.hours.permanentlyClosed') }
  if (hours.isTemporarilyClosed)
    return { openState: 'closed', hoursText: t('place.hours.temporarilyClosed') }
  if (hours.isOpen24_7)
    return { openState: 'open', hoursText: t('place.hours.open24hours') }

  return { openState: null, hoursText: null }
}

export function placeToDisplay(
  place: Place,
  { isDark, t }: PlaceDisplayOptions,
): PlaceDisplay {
  const title = getSearchResultName(place)
  const address = formatAddress(place)
  const rawType = place.placeType?.value

  // The type is only a useful subtitle when the title is the place's real name.
  // For an unnamed POI the title already *is* the type, so repeating it is noise.
  const hasRealName = !!place.name?.value
  const placeType =
    hasRealName && rawType && !UNINFORMATIVE_PLACE_TYPES.has(rawType)
      ? capitalize(rawType)
      : null

  const { openState, hoursText } = resolveHours(place, t)

  return {
    id: place.id,
    title,
    icon: getSearchResultIconName(place),
    iconPack: getSearchResultIconPack(place),
    customColor: getCategoryColor(getSearchResultCategory(place), isDark),
    imageUrl: null,
    placeType,
    // Suppress an address that only restates the title (unnamed POIs fall back
    // to the formatted address for their title).
    address: address && address !== title ? address : null,
    summary: place.summary ?? null,
    phone: place.contactInfo?.phone?.value ?? null,
    rating: place.ratings?.rating?.value ? place.ratings.rating.value * 5 : null,
    reviewCount: place.ratings?.reviewCount?.value ?? null,
    openState,
    hoursText,
    // A GTFS-only stop has no OSM place to open — route to its coordinates
    // instead (a transit-route id resolves fine through getPlaceRoute).
    route: place.transitStop
      ? getTransitStopRoute(
          title,
          place.geometry?.value?.center?.lat ?? 0,
          place.geometry?.value?.center?.lng ?? 0,
        )
      : place.id
        ? getPlaceRoute(place.id)
        : null,
  }
}

/**
 * A recently-viewed place. These are compact cached entries rather than full
 * records, so most detail lines are simply unavailable — `subtitle` is the
 * only text the entry carries.
 */
export function recentPlaceToDisplay(
  entry: RecentPlaceEntry,
  { isDark }: Pick<PlaceDisplayOptions, 'isDark'>,
): PlaceDisplay {
  return {
    id: entry.id,
    title: entry.title,
    icon: entry.icon || 'MapPin',
    iconPack: entry.iconPack ?? 'lucide',
    customColor: getCategoryColor(entry.category ?? 'default', isDark),
    imageUrl: null,
    placeType: null,
    address: entry.subtitle ?? null,
    summary: null,
    phone: null,
    rating: null,
    reviewCount: null,
    openState: null,
    hoursText: null,
    route: getPlaceRoute(entry.id),
  }
}

/**
 * Where re-selecting a recent search goes. Mirrors the palette's search action:
 * a category or brand recent re-runs that browse rather than searching for its
 * label as text, which would return places named after the category.
 */
export function recentSearchRoute(entry: RecentSearchEntry): RouteLocationRaw {
  if (entry.kind === 'category' && entry.categoryId) {
    return {
      name: AppRoute.SEARCH_RESULTS,
      query: {
        categoryId: entry.categoryId,
        ...(entry.query ? { categoryName: entry.query } : {}),
        ...(entry.iconCategory ? { categoryIconCategory: entry.iconCategory } : {}),
      },
    }
  }
  if (entry.kind === 'brand' && entry.brandKey) {
    return {
      name: AppRoute.SEARCH_RESULTS,
      query: {
        brandKey: entry.brandKey,
        ...(entry.brandName ? { brandName: entry.brandName } : {}),
      },
    }
  }
  return { name: AppRoute.SEARCH_RESULTS, query: { q: entry.query } }
}

/**
 * A recent search — a typed query, a POI category, or a brand browse. Adapted
 * to the same display record as a recent place so both kinds render as one
 * interleaved list; only the route differs (re-run a search vs open a place).
 */
export function recentSearchToDisplay(
  entry: RecentSearchEntry,
  { isDark }: Pick<PlaceDisplayOptions, 'isDark'>,
): PlaceDisplay {
  // Text searches have no icon of their own — they get the history glyph, the
  // same one the palette gives them.
  const fallbackIcon =
    entry.kind === 'category' ? 'MapPin' : entry.kind === 'brand' ? 'Store' : 'History'

  return makePlaceDisplay({
    title: entry.query,
    icon: entry.iconName || fallbackIcon,
    iconPack: entry.iconPack ?? 'lucide',
    customColor: getCategoryColor(
      (entry.iconCategory || 'default') as PlaceCategory,
      isDark,
    ),
    imageUrl: entry.brandLogoUrl ?? null,
    route: recentSearchRoute(entry),
  })
}

/**
 * An autocomplete suggestion. Thin by design — a title, a description and an
 * icon — so most detail lines are simply unavailable; the description is the
 * one subtitle the row carries.
 *
 * Adapting here rather than at the call site is what lets the directions
 * waypoint picker draw the same rows as search: a maki glyph stays a maki
 * glyph, and a category keeps its colour.
 */
export function autocompleteToDisplay(
  result: AutocompleteResult,
  { isDark }: Pick<PlaceDisplayOptions, 'isDark'>,
): PlaceDisplay {
  const isCurrentLocation = result.type === 'current_location'

  return makePlaceDisplay({
    title: result.title,
    icon: isCurrentLocation ? 'Locate' : result.icon || 'MapPin',
    iconPack: result.iconPack ?? 'lucide',
    // A bookmark's colour is fixed by its type and set on the row itself;
    // everything else takes its category's colour, as search results do.
    ...(result.color && result.type === 'bookmark'
      ? { color: result.color as ThemeColor }
      : {
          customColor: getCategoryColor(
            (result.iconCategory || 'default') as PlaceCategory,
            isDark,
          ),
        }),
    address: result.description ?? null,
  })
}

/**
 * Place types that name a point rather than a place: a plain address, a
 * dropped pin, a coordinate, a link's own stub. They have no identity to draw
 * an icon from — the surface showing them says "a stop is here" some other
 * way, with a start ring or an ordinal.
 */
const POINT_PLACE_TYPES = new Set([
  'area',
  'address',
  'coordinates',
  'shared_location',
  'current_location',
])

/**
 * A directions waypoint.
 *
 * Every surface that draws a stop — the waypoint inputs, the trip timeline,
 * the map markers — has to make the same three-way call: does this stop have
 * an icon of its own, is it your current position, or is it just a point? They
 * used to each decide separately, and drifted: a stop drawn as a restaurant on
 * the map was a numbered disc in the input.
 *
 * `ownIcon` says whether `display.icon` is the stop's own, so a caller can
 * fall back to its own start/stop marks rather than draw a generic pin.
 */
export function waypointToDisplay(
  place: Partial<Place> | null | undefined,
  { isDark, t, fallbackTitle = '' }: PlaceDisplayOptions & { fallbackTitle?: string },
): { display: PlaceDisplay; ownIcon: boolean } {
  if (place?.id === 'current-location') {
    return {
      display: makePlaceDisplay({
        title: place.name?.value || t('directions.currentLocation'),
        icon: 'Locate',
      }),
      ownIcon: true,
    }
  }

  const type = place?.placeType?.value?.toLowerCase?.().trim()
  const isPoint = !place?.id || (!!type && POINT_PLACE_TYPES.has(type))

  if (isPoint) {
    return {
      display: makePlaceDisplay({
        title:
          (place ? getSearchResultName(place as Place) : '') || fallbackTitle,
        icon: 'MapPin',
        // Spelled out rather than left to whatever each surface defaults to:
        // `ItemIcon` falls back to cobalt, so an unstyled pin came out blue in
        // the timeline while the same stop was a neutral plate on the map. The
        // uncategorised colour is what the marker system already paints a
        // place it can't categorise.
        customColor: getCategoryColor('default', isDark),
      }),
      ownIcon: false,
    }
  }

  const display = placeToDisplay(place as Place, { isDark, t })
  return {
    display: display.title ? display : { ...display, title: fallbackTitle },
    ownIcon: true,
  }
}

/**
 * A saved bookmark. Frequents (Home/Work/School and user-named ones) render
 * with the look fixed by their type; everything else keeps the saved POI's own
 * icon and colour.
 */
export function bookmarkToDisplay(bookmark: Bookmark): PlaceDisplay {
  const chip = frequentChipMeta(bookmark)

  return {
    id: bookmark.id,
    title: bookmark.name,
    icon: chip.icon,
    iconPack: chip.iconPack,
    color: chip.color,
    imageUrl: null,
    placeType: bookmark.frequentType ? capitalize(bookmark.frequentType) : null,
    address: bookmark.address ?? null,
    summary: null,
    phone: null,
    rating: null,
    reviewCount: null,
    openState: null,
    hoursText: null,
    route: getPlaceRouteFromExternalIds(bookmark.externalIds) ?? null,
  }
}
