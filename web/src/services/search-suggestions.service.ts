/**
 * The palette's place suggestions.
 *
 * Merges encrypted recents, frequent places, curated category shortcuts,
 * brands and GTFS stops with the server autocomplete, deduping so one entity
 * never lands in two groups.
 */
import { storeToRefs } from 'pinia'
import { useThemeStore } from '@/stores/theme.store'
import { i18n } from '@/lib/i18n'
import type { PlaceCategory } from '@/types/place.types'
import { COMMON_CATEGORIES } from '@/lib/place/common-categories'
import { CommandArgumentOption } from '@/types/command.types'
import { frequentChipMeta } from '@/lib/frequents'
import { getBookmarkPlaceId } from '@/lib/place/place-route'
import { getCategoryColor } from '@/services/place/place-colors'
import { recentPlaceIdentity, recentSearchIdentity, RecentSearchEntry, RecentPlaceEntry } from '@/lib/recents'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCommandService } from '@/services/command.service'
import { useSearchService } from '@/services/search.service'
import { useMapStore } from '@/stores/map.store'
import { useRecentsStore } from '@/stores/recents.store'
import { toLngLat } from '@/lib/geo/lng-lat'
import { intentFilters, LOOKUP_INTENT } from '@/lib/search/query-intent'
import type { QueryIntent } from '@/types/search.types'
import { useAskService } from '@/services/ask/ask.service'
import { isAskOffered } from '@/lib/ask/ask-access'
import { useAskPreferencesStore } from '@/stores/preferences/ask-preferences.store'

export const ASK_OPTION = 'ask'
export const FULL_SEARCH_OPTION = 'full-search'
export const RECENT_ASK_PREFIX = 'recent-ask:'
export const BROWSE_OPTION_PREFIX = 'browse:'

