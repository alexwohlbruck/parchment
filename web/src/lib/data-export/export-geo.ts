/** The export's open formats: saved places as features, saved routes as tracks. */

import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson'
import type { ExportData, ExportedRoute } from '@/lib/data-export/export-format'

type Library = ExportData['library']

/** Flat, so every format shows them: KML as data fields, CSV as columns. */
type PlaceProperties = Record<string, string>

function placeFeature(
  place: { name: string; address?: string | null; lat: number; lng: number; externalIds: Record<string, string>; frequentType?: string | null },
  collections: string[],
): Feature<Point, PlaceProperties> {
  const optional = {
    address: place.address,
    collections: collections.join(', '),
    frequentType: place.frequentType,
  }
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [place.lng, place.lat] },
    properties: {
      name: place.name,
      ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value)),
      ...place.externalIds,
    } as PlaceProperties,
  }
}

/** Every saved place, private collections' included, each naming the collections it is in. */
export function libraryPlaces(library: Library): FeatureCollection<Point, PlaceProperties> {
  const names = new Map(library.collections.map(c => [c.id, c.name ?? '']))
  const named = (ids: string[]) => ids.map(id => names.get(id)).filter((n): n is string => !!n)

  const bookmarks = library.bookmarks.map(b => placeFeature(b, named(b.collectionIds)))
  const points = library.collections.flatMap(c =>
    (c.points ?? []).map(p => placeFeature(p, named([c.id]))),
  )
  return { type: 'FeatureCollection', features: [...bookmarks, ...points] }
}

function routePositions(route: ExportedRoute): Position[] {
  const { geometry, elevation } = route.body
  const aligned = elevation?.length === geometry.length
  return geometry.map(([lng, lat], i) => (aligned ? [lng, lat, elevation![i]] : [lng, lat]))
}

/** Each saved route as a line, with elevation where the route has it. */
export function routeTracks(routes: ExportedRoute[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter(route => route.body.geometry.length > 1)
      .map(route => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: routePositions(route) },
        properties: {
          name: route.name ?? '',
          description: route.description,
          mode: route.mode,
          distance: route.body.stats?.distance ?? null,
          duration: route.body.stats?.duration ?? null,
        },
      })),
  }
}
