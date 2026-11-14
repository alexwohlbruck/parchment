/** Recently viewed places as quiet map markers, minus anything the map already marks. */

import type { RecentPlaceEntry } from '@/lib/recents'
import { isSamePlace, type ExternalIds } from '@/lib/library/external-ids'
import { placeIdExternalIds } from '@/lib/search/local-search'
import {
  markerImageId,
  markerPaint,
  type MarkerImageSpec,
} from '@/lib/map-marker'

/** Synthetic layer-selector row; its state lives in the layer visibility overrides. */
export const RECENT_PLACES_TOGGLE_ID = 'recent-places'

export const RECENT_PLACE_MARKER_LIMIT = 15

const MUTED_COLOR = '#78716c'
const FALLBACK_ICON = 'History'

export type DrawableRecentPlace = RecentPlaceEntry & { lat: number; lng: number }

interface SelectParams {
  /** Newest first, as the recents store lists them. */
  entries: RecentPlaceEntry[]
  /** External ids of every saved place, which draws its own marker. */
  saved: ExternalIds[]
  /** The place currently open, which wears the selected pin instead. */
  selectedId?: string | null
  limit?: number
}

function isDrawable(entry: RecentPlaceEntry): entry is DrawableRecentPlace {
  return (
    !entry.id.startsWith('transit-route/') &&
    Number.isFinite(entry.lat) &&
    Number.isFinite(entry.lng)
  )
}

export function selectRecentPlaceMarkers({
  entries,
  saved,
  selectedId,
  limit = RECENT_PLACE_MARKER_LIMIT,
}: SelectParams): DrawableRecentPlace[] {
  const result: DrawableRecentPlace[] = []
  for (const entry of entries) {
    if (result.length >= limit) break
    if (!isDrawable(entry) || entry.id === selectedId) continue
    const ids = placeIdExternalIds(entry.id)
    if (saved.some(s => isSamePlace(ids, s))) continue
    result.push(entry)
  }
  return result
}

export function recentPlaceMarkerSpec(
  entry: RecentPlaceEntry,
  isDark: boolean,
): MarkerImageSpec {
  const hasIcon = !!entry.icon
  return {
    shape: 'disc',
    pack: hasIcon ? (entry.iconPack ?? 'lucide') : 'lucide',
    name: hasIcon ? entry.icon! : FALLBACK_ICON,
    paint: markerPaint(MUTED_COLOR, 'disc', isDark),
  }
}

export function buildRecentPlacesGeoJSON(
  places: DrawableRecentPlace[],
  isDark: boolean,
) {
  return {
    type: 'FeatureCollection' as const,
    features: places.map((place, index) => {
      const spec = recentPlaceMarkerSpec(place, isDark)
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [place.lng, place.lat],
        },
        properties: {
          id: place.id,
          name: place.title,
          markerImage: markerImageId(spec),
          ink: spec.paint.ink,
          // The most recent wins collisions.
          sortKey: index,
        },
      }
    }),
  }
}