export async function buildSearchSuggestions(
  _query?: string,
  signal?: AbortSignal,
): Promise<CommandArgumentOption[]> {
  const t = (i18n.global as unknown as { t: (k: string, n?: any) => string }).t
  const { isDark } = storeToRefs(useThemeStore())
  const placeSearchService = useSearchService()

  // Use the command service to get the current search query
  const { currentSearchQuery } = useCommandService()
  const searchText = currentSearchQuery.value

  // Recent searches + places (client-side, end-to-end encrypted).
  // They surface in a dedicated "Recents" section, deduped from the
  // live result groups so the same entity never appears twice.
  // Hydration is a no-op after the first load.
  const recentsStore = useRecentsStore()
  const q = searchText.trim().toLowerCase()

  // A recent, ready to render, plus the metadata used to order and
  // dedupe it: `at` (recency) and `identity` (stable entity key).
  type RecentEntry = {
    option: CommandArgumentOption
    at: number
    identity: string
  }

  const recentSearchToEntry = (e: RecentSearchEntry): RecentEntry => {
    if (e.kind === 'category' && e.categoryId) {
      return {
        at: e.at,
        identity: recentSearchIdentity(e),
        option: {
          value: `category:${e.categoryId}`,
          name: e.query,
          iconName: e.iconName || 'MapPin',
          iconPack: (e.iconPack || 'lucide') as 'lucide' | 'maki',
          iconColor: getCategoryColor(
            (e.iconCategory || 'default') as PlaceCategory,
            isDark.value,
          ),
          group: 'recents',
        },
      }
    }
    if (e.kind === 'brand' && e.brandKey) {
      return {
        at: e.at,
        identity: recentSearchIdentity(e),
        option: {
          value: `brand:${encodeURIComponent(
            JSON.stringify({ key: e.brandKey, name: e.brandName || e.query }),
          )}`,
          name: e.query,
          iconName: e.iconName || 'Store',
          iconPack: (e.iconPack || 'lucide') as 'lucide' | 'maki',
          iconColor: getCategoryColor('default', isDark.value),
          imageUrl: e.brandLogoUrl,
          group: 'recents',
        },
      }
    }
    if (e.kind === 'ask') {
      return {
        at: e.at,
        identity: recentSearchIdentity(e),
        option: {
          value: `${RECENT_ASK_PREFIX}${encodeURIComponent(JSON.stringify({ q: e.query, thread: e.threadId }))}`,
          name: e.query,
          iconName: 'MessageCircleQuestion',
          iconColor: getCategoryColor('default', isDark.value),
          group: 'recents',
        },
      }
    }
    return {
      at: e.at,
      identity: recentSearchIdentity(e),
      option: {
        value: `recent-search:${e.query}`,
        name: e.query,
        iconName: 'History',
        iconColor: getCategoryColor('default', isDark.value),
        group: 'recents',
      },
    }
  }

  const bookmarksStore = useBookmarksStore()
  const bookmarkedPlaceIds = new Set(
    bookmarksStore.bookmarks.map(getBookmarkPlaceId).filter(Boolean),
  )

  const recentPlaceToEntry = (e: RecentPlaceEntry): RecentEntry => ({
    at: e.at,
    identity: recentPlaceIdentity(e),
    option: {
      value: e.id,
      name: e.title,
      description: bookmarkedPlaceIds.has(e.id)
        ? [t('palette.commands.search.bookmarked'), e.subtitle].filter(Boolean).join(' · ')
        : e.subtitle,
      iconName: e.icon || 'MapPin',
      iconPack: (e.iconPack || 'lucide') as 'lucide' | 'maki',
      iconColor: getCategoryColor(
        (e.category || 'default') as PlaceCategory,
        isDark.value,
      ),
      bullet: e.bullet,
      group: 'recents',
    },
  })

  // Merge every recent kind, keep the ones matching `predicate`,
  // order newest-first, and cap the section.
  const buildRecents = (
    predicate: (label: string) => boolean,
  ): RecentEntry[] =>
    [
      ...recentsStore.searches
        .filter(e => predicate(e.query))
        .map(recentSearchToEntry),
      ...recentsStore.places
        .filter(e => predicate(e.title) || predicate(e.subtitle || ''))
        .map(recentPlaceToEntry),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 8)

  // ── Empty query → frequents, common categories, recents. ──
  if (!q) {
    // Deliberately NOT awaited: recents live in an encrypted blob
    // that has to be fetched and decrypted, and blocking on it made
    // the first palette open sit on a spinner even though the
    // frequents and category shortcuts are already in memory. The
    // palette re-runs this once hydration lands, filling the
    // Recents section in place.
    void recentsStore.ensureSearchesHydrated()
    void recentsStore.ensurePlacesHydrated()

    // Frequents: Home / Work / School / custom, rendered as tiles.
    const frequentItems = bookmarksStore.bookmarks
      .filter(b => b.frequentType)
      .slice(0, 8)
      .map(b => {
        const meta = frequentChipMeta(b)
        return {
          value: getBookmarkPlaceId(b) ?? '',
          name: meta.labelKey ? t(meta.labelKey) : meta.title ?? b.name,
          description: b.address || undefined,
          iconName: meta.icon,
          iconPack: meta.iconPack,
          color: meta.color,
          group: 'frequents',
        }
      })
      .filter(item => item.value)

    const recentEntries = buildRecents(() => true)

    // Common categories: a fixed, curated set of browse shortcuts.
    // Always shown in full — it's a stable menu, so using one doesn't
    // make it disappear (it may also appear under Recents, which is
    // fine: the menu and your history mean different things).
    const suggestedCategoryItems = COMMON_CATEGORIES.map(c => ({
      value: `category:${c.id}`,
      name: t(c.labelKey),
      iconName: c.icon,
      iconPack: 'lucide' as const,
      iconColor: getCategoryColor(c.category, isDark.value),
      group: 'suggestedCategories',
    }))

    return [
      ...frequentItems,
      ...suggestedCategoryItems,
      ...recentEntries.map(r => r.option),
    ]
  }

  // ── Typed query → server autocomplete + matching recents. ──
  await Promise.all([
    recentsStore.ensureSearchesHydrated(),
    recentsStore.ensurePlacesHydrated(),
  ])

  // Matching recents → their own section; also used to dedupe the
  // same entity out of the live brands/categories/places groups.
  const recentEntries = buildRecents(label => {
    const l = label.toLowerCase()
    return l.includes(q) && l !== q
  })
  const recentIdentities = new Set(recentEntries.map(r => r.identity))
  const recentItems = recentEntries.map(r => r.option)

  const askAccess = useAskService().loadAccess().catch(() => null)
  const askItem = async (intent: QueryIntent): Promise<CommandArgumentOption[]> => {
    const access = await askAccess
    if (!isAskOffered(access)) return []
    return [
      {
        value: ASK_OPTION,
        name: searchText,
        iconName: 'MessageCircleQuestion',
        iconColor: getCategoryColor('default', isDark.value),
        group: intent.intent === 'ask' && useAskPreferencesStore().preferences.suggest ? 'ask' : 'askLast',
      },
    ]
  }

  const browseItem = (intent: QueryIntent): CommandArgumentOption[] => {
    const { category, attributes = [], openNow } = intent
    if (intent.intent !== 'browse' || !category) return []
    const payload = encodeURIComponent(JSON.stringify({
      categoryId: category.id,
      categoryName: category.name,
      filters: intentFilters(intent),
    }))
    return [
      {
        value: `${BROWSE_OPTION_PREFIX}${payload}`,
        name: [
          category.name,
          ...attributes.map(a => a.name),
          ...(openNow ? [t('palette.commands.search.browse.openNow')] : []),
        ].join(' · '),
        iconName: 'ListFilter',
        iconColor: getCategoryColor('default', isDark.value),
        group: 'browse',
      },
    ]
  }

  try {
    // Get map center for location-aware search
    const mapStore = useMapStore()
    const { lng, lat } = toLngLat(mapStore.mapCamera.center)

    // The server returns categories and places interleaved by relevance score.
    // Trust the server's ordering — no client-side category search or re-sort.
    const { results: searchResults, intent } =
      await placeSearchService.getAutocomplete({
        query: searchText,
        lat,
        lng,
      }, signal)
    const mapped = searchResults
      .map(result => {
        // Brand suggestion ("See all McDonald's locations"): encode the
        // key + name so the action can browse it; own group + icon.
        if (result.type === 'brand' && result.brand) {
          const payload = encodeURIComponent(
            JSON.stringify({ key: result.brand.brandKey, name: result.brand.name }),
          )
          return {
            identity: `brand:${result.brand.brandKey}`,
            option: {
              value: `brand:${payload}`,
              name: result.title,
              description: result.brand.locationCount != null
                ? t('palette.commands.search.brand.locationsCount', { count: result.brand.locationCount })
                : t('palette.commands.search.brand.seeAll'),
              iconName: result.icon || 'Store',
              iconPack: (result.iconPack || 'lucide') as 'lucide' | 'maki',
              iconColor: getCategoryColor('default', isDark.value),
              imageUrl: result.brand.logoUrl,
              group: 'brands',
            },
          }
        }

        // A transit line wears its route bullet — short name on
        // the line's own colour — instead of a generic icon.
        if (result.type === 'transit_route' && result.transitLine?.shortName) {
          return {
            identity: `place:${result.id}`,
            option: {
              value: result.id,
              // The bullet already says the short name; the row
              // reads "Broadway Express", not "Q · Broadway Express".
              name: result.transitLine.longName || result.title,
              description: result.description,
              bullet: {
                label: result.transitLine.shortName,
                color: result.transitLine.color,
                textColor: result.transitLine.textColor,
              },
              group: 'places',
            },
          }
        }

        // GTFS-only stop: the action needs coordinates and the
        // portolan index key, neither of which fit in a bare id —
        // encode them like the brand payload above.
        if (result.type === 'transit_stop') {
          const payload = encodeURIComponent(
            JSON.stringify({
              name: result.title,
              lat: result.lat,
              lng: result.lng,
              feedOnestopId: result.transitStop?.feedOnestopId,
              stopId: result.transitStop?.stopId,
            }),
          )
          return {
            identity: `place:${result.id}`,
            option: {
              value: `transit-stop:${payload}`,
              name: result.title,
              description: result.description,
              iconName: result.icon || 'MapPin',
              iconPack: (result.iconPack || 'lucide') as 'lucide' | 'maki',
              iconColor: getCategoryColor('default', isDark.value),
              group: 'places',
            },
          }
        }

        // A bookmark comes back under its own id; open and dedupe it as
        // the place it saves.
        if (result.type === 'bookmark') {
          const bookmark = bookmarksStore.getBookmarkById(result.id)
          const placeId = (bookmark && getBookmarkPlaceId(bookmark)) || result.id
          return {
            identity: `place:${placeId}`,
            bookmarked: true,
            option: {
              value: placeId,
              name: result.title,
              description: result.description,
              iconName: result.icon || 'Bookmark',
              iconPack: result.iconPack || 'lucide',
              iconColor: getCategoryColor('default', isDark.value),
              group: 'places',
            },
          }
        }

        const itemValue = result.type === 'category'
          ? `category:${result.id}`
          : result.id
        const iconCategory = (result.iconCategory || 'default') as PlaceCategory
        return {
          identity:
            result.type === 'category'
              ? `category:${result.id}`
              : `place:${result.id}`,
          option: {
            value: itemValue,
            name: result.title,
            description: result.description && !/^\S+=\S+$/.test(result.description)
              ? result.description
              : undefined,
            iconName: result.icon || 'MapPin',
            iconPack: result.iconPack || 'lucide',
            iconColor: getCategoryColor(iconCategory, isDark.value),
            group: result.type === 'category' ? 'categories' : 'places',
          },
        }
      })
    const bookmarkIdentities = new Set(
      mapped.filter(r => r.bookmarked).map(r => r.identity),
    )
    const results = mapped
      // Drop live results already surfaced in the Recents section, and
      // plain place hits for a place that is also a bookmark result.
      .filter(r =>
        !recentIdentities.has(r.identity) &&
        (r.bookmarked || !bookmarkIdentities.has(r.identity)),
      )
      .map(r => r.option)

    return [
      ...browseItem(intent),
      ...(await askItem(intent)),
      ...recentItems,
      ...results,
    ]
  } catch (error) {
    console.error('Error loading search suggestions:', error)
    // Still surface recents even when the server search fails.
    return [...(await askItem(LOOKUP_INTENT)), ...recentItems]
  }
}
