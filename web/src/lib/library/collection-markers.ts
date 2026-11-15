/** Each place wears the look its list row shows, tinted as a search result is. */

import type { Bookmark } from '@/types/library.types'
import { frequentChipMeta } from '@/lib/frequents'
import { markerPaint, type MarkerImageSpec, type PlaceMark } from '@/lib/map-marker'

export type ColorResolver = (color: string) => string

function isDrawable(bookmark: Bookmark): boolean {
  return Number.isFinite(bookmark.lat) && Number.isFinite(bookmark.lng)
}

/** The colour a place is tinted, resolved from its list row's look. */
export function collectionMarkerColor(bookmark: Bookmark, resolveColor: ColorResolver): string {
  return resolveColor(frequentChipMeta(bookmark).color)
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
    paint: markerPaint(collectionMarkerColor(bookmark, resolveColor), 'disc', isDark),
  }
}

export function drawableBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return bookmarks.filter(isDrawable)
}

/** One point per place; `marks` lines up with `bookmarks`, which must already be drawable. */
export function buildCollectionMarkersGeoJSON(bookmarks: Bookmark[], marks: PlaceMark[]) {
  return {
    type: 'FeatureCollection' as const,
    features: bookmarks.map((bookmark, index) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [bookmark.lng, bookmark.lat],
      },
      properties: {
        id: bookmark.id,
        name: bookmark.name,
        markerImage: marks[index].image,
        ink: marks[index].ink,
        // List order wins label collisions.
        sortKey: index,
      },
    })),
  }
}
