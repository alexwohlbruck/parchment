/**
 * The palette's place suggestions.
 *
 * Merges encrypted recents, frequent places, curated category shortcuts,
 * brands and GTFS stops with the server autocomplete, deduping so one entity
 * never lands in two groups.
 */
import { useDark } from '@vueuse/core'
import { i18n } from '@/lib/i18n'
import type { PlaceCategory } from '@/types/place.types'
import { COMMON_CATEGORIES } from '@/lib/place/common-categories'
import { CommandArgumentOption } from '@/types/command.types'
import { frequentChipMeta } from '@/lib/frequents'
import { getBookmarkPlaceId } from '@/lib/place/place.utils'
import { getCategoryColor } from '@/services/place/place-colors'
import { recentPlaceIdentity, recentSearchIdentity, RecentSearchEntry, RecentPlaceEntry } from '@/lib/recents'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCommandService } from '@/services/command.service'
import { useSearchService } from '@/services/search.service'
import { useMapStore } from '@/stores/map.store'
import { useRecentsStore } from '@/stores/recents.store'

export async function buildSearchSuggestions(
  _query?: string,
  signal?: AbortSignal,
): Promise<CommandArgumentOption[]> {
  const t = (i18n.global as unknown as { t: (k: string, n?: any) => string }).t
  const isDark = useDark()
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

  const recentPlaceToEntry = (e: RecentPlaceEntry): RecentEntry => ({
    at: e.at,
    identity: recentPlaceIdentity(e),
    option: {
      value: e.id,
      name: e.title,
      description: e.subtitle,
      iconName: e.icon || 'MapPin',
      iconPack: (e.iconPack || 'lucide') as 'lucide' | 'maki',
      iconColor: getCategoryColor(
        (e.category || 'default') as PlaceCategory,
        isDark.value,
      ),
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
    const bookmarksStore = useBookmarksStore()
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

  const fullSearchItem = searchText.trim()
    ? [
        {
          value: 'search-more-results',
          name: searchText,
          iconName: 'Search',
          iconColor: getCategoryColor('default', isDark.value),
          group: 'fullSearch',
        },
      ]
    : []

  try {
    // Get map center for location-aware search
    const mapStore = useMapStore()
    const center = mapStore.mapCamera.center

    let lng, lat
    if (Array.isArray(center)) {
      ;[lng, lat] = center
    } else if (typeof center === 'object') {
      lng =
        'lng' in center
          ? center.lng
          : 'lon' in center
          ? center.lon
          : 0
      lat = center.lat || 0
    }

    // The server returns categories and places interleaved by relevance score.
    // Trust the server's ordering — no client-side category search or re-sort.
    const searchResults =
      await placeSearchService.getAutocompleteSuggestions({
        query: searchText,
        lat,
        lng,
      }, signal)
    const results = searchResults
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
      // Drop live results already surfaced in the Recents section.
      .filter(r => !recentIdentities.has(r.identity))
      .map(r => r.option)

    return [...fullSearchItem, ...recentItems, ...results]
  } catch (error) {
    console.error('Error loading search suggestions:', error)
    // Still surface recents even when the server search fails.
    return [...fullSearchItem, ...recentItems]
  }
}
