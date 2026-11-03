/** Each place wears the look its list row shows, tinted as a search result is. */

import type { Bookmark } from '@/types/library.types'
import { frequentChipMeta } from '@/lib/frequents'
import {
  markerImageId,
  markerPaint,
  type MarkerImageSpec,
} from '@/lib/map-marker'

export type ColorResolver = (color: string) => string

function isDrawable(bookmark: Bookmark): boolean {
  return Number.isFinite(bookmark.lat) && Number.isFinite(bookmark.lng)
}

export function collectionMarkerSpec(
  bookmark: Bookmark,
  resolveColor: ColorResolver,
  isDark: boolean,
): MarkerImageSpec {
  const look = frequentChipMeta(bookmark)
  return {
    shape: 'disc',
    pack: look.iconPack,
    name: look.icon,
    paint: markerPaint(resolveColor(look.color), 'disc', isDark),
  }
}

export function collectionMarkerSpecs(
  bookmarks: Bookmark[],
  resolveColor: ColorResolver,
  isDark: boolean,
): MarkerImageSpec[] {
  return bookmarks
    .filter(isDrawable)
    .map(bookmark => collectionMarkerSpec(bookmark, resolveColor, isDark))
}

export function buildCollectionMarkersGeoJSON(
  bookmarks: Bookmark[],
  resolveColor: ColorResolver,
  isDark: boolean,
) {
  return {
    type: 'FeatureCollection' as const,
    features: bookmarks.filter(isDrawable).map((bookmark, index) => {
      const spec = collectionMarkerSpec(bookmark, resolveColor, isDark)
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [bookmark.lng, bookmark.lat],
        },
        properties: {
          id: bookmark.id,
          name: bookmark.name,
          markerImage: markerImageId(spec),
          // A POI label is set in its marker's glyph colour.
          ink: spec.paint.ink,
          // List order wins label collisions.
          sortKey: index,
        },
      }
    }),
  }
}
